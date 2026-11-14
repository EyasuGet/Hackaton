// Builds the Fastify application without binding a port, so tests can exercise
// routes in-process and the server entry point owns startup and wiring.
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Readiness } from '../infrastructure/database/migrations.ts';

export interface AppDependencies {
  /** Must not throw: report an unavailable dependency as not ready. */
  readonly checkReadiness: () => Promise<Readiness>;
}

export function buildApp(
  dependencies: AppDependencies,
  options: FastifyServerOptions = {},
): FastifyInstance {
  const app = Fastify(options);

  // Liveness: the process is up, regardless of dependencies.
  app.get('/api/health', (_request, reply) => reply.send({ status: 'ok' }));

  // Readiness: the API can serve requests that need the database. The reason is
  // a fixed code; driver errors are never returned to the client.
  app.get('/api/ready', async (_request, reply) => {
    const readiness = await dependencies.checkReadiness();
    if (readiness.ready) return { status: 'ready' };
    return reply.code(503).send({ status: 'not_ready', reason: readiness.reason });
  });

  return app;
}
