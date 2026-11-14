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
import { DemoRecords } from './modules/demo-records/demo-records.ts';
import { PostgresDemoRecordRepository } from './modules/demo-records/postgres-demo-record-repository.ts';
import { DemoSessions } from './modules/identity/application/demo-sessions.ts';
import { ResolvePrincipal } from './modules/identity/application/resolve-principal.ts';
import { PostgresDemoSessionRepository } from './modules/identity/infrastructure/postgres-demo-session-repository.ts';
import { PostgresPrincipalRepository } from './modules/identity/infrastructure/postgres-principal-repository.ts';

const config = loadOrExit(() => loadConfig(process.env));
const migrations = await loadMigrations(MIGRATIONS_DIR);

// Log only the driver's error code: messages can include connection details.
const pool = createPool(config.database, (error) =>
  app.log.warn({ code: 'code' in error ? error.code : undefined }, 'Idle database connection lost'),
);
const app = buildApp(
  {
    checkReadiness: () => checkReadiness(pool, migrations),
    resolvePrincipal: new ResolvePrincipal(new PostgresPrincipalRepository(pool), config.demoMode),
    demoRecords: new DemoRecords(new PostgresDemoRecordRepository(pool)),
    demoSessions: new DemoSessions(new PostgresDemoSessionRepository(pool), config.demoMode),
    demoAllowedOrigins: config.demoAllowedOrigins,
  },
  { logger: true },
);

if (config.demoMode) {
  app.log.warn('DEMO MODE: synthetic demo identities are enabled; this is not real authentication');
}

await app.listen({ host: config.host, port: config.port });
