// Builds the Fastify application without binding a port, so tests can exercise
// routes in-process and the server entry point owns startup.
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

  // Liveness only: database readiness is added with PostgreSQL (T3-001-B).
  app.get('/api/health', async () => ({ status: 'ok' }));

  return app;
}
