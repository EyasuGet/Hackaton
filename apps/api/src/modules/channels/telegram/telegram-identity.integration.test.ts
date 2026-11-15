// Real-PostgreSQL integration tests for Telegram identity linking and revocation (T3-012-A).
// Verifies:
// - Authenticated token generation from web assistant and role enforcement
// - Single-use token lifecycle and replay protection
// - Expired/invalid token rejection
// - Telegram user ID association and chat privacy (group-chat rejection)
// - Cross-user and multi-link guards
// - Learner revocation from web assistant immediately stops access
// - Safe re-linking after revocation
// - Webhook secret token authenticity verification
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../bootstrap/app.ts';
import { loadDatabaseConfig } from '../../../bootstrap/config.ts';
import { createPool } from '../../../infrastructure/database/connection.ts';
import {
  loadMigrations,
  migrate,
  MIGRATIONS_DIR,
} from '../../../infrastructure/database/migrations.ts';
import { DemoRecords } from '../../demo-records/demo-records.ts';
import { PostgresDemoRecordRepository } from '../../demo-records/postgres-demo-record-repository.ts';
import { DemoSessions } from '../../identity/application/demo-sessions.ts';
import { ResolvePrincipal } from '../../identity/application/resolve-principal.ts';
import { PostgresDemoSessionRepository } from '../../identity/infrastructure/postgres-demo-session-repository.ts';
import {
  PostgresPrincipalRepository,
  provisionDemoPrincipals,
  type DemoPrincipalKey,
} from '../../identity/infrastructure/postgres-principal-repository.ts';
import { Tutoring } from '../../tutoring/application/tutoring.ts';
import { PostgresTutoringRepository } from '../../tutoring/infrastructure/persistence/postgres-tutoring-repository.ts';
import { ContentAccess } from '../../content/application/content-access.ts';
import { PostgresLessonReader } from '../../content/infrastructure/postgres-lesson-reader.ts';
import { FaqProvider } from '../../tutoring/application/faq-provider.ts';
import { PostgresTelegramIdentityRepository } from './infrastructure/persistence/postgres-telegram-identity-repository.ts';
import { TelegramIdentityService } from './application/telegram-identity-service.ts';
import { hashLinkingToken } from './domain/telegram-identity.ts';

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_${randomUUID().replaceAll('-', '')}`;

let admin: pg.Pool;
let pool: pg.Pool;
let tokens: Record<DemoPrincipalKey, string>;
let principalIds: Record<DemoPrincipalKey, string>;
let telegramRepo: PostgresTelegramIdentityRepository;
let telegramService: TelegramIdentityService;

const WEBHOOK_SECRET = 'secret-token-integration-xyz-123';

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));

  const client = await pool.connect();
  try {
    const credentials = await provisionDemoPrincipals(client);
    tokens = Object.fromEntries(credentials.map((c) => [c.key, c.token])) as Record<
      DemoPrincipalKey,
      string
    >;
    principalIds = Object.fromEntries(credentials.map((c) => [c.key, c.id])) as Record<
      DemoPrincipalKey,
      string
    >;
  } finally {
    client.release();
  }

  telegramRepo = new PostgresTelegramIdentityRepository(pool);
  telegramService = new TelegramIdentityService(telegramRepo);
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin?.end();
});

function createTestApp() {
  const principalRepo = new PostgresPrincipalRepository(pool);
  const resolvePrincipal = new ResolvePrincipal(principalRepo, true);
  const demoRecordRepo = new PostgresDemoRecordRepository(pool);
  const demoSessionRepo = new PostgresDemoSessionRepository(pool);
  const tutoringRepo = new PostgresTutoringRepository(pool);

  const content = new ContentAccess(new PostgresLessonReader(pool), []);
  const faqProvider = new FaqProvider(content, []);

  return buildApp({
    checkReadiness: () => Promise.resolve({ ready: true }),
    resolvePrincipal,
    demoRecords: new DemoRecords(demoRecordRepo),
    demoSessions: new DemoSessions(demoSessionRepo, true),
    demoAllowedOrigins: ['http://localhost:5173'],
    tutoring: new Tutoring(tutoringRepo, faqProvider),
    content,
    telegramIdentity: telegramService,
    telegramWebhookSecret: WEBHOOK_SECRET,
  });
}

describe('Telegram Identity Integration (T3-012-A)', () => {
  it('enforces learner-only authentication on token creation and status endpoints', async () => {
    const app = createTestApp();
    try {
      // 1. Unauthenticated request rejected
      const unauthRes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/link-token',
      });
      expect(unauthRes.statusCode).toBe(401);

      // 2. Support principal rejected from learner-only route
      const supportRes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/link-token',
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(supportRes.statusCode).toBe(403);

      // 3. Learner principal succeeds
      const learnerRes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/link-token',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(learnerRes.statusCode).toBe(201);
      const body = learnerRes.json<{ token: string; expiresAt: string; expiresInSeconds: number }>();
      expect(body.token).toMatch(/^tlk_[0-9a-f]{32}$/);
      expect(body.expiresInSeconds).toBe(600);
    } finally {
      await app.close();
    }
  });

  it('initially reports unlinked status for learner', async () => {
    const app = createTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/channels/telegram/status',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ linked: false });
    } finally {
      await app.close();
    }
  });

  it('rejects webhook requests with missing or invalid secret token header', async () => {
    const app = createTestApp();
    try {
      // Missing secret header
      const missing = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/webhook',
        payload: {
          update_id: 1,
          message: {
            message_id: 1,
            chat: { id: 12345, type: 'private' },
            from: { id: 12345, is_bot: false },
            date: 1700000000,
            text: '/status',
          },
        },
      });
      expect(missing.statusCode).toBe(401);

      // Wrong secret header
      const wrong = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': 'wrong-token' },
        payload: {
          update_id: 1,
          message: {
            message_id: 1,
            chat: { id: 12345, type: 'private' },
            from: { id: 12345, is_bot: false },
            date: 1700000000,
            text: '/status',
          },
        },
      });
      expect(wrong.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('rejects linking from group chats', async () => {
    const app = createTestApp();
    try {
      const tokenRes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/link-token',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      const { token } = tokenRes.json<{ token: string }>();

      const groupRes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        payload: {
          update_id: 10,
          message: {
            message_id: 20,
            chat: { id: -10012345678, type: 'group' },
            from: { id: 55555, is_bot: false },
            date: 1700000000,
            text: `/link ${token}`,
          },
        },
      });

      expect(groupRes.statusCode).toBe(200);
      const body = groupRes.json<{ outcome?: { success: boolean; reason: string } }>();
      expect(body.outcome?.success).toBe(false);
      expect(body.outcome?.reason).toBe('group_chat_forbidden');
    } finally {
      await app.close();
    }
  });

  it('links private Telegram user successfully and exposes masked status', async () => {
    const app = createTestApp();
    try {
      const tokenRes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/link-token',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      const { token } = tokenRes.json<{ token: string }>();

      // Link via webhook
      const webhookRes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        payload: {
          update_id: 11,
          message: {
            message_id: 21,
            chat: { id: 87654321, type: 'private' },
            from: { id: 87654321, is_bot: false },
            date: 1700000000,
            text: `/link ${token}`,
          },
        },
      });

      expect(webhookRes.statusCode).toBe(200);
      const webhookBody = webhookRes.json<{ success: boolean; action: string }>();
      expect(webhookBody.success).toBe(true);
      expect(webhookBody.action).toBe('link');

      // Learner status reflects active link with masked telegram user id
      const statusRes = await app.inject({
        method: 'GET',
        url: '/api/channels/telegram/status',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(statusRes.statusCode).toBe(200);
      const statusBody = statusRes.json<{ linked: boolean; telegramUserIdMasked: string }>();
      expect(statusBody.linked).toBe(true);
      expect(statusBody.telegramUserIdMasked).toBe('***4321');

      // Service resolves the learner principal
      const principalId = await telegramService.resolveActivePrincipalByTelegramUser('87654321');
      expect(principalId).toBeTruthy();

      // Second attempt with the SAME token fails (replay protection)
      const replayRes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        payload: {
          update_id: 12,
          message: {
            message_id: 22,
            chat: { id: 87654321, type: 'private' },
            from: { id: 87654321, is_bot: false },
            date: 1700000000,
            text: `/link ${token}`,
          },
        },
      });
      const replayBody = replayRes.json<{ outcome?: { success: boolean; reason: string } }>();
      expect(replayBody.outcome?.success).toBe(false);
      expect(replayBody.outcome?.reason).toBe('token_already_used');
    } finally {
      await app.close();
    }
  });

  it('guards against cross-user linking and multi-account linking', async () => {
    const app = createTestApp();
    try {
      // Learner B creates a token
      const tokenBRes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/link-token',
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
      });
      const tokenB = tokenBRes.json<{ token: string }>().token;

      // Telegram user 87654321 (already linked to learner A) tries to link to learner B
      const crossRes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        payload: {
          update_id: 13,
          message: {
            message_id: 23,
            chat: { id: 87654321, type: 'private' },
            from: { id: 87654321, is_bot: false },
            date: 1700000000,
            text: `/link ${tokenB}`,
          },
        },
      });

      const crossBody = crossRes.json<{ outcome?: { success: boolean; reason: string } }>();
      expect(crossBody.outcome?.success).toBe(false);
      expect(crossBody.outcome?.reason).toBe('already_linked_to_other_account');

      // Learner A creates another token, but Telegram user 99999999 tries to link to Learner A
      // while Learner A is already linked to 87654321
      const tokenARes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/link-token',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      const tokenA = tokenARes.json<{ token: string }>().token;

      const multiRes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        payload: {
          update_id: 14,
          message: {
            message_id: 24,
            chat: { id: 99999999, type: 'private' },
            from: { id: 99999999, is_bot: false },
            date: 1700000000,
            text: `/link ${tokenA}`,
          },
        },
      });

      const multiBody = multiRes.json<{ outcome?: { success: boolean; reason: string } }>();
      expect(multiBody.outcome?.success).toBe(false);
      expect(multiBody.outcome?.reason).toBe('account_already_linked');
    } finally {
      await app.close();
    }
  });

  it('rejects expired tokens', async () => {
    const app = createTestApp();
    try {
      // Insert an expired token directly into the database
      const expiredToken = 'tlk_expired_token_0000000000000000';
      const digest = hashLinkingToken(expiredToken);
      const past = new Date(Date.now() - 3600 * 1000);
      const principalA = principalIds['learner-a'];

      await pool.query(
        `INSERT INTO telegram_linking_tokens (token_digest, principal_id, expires_at, created_at)
         VALUES ($1, $2, $3, $4)`,
        [digest, principalA, past, past],
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        payload: {
          update_id: 15,
          message: {
            message_id: 25,
            chat: { id: 33333333, type: 'private' },
            from: { id: 33333333, is_bot: false },
            date: 1700000000,
            text: `/link ${expiredToken}`,
          },
        },
      });

      const body = res.json<{ outcome?: { success: boolean; reason: string } }>();
      expect(body.outcome?.success).toBe(false);
      expect(body.outcome?.reason).toBe('expired_token');
    } finally {
      await app.close();
    }
  });

  it('learner revokes link from web assistant, immediately stopping Telegram access', async () => {
    const app = createTestApp();
    try {
      // Confirm currently linked
      expect(await telegramService.resolveActivePrincipalByTelegramUser('87654321')).toBeTruthy();

      // Revoke from web assistant
      const revokeRes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/revoke',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(revokeRes.statusCode).toBe(200);
      expect(revokeRes.json()).toEqual({ revoked: true });

      // Immediate check: access is gone!
      expect(await telegramService.resolveActivePrincipalByTelegramUser('87654321')).toBeNull();

      // Web status reflects unlinked state
      const statusRes = await app.inject({
        method: 'GET',
        url: '/api/channels/telegram/status',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(statusRes.json()).toEqual({ linked: false });
    } finally {
      await app.close();
    }
  });

  it('allows re-linking the same account after revocation', async () => {
    const app = createTestApp();
    try {
      // Learner A generates a new token
      const tokenRes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/link-token',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      const { token } = tokenRes.json<{ token: string }>();

      // Telegram user 87654321 re-links
      const reLinkRes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        payload: {
          update_id: 16,
          message: {
            message_id: 26,
            chat: { id: 87654321, type: 'private' },
            from: { id: 87654321, is_bot: false },
            date: 1700000000,
            text: `/link ${token}`,
          },
        },
      });

      expect(reLinkRes.statusCode).toBe(200);
      expect(reLinkRes.json<{ success: boolean }>().success).toBe(true);

      // Access is restored
      expect(await telegramService.resolveActivePrincipalByTelegramUser('87654321')).toBeTruthy();

      // Unlink via Telegram /unlink command
      const unlinkRes = await app.inject({
        method: 'POST',
        url: '/api/channels/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        payload: {
          update_id: 17,
          message: {
            message_id: 27,
            chat: { id: 87654321, type: 'private' },
            from: { id: 87654321, is_bot: false },
            date: 1700000000,
            text: '/unlink',
          },
        },
      });

      expect(unlinkRes.statusCode).toBe(200);
      expect(unlinkRes.json<{ action: string; success: boolean }>().action).toBe('unlink');
      expect(unlinkRes.json<{ success: boolean }>().success).toBe(true);

      // Access is gone again
      expect(await telegramService.resolveActivePrincipalByTelegramUser('87654321')).toBeNull();
    } finally {
      await app.close();
    }
  });
});
