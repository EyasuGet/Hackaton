// HTTP presentation routes for tutoring requests, conversations and history.
// Endpoints are restricted to authenticated learners; attempts to access records
// of another learner or ungranted courses return 404 to avoid leaking existence.
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { principalOf, requireRole } from '../../../identity/presentation/http/authentication.ts';
import type { Tutoring } from '../../application/tutoring.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ClaimRequestBody {
  courseId: string;
  requestId: string;
  question: string;
  conversationId?: string;
}

export function registerTutoringRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  tutoring: Tutoring,
) {
  const learnerOnly = { preHandler: [authenticated, requireRole('learner')] };

  // Claims a request atomically; returns 201 Created on new claim or 200 OK on existing.
  app.post<{ Body: ClaimRequestBody }>(
    '/api/tutoring/requests',
    learnerOnly,
    async (request, reply) => {
      const { courseId, requestId, question, conversationId } = request.body ?? {};

      if (!courseId || typeof courseId !== 'string' || courseId.trim() === '') {
        return reply.code(400).send({ error: 'invalid_course_id' });
      }
      if (!requestId || typeof requestId !== 'string' || requestId.trim() === '') {
        return reply.code(400).send({ error: 'invalid_request_id' });
      }
      if (!question || typeof question !== 'string' || question.trim() === '') {
        return reply.code(400).send({ error: 'invalid_question' });
      }
      if (conversationId !== undefined && !UUID.test(conversationId)) {
        return reply.code(404).send({ error: 'not_found' });
      }

      const principal = principalOf(request);
      const result = await tutoring.claim(principal, {
        courseId: courseId.trim(),
        requestId: requestId.trim(),
        question: question.trim(),
        ...(conversationId !== undefined ? { conversationId } : {}),
      });

      if (!result) {
        return reply.code(404).send({ error: 'not_found' });
      }

      const statusCode = result.kind === 'claimed' ? 201 : 200;
      return reply.code(statusCode).send({
        kind: result.kind,
        request: result.request,
      });
    },
  );

  // Ask an approved FAQ answer directly through tutoring, returning cited answers or limitation (T3-007-A).
  app.post<{ Body: ClaimRequestBody }>('/api/tutoring/faq', learnerOnly, async (request, reply) => {
    const { courseId, requestId, question, conversationId } = request.body ?? {};

    if (!courseId || typeof courseId !== 'string' || courseId.trim() === '') {
      return reply.code(400).send({ error: 'invalid_course_id' });
    }
    if (!requestId || typeof requestId !== 'string' || requestId.trim() === '') {
      return reply.code(400).send({ error: 'invalid_request_id' });
    }
    if (!question || typeof question !== 'string' || question.trim() === '') {
      return reply.code(400).send({ error: 'invalid_question' });
    }
    if (conversationId !== undefined && !UUID.test(conversationId)) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const principal = principalOf(request);
    const result = await tutoring.askFaq(principal, {
      courseId: courseId.trim(),
      requestId: requestId.trim(),
      question: question.trim(),
      ...(conversationId !== undefined ? { conversationId } : {}),
    });

    if (!result) {
      return reply.code(404).send({ error: 'not_found' });
    }

    return reply.code(200).send({
      request: result.request,
      answer: result.faqResult.answerText,
      lang: result.faqResult.answerLang,
      kind: result.faqResult.kind,
      citations: result.faqResult.citations,
    });
  });

  // Lists request history for the learner, optionally filtered by courseId.
  app.get<{ Querystring: { courseId?: string } }>(
    '/api/tutoring/history',
    learnerOnly,
    async (request) => {
      const principal = principalOf(request);
      const courseId = request.query.courseId?.trim() || undefined;
      const history = await tutoring.listHistory(principal, courseId);
      return { history };
    },
  );

  // Gets a specific request by id.
  app.get<{ Params: { id: string } }>(
    '/api/tutoring/requests/:id',
    learnerOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const record = await tutoring.getRequest(principal, id);
      return record ?? reply.code(404).send({ error: 'not_found' });
    },
  );

  // Gets a specific conversation by id.
  app.get<{ Params: { id: string } }>(
    '/api/tutoring/conversations/:id',
    learnerOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const conv = await tutoring.getConversation(principal, id);
      return conv ?? reply.code(404).send({ error: 'not_found' });
    },
  );
}
