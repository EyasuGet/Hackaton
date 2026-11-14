// Builds the Fastify application without binding a port, so tests can exercise
// routes in-process and the server entry point owns startup and wiring.
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import type { Readiness } from '../infrastructure/database/migrations.ts';
import type { DemoRecords } from '../modules/demo-records/demo-records.ts';
import { registerDemoRecordRoutes } from '../modules/demo-records/http.ts';
import type { ResolvePrincipal } from '../modules/identity/application/resolve-principal.ts';
import {
  authenticate,
  registerIdentityRoutes,
} from '../modules/identity/presentation/http/authentication.ts';

export interface AppDependencies {
  /** Must not throw: report an unavailable dependency as not ready. */
  readonly checkReadiness: () => Promise<Readiness>;
  readonly resolvePrincipal: ResolvePrincipal;
  readonly demoRecords: DemoRecords;
}

export function buildApp(
  dependencies: AppDependencies,
  options: FastifyServerOptions = {},
): FastifyInstance {
  const app = Fastify(options);

  // Unexpected failures (for example a database outage during authentication)
  // return a fixed body: driver messages can contain connection details.
  // Typed as FastifyError (Fastify's documented pattern): statusCode/code are optional,
  // so a plain thrown Error (no statusCode) is treated as a 500.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.statusCode !== undefined && error.statusCode < 500) return reply.send(error);
    request.log.error({ code: error.code }, 'Request failed');
    return reply.code(500).send({ error: 'internal' });
  });

  // Liveness: the process is up, regardless of dependencies.
  app.get('/api/health', (_request, reply) => reply.send({ status: 'ok' }));

  // Readiness: the API can serve requests that need the database. The reason is
  // a fixed code; driver errors are never returned to the client.
  app.get('/api/ready', async (_request, reply) => {
    const readiness = await dependencies.checkReadiness();
    if (readiness.ready) return { status: 'ready' };
    return reply.code(503).send({ status: 'not_ready', reason: readiness.reason });
  });

  registerIdentityRoutes(app, dependencies.resolvePrincipal);
  registerDemoRecordRoutes(
    app,
    authenticate(dependencies.resolvePrincipal),
    dependencies.demoRecords,
  );

  return app;
}
