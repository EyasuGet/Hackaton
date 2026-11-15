// API process entry point: validate configuration, wire dependencies, then listen.
// The API starts even if PostgreSQL is down; /api/ready reports when it can serve.
import { buildApp } from './bootstrap/app.ts';
import { loadConfig, loadOrExit } from './bootstrap/config.ts';
import { createPool } from './infrastructure/database/connection.ts';
import {
  checkReadiness,
  loadMigrations,
  MIGRATIONS_DIR,
} from './infrastructure/database/migrations.ts';
import { ContentAccess } from './modules/content/application/content-access.ts';
import { loadGlossary } from './modules/content/infrastructure/glossary-file.ts';
import { PostgresLessonReader } from './modules/content/infrastructure/postgres-lesson-reader.ts';
import { DemoRecords } from './modules/demo-records/demo-records.ts';
import { PostgresDemoRecordRepository } from './modules/demo-records/postgres-demo-record-repository.ts';
import { DemoSessions } from './modules/identity/application/demo-sessions.ts';
import { ResolvePrincipal } from './modules/identity/application/resolve-principal.ts';
import { PostgresDemoSessionRepository } from './modules/identity/infrastructure/postgres-demo-session-repository.ts';
import { PostgresPrincipalRepository } from './modules/identity/infrastructure/postgres-principal-repository.ts';
import { Accommodation } from './modules/accommodation/application/accommodation.ts';
import { PostgresAccommodationRepository } from './modules/accommodation/infrastructure/persistence/postgres-accommodation-repository.ts';
import { JobAnswers } from './modules/careers/application/job-answers.ts';
import { JobPreferences } from './modules/careers/application/job-preferences.ts';
import { PostgresJobPreferencesRepository } from './modules/careers/infrastructure/postgres-job-preferences-repository.ts';
import { PostgresJobRepository } from './modules/careers/infrastructure/postgres-job-repository.ts';
import { Help } from './modules/help/application/help.ts';
import { StaffHelp } from './modules/help/application/staff-help.ts';
import { PostgresHelpRepository } from './modules/help/infrastructure/persistence/postgres-help-repository.ts';
import { Sharing } from './modules/sharing/application/sharing.ts';
import { PostgresHelpRequestLookup } from './modules/sharing/infrastructure/persistence/postgres-help-request-lookup.ts';
import { PostgresSharingRepository } from './modules/sharing/infrastructure/persistence/postgres-sharing-repository.ts';
import { GeminiGroundedAnswerProvider } from './evaluations/grounding/provider-adapter.ts';
import { TelegramLinkService } from './modules/telegram/application/telegram-link-service.ts';
import { PostgresTelegramLinkRepository } from './modules/telegram/infrastructure/persistence/postgres-telegram-link-repository.ts';
import { FaqProvider } from './modules/tutoring/application/faq-provider.ts';
import { Tutoring } from './modules/tutoring/application/tutoring.ts';
import { GeminiTranscriptionAdapter } from './modules/tutoring/infrastructure/gemini-transcription-adapter.ts';
import { ProviderAdmissionController } from './modules/tutoring/application/provider-admission.ts';
import { PostgresTutoringRepository } from './modules/tutoring/infrastructure/persistence/postgres-tutoring-repository.ts';

const config = loadOrExit(() => loadConfig(process.env));
const migrations = await loadMigrations(MIGRATIONS_DIR);
const glossary = await loadGlossary();

// Log only the driver's error code: messages can include connection details.
const pool = createPool(config.database, (error) =>
  app.log.warn({ code: 'code' in error ? error.code : undefined }, 'Idle database connection lost'),
);
const content = new ContentAccess(new PostgresLessonReader(pool), glossary);
const faqProvider = new FaqProvider(content);
const onlineProvider = new GeminiGroundedAnswerProvider();
const transcription = new GeminiTranscriptionAdapter();
const admissionController = new ProviderAdmissionController(config.providerLimits);
const helpRepository = new PostgresHelpRepository(pool);
const sharingRepository = new PostgresSharingRepository(pool);
const helpRequestLookup = new PostgresHelpRequestLookup(pool);
const jobRepository = new PostgresJobRepository(pool);
const jobPreferences = new JobPreferences(new PostgresJobPreferencesRepository(pool));
const jobAnswers = new JobAnswers(jobRepository);
const telegramLinkRepository = new PostgresTelegramLinkRepository(pool);
const telegramService = new TelegramLinkService(telegramLinkRepository, {
  webhookSecret: config.telegram.webhookSecret,
  botToken: config.telegram.botToken,
  jobAnswers,
});

const app = buildApp(
  {
    checkReadiness: () => checkReadiness(pool, migrations),
    resolvePrincipal: new ResolvePrincipal(new PostgresPrincipalRepository(pool), config.demoMode),
    demoRecords: new DemoRecords(new PostgresDemoRecordRepository(pool)),
    demoSessions: new DemoSessions(new PostgresDemoSessionRepository(pool), config.demoMode),
    demoAllowedOrigins: config.demoAllowedOrigins,
    tutoring: new Tutoring(
      new PostgresTutoringRepository(pool),
      faqProvider,
      onlineProvider,
      content,
      admissionController,
      jobAnswers,
    ),
    transcription,
    content,
    help: new Help(helpRepository),
    staffHelp: new StaffHelp(helpRepository),
    sharing: new Sharing(sharingRepository, helpRequestLookup),
    accommodation: new Accommodation(new PostgresAccommodationRepository(pool)),
    jobRepository,
    jobPreferences,
    jobAnswers,
    telegramService,
    admissionController,
  },
  { logger: true },
);

if (config.demoMode) {
  app.log.warn('DEMO MODE: synthetic demo identities are enabled; this is not real authentication');
}

await app.listen({ host: config.host, port: config.port });
