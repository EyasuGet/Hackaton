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

interface ReplyBody {
  clientReplyId: string;
  body: string;
}

export function registerHelpRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  help: Help,
  staffHelp: StaffHelp,
) {
  const learnerOnly = { preHandler: [authenticated, requireRole('learner')] };
  const supportOnly = { preHandler: [authenticated, requireRole('support')] };
  const authenticated_ = { preHandler: [authenticated] };

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

  // Adds a reply to a help request.
  // Learner (owner) may reply to their own waiting/claimed request.
  // Support staff may reply to any claimed request.
  // Returns 201 on new reply, 200 on duplicate (idempotent clientReplyId).
  // Returns 409 when the request is in a terminal state or expired.
  app.post<{ Params: { id: string }; Body: ReplyBody }>(
    '/api/help/requests/:id/replies',
    authenticated_,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const { clientReplyId, body } = request.body ?? {};
      if (!clientReplyId || typeof clientReplyId !== 'string' || clientReplyId.trim() === '') {
        return reply.code(400).send({ error: 'invalid_client_reply_id' });
      }
      if (!body || typeof body !== 'string' || body.trim() === '') {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      const principal = principalOf(request);
      let result;

      if (principal.role === 'learner') {
        result = await help.addReply(principal, id, clientReplyId.trim(), body);
      } else if (principal.role === 'support') {
        result = await staffHelp.addReply(principal, id, clientReplyId.trim(), body);
      } else {
        return reply.code(403).send({ error: 'forbidden' });
      }

      if (!result) return reply.code(409).send({ error: 'terminal_or_not_found' });
      const statusCode = result.kind === 'added' ? 201 : 200;
      return reply.code(statusCode).send({ kind: result.kind, reply: result.reply });
    },
  );

  // Lists replies for a help request in chronological order.
  // Learner (owner) may list their own request's replies.
  // Support staff may list any request's replies.
  app.get<{ Params: { id: string } }>(
    '/api/help/requests/:id/replies',
    authenticated_,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      let replies;

      if (principal.role === 'learner') {
        replies = await help.listReplies(principal, id);
      } else if (principal.role === 'support') {
        replies = await staffHelp.listReplies(principal, id);
      } else {
        return reply.code(403).send({ error: 'forbidden' });
      }

      if (replies === null) return reply.code(404).send({ error: 'not_found' });
      return { replies };
    },
  );

  // Marks all unread replies (by others) on the learner's own request as read.
  // Learner marks their staff-sent replies as read.
  // Support marks their learner-sent replies as read.
  app.put<{ Params: { id: string } }>(
    '/api/help/requests/:id/replies/read',
    authenticated_,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      let success;

      if (principal.role === 'learner') {
        success = await help.markRepliesRead(principal, id);
      } else if (principal.role === 'support') {
        success = await staffHelp.markRepliesRead(principal, id);
      } else {
        return reply.code(403).send({ error: 'forbidden' });
      }

      if (!success) return reply.code(404).send({ error: 'not_found' });
      return reply.code(204).send();
    },
  );

  // Resolves a claimed help request. Support-only.
  // Returns 200 with the updated request on success.
  // Returns 404 when the request does not exist, is not in claimed state, or has expired.
  app.post<{ Params: { id: string } }>(
    '/api/help/requests/:id/resolve',
    supportOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const resolved = await staffHelp.resolveRequest(principal, id);

      if (!resolved) return reply.code(404).send({ error: 'not_found' });
      return reply.code(200).send({ request: resolved });
    },
  );
}
