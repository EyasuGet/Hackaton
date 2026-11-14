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

const config = loadOrExit(() => loadConfig(process.env));
const migrations = await loadMigrations(MIGRATIONS_DIR);

// Log only the driver's error code: messages can include connection details.
const pool = createPool(config.database, (error) =>
  app.log.warn({ code: 'code' in error ? error.code : undefined }, 'Idle database connection lost'),
);
const app = buildApp({ checkReadiness: () => checkReadiness(pool, migrations) }, { logger: true });

await app.listen({ host: config.host, port: config.port });
