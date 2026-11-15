// Builds the Fastify application without binding a port, so tests can exercise
// routes in-process and the server entry point owns startup and wiring.
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import type { Readiness } from '../infrastructure/database/migrations.ts';
import type { ContentAccess } from '../modules/content/application/content-access.ts';
import { registerContentRoutes } from '../modules/content/presentation/http/content-routes.ts';
import type { DemoRecords } from '../modules/demo-records/demo-records.ts';
import { registerDemoRecordRoutes } from '../modules/demo-records/http.ts';
import type { DemoSessions } from '../modules/identity/application/demo-sessions.ts';
import type { ResolvePrincipal } from '../modules/identity/application/resolve-principal.ts';
import {
  authenticate,
  registerIdentityRoutes,
} from '../modules/identity/presentation/http/authentication.ts';
import { registerDemoSessionRoutes } from '../modules/identity/presentation/http/demo-session-routes.ts';
import type { Accommodation } from '../modules/accommodation/application/accommodation.ts';
import { registerAccommodationRoutes } from '../modules/accommodation/presentation/http/accommodation-routes.ts';
import type { JobAnswers } from '../modules/careers/application/job-answers.ts';
import type { JobRepository } from '../modules/careers/application/import-jobs.ts';
import type { JobPreferences } from '../modules/careers/application/job-preferences.ts';
import { registerCareersRoutes } from '../modules/careers/presentation/http/careers-routes.ts';
import type { Help } from '../modules/help/application/help.ts';
import type { StaffHelp } from '../modules/help/application/staff-help.ts';
import { registerHelpRoutes } from '../modules/help/presentation/http/help-routes.ts';
import type { Sharing } from '../modules/sharing/application/sharing.ts';
import { registerSharingRoutes } from '../modules/sharing/presentation/http/sharing-routes.ts';
import type { TelegramLinkService } from '../modules/telegram/application/telegram-link-service.ts';
import { registerTelegramRoutes } from '../modules/telegram/presentation/http/telegram-routes.ts';
import type { TranscriptionPort } from '../modules/tutoring/application/ports/transcription-port.ts';
import type { Tutoring } from '../modules/tutoring/application/tutoring.ts';
import { registerTutoringRoutes } from '../modules/tutoring/presentation/http/tutoring-routes.ts';

export interface AppDependencies {
  /** Must not throw: report an unavailable dependency as not ready. */
  readonly checkReadiness: () => Promise<Readiness>;
  readonly resolvePrincipal: ResolvePrincipal;
  readonly demoRecords: DemoRecords;
  readonly demoSessions: DemoSessions;
  /** Exact page origins allowed to start a demo session. */
  readonly demoAllowedOrigins: readonly string[];
  readonly tutoring: Tutoring;
  /** Optional; when omitted the transcription route is not registered. */
  readonly transcription?: TranscriptionPort;
  readonly content: ContentAccess;
  /** Optional; when omitted the help routes are not registered (for tests that do not exercise them). */
  readonly help?: Help;
  readonly staffHelp?: StaffHelp;
  /** Optional; when omitted sharing session routes are not registered. */
  readonly sharing?: Sharing;
  /** Optional; when omitted accommodation and job listing routes are not registered. */
  readonly accommodation?: Accommodation;
  readonly jobRepository?: JobRepository;
  readonly jobPreferences?: JobPreferences;
  readonly jobAnswers?: JobAnswers;
  /** Optional; when omitted Telegram channel routes are not registered. */
  readonly telegramService?: TelegramLinkService;
}

export function buildApp(
  dependencies: AppDependencies,
  options: FastifyServerOptions = {},
): FastifyInstance {
  const loggerOptions =
    typeof options.logger === 'object' && options.logger !== null
      ? {
          ...options.logger,
          redact: [
            'req.headers["x-telegram-bot-api-secret-token"]',
            'req.headers.authorization',
            '*.token',
            '*.secret',
            '*.code',
            ...(Array.isArray((options.logger as Record<string, unknown>).redact)
              ? ((options.logger as Record<string, unknown>).redact as string[])
              : []),
          ],
        }
      : options.logger === true
        ? {
            redact: [
              'req.headers["x-telegram-bot-api-secret-token"]',
              'req.headers.authorization',
              '*.token',
              '*.secret',
              '*.code',
            ],
          }
        : options.logger;

  const app = Fastify({
    ...options,
    ...(loggerOptions !== undefined ? { logger: loggerOptions } : {}),
  });

  // Unexpected failures (for example a database outage during authentication)
  // return a fixed body: driver messages can contain connection details.
  // Typed as FastifyError (Fastify's documented pattern): statusCode/code are optional,
  // so a plain thrown Error (no statusCode) is treated as a 500.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.statusCode !== undefined && error.statusCode < 500) return reply.send(error);
    // Name and code identify the failure without the message, which may hold connection details.
    request.log.error({ name: error.name, code: error.code }, 'Request failed');
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
  registerDemoSessionRoutes(
    app,
    authenticate(dependencies.resolvePrincipal),
    dependencies.demoSessions,
    dependencies.demoAllowedOrigins,
  );
  registerContentRoutes(app, authenticate(dependencies.resolvePrincipal), dependencies.content);
  registerDemoRecordRoutes(
    app,
    authenticate(dependencies.resolvePrincipal),
    dependencies.demoRecords,
  );
  registerTutoringRoutes(
    app,
    authenticate(dependencies.resolvePrincipal),
    dependencies.tutoring,
    dependencies.transcription,
  );
  if (dependencies.help && dependencies.staffHelp) {
    registerHelpRoutes(
      app,
      authenticate(dependencies.resolvePrincipal),
      dependencies.help,
      dependencies.staffHelp,
    );
  }
  if (dependencies.sharing) {
    registerSharingRoutes(app, authenticate(dependencies.resolvePrincipal), dependencies.sharing);
  }
  if (dependencies.jobRepository) {
    registerCareersRoutes(
      app,
      authenticate(dependencies.resolvePrincipal),
      dependencies.jobRepository,
      dependencies.jobPreferences,
      dependencies.jobAnswers,
    );
  }
  if (dependencies.accommodation) {
    registerAccommodationRoutes(
      app,
      authenticate(dependencies.resolvePrincipal),
      dependencies.accommodation,
    );
  }
  if (dependencies.telegramService) {
    registerTelegramRoutes(app, dependencies.resolvePrincipal, dependencies.telegramService);
  }
  return app;
}
