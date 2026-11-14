// HTTP presentation routes for accommodation requests (T3-022-A).
// Learners may submit and cancel their own requests; support principals may
// read any non-expired request by ID. Attempts to access another learner's
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

export function registerAccommodationRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  accommodation: Accommodation,
) {
  const learnerOnly = { preHandler: [authenticated, requireRole('learner')] };

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

  // Gets a single accommodation request by id.
  // Learners can read their own; support principals can read any non-expired request.
  app.get<{ Params: { id: string } }>(
    '/api/accommodation/requests/:id',
    { preHandler: [authenticated] },
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
