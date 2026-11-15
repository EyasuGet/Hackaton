// Real-PostgreSQL integration checks for Telegram identity linking and revocation (T3-012-A).
// Verifies schema migration 0014, atomic transactions, concurrency race conditions,
// cross-user link prevention, unlinking, and Fastify HTTP endpoints end-to-end.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../bootstrap/app.ts';
import { loadDatabaseConfig } from '../../bootstrap/config.ts';
import { createPool } from '../../infrastructure/database/connection.ts';
import {
  loadMigrations,
  migrate,
  MIGRATIONS_DIR,
} from '../../infrastructure/database/migrations.ts';
import { ContentAccess } from '../content/application/content-access.ts';
import { PostgresLessonReader } from '../content/infrastructure/postgres-lesson-reader.ts';
import { DemoRecords } from '../demo-records/demo-records.ts';
import {
  PostgresDemoRecordRepository,
  seedDemoRecords,
} from '../demo-records/postgres-demo-record-repository.ts';
import { DemoSessions } from '../identity/application/demo-sessions.ts';
import { ResolvePrincipal } from '../identity/application/resolve-principal.ts';
import { PostgresDemoSessionRepository } from '../identity/infrastructure/postgres-demo-session-repository.ts';
import {
  PostgresPrincipalRepository,
  provisionDemoPrincipals,
  type DemoCredential,
  type DemoPrincipalKey,
} from '../identity/infrastructure/postgres-principal-repository.ts';
import { Tutoring } from '../tutoring/application/tutoring.ts';
import { PostgresTutoringRepository } from '../tutoring/infrastructure/persistence/postgres-tutoring-repository.ts';
import {
  digestLinkCode,
  TelegramLinkService,
  TELEGRAM_LINK_CODE_TTL_MS,
} from './application/telegram-link-service.ts';
import { PostgresTelegramLinkRepository } from './infrastructure/persistence/postgres-telegram-link-repository.ts';

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_${randomUUID().replaceAll('-', '')}`;
let admin: pg.Pool;
let pool: pg.Pool;
let tokens: Record<DemoPrincipalKey, string>;
let telegramRepo: PostgresTelegramLinkRepository;
let telegramService: TelegramLinkService;

const WEBHOOK_SECRET = 'pg-test-webhook-secret-98765';
const clock = new Date('2026-11-15T12:00:00Z');
const now = () => clock;

async function provision(): Promise<Record<DemoPrincipalKey, string>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const credentials: DemoCredential[] = await provisionDemoPrincipals(client);
    await seedDemoRecords(client, new Map(credentials.map((c) => [c.key, c.id])));
    await client.query('COMMIT');
    return Object.fromEntries(credentials.map((c) => [c.key, c.token])) as Record<
      DemoPrincipalKey,
      string
    >;
  } finally {
    client.release();
  }
}

function makeApp() {
  const resolvePrincipal = new ResolvePrincipal(new PostgresPrincipalRepository(pool), true, now);
  return buildApp({
    checkReadiness: () => Promise.resolve({ ready: true }),
    resolvePrincipal,
    demoRecords: new DemoRecords(new PostgresDemoRecordRepository(pool)),
    demoSessions: new DemoSessions(new PostgresDemoSessionRepository(pool), true, now),
    demoAllowedOrigins: ['http://localhost:5173'],
    tutoring: new Tutoring(new PostgresTutoringRepository(pool)),
    content: new ContentAccess(new PostgresLessonReader(pool), []),
    telegramService,
  });
}

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  tokens = await provision();

  telegramRepo = new PostgresTelegramLinkRepository(pool);
  telegramService = new TelegramLinkService(telegramRepo, {
    webhookSecret: WEBHOOK_SECRET,
    now,
  });
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin?.end();
});

describe('Telegram Identity PostgreSQL Integration (T3-012-A)', () => {
  it('applies migration 0014 and creates telegram_link_codes and telegram_identities tables', async () => {
    const res = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('telegram_link_codes', 'telegram_identities')`,
    );
    expect(res.rows.map((r) => r.table_name).sort()).toEqual([
      'telegram_identities',
      'telegram_link_codes',
    ]);
  });

  it('persists single-use link codes and enforces atomic single-use under concurrency', async () => {
    const learnerPrincipal = await new ResolvePrincipal(
      new PostgresPrincipalRepository(pool),
      true,
      now,
    ).execute(tokens['learner-a']);
    expect(learnerPrincipal).not.toBeNull();

    const { code } = await telegramService.issueLinkCode(learnerPrincipal!);
    const digest = digestLinkCode(code);

    // Verify digest stored
    const codeQuery = await pool.query<{ code_digest: string; used_at: Date | null }>(
      'SELECT code_digest, used_at FROM telegram_link_codes WHERE code_digest = $1',
      [digest],
    );
    expect(codeQuery.rows[0]?.used_at).toBeNull();

    // Two concurrent requests attempt to consume the exact same link code
    const [result1, result2] = await Promise.all([
      telegramRepo.consumeLinkCode({
        codeDigest: digest,
        telegramUserId: '100001',
        telegramChatId: '100001',
        telegramUsername: 'user1',
        now: clock,
      }),
      telegramRepo.consumeLinkCode({
        codeDigest: digest,
        telegramUserId: '100002',
        telegramChatId: '100002',
        telegramUsername: 'user2',
        now: clock,
      }),
    ]);

    // Exactly one must succeed, the other must fail with code_already_used
    const successCount = (result1.success ? 1 : 0) + (result2.success ? 1 : 0);
    const failureCount = (!result1.success ? 1 : 0) + (!result2.success ? 1 : 0);
    expect(successCount).toBe(1);
    expect(failureCount).toBe(1);

    if (!result1.success) {
      expect(result1.reason).toBe('code_already_used');
    } else if (!result2.success) {
      expect(result2.reason).toBe('code_already_used');
    }

    // Unlink so subsequent tests have a clean slate for learner-a
    await telegramRepo.unlinkByLearnerId(learnerPrincipal!.id, clock);
  });

  it('rejects expired link codes in PostgreSQL', async () => {
    const learnerPrincipal = (await new ResolvePrincipal(
      new PostgresPrincipalRepository(pool),
      true,
      now,
    ).execute(tokens['learner-b']))!;

    const { code } = await telegramService.issueLinkCode(learnerPrincipal);
    const digest = digestLinkCode(code);

    const expiredClock = new Date(clock.getTime() + TELEGRAM_LINK_CODE_TTL_MS + 5000);
    const result = await telegramRepo.consumeLinkCode({
      codeDigest: digest,
      telegramUserId: '200001',
      telegramChatId: '200001',
      now: expiredClock,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('code_expired');
    }
  });

  it('enforces cross-user linking isolation and database partial unique index constraints', async () => {
    const resolvePrincipal = new ResolvePrincipal(new PostgresPrincipalRepository(pool), true, now);
    const learnerA = (await resolvePrincipal.execute(tokens['learner-a']))!;
    const learnerB = (await resolvePrincipal.execute(tokens['learner-b']))!;

    // 1. Learner A links Telegram user 300001
    const codeA = (await telegramService.issueLinkCode(learnerA)).code;
    const linkA = await telegramRepo.consumeLinkCode({
      codeDigest: digestLinkCode(codeA),
      telegramUserId: '300001',
      telegramChatId: '300001',
      telegramUsername: 'tg_user_300001',
      now: clock,
    });
    expect(linkA.success).toBe(true);

    // 2. Telegram user 300001 tries to link to Learner B -> fails (cross-user attempt)
    const codeB = (await telegramService.issueLinkCode(learnerB)).code;
    const linkB = await telegramRepo.consumeLinkCode({
      codeDigest: digestLinkCode(codeB),
      telegramUserId: '300001', // Already linked to Learner A
      telegramChatId: '300001',
      now: clock,
    });
    expect(linkB.success).toBe(false);
    if (!linkB.success) {
      expect(linkB.reason).toBe('telegram_user_already_linked');
    }

    // 3. Learner A tries to link second Telegram user 300002 without unlinking -> fails
    const codeA2 = (await telegramService.issueLinkCode(learnerA)).code;
    const linkA2 = await telegramRepo.consumeLinkCode({
      codeDigest: digestLinkCode(codeA2),
      telegramUserId: '300002',
      telegramChatId: '300002',
      now: clock,
    });
    expect(linkA2.success).toBe(false);
    if (!linkA2.success) {
      expect(linkA2.reason).toBe('learner_already_linked');
    }

    // 4. Resolving principal by telegramUserId returns Learner A with correct course grants
    const principal = await telegramRepo.findPrincipalByTelegramUserId('300001');
    expect(principal).not.toBeNull();
    expect(principal?.id).toBe(learnerA.id);
    expect(principal?.role).toBe('learner');
    expect(principal?.courseIds.length).toBeGreaterThan(0);

    // 5. Unlinking revokes access immediately
    const unlinked = await telegramRepo.unlinkByLearnerId(learnerA.id, clock);
    expect(unlinked).toBe(true);

    const revokedPrincipal = await telegramRepo.findPrincipalByTelegramUserId('300001');
    expect(revokedPrincipal).toBeNull();

    // 6. After unlinking, Learner B can now link Telegram user 300001 with a fresh code
    const codeB2 = (await telegramService.issueLinkCode(learnerB)).code;
    const reLink = await telegramRepo.consumeLinkCode({
      codeDigest: digestLinkCode(codeB2),
      telegramUserId: '300001',
      telegramChatId: '300001',
      now: clock,
    });
    expect(reLink.success).toBe(true);

    // Clean up
    await telegramRepo.unlinkByLearnerId(learnerB.id, clock);
  });

  describe('HTTP Endpoints & Webhook Flow', () => {
    it('exercises full HTTP linking lifecycle: code issuance, webhook /start, status, and deletion', async () => {
      const app = makeApp();
      try {
        // 1. Initial status -> not linked
        const initialStatus = await app.inject({
          method: 'GET',
          url: '/api/telegram/status',
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
        });
        expect(initialStatus.statusCode).toBe(200);
        expect(initialStatus.json()).toEqual({ linked: false });

        // 2. Issue link code
        const issueRes = await app.inject({
          method: 'POST',
          url: '/api/telegram/link-code',
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
        });
        expect(issueRes.statusCode).toBe(201);
        const { code, expiresAt } = issueRes.json<{ code: string; expiresAt: string }>();
        expect(code).toBeDefined();
        expect(expiresAt).toBeDefined();

        // 3. Webhook update with missing secret token -> 401
        const unauthRes = await app.inject({
          method: 'POST',
          url: '/api/telegram/webhook',
          payload: {
            update_id: 1,
            message: {
              message_id: 1,
              from: { id: 777777, is_bot: false, username: 'testuser' },
              chat: { id: 777777, type: 'private' },
              date: Math.floor(clock.getTime() / 1000),
              text: `/start ${code}`,
            },
          },
        });
        expect(unauthRes.statusCode).toBe(401);

        // 4. Webhook update from group chat -> 400 rejected
        const groupRes = await app.inject({
          method: 'POST',
          url: '/api/telegram/webhook',
          headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
          payload: {
            update_id: 2,
            message: {
              message_id: 2,
              from: { id: 777777, is_bot: false },
              chat: { id: -100999, type: 'group', title: 'Study Group' },
              date: Math.floor(clock.getTime() / 1000),
              text: `/start ${code}`,
            },
          },
        });
        expect(groupRes.statusCode).toBe(400);
        expect(groupRes.json<{ error: string }>().error).toBe('group_chats_not_allowed');

        // 5. Valid webhook /start <code> in private chat -> 200 linked
        const linkRes = await app.inject({
          method: 'POST',
          url: '/api/telegram/webhook',
          headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
          payload: {
            update_id: 3,
            message: {
              message_id: 3,
              from: { id: 777777, is_bot: false, username: 'telegram_learner' },
              chat: { id: 777777, type: 'private' },
              date: Math.floor(clock.getTime() / 1000),
              text: `/start ${code}`,
            },
          },
        });
        expect(linkRes.statusCode).toBe(200);
        expect(linkRes.json()).toEqual({ ok: true, status: 'linked' });

        // 6. Inspect status -> linked with safe non-sensitive metadata (no tokens)
        const activeStatus = await app.inject({
          method: 'GET',
          url: '/api/telegram/status',
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
        });
        expect(activeStatus.statusCode).toBe(200);
        const statusJson = activeStatus.json<{
          linked: boolean;
          telegramUserId?: string;
          telegramUsername?: string;
          token?: string;
          code?: string;
        }>();
        expect(statusJson.linked).toBe(true);
        expect(statusJson.telegramUserId).toBe('777777');
        expect(statusJson.telegramUsername).toBe('telegram_learner');
        expect(statusJson.token).toBeUndefined();
        expect(statusJson.code).toBeUndefined();

        // 7. Replay /start <code> -> rejected
        const replayRes = await app.inject({
          method: 'POST',
          url: '/api/telegram/webhook',
          headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
          payload: {
            update_id: 4,
            message: {
              message_id: 4,
              from: { id: 777777, is_bot: false },
              chat: { id: 777777, type: 'private' },
              date: Math.floor(clock.getTime() / 1000),
              text: `/start ${code}`,
            },
          },
        });
        expect(replayRes.statusCode).toBe(400);
        expect(replayRes.json<{ error: string }>().error).toBe('code_already_used');

        // 8. Delete link via DELETE /api/telegram/link -> 204
        const deleteRes = await app.inject({
          method: 'DELETE',
          url: '/api/telegram/link',
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
        });
        expect(deleteRes.statusCode).toBe(204);

        // 9. Subsequent status -> not linked
        const finalStatus = await app.inject({
          method: 'GET',
          url: '/api/telegram/status',
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
        });
        expect(finalStatus.statusCode).toBe(200);
        expect(finalStatus.json()).toEqual({ linked: false });

        // 10. Subsequent DELETE -> 404 not_linked
        const reDelete = await app.inject({
          method: 'DELETE',
          url: '/api/telegram/link',
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
        });
        expect(reDelete.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });
  });
});
