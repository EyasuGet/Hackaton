// Command-line entry point: mint a single-use, two-minute sign-in link for one
// provisioned demo principal and one allowed page origin
// (`pnpm demo:handoff learner-a [origin]`). Refuses to run unless DEMO_MODE=true.
// The printed code is shown once; only its digest is stored.
import {
  loadDatabaseConfig,
  loadDemoAllowedOrigins,
  loadDemoMode,
  loadOrExit,
} from './bootstrap/config.ts';
import { createPool } from './infrastructure/database/connection.ts';
import { DemoSessions } from './modules/identity/application/demo-sessions.ts';
import { PostgresDemoSessionRepository } from './modules/identity/infrastructure/postgres-demo-session-repository.ts';

const [principalKey, requestedOrigin] = process.argv.slice(2);
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
  console.error('Usage: pnpm demo:handoff <learner-a|learner-b|support> [page origin]');
  process.exit(1);
}
// The code is bound to one page origin, which must be allowed to start sessions.
const audience = requestedOrigin ?? origins[0];
if (!audience || !origins.includes(audience)) {
  console.error('The page origin must be listed in DEMO_ALLOWED_ORIGINS.');
  process.exit(1);
}

const pool = createPool(database, () => {});
try {
  const sessions = new DemoSessions(new PostgresDemoSessionRepository(pool), demoMode);
  const handoff = await sessions.issueHandoff(principalKey, audience);
  if (!handoff) {
    console.error(
      `No provisioned demo principal "${principalKey}". Run pnpm demo:provision first.`,
    );
    process.exitCode = 1;
  } else {
    const until = handoff.expiresAt.toISOString();
    console.log(
      `DEMO MODE: single-use sign-in for ${principalKey} on ${audience}, valid until ${until}.`,
    );
    console.log(`Code: ${handoff.secret}`);
    // A fragment is never sent to servers, so the code stays out of access logs.
    console.log(`Link: ${audience}/#handoff=${handoff.secret}`);
  }
} finally {
  await pool.end();
}
