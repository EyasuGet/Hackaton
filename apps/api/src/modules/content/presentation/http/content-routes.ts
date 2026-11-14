// HTTP access to approved lesson content for signed-in learners (T3-005-B).
// A forbidden course and a missing source both answer 404, so existence is
// never revealed; a withdrawn or removed section the learner may see answers 410.
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { principalOf, requireRole } from '../../../identity/presentation/http/authentication.ts';
import type { ContentAccess } from '../../application/content-access.ts';

const ID = '^[a-z0-9][a-z0-9-]{0,99}$';

export function registerContentRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  content: ContentAccess,
) {
  const learnerOnly = [authenticated, requireRole('learner')];

  app.get<{ Querystring: { q: string } }>(
    '/api/content/search',
    {
      preHandler: learnerOnly,
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          properties: { q: { type: 'string', minLength: 1, maxLength: 500 } },
        },
      },
    },
    async (request) => ({
      passages: (await content.search(principalOf(request), request.query.q)).map((passage) => ({
        sourceId: passage.sourceId,
        sectionId: passage.sectionId,
        sourceTitle: passage.sourceTitle,
        heading: passage.heading,
        excerpt: passage.text.length > 200 ? `${passage.text.slice(0, 200)}…` : passage.text,
        language: passage.language,
        courseId: passage.courseId,
      })),
    }),
  );

  app.get<{ Params: { sourceId: string; sectionId: string } }>(
    '/api/content/sources/:sourceId/sections/:sectionId',
    {
      preHandler: learnerOnly,
      schema: {
        params: {
          type: 'object',
          properties: {
            sourceId: { type: 'string', pattern: ID },
            sectionId: { type: 'string', pattern: ID },
          },
        },
      },
    },
    async (request, reply) => {
      const { sourceId, sectionId } = request.params;
      const result = await content.resolve(principalOf(request), sourceId, sectionId);
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (result.kind === 'unavailable') {
        return reply.code(410).send({ error: 'unavailable', reason: result.reason });
      }
      return result.section;
    },
  );
}
