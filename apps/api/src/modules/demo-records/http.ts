// FIXTURE ONLY: protected routes demonstrating the identity rules. Records are
// learner-only; a record that is missing, belongs to someone else or sits in an
// ungranted course returns the same 404, so its existence is never revealed.
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { principalOf, requireRole } from '../identity/presentation/http/authentication.ts';
import type { DemoRecords } from './demo-records.ts';

// Anything that is not a UUID cannot exist; answering 404 early also keeps
// malformed ids away from PostgreSQL's uuid cast.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerDemoRecordRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  demoRecords: DemoRecords,
) {
  const learnerOnly = { preHandler: [authenticated, requireRole('learner')] };

  app.get('/api/demo/records', learnerOnly, async (request) => ({
    records: await demoRecords.list(principalOf(request)),
  }));

  app.get<{ Params: { id: string } }>(
    '/api/demo/records/:id',
    learnerOnly,
    async (request, reply) => {
      const { id } = request.params;
      const record = UUID.test(id) ? await demoRecords.get(principalOf(request), id) : null;
      return record ?? reply.code(404).send({ error: 'not_found' });
    },
  );

  // A support-only operation, so tests can show a learner cannot reach staff actions.
  app.get(
    '/api/demo/support-check',
    { preHandler: [authenticated, requireRole('support')] },
    () => ({ ok: true }),
  );
}
