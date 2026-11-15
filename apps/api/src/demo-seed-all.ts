// Command-line entry point: one-shot setup for demo stack in Docker Compose.
// Runs migration, provisions demo credentials, imports lessons and jobs,
// and issues demo handoff links for all principals on the configured frontend origin.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig,
  loadDemoAllowedOrigins,
  loadDemoMode,
  loadOrExit,
} from './bootstrap/config.ts';
import { createPool } from './infrastructure/database/connection.ts';
import { loadMigrations, migrate, MIGRATIONS_DIR } from './infrastructure/database/migrations.ts';
import { seedDemoRecords } from './modules/demo-records/postgres-demo-record-repository.ts';
import {
  DEMO_PRINCIPALS,
  provisionDemoPrincipals,
} from './modules/identity/infrastructure/postgres-principal-repository.ts';
import { DemoSessions } from './modules/identity/application/demo-sessions.ts';
import { PostgresDemoSessionRepository } from './modules/identity/infrastructure/postgres-demo-session-repository.ts';
import { ImportLessonSource } from './modules/content/application/import-lesson-source.ts';
import { PostgresLessonRepository } from './modules/content/infrastructure/postgres-lesson-repository.ts';
import { PostgresJobRepository } from './modules/careers/infrastructure/postgres-job-repository.ts';
import { ImportJobs } from './modules/careers/application/import-jobs.ts';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const { database, demoMode, origins } = loadOrExit(() => {
  const cfg = loadConfig(process.env);
  return {
    database: cfg.database,
    demoMode: loadDemoMode(process.env),
    origins: loadDemoAllowedOrigins(process.env),
  };
});

if (!demoMode) {
  console.error('Refusing to run demo seed: set DEMO_MODE=true first.');
  process.exit(1);
}

const pool = createPool(database, () => {});

try {
  console.log('--- Step 1/4: Applying database migrations ---');
  const migrations = await loadMigrations(MIGRATIONS_DIR);
  await migrate(pool, migrations);
  console.log(`Applied ${migrations.length} migrations.`);

  console.log('--- Step 2/4: Provisioning demo principals and records ---');
  const client = await pool.connect();
  let credentials;
  try {
    await client.query('BEGIN');
    credentials = await provisionDemoPrincipals(client);
    await seedDemoRecords(client, new Map(credentials.map((c) => [c.key, c.id])));
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log('--- Step 3/4: Importing lessons and approved jobs ---');
  const lessonRepo = new PostgresLessonRepository(pool);
  const importLesson = new ImportLessonSource(lessonRepo);
  const coursesDir = join(REPOSITORY_ROOT, 'fixtures/courses');
  try {
    const files = await readdir(coursesDir);
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      const raw: unknown = JSON.parse(await readFile(join(coursesDir, file), 'utf8'));
      await importLesson.execute(raw);
    }
    console.log('Course content imported successfully.');
  } catch (err) {
    console.warn('Lesson import note:', err instanceof Error ? err.message : String(err));
  }

  const jobRepo = new PostgresJobRepository(pool);
  const importJobs = new ImportJobs(jobRepo);
  const jobsDir = join(REPOSITORY_ROOT, 'fixtures/jobs');
  try {
    const jobFiles = await readdir(jobsDir);
    for (const file of jobFiles.filter((f) => f.endsWith('.json'))) {
      const raw: unknown = JSON.parse(await readFile(join(jobsDir, file), 'utf8'));
      await importJobs.execute(raw);
    }
    console.log('Approved jobs imported successfully.');
  } catch (err) {
    console.warn('Jobs import note:', err instanceof Error ? err.message : String(err));
  }

  console.log('--- Step 4/4: Generating single-use sign-in links ---');
  const sessions = new DemoSessions(new PostgresDemoSessionRepository(pool), demoMode);
  const audience = origins[0] ?? 'http://localhost:5173';

  console.log('================================================================');
  console.log(`DEMO STACK READY! Web frontend: ${audience}`);
  console.log('One-time sign-in links (valid 2 hours, synthetic identities):');
  console.log('================================================================');

  for (const p of DEMO_PRINCIPALS) {
    const handoff = await sessions.issueHandoff(p.key, audience);
    if (handoff) {
      console.log(`\nRole: ${p.role.toUpperCase()} (${p.label})`);
      console.log(`Key:  ${p.key}`);
      console.log(`Link: ${audience}/#handoff=${handoff.secret}`);
    }
  }
  console.log('\n================================================================\n');
} finally {
  await pool.end();
}
