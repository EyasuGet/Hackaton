// HTTP presentation routes for learner help requests. Only authenticated
// learners may submit or cancel their own requests; attempts to access
// another learner's record return 404 to avoid leaking existence.
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { principalOf, requireRole } from '../../../identity/presentation/http/authentication.ts';
import type { Help } from '../../application/help.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SubmitBody {
  clientRequestId: string;
  contextSnapshot: string;
}

export function registerHelpRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  help: Help,
) {
  const learnerOnly = { preHandler: [authenticated, requireRole('learner')] };

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
}
