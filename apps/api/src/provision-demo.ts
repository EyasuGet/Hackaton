// Command-line entry point: create or refresh the synthetic demo identities and
// fixture records, then print each new token once. Refuses to run unless
// DEMO_MODE=true, so a real deployment cannot be seeded with demo access by accident.
import { loadDatabaseConfig, loadDemoMode, loadOrExit } from './bootstrap/config.ts';
import { createPool } from './infrastructure/database/connection.ts';
import { seedDemoRecords } from './modules/demo-records/postgres-demo-record-repository.ts';
import { provisionDemoPrincipals } from './modules/identity/infrastructure/postgres-principal-repository.ts';

const { database, demoMode } = loadOrExit(() => ({
  database: loadDatabaseConfig(process.env),
  demoMode: loadDemoMode(process.env),
}));
if (!demoMode) {
  console.error('Refusing to provision demo identities: set DEMO_MODE=true first.');
  process.exit(1);
}

const pool = createPool(database, () => {});
const client = await pool.connect();
try {
  // All identities, grants and records change together, or not at all.
  await client.query('BEGIN');
  const credentials = await provisionDemoPrincipals(client);
  await seedDemoRecords(client, new Map(credentials.map((c) => [c.key, c.id])));
  await client.query('COMMIT');

  console.log(
    'DEMO MODE: synthetic identities, not real authentication. Earlier tokens no longer work.',
  );
  for (const { key, role, label, token } of credentials) {
    console.log(`${key} (${role}, ${label}): ${token}`);
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
