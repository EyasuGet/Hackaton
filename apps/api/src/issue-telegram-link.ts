// Command-line entry point: issue a single-use Telegram link code for testing
// with a real Telegram account (`pnpm telegram:link [learner-a|learner-b]`).
import { loadDatabaseConfig, loadDemoMode, loadOrExit } from './bootstrap/config.ts';
import { createPool } from './infrastructure/database/connection.ts';
import type { Principal } from './modules/identity/domain/principal.ts';
import { TelegramLinkService } from './modules/telegram/application/telegram-link-service.ts';
import { PostgresTelegramLinkRepository } from './modules/telegram/infrastructure/persistence/postgres-telegram-link-repository.ts';

const [requestedKey = 'learner-a'] = process.argv.slice(2);

const { database, demoMode } = loadOrExit(() => ({
  database: loadDatabaseConfig(process.env),
  demoMode: loadDemoMode(process.env),
}));

if (!demoMode) {
  console.error('Refusing to issue a demo link code: set DEMO_MODE=true first.');
  process.exit(1);
}

const pool = createPool(database, () => {});

try {
  const result = await pool.query<{
    id: string;
    role: string;
    label: string;
    course_ids: string[];
  }>(
    `SELECT p.id, p.role, p.label,
            coalesce(array_agg(g.course_id ORDER BY g.course_id)
                     FILTER (WHERE g.course_id IS NOT NULL), '{}') AS course_ids
       FROM principals p
       LEFT JOIN course_grants g ON g.principal_id = p.id
      WHERE p.is_demo AND p.demo_key = $1
      GROUP BY p.id`,
    [requestedKey],
  );

  const row = result.rows[0];
  if (!row) {
    console.error(
      `No provisioned demo principal "${requestedKey}". Run pnpm demo:provision first.`,
    );
    process.exitCode = 1;
  } else {
    const principal: Principal = {
      id: row.id,
      role: 'learner',
      label: row.label,
      demo: true,
      courseIds: row.course_ids,
    };

    const repository = new PostgresTelegramLinkRepository(pool);
    const service = new TelegramLinkService(repository);
    const { code, expiresAt } = await service.issueLinkCode(principal);

    console.log(`\n================================================================`);
    console.log(`Telegram Link Code for ${principal.label} (${requestedKey})`);
    console.log(`Valid until: ${expiresAt.toLocaleTimeString()} (${expiresAt.toISOString()})`);
    console.log(`================================================================\n`);
    console.log(`To link your Telegram account, open your bot chat in Telegram and send:\n`);
    console.log(`  /start ${code}\n`);
    console.log(`================================================================\n`);
  }
} finally {
  await pool.end();
}
