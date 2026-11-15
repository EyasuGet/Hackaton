// HTTP presentation routes for accommodation requests (T3-022-A, T3-022-B).
// Learners may submit and cancel their own requests; support principals may
// read any non-expired request by ID, view the coordinator queue, update request status,
// and exchange private replies with the requesting learner.
// Attempts to access another learner's record return 404 to avoid leaking existence.
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import { principalOf, requireRole } from '../../../identity/presentation/http/authentication.ts';
import type { Accommodation } from '../../application/accommodation.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SubmitBody {
  clientRequestId: string;
  jobId: string;
  supportDescription: string;
}

interface StatusBody {
  status: string;
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
  // already cancelled, or expired.
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

  // Lists all accommodation requests for an authorised coordinator (support role).
  app.get('/api/accommodation/coordinator/requests', supportOnly, async (request, reply) => {
    const principal = principalOf(request);
    const requests = await accommodation.listCoordinatorQueue(principal);
    if (!requests) return reply.code(403).send({ error: 'forbidden' });
    return { requests };
  });

  // Alias for coordinator queue
  app.get('/api/accommodation/queue', supportOnly, async (request, reply) => {
    const principal = principalOf(request);
    const requests = await accommodation.listCoordinatorQueue(principal);
    if (!requests) return reply.code(403).send({ error: 'forbidden' });
    return { requests };
  });

  // Updates request status (reviewing, confirmed, declined). Coordinator only.
  const handleStatusUpdate = async (
    request: FastifyRequest<{ Params: { id: string }; Body: StatusBody }>,
    reply: FastifyReply,
  ) => {
    const { id } = request.params;
    if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

    const { status } = request.body ?? {};
    if (status !== 'reviewing' && status !== 'confirmed' && status !== 'declined') {
      return reply.code(400).send({ error: 'invalid_status' });
    }

    const principal = principalOf(request);
    const updated = await accommodation.updateStatus(principal, id, status);
    if (!updated) return reply.code(404).send({ error: 'terminal_or_not_found' });
    return reply.code(200).send({ request: updated });
  };

  app.post<{ Params: { id: string }; Body: StatusBody }>(
    '/api/accommodation/requests/:id/status',
    supportOnly,
    async (request, reply) => handleStatusUpdate(request, reply),
  );

  app.patch<{ Params: { id: string }; Body: StatusBody }>(
    '/api/accommodation/requests/:id/status',
    supportOnly,
    async (request, reply) => handleStatusUpdate(request, reply),
  );

  // Adds a reply to an accommodation request (T3-022-B).
  // Requesting learner may reply to their owned active request; coordinator may reply to any active request.
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
      const result = await accommodation.addReply(principal, id, clientReplyId.trim(), body.trim());

      if (!result) return reply.code(409).send({ error: 'terminal_or_not_found' });
      const statusCode = result.kind === 'added' ? 201 : 200;
      return reply.code(statusCode).send({ kind: result.kind, reply: result.reply });
    },
  );

  // Lists replies for an accommodation request in chronological order.
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

  // Marks unread replies (by others) on the accommodation request as read.
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

  // Lists non-expired accommodation requests for the authenticated learner.
  app.get('/api/accommodation/requests', learnerOnly, async (request) => {
    const principal = principalOf(request);
    const requests = await accommodation.listOwned(principal);
    return { requests };
  });
}
