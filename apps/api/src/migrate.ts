// Command-line entry point: apply pending migrations once, then exit.
import { loadDatabaseConfig, loadOrExit } from './bootstrap/config.ts';
import { createPool } from './infrastructure/database/connection.ts';
import { loadMigrations, migrate, MIGRATIONS_DIR } from './infrastructure/database/migrations.ts';

const config = loadOrExit(() => loadDatabaseConfig(process.env));
const pool = createPool(config, () => {});

try {
  const applied = await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database schema is up to date');
} finally {
  await pool.end();
}
