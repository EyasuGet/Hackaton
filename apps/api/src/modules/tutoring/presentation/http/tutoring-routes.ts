// HTTP presentation routes for tutoring requests, conversations, history,
// online/FAQ answers, and voice transcription (T3-007-A, T3-007-C, T3-010-A).
// Endpoints are restricted to authenticated learners; attempts to access records
// of another learner or ungranted courses return 404 to avoid leaking existence.
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import { principalOf, requireRole } from '../../../identity/presentation/http/authentication.ts';
import { TutoringError, type Tutoring } from '../../application/tutoring.ts';
import type { TranscriptionPort } from '../../application/ports/transcription-port.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ClaimRequestBody {
  courseId: string;
  requestId: string;
  question: string;
  conversationId?: string;
  externalConsent?: boolean;
  simpleLanguage?: boolean;
}

export function registerTutoringRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  tutoring: Tutoring,
  transcription?: TranscriptionPort,
) {
  const learnerOnly = { preHandler: [authenticated, requireRole('learner')] };

  async function handleAnswerRequest(
    request: FastifyRequest<{ Body: ClaimRequestBody }>,
    reply: FastifyReply,
  ) {
    const { courseId, requestId, question, conversationId, externalConsent, simpleLanguage } =
      request.body ?? {};

    if (!courseId || typeof courseId !== 'string' || courseId.trim() === '') {
      return reply.code(400).send({ error: 'invalid_course_id' });
    }
    if (!requestId || typeof requestId !== 'string' || requestId.trim() === '') {
      return reply.code(400).send({ error: 'invalid_request_id' });
    }
    if (!question || typeof question !== 'string' || question.trim() === '') {
      return reply.code(400).send({ error: 'invalid_question' });
    }
    if (question.length > tutoring.admissionController.limits.maxQuestionLength) {
      return reply.code(400).send({
        error: 'input_too_large',
        message: `Question exceeds maximum allowed length of ${tutoring.admissionController.limits.maxQuestionLength} characters`,
      });
    }
    if (conversationId !== undefined && !UUID.test(conversationId)) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const principal = principalOf(request);

    try {
      const result = await tutoring.ask(
        principal,
        {
          courseId: courseId.trim(),
          requestId: requestId.trim(),
          question: question.trim(),
          ...(conversationId !== undefined ? { conversationId } : {}),
          externalConsent: externalConsent === true,
          simpleLanguage: simpleLanguage === true,
        },
        { signal: request.signal },
      );

      if (!result) {
        return reply.code(404).send({ error: 'not_found' });
      }

      return reply.code(200).send({
        request: result.request,
        answer: result.answerText,
        lang: result.answerLang,
        kind: result.kind,
        provider: result.provider,
        citations: result.citations,
        ...(result.simpleLanguage ? { simpleLanguage: true } : {}),
      });
    } catch (err: unknown) {
      if (err instanceof TutoringError) {
        if (err.code === 'busy') {
          const retryAfter = err.retryAfterSeconds ?? 3;
          return reply.code(503).header('Retry-After', String(retryAfter)).send({
            error: 'busy',
            message: err.message,
            retryAfterSeconds: retryAfter,
          });
        }
        if (err.code === 'rate_limited') {
          const retryAfter = err.retryAfterSeconds ?? 5;
          return reply.code(429).header('Retry-After', String(retryAfter)).send({
            error: 'rate_limited',
            message: err.message,
            retryAfterSeconds: retryAfter,
          });
        }
        if (err.code === 'input_too_large') {
          return reply.code(400).send({
            error: 'input_too_large',
            message: err.message,
          });
        }
        if (err.code === 'timeout') {
          return reply.code(504).send({ error: 'timeout', message: err.message });
        }
        if (
          err.code === 'invented_citation' ||
          err.code === 'unsupported_output' ||
          err.code === 'unverified_citation'
        ) {
          return reply
            .code(422)
            .send({ error: 'unsupported_output', reason: err.code, message: err.message });
        }
        if (err.code === 'provider_error') {
          return reply.code(502).send({ error: 'provider_error', message: err.message });
        }
      }
      throw err;
    }
  }

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
      if (question.length > tutoring.admissionController.limits.maxQuestionLength) {
        return reply.code(400).send({
          error: 'input_too_large',
          message: `Question exceeds maximum allowed length of ${tutoring.admissionController.limits.maxQuestionLength} characters`,
        });
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

  // Primary unified answer endpoint (T3-007-C) supporting online provider and FAQ fallback.
  app.post<{ Body: ClaimRequestBody }>('/api/tutoring/answers', learnerOnly, handleAnswerRequest);

  // Ask an approved FAQ answer directly through tutoring (T3-007-A & T3-007-C).
  app.post<{ Body: ClaimRequestBody }>('/api/tutoring/faq', learnerOnly, handleAnswerRequest);

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

  // Clears the authenticated learner's own conversation history.
  // Returns 204 No Content on success; non-learners receive 403.
  app.delete('/api/tutoring/history', learnerOnly, async (request, reply) => {
    const principal = principalOf(request);
    await tutoring.clearHistory(principal);
    return reply.code(204).send();
  });

  if (transcription) {
    // Transcribes a learner-supplied audio clip to text (T3-010-A).
    // Accepts base64-encoded audio with its MIME type. Audio is held only in
    // memory during the API call; it is never persisted or logged.
    app.post<{ Body: { audio?: string; mimeType?: string } }>(
      '/api/tutoring/transcription',
      learnerOnly,
      async (request, reply) => {
        const { audio, mimeType } = request.body ?? {};
        if (typeof audio !== 'string' || !audio.trim()) {
          return reply.code(400).send({ error: 'audio is required' });
        }
        if (typeof mimeType !== 'string' || !mimeType.trim()) {
          return reply.code(400).send({ error: 'mimeType is required' });
        }

        const outcome = await transcription.transcribe({
          audioBase64: audio.trim(),
          mimeType: mimeType.trim(),
        });

        switch (outcome.status) {
          case 'transcribed':
            return reply.code(200).send({
              transcript: outcome.transcript,
              lang: outcome.detectedLang === 'unknown' ? 'en' : outcome.detectedLang,
            });
          case 'unsupported_format':
            return reply.code(400).send({ error: 'unsupported_format' });
          case 'too_large':
            return reply.code(413).send({ error: 'audio_too_large' });
          case 'empty_audio':
            return reply.code(400).send({ error: 'empty_audio' });
          case 'provider_unavailable':
            return reply.code(503).send({ error: 'provider_unavailable' });
          case 'provider_error':
            return reply.code(502).send({ error: 'provider_error' });
        }
      },
    );
  }

  // Triggers an expiry purge up to the current instant. Restricted to support role
  // only; learners cannot trigger purges. Returns the count of purged rows.
  app.post(
    '/api/tutoring/admin/purge',
    { preHandler: [authenticated, requireRole('support')] },
    async (_request, reply) => {
      const purged = await tutoring.purgeExpired(new Date());
      return reply.code(200).send({ purged });
    },
  );
}
