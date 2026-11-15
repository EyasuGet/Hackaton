// HTTP presentation routes for accommodation requests (T3-022-A, T3-022-B).
// Learners may submit and cancel their own requests; support principals (coordinators) may
// read, claim, reply to, and resolve requests. Attempts to access another learner's
// record return 404 to avoid leaking existence.
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { principalOf, requireRole } from '../../../identity/presentation/http/authentication.ts';
import type { Accommodation } from '../../application/accommodation.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SubmitBody {
  clientRequestId: string;
  jobId: string;
  supportDescription: string;
}

interface ReplyBody {
  clientReplyId: string;
  body: string;
}

export function registerAccommodationRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  accommodation: Accommodation,
) {
  const learnerOnly = { preHandler: [authenticated, requireRole('learner')] };
  const supportOnly = { preHandler: [authenticated, requireRole('support')] };
  const authenticated_ = { preHandler: [authenticated] };

  // Submits an accommodation request after learner confirms the preview.
  // Returns 201 on new submission, 200 on idempotent duplicate.
  app.post<{ Body: SubmitBody }>(
    '/api/accommodation/requests',
    learnerOnly,
    async (request, reply) => {
      const { clientRequestId, jobId, supportDescription } = request.body ?? {};

      if (
        !clientRequestId ||
        typeof clientRequestId !== 'string' ||
        clientRequestId.trim() === ''
      ) {
        return reply.code(400).send({ error: 'invalid_client_request_id' });
      }
      if (!jobId || typeof jobId !== 'string' || jobId.trim() === '') {
        return reply.code(400).send({ error: 'invalid_job_id' });
      }
      if (
        !supportDescription ||
        typeof supportDescription !== 'string' ||
        supportDescription.trim() === ''
      ) {
        return reply.code(400).send({ error: 'invalid_support_description' });
      }

      const principal = principalOf(request);
      const result = await accommodation.submit(principal, {
        clientRequestId: clientRequestId.trim(),
        jobId: jobId.trim(),
        supportDescription: supportDescription.trim(),
      });

      if (!result) return reply.code(404).send({ error: 'not_found' });

      if (result.kind === 'job_not_found') {
        return reply.code(422).send({ error: 'job_not_found' });
      }

      const statusCode = result.kind === 'submitted' ? 201 : 200;
      return reply.code(statusCode).send({ kind: result.kind, request: result.request });
    },
  );

  // Cancels an owned waiting accommodation request. Returns 404 when not found,
  // already cancelled, claimed, or expired.
  app.delete<{ Params: { id: string } }>(
    '/api/accommodation/requests/:id',
    learnerOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const cancelled = await accommodation.cancel(principal, id);
      if (!cancelled) return reply.code(404).send({ error: 'not_found' });
      return reply.code(200).send({ request: cancelled });
    },
  );

  // Gets a single accommodation request by id.
  // Learners can read their own; support principals can read any non-expired request.
  app.get<{ Params: { id: string } }>(
    '/api/accommodation/requests/:id',
    authenticated_,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const record = await accommodation.getById(principal, id);
      return record ?? reply.code(404).send({ error: 'not_found' });
    },
  );

  // Lists non-expired accommodation requests.
  // Learner gets owned requests; support principal gets coordinator tracking view.
  app.get('/api/accommodation/requests', authenticated_, async (request) => {
    const principal = principalOf(request);
    if (principal.role === 'learner') {
      const requests = await accommodation.listOwned(principal);
      return { requests };
    }
    const requests = (await accommodation.listForCoordinator(principal)) ?? [];
    return { requests };
  });

  // Coordinator queue: returns non-expired waiting requests without raw support descriptions.
  app.get('/api/accommodation/queue', supportOnly, async (request, reply) => {
    const principal = principalOf(request);
    const queue = await accommodation.listQueue(principal);
    if (!queue) return reply.code(403).send({ error: 'forbidden' });
    return { queue };
  });

  // Coordinator inbox: returns non-expired accommodation requests for coordinator tracking.
  app.get('/api/accommodation/inbox', supportOnly, async (request, reply) => {
    const principal = principalOf(request);
    const requests = await accommodation.listForCoordinator(principal);
    if (!requests) return reply.code(403).send({ error: 'forbidden' });
    return { requests };
  });

  app.get('/api/accommodation/coordinator/requests', supportOnly, async (request, reply) => {
    const principal = principalOf(request);
    const requests = await accommodation.listForCoordinator(principal);
    if (!requests) return reply.code(403).send({ error: 'forbidden' });
    return { requests };
  });

  // Atomically claims a waiting request for the authenticated coordinator.
  // Returns 200 with the full request on success.
  // Returns 409 when already claimed.
  // Returns 404 when not found or in terminal state.
  app.post<{ Params: { id: string } }>(
    '/api/accommodation/requests/:id/claim',
    supportOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const result = await accommodation.claimRequest(principal, id);

      if (!result) return reply.code(404).send({ error: 'not_found' });
      if (result.kind === 'already_claimed') {
        return reply
          .code(409)
          .send({ error: 'already_claimed', claimedBy: result.request.claimedBy });
      }
      return reply.code(200).send({ request: result.request });
    },
  );

  // Transitions a claimed accommodation request to resolved. Coordinator-only.
  // Returns 200 with the updated request on success.
  // Returns 404 when the request does not exist, is not in claimed state, or has expired.
  app.post<{ Params: { id: string } }>(
    '/api/accommodation/requests/:id/resolve',
    supportOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const resolved = await accommodation.resolveRequest(principal, id);

      if (!resolved) return reply.code(404).send({ error: 'not_found' });
      return reply.code(200).send({ request: resolved });
    },
  );

  // Adds a reply to an accommodation request.
  // Learner (owner) may reply to their own waiting/claimed request.
  // Coordinator (support) may reply to any active request.
  // Returns 201 on new reply, 200 on duplicate (idempotent clientReplyId).
  // Returns 409 when the request is in a terminal state or expired.
  app.post<{ Params: { id: string }; Body: ReplyBody }>(
    '/api/accommodation/requests/:id/replies',
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
      const result = await accommodation.addReply(principal, id, clientReplyId.trim(), body);

      if (!result) return reply.code(409).send({ error: 'terminal_or_not_found' });
      const statusCode = result.kind === 'added' ? 201 : 200;
      return reply.code(statusCode).send({ kind: result.kind, reply: result.reply });
    },
  );

  // Lists replies for an accommodation request in chronological order.
  // Learner (owner) may list their own request's replies.
  // Support staff may list any request's replies.
  app.get<{ Params: { id: string } }>(
    '/api/accommodation/requests/:id/replies',
    authenticated_,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const replies = await accommodation.listReplies(principal, id);

      if (replies === null) return reply.code(404).send({ error: 'not_found' });
      return { replies };
    },
  );

  // Marks unread replies (by others) as read.
  app.put<{ Params: { id: string } }>(
    '/api/accommodation/requests/:id/replies/read',
    authenticated_,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const success = await accommodation.markRepliesRead(principal, id);

      if (!success) return reply.code(404).send({ error: 'not_found' });
      return reply.code(204).send();
    },
  );
}
