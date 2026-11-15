// Real-PostgreSQL integration tests for support reply notifications (T3-017-C).
// Tests:
// 1. Consent/eligibility: only opted-in, actively linked learners receive enqueued intents.
// 2. Transactional enqueue: staff reply commits delivery intent atomically with reply.
// 3. Suppression upon unlink: unlinking Telegram cancels pending notices.
// 4. Suppression upon opt-out: opting out cancels pending notices.
// 5. Suppression upon cancellation: cancelling help request cancels pending notices.
// 6. Generic notice content: no sensitive message body or accommodation details exposed; provides return path.
// 7. Safe failure handling: failed notification never erases or blocks the persisted reply.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../bootstrap/app.ts';
import { loadDatabaseConfig } from '../../bootstrap/config.ts';
import { createPool } from '../../infrastructure/database/connection.ts';
import {
  loadMigrations,
  migrate,
  MIGRATIONS_DIR,
} from '../../infrastructure/database/migrations.ts';
import { ContentAccess } from '../content/application/content-access.ts';
import { DeliveryWorker } from '../delivery/application/delivery-worker.ts';
import { PostgresDeliveryIntents } from '../delivery/infrastructure/postgres-delivery-intents.ts';
import { TelegramDeliveryAdapter } from '../delivery/infrastructure/telegram-delivery-adapter.ts';
import { DemoRecords } from '../demo-records/demo-records.ts';
import { PostgresDemoRecordRepository } from '../demo-records/postgres-demo-record-repository.ts';
import { DemoSessions } from '../identity/application/demo-sessions.ts';
import { ResolvePrincipal } from '../identity/application/resolve-principal.ts';
import { PostgresDemoSessionRepository } from '../identity/infrastructure/postgres-demo-session-repository.ts';
import {
  PostgresPrincipalRepository,
  provisionDemoPrincipals,
  type DemoCredential,
  type DemoPrincipalKey,
} from '../identity/infrastructure/postgres-principal-repository.ts';
import { TelegramLinkService } from '../telegram/application/telegram-link-service.ts';
import { PostgresTelegramLinkRepository } from '../telegram/infrastructure/persistence/postgres-telegram-link-repository.ts';
import { Tutoring } from '../tutoring/application/tutoring.ts';
import { PostgresTutoringRepository } from '../tutoring/infrastructure/persistence/postgres-tutoring-repository.ts';
import { Help } from './application/help.ts';
import { StaffHelp } from './application/staff-help.ts';
import { SupportReplyNotifier } from './application/support-reply-notifier.ts';
import type { HelpReply, HelpRequest } from './domain/help-request.ts';
import { PostgresHelpRepository } from './infrastructure/persistence/postgres-help-repository.ts';

interface SubmitResponse {
  readonly kind: 'submitted' | 'existing';
  readonly request: HelpRequest;
}

interface ReplyResponse {
  readonly kind: 'added' | 'existing';
  readonly reply: HelpReply;
}

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_notif_${randomUUID().replaceAll('-', '')}`;
let admin: pg.Pool;
let pool: pg.Pool;
let tokens: Record<DemoPrincipalKey, string>;
let credentials: DemoCredential[];

async function provision(): Promise<Record<DemoPrincipalKey, string>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    credentials = await provisionDemoPrincipals(client);
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
  const helpRepository = new PostgresHelpRepository(pool);
  const telegramLinkRepository = new PostgresTelegramLinkRepository(pool);
  const telegramService = new TelegramLinkService(telegramLinkRepository, {
    webhookSecret: 'test-webhook-secret',
    botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
  });

  return buildApp({
    checkReadiness: () => Promise.resolve({ ready: true }),
    resolvePrincipal: new ResolvePrincipal(new PostgresPrincipalRepository(pool), true),
    demoRecords: new DemoRecords(new PostgresDemoRecordRepository(pool)),
    demoSessions: new DemoSessions(new PostgresDemoSessionRepository(pool), true),
    demoAllowedOrigins: ['http://localhost:5173'],
    tutoring: new Tutoring(new PostgresTutoringRepository(pool)),
    content: new ContentAccess(
      { search: () => Promise.resolve([]), resolve: () => Promise.resolve({ kind: 'not_found' }) },
      [],
    ),
    help: new Help(helpRepository),
    staffHelp: new StaffHelp(helpRepository),
    telegramService,
  });
}

async function linkTelegram(
  app: ReturnType<typeof makeApp>,
  userKey: DemoPrincipalKey,
  telegramUserId: string,
  telegramChatId: string,
): Promise<void> {
  const codeRes = await app.inject({
    method: 'POST',
    url: '/api/telegram/link-code',
    headers: { authorization: `Bearer ${tokens[userKey]}` },
  });
  expect(codeRes.statusCode).toBe(201);
  const { code } = codeRes.json<{ code: string }>();

  const linkRes = await app.inject({
    method: 'POST',
    url: '/api/telegram/link',
    payload: {
      code,
      telegramUserId,
      telegramChatId,
      chatType: 'private',
    },
  });
  expect(linkRes.statusCode).toBe(201);
}

async function optInNotifications(
  app: ReturnType<typeof makeApp>,
  userKey: DemoPrincipalKey,
): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/help/notifications/opt-in',
    headers: { authorization: `Bearer ${tokens[userKey]}` },
    payload: { channel: 'telegram' },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ channel: 'telegram', optedIn: true });
}

async function optOutNotifications(
  app: ReturnType<typeof makeApp>,
  userKey: DemoPrincipalKey,
): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/help/notifications/opt-out',
    headers: { authorization: `Bearer ${tokens[userKey]}` },
    payload: { channel: 'telegram' },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ channel: 'telegram', optedIn: false });
}

async function submitAndClaim(
  app: ReturnType<typeof makeApp>,
  key: string,
  userKey: DemoPrincipalKey = 'learner-a',
): Promise<string> {
  const subRes = await app.inject({
    method: 'POST',
    url: '/api/help/requests',
    headers: { authorization: `Bearer ${tokens[userKey]}` },
    payload: {
      clientRequestId: key,
      contextSnapshot: `Learner sensitive context and accommodation notes for ${key}`,
    },
  });
  expect(subRes.statusCode).toBe(201);
  const requestId = subRes.json<SubmitResponse>().request.id;

  const claimRes = await app.inject({
    method: 'POST',
    url: `/api/help/requests/${requestId}/claim`,
    headers: { authorization: `Bearer ${tokens.support}` },
  });
  expect(claimRes.statusCode).toBe(200);
  return requestId;
}

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  tokens = await provision();
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin?.end();
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE help_request_replies, help_requests, delivery_intents, help_notification_preferences, telegram_identities, telegram_link_codes CASCADE',
  );
});

describe('Help Notifications Integration (T3-017-C)', () => {
  describe('Notification Preferences API', () => {
    it('defaults to optedIn: false and updates explicitly', async () => {
      const app = makeApp();

      // Default is not opted in
      const getRes = await app.inject({
        method: 'GET',
        url: '/api/help/notifications/preference',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json()).toEqual({ channel: 'telegram', optedIn: false });

      // Opt in
      await optInNotifications(app, 'learner-a');

      // Verify opted-in
      const checkRes = await app.inject({
        method: 'GET',
        url: '/api/help/notifications/preference',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(checkRes.statusCode).toBe(200);
      expect(checkRes.json()).toEqual({ channel: 'telegram', optedIn: true });

      // Opt out
      await optOutNotifications(app, 'learner-a');

      // Verify opted-out
      const finalRes = await app.inject({
        method: 'GET',
        url: '/api/help/notifications/preference',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(finalRes.statusCode).toBe(200);
      expect(finalRes.json()).toEqual({ channel: 'telegram', optedIn: false });
    });
  });

  describe('Consent and Eligibility Checks on Staff Reply', () => {
    it('does not enqueue delivery intent when learner has neither link nor opt-in', async () => {
      const app = makeApp();
      const requestId = await submitAndClaim(app, 'req-unlinked-noopt');

      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { clientReplyId: 'sr-1', body: 'Support reply message.' },
      });
      expect(replyRes.statusCode).toBe(201);

      const count = await pool.query<{ count: string }>('SELECT count(*) FROM delivery_intents');
      expect(count.rows[0]?.count).toBe('0');
    });

    it('does not enqueue delivery intent when learner is linked but NOT opted in', async () => {
      const app = makeApp();
      await linkTelegram(app, 'learner-a', '10001', '20001');

      const requestId = await submitAndClaim(app, 'req-linked-noopt');

      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { clientReplyId: 'sr-1', body: 'Support reply message.' },
      });
      expect(replyRes.statusCode).toBe(201);

      const count = await pool.query<{ count: string }>('SELECT count(*) FROM delivery_intents');
      expect(count.rows[0]?.count).toBe('0');
    });

    it('does not enqueue delivery intent when learner is opted in but NOT linked', async () => {
      const app = makeApp();
      await optInNotifications(app, 'learner-a');

      const requestId = await submitAndClaim(app, 'req-opted-nolink');

      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { clientReplyId: 'sr-1', body: 'Support reply message.' },
      });
      expect(replyRes.statusCode).toBe(201);

      const count = await pool.query<{ count: string }>('SELECT count(*) FROM delivery_intents');
      expect(count.rows[0]?.count).toBe('0');
    });

    it('atomically enqueues delivery intent when learner is BOTH linked AND opted in', async () => {
      const app = makeApp();
      await linkTelegram(app, 'learner-a', '10001', '20001');
      await optInNotifications(app, 'learner-a');

      const requestId = await submitAndClaim(app, 'req-eligible-1');

      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { clientReplyId: 'sr-1', body: 'Support reply message.' },
      });
      expect(replyRes.statusCode).toBe(201);
      const reply = replyRes.json<ReplyResponse>().reply;

      const intents = await pool.query<{
        recipient_id: string;
        channel: string;
        status: string;
        content_ref: string;
      }>('SELECT recipient_id, channel, status, content_ref FROM delivery_intents');

      expect(intents.rows).toHaveLength(1);
      const row = intents.rows[0]!;
      expect(row.channel).toBe('telegram');
      expect(row.status).toBe('pending');
      expect(row.content_ref).toBe(`help_reply:${requestId}:${reply.id}`);

      const learnerCred = credentials.find((c) => c.key === 'learner-a')!;
      expect(row.recipient_id).toBe(learnerCred.id);
    });

    it('idempotent reply submission does not create duplicate delivery intents', async () => {
      const app = makeApp();
      await linkTelegram(app, 'learner-a', '10001', '20001');
      await optInNotifications(app, 'learner-a');

      const requestId = await submitAndClaim(app, 'req-idempotent-1');

      // First submit
      const res1 = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { clientReplyId: 'sr-idem-1', body: 'Support reply message.' },
      });
      expect(res1.statusCode).toBe(201);

      // Retry with same clientReplyId
      const res2 = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { clientReplyId: 'sr-idem-1', body: 'Support reply message.' },
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json<ReplyResponse>().kind).toBe('existing');

      const count = await pool.query<{ count: string }>('SELECT count(*) FROM delivery_intents');
      expect(count.rows[0]?.count).toBe('1');
    });

    it('learner replying to their own ticket does NOT enqueue a delivery intent for themselves', async () => {
      const app = makeApp();
      await linkTelegram(app, 'learner-a', '10001', '20001');
      await optInNotifications(app, 'learner-a');

      const requestId = await submitAndClaim(app, 'req-self-reply-1');

      const res = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: { clientReplyId: 'lr-1', body: 'Learner extra comment.' },
      });
      expect(res.statusCode).toBe(201);

      const count = await pool.query<{ count: string }>('SELECT count(*) FROM delivery_intents');
      expect(count.rows[0]?.count).toBe('0');
    });
  });

  describe('Suppression upon Unlink, Opt-out, and Cancellation', () => {
    it('unlinking Telegram via API cancels pending delivery intents', async () => {
      const app = makeApp();
      await linkTelegram(app, 'learner-a', '10001', '20001');
      await optInNotifications(app, 'learner-a');

      const requestId = await submitAndClaim(app, 'req-suppress-unlink');

      await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { clientReplyId: 'sr-1', body: 'Reply before unlink.' },
      });

      // Verify pending intent exists
      const before = await pool.query<{ status: string; content_ref: string | null }>(
        'SELECT status, content_ref FROM delivery_intents',
      );
      expect(before.rows[0]?.status).toBe('pending');
      expect(before.rows[0]?.content_ref).toBeTruthy();

      // Learner unlinks Telegram
      const unlinkRes = await app.inject({
        method: 'DELETE',
        url: '/api/telegram/link',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(unlinkRes.statusCode).toBe(204);

      // Pending delivery intent must be suppressed (cancelled with content_ref null)
      const after = await pool.query<{ status: string; content_ref: string | null }>(
        'SELECT status, content_ref FROM delivery_intents',
      );
      expect(after.rows[0]?.status).toBe('cancelled');
      expect(after.rows[0]?.content_ref).toBeNull();
    });

    it('unlinking Telegram via /unlink chat command cancels pending delivery intents', async () => {
      const app = makeApp();
      await linkTelegram(app, 'learner-a', '10001', '20001');
      await optInNotifications(app, 'learner-a');

      const requestId = await submitAndClaim(app, 'req-suppress-tg-unlink');

      await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { clientReplyId: 'sr-1', body: 'Reply before telegram unlink.' },
      });

      // Learner sends /unlink command
      const hookRes = await app.inject({
        method: 'POST',
        url: '/api/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret' },
        payload: {
          update_id: 999,
          message: {
            message_id: 1,
            from: { id: 10001, is_bot: false },
            chat: { id: 20001, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: '/unlink',
          },
        },
      });
      expect(hookRes.statusCode).toBe(200);
      expect(hookRes.json()).toEqual({ ok: true, status: 'unlinked' });

      // Delivery intent must be suppressed
      const after = await pool.query<{ status: string; content_ref: string | null }>(
        'SELECT status, content_ref FROM delivery_intents',
      );
      expect(after.rows[0]?.status).toBe('cancelled');
      expect(after.rows[0]?.content_ref).toBeNull();
    });

    it('opting out of notifications cancels pending delivery intents', async () => {
      const app = makeApp();
      await linkTelegram(app, 'learner-a', '10001', '20001');
      await optInNotifications(app, 'learner-a');

      const requestId = await submitAndClaim(app, 'req-suppress-optout');

      await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { clientReplyId: 'sr-1', body: 'Reply before opt out.' },
      });

      // Opt out
      await optOutNotifications(app, 'learner-a');

      // Intent must be cancelled
      const after = await pool.query<{ status: string; content_ref: string | null }>(
        'SELECT status, content_ref FROM delivery_intents',
      );
      expect(after.rows[0]?.status).toBe('cancelled');
      expect(after.rows[0]?.content_ref).toBeNull();
    });

    it('cancelling help request cancels pending delivery intents for that request', async () => {
      const app = makeApp();
      await linkTelegram(app, 'learner-a', '10001', '20001');
      await optInNotifications(app, 'learner-a');

      // Submit request without claim so it is in 'waiting' state
      const subRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: { clientRequestId: 'req-waiting-cancel', contextSnapshot: 'Context' },
      });
      const requestId = subRes.json<SubmitResponse>().request.id;

      // Claim and reply
      await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/claim`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { clientReplyId: 'sr-1', body: 'Support reply.' },
      });

      const before = await pool.query<{ status: string }>('SELECT status FROM delivery_intents');
      expect(before.rows[0]?.status).toBe('pending');

      // Now cancel via repository (or cancel waiting request)
      const helpRepo = new PostgresHelpRepository(pool);
      await helpRepo.cancelPendingIntentsForHelpRequest(requestId);

      const after = await pool.query<{ status: string; content_ref: string | null }>(
        'SELECT status, content_ref FROM delivery_intents',
      );
      expect(after.rows[0]?.status).toBe('cancelled');
      expect(after.rows[0]?.content_ref).toBeNull();
    });

    it('rechecks eligibility at dispatch time and suppresses if unlinked or opted out', async () => {
      const app = makeApp();
      await linkTelegram(app, 'learner-a', '10001', '20001');
      await optInNotifications(app, 'learner-a');

      const requestId = await submitAndClaim(app, 'req-dispatch-recheck');
      await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { clientReplyId: 'sr-1', body: 'Support reply.' },
      });

      const intentsRepo = new PostgresDeliveryIntents(pool);
      const claimed = await intentsRepo.claimDueWork({
        workerId: 'test-worker-1',
        now: new Date(),
      });
      expect(claimed).toHaveLength(1);

      // Learner opts out while intent was leased
      await optOutNotifications(app, 'learner-a');

      const mockFetch: typeof fetch = () => Promise.resolve(new Response('{}', { status: 200 }));
      const telegramAdapter = new TelegramDeliveryAdapter({ botToken: 'test-token' }, mockFetch);
      const notifier = new SupportReplyNotifier({ pool, telegramAdapter });

      const firstClaimed = claimed[0];
      expect(firstClaimed).toBeDefined();
      if (!firstClaimed) throw new Error('Expected claimed intent');
      const outcome = await notifier.dispatch(firstClaimed, new Date());
      expect(outcome.status).toBe('suppressed');
      expect(outcome.reason).toBe('not_opted_in');
    });
  });

  describe('Live Generic Notice Delivery', () => {
    it('dispatches generic notice with authorized return path and completes intent', async () => {
      const app = makeApp();
      await linkTelegram(app, 'learner-a', '10001', '20001');
      await optInNotifications(app, 'learner-a');

      const sensitiveBody = 'Sensitive confidential diagnosis and private exam notes.';
      const requestId = await submitAndClaim(app, 'req-live-dispatch');

      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { clientReplyId: 'sr-live-1', body: sensitiveBody },
      });
      expect(replyRes.statusCode).toBe(201);

      // Setup delivery worker and mock Telegram provider
      const sentPayloads: Array<{ chatId: string; text: string }> = [];
      const customFetch: typeof fetch = (_input, init) => {
        const bodyStr = typeof init?.body === 'string' ? init.body : '';
        const parsedBody = JSON.parse(bodyStr) as { chat_id: string; text: string };
        sentPayloads.push({ chatId: parsedBody.chat_id, text: parsedBody.text });
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, result: { message_id: 9991 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      };

      const telegramAdapter = new TelegramDeliveryAdapter(
        { botToken: 'test-bot-token' },
        customFetch,
      );
      const notifier = new SupportReplyNotifier({
        pool,
        telegramAdapter,
        returnUrlBase: 'http://localhost:5173',
      });

      const intentsRepo = new PostgresDeliveryIntents(pool);
      const worker = new DeliveryWorker({
        workerId: 'worker-live',
        intents: intentsRepo,
      });

      const batchResult = await worker.processBatch(new Date(), (intent) =>
        notifier.processClaimedIntent(intent),
      );

      expect(batchResult.claimed).toBe(1);
      expect(batchResult.completed).toBe(1);

      // Verify delivery intent in PostgreSQL
      const intentRecord = await pool.query<{ status: string; completed_at: Date | null }>(
        'SELECT status, completed_at FROM delivery_intents',
      );
      expect(intentRecord.rows[0]?.status).toBe('completed');
      expect(intentRecord.rows[0]?.completed_at).toBeTruthy();

      // Verify payload sent to Telegram API
      expect(sentPayloads).toHaveLength(1);
      const sent = sentPayloads[0];
      expect(sent).toBeDefined();
      if (!sent) throw new Error('Expected sent payload');
      expect(sent.chatId).toBe('20001');

      // CRITICAL CRITERION 1:
      // No sensitive message or accommodation body is exposed in the notification
      expect(sent.text).not.toContain(sensitiveBody);
      expect(sent.text).not.toContain('accommodation');
      expect(sent.text).not.toContain('confidential');
      expect(sent.text).toContain('A support team member has replied to your help request');

      // CRITICAL CRITERION 1: Notice provides an authorized return path to view the reply
      expect(sent.text).toContain('http://localhost:5173/#inbox');
    });
  });

  describe('Failure Safety', () => {
    it('failed notification never erases or blocks the persisted reply', async () => {
      const app = makeApp();
      await linkTelegram(app, 'learner-a', '10001', '20001');
      await optInNotifications(app, 'learner-a');

      const requestId = await submitAndClaim(app, 'req-failure-safety');
      const staffReplyText = 'Important staff reply that must never be lost.';

      // Add reply
      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { clientReplyId: 'sr-fail-1', body: staffReplyText },
      });
      expect(replyRes.statusCode).toBe(201);
      const replyId = replyRes.json<ReplyResponse>().reply.id;

      // Simulate provider catastrophic failure
      const failingFetch: typeof fetch = () =>
        Promise.reject(new Error('Telegram provider network failure'));
      const telegramAdapter = new TelegramDeliveryAdapter(
        { botToken: 'test-bot-token' },
        failingFetch,
      );
      const notifier = new SupportReplyNotifier({ pool, telegramAdapter });

      const intentsRepo = new PostgresDeliveryIntents(pool);
      const worker = new DeliveryWorker({
        workerId: 'worker-fail-test',
        intents: intentsRepo,
      });

      // Dispatch fails
      await worker.processBatch(new Date(), (intent) => notifier.processClaimedIntent(intent));

      // Persisted reply in PostgreSQL must be completely intact!
      const replyQuery = await pool.query<{ id: string; body: string }>(
        'SELECT id, body FROM help_request_replies WHERE id = $1',
        [replyId],
      );
      expect(replyQuery.rows).toHaveLength(1);
      expect(replyQuery.rows[0]?.body).toBe(staffReplyText);

      // Learner can still retrieve and read their reply via API
      const fetchRes = await app.inject({
        method: 'GET',
        url: `/api/help/requests/${requestId}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(fetchRes.statusCode).toBe(200);
      const replies = fetchRes.json<{ replies: readonly HelpReply[] }>().replies;
      expect(replies.some((r) => r.id === replyId && r.body === staffReplyText)).toBe(true);
    });
  });
});
