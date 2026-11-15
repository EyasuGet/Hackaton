// HTTP presentation routes for speech synthesis (T3-011 & T3-024-C).
// Endpoints are restricted to authenticated learners, bound input sizes,
// enforce provider admission and rate limits, and release capacity on completion/failure/cancellation.

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import { principalOf } from '../../../identity/presentation/http/authentication.ts';
import type { SpeechSynthesizerProvider } from '../../application/ports/speech-synthesizer-provider.ts';
import {
  ProviderAdmissionError,
  type ProviderAdmissionController,
} from '../../application/provider-admission.ts';
import { DefaultSpeechSynthesizerProvider } from '../../infrastructure/default-speech-provider.ts';

interface SynthesizeRequestBody {
  text: string;
  lang: string;
}

const SUPPORTED_LANGUAGES = ['en', 'am', 'en-us', 'am-et'];

export function registerSpeechRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  admission: ProviderAdmissionController,
  speechProvider: SpeechSynthesizerProvider = new DefaultSpeechSynthesizerProvider(),
): void {
  app.post<{ Body: SynthesizeRequestBody }>(
    '/api/speech/synthesize',
    { preHandler: [authenticated] },
    async (request: FastifyRequest<{ Body: SynthesizeRequestBody }>, reply: FastifyReply) => {
      const { text, lang } = request.body ?? {};

      if (!text || typeof text !== 'string' || text.trim() === '') {
        return reply.code(400).send({ error: 'invalid_text' });
      }

      if (text.length > admission.limits.maxSpeechTextLength) {
        return reply.code(400).send({
          error: 'input_too_large',
          message: `Speech text exceeds maximum allowed length of ${admission.limits.maxSpeechTextLength} characters`,
        });
      }

      if (!lang || typeof lang !== 'string') {
        return reply.code(400).send({ error: 'unsupported_language' });
      }

      const normalisedLang = lang.trim().toLowerCase();
      const isSupported = SUPPORTED_LANGUAGES.some((s) => normalisedLang.startsWith(s));
      if (!isSupported) {
        return reply.code(400).send({
          error: 'unsupported_language',
          message: `Language '${lang}' is not supported for speech synthesis`,
        });
      }

      const principal = principalOf(request);

      let lease;
      try {
        lease = await admission.acquire(principal.id, request.signal);
      } catch (err: unknown) {
        if (err instanceof ProviderAdmissionError) {
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
        }
        throw err;
      }

      try {
        const audio = await speechProvider.synthesize({
          text: text.trim(),
          language: normalisedLang,
          signal: request.signal,
        });
        return reply.code(200).type('audio/wav').send(audio);
      } catch (err: unknown) {
        if (request.signal?.aborted) {
          return reply.code(499).send({ error: 'cancelled' });
        }
        return reply.code(502).send({ error: 'provider_error', message: String(err) });
      } finally {
        lease.release();
      }
    },
  );
}
