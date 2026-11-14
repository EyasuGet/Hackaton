// Command-line entry point: mint a single-use, two-minute sign-in link for one
// provisioned demo principal (`pnpm demo:handoff learner-a`). Refuses to run
// unless DEMO_MODE=true. The printed code is shown once; only its digest is stored.
import {
  loadDatabaseConfig,
  loadDemoAllowedOrigins,
  loadDemoMode,
  loadOrExit,
} from './bootstrap/config.ts';
import { createPool } from './infrastructure/database/connection.ts';
import { DemoSessions } from './modules/identity/application/demo-sessions.ts';
import { PostgresDemoSessionRepository } from './modules/identity/infrastructure/postgres-demo-session-repository.ts';

const principalKey = process.argv[2];
const { database, demoMode, origins } = loadOrExit(() => ({
  database: loadDatabaseConfig(process.env),
  demoMode: loadDemoMode(process.env),
  origins: loadDemoAllowedOrigins(process.env),
}));
if (!demoMode) {
  console.error('Refusing to create a demo sign-in link: set DEMO_MODE=true first.');
  process.exit(1);
}
if (!principalKey) {
  console.error('Usage: pnpm demo:handoff <learner-a|learner-b|support>');
  process.exit(1);
}

const pool = createPool(database, () => {});
try {
  const handoff = await new DemoSessions(
    new PostgresDemoSessionRepository(pool),
    demoMode,
  ).issueHandoff(principalKey);
  if (!handoff) {
    console.error(
      `No provisioned demo principal "${principalKey}". Run pnpm demo:provision first.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `DEMO MODE: single-use sign-in for ${principalKey}, valid until ${handoff.expiresAt.toISOString()}.`,
    );
    console.log(`Code: ${handoff.secret}`);
    for (const origin of origins) console.log(`Link: ${origin}/?handoff=${handoff.secret}`);
    if (origins.length === 0)
      console.log('No DEMO_ALLOWED_ORIGINS configured, so no page can use it yet.');
  }
} finally {
  await pool.end();
}
