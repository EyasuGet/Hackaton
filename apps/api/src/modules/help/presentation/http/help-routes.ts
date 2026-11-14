// HTTP presentation routes for learner and staff help requests. Only
// authenticated learners may submit or cancel their own requests; only support
// staff may access the queue and claim endpoints.
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { principalOf, requireRole } from '../../../identity/presentation/http/authentication.ts';
import type { Help } from '../../application/help.ts';
import type { StaffHelp } from '../../application/staff-help.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SubmitBody {
  clientRequestId: string;
  contextSnapshot: string;
}

export function registerHelpRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  help: Help,
  staffHelp: StaffHelp,
) {
  const learnerOnly = { preHandler: [authenticated, requireRole('learner')] };
  const supportOnly = { preHandler: [authenticated, requireRole('support')] };

  // Submits a help request. Returns 201 on new submission, 200 on duplicate.
  app.post<{ Body: SubmitBody }>('/api/help/requests', learnerOnly, async (request, reply) => {
    const { clientRequestId, contextSnapshot } = request.body ?? {};

    if (!clientRequestId || typeof clientRequestId !== 'string' || clientRequestId.trim() === '') {
      return reply.code(400).send({ error: 'invalid_client_request_id' });
    }
    if (!contextSnapshot || typeof contextSnapshot !== 'string' || contextSnapshot.trim() === '') {
      return reply.code(400).send({ error: 'invalid_context_snapshot' });
    }

    const principal = principalOf(request);
    const result = await help.submit(principal, {
      clientRequestId: clientRequestId.trim(),
      contextSnapshot: contextSnapshot.trim(),
    });

    if (!result) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const statusCode = result.kind === 'submitted' ? 201 : 200;
    return reply.code(statusCode).send({ kind: result.kind, request: result.request });
  });

  // Cancels an owned waiting help request. Returns 404 when not found, already
  // cancelled, or expired.
  app.delete<{ Params: { id: string } }>(
    '/api/help/requests/:id',
    learnerOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const cancelled = await help.cancel(principal, id);
      if (!cancelled) return reply.code(404).send({ error: 'not_found' });
      return reply.code(200).send({ request: cancelled });
    },
  );

  // Gets a single owned help request by id.
  app.get<{ Params: { id: string } }>(
    '/api/help/requests/:id',
    learnerOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const record = await help.getById(principal, id);
      return record ?? reply.code(404).send({ error: 'not_found' });
    },
  );

  // Lists non-expired help requests for the authenticated learner.
  app.get('/api/help/requests', learnerOnly, async (request) => {
    const principal = principalOf(request);
    const requests = await help.listOwned(principal);
    return { requests };
  });

  // Returns all non-expired waiting requests (queue metadata, no context snapshots).
  // Staff-only: 403 for learners.
  app.get('/api/help/queue', supportOnly, async (request, reply) => {
    const principal = principalOf(request);
    const queue = await staffHelp.listQueue(principal);
    if (!queue) return reply.code(403).send({ error: 'forbidden' });
    return { queue };
  });

  // Atomically claims a waiting request for the authenticated support principal.
  // Returns 200 with the full request (including contextSnapshot) on success.
  // Returns 409 when another staff member already claimed it.
  // Returns 404 when the request does not exist or is not in waiting state.
  app.post<{ Params: { id: string } }>(
    '/api/help/requests/:id/claim',
    supportOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const result = await staffHelp.claimRequest(principal, id);

      if (!result) return reply.code(404).send({ error: 'not_found' });
      if (result.kind === 'already_claimed') {
        return reply
          .code(409)
          .send({ error: 'already_claimed', claimedBy: result.request.claimedBy });
      }
      return reply.code(200).send({ request: result.request });
    },
  );
}
