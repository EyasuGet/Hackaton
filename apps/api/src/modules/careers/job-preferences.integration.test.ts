// Real-PostgreSQL integration tests for job alert preferences, matching, and consent lifecycle (T3-020-A).
// Verifies:
// - Deterministic match / non-match against PostgreSQL
// - Learner ownership and scoped isolation
// - Duplicate publication deduplication and atomic enqueue
// - Consent/destination lifecycle: cancelling queued intents and removing no-longer-needed contacts
//   while preserving unrelated active subscriptions and bounded dedup records.
// - HTTP endpoints for subscriptions management.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from '../../bootstrap/config.ts';
import { createPool } from '../../infrastructure/database/connection.ts';
import {
  loadMigrations,
  migrate,
  MIGRATIONS_DIR,
} from '../../infrastructure/database/migrations.ts';
import { PostgresDeliveryIntents } from '../delivery/infrastructure/postgres-delivery-intents.ts';
import { JobMatching } from './application/job-matching.ts';
import { JobPreferences } from './application/job-preferences.ts';
import { PostgresJobPreferencesRepository } from './infrastructure/postgres-job-preferences-repository.ts';
import type { Job } from './domain/job.ts';
import type { Principal } from '../identity/domain/principal.ts';

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_${randomUUID().replaceAll('-', '')}`;

let admin: pg.Pool;
let pool: pg.Pool;
let preferencesRepo: PostgresJobPreferencesRepository;
let deliveryIntents: PostgresDeliveryIntents;
let preferences: JobPreferences;
let matching: JobMatching;

let learnerA: Principal;
let learnerB: Principal;
let learnerC: Principal;
let supportUser: Principal;

const T0 = new Date('2026-11-15T10:00:00.000Z');
const T_EXPIRES = new Date('2026-11-22T10:00:00.000Z');
const T_PAST = new Date('2026-11-10T10:00:00.000Z');

function sampleJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-admin-01',
    version: '1.0',
    title: 'Administrative Officer',
    organization: 'Addis Org',
    category: 'administrative',
    location: 'Addis Ababa',
    description: 'Provide office support',
    sourceUrl: 'https://example.com/job/1',
    postedAt: T0,
    expiresAt: T_EXPIRES,
    withdrawn: false,
    provenance: { kind: 'demo', note: 'fixture' },
    ...overrides,
  };
}

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));

  preferencesRepo = new PostgresJobPreferencesRepository(pool);
  deliveryIntents = new PostgresDeliveryIntents(pool);
  preferences = new JobPreferences(preferencesRepo);
  matching = new JobMatching(preferencesRepo, deliveryIntents, pool);

  const tokenA = 'a'.repeat(43);
  const tokenB = 'b'.repeat(43);
  const tokenSupport = 's'.repeat(43);

  const createPrincipal = async (
    role: 'learner' | 'support',
    label: string,
    key: string,
    token: string,
  ) => {
    const { createHash } = await import('node:crypto');
    const digest = createHash('sha256').update(token).digest('hex');
    const res = await pool.query<{ id: string }>(
      'INSERT INTO principals (role, label, is_demo, demo_key, token_digest) VALUES ($1, $2, true, $3, $4) RETURNING id',
      [role, label, key, digest],
    );
    const id = res.rows[0]!.id;
    return { id, role, label, demo: true, courseIds: ['course-1'] };
  };

  learnerA = await createPrincipal('learner', 'Learner A', 'learner-a', tokenA);
  learnerB = await createPrincipal('learner', 'Learner B', 'learner-b', tokenB);
  learnerC = await createPrincipal('learner', 'Learner C', 'learner-c', 'c'.repeat(43));
  supportUser = await createPrincipal('support', 'Support Staff', 'support-user', tokenSupport);
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin?.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE delivery_intents, job_subscriptions, job_alert_contacts CASCADE');
});

describe('Job Alert Subscriptions and Matching Integration (T3-020-A)', () => {
  describe('Learner ownership and scoped access', () => {
    it('allows a learner to create and view their own subscriptions', async () => {
      const sub = await preferences.subscribe(learnerA, {
        channel: 'telegram',
        destination: 'tg:111111',
        categories: ['administrative'],
        locations: ['Addis Ababa'],
      });

      expect(sub).not.toBeNull();
      expect(sub?.learnerId).toBe(learnerA.id);
      expect(sub?.channel).toBe('telegram');
      expect(sub?.destination).toBe('tg:111111');
      expect(sub?.categories).toEqual(['administrative']);
      expect(sub?.locations).toEqual(['Addis Ababa']);
      expect(sub?.active).toBe(true);

      const owned = await preferences.listOwned(learnerA);
      expect(owned).toHaveLength(1);
      expect(owned[0]?.id).toBe(sub?.id);
    });

    it('prevents learner B from viewing or unsubscribing learner A subscriptions', async () => {
      const subA = await preferences.subscribe(learnerA, {
        channel: 'telegram',
        destination: 'tg:111111',
        categories: ['administrative'],
      });
      expect(subA).not.toBeNull();

      // Learner B list is empty
      const listB = await preferences.listOwned(learnerB);
      expect(listB).toHaveLength(0);

      // Learner B cannot fetch Learner A's subscription
      const getB = await preferences.getOwned(learnerB, subA!.id);
      expect(getB).toBeNull();

      // Learner B cannot unsubscribe Learner A's subscription
      const unsubB = await preferences.unsubscribe(learnerB, subA!.id);
      expect(unsubB).toBeNull();

      // Subscription A is still active
      const getA = await preferences.getOwned(learnerA, subA!.id);
      expect(getA?.active).toBe(true);
    });

    it('rejects subscription requests from non-learner principals', async () => {
      const sub = await preferences.subscribe(supportUser, {
        channel: 'telegram',
        destination: 'tg:support',
      });
      expect(sub).toBeNull();
    });
  });

  describe('Deterministic match / non-match against publications', () => {
    it('enqueues alert intents only for matching active subscriptions', async () => {
      // Learner A: administrative in Addis Ababa
      await preferences.subscribe(learnerA, {
        channel: 'telegram',
        destination: 'tg:learnerA',
        categories: ['administrative'],
        locations: ['Addis Ababa'],
      });

      // Learner B: software engineering in Addis Ababa
      await preferences.subscribe(learnerB, {
        channel: 'telegram',
        destination: 'tg:learnerB',
        categories: ['software'],
        locations: ['Addis Ababa'],
      });

      // Learner C: open-ended / all categories and locations on SMS
      await preferences.subscribe(learnerC, {
        channel: 'sms',
        destination: '+251911223344',
        categories: [],
        locations: [],
      });

      const adminJob = sampleJob({
        id: 'job-admin-01',
        category: 'administrative',
        location: 'Addis Ababa',
      });

      const outcome = await matching.matchAndEnqueue(adminJob, T0);
      expect(outcome.matched).toBe(2); // Learner A and Learner C
      expect(outcome.enqueued).toBe(2);
      expect(outcome.duplicates).toBe(0);

      const intents = await pool.query<{
        recipient_id: string;
        channel: string;
        content_ref: string;
      }>(
        'SELECT recipient_id, channel, content_ref FROM delivery_intents ORDER BY channel, recipient_id',
      );
      expect(intents.rows).toHaveLength(2);
      expect(intents.rows).toEqual([
        {
          recipient_id: learnerC.id,
          channel: 'sms',
          content_ref: 'job:job-admin-01:1.0',
        },
        {
          recipient_id: learnerA.id,
          channel: 'telegram',
          content_ref: 'job:job-admin-01:1.0',
        },
      ]);
    });

    it('does not enqueue alerts for expired or withdrawn jobs', async () => {
      await preferences.subscribe(learnerA, {
        channel: 'telegram',
        destination: 'tg:learnerA',
        categories: [],
      });

      const expiredJob = sampleJob({ expiresAt: T_PAST });
      const expiredOutcome = await matching.matchAndEnqueue(expiredJob, T0);
      expect(expiredOutcome.skippedReason).toBe('ineligible_job');
      expect(expiredOutcome.enqueued).toBe(0);

      const withdrawnJob = sampleJob({ withdrawn: true });
      const withdrawnOutcome = await matching.matchAndEnqueue(withdrawnJob, T0);
      expect(withdrawnOutcome.skippedReason).toBe('ineligible_job');
      expect(withdrawnOutcome.enqueued).toBe(0);

      const count = await pool.query<{ count: string }>('SELECT count(*) FROM delivery_intents');
      expect(count.rows[0]?.count).toBe('0');
    });

    it('does not match inactive / unsubscribed preferences', async () => {
      const sub = await preferences.subscribe(learnerA, {
        channel: 'telegram',
        destination: 'tg:learnerA',
        categories: ['administrative'],
      });
      await preferences.unsubscribe(learnerA, sub!.id);

      const job = sampleJob({ category: 'administrative' });
      const outcome = await matching.matchAndEnqueue(job, T0);
      expect(outcome.matched).toBe(0);
      expect(outcome.enqueued).toBe(0);

      const count = await pool.query<{ count: string }>('SELECT count(*) FROM delivery_intents');
      expect(count.rows[0]?.count).toBe('0');
    });
  });

  describe('Duplicate publication and concurrency handling', () => {
    it('yields one logical intent when a publication is processed repeatedly', async () => {
      await preferences.subscribe(learnerA, {
        channel: 'telegram',
        destination: 'tg:learnerA',
        categories: ['administrative'],
      });

      const job = sampleJob();

      const first = await matching.matchAndEnqueue(job, T0);
      expect(first.enqueued).toBe(1);
      expect(first.duplicates).toBe(0);

      // Re-running or re-importing the same publication event:
      const second = await matching.matchAndEnqueue(job, T0);
      expect(second.matched).toBe(1);
      expect(second.enqueued).toBe(0);
      expect(second.duplicates).toBe(1);

      const count = await pool.query<{ count: string }>('SELECT count(*) FROM delivery_intents');
      expect(count.rows[0]?.count).toBe('1');
    });

    it('enqueues exactly one intent when concurrent matching runs race', async () => {
      await preferences.subscribe(learnerA, {
        channel: 'telegram',
        destination: 'tg:learnerA',
        categories: ['administrative'],
      });

      const job = sampleJob();

      const [res1, res2] = await Promise.all([
        matching.matchAndEnqueue(job, T0),
        matching.matchAndEnqueue(job, T0),
      ]);

      expect(res1.enqueued + res2.enqueued).toBe(1);
      expect(res1.duplicates + res2.duplicates).toBe(1);

      const count = await pool.query<{ count: string }>('SELECT count(*) FROM delivery_intents');
      expect(count.rows[0]?.count).toBe('1');
    });
  });

  describe('Consent/destination lifecycle (T3-023-A)', () => {
    it('cancels queued intents and deletes contact when last subscription on channel is unsubscribed', async () => {
      const sub = await preferences.subscribe(learnerA, {
        channel: 'telegram',
        destination: 'tg:dest1',
        categories: ['administrative'],
      });

      // Match a job so a delivery intent is pending in queue
      const job = sampleJob();
      await matching.matchAndEnqueue(job, T0);

      const before = await pool.query<{ status: string; content_ref: string }>(
        'SELECT status, content_ref FROM delivery_intents',
      );
      expect(before.rows[0]?.status).toBe('pending');
      expect(before.rows[0]?.content_ref).toBe('job:job-admin-01:1.0');

      // Unsubscribe
      const unsub = await preferences.unsubscribe(learnerA, sub!.id, T0);
      expect(unsub).not.toBeNull();
      expect(unsub?.cancelledIntentsCount).toBe(1);
      expect(unsub?.contactRemoved).toBe(true);

      // 1. Ineligible queued intent is cancelled and content_ref scrubbed
      const after = await pool.query<{
        status: string;
        content_ref: string | null;
        dedup_digest: string;
      }>('SELECT status, content_ref, dedup_digest FROM delivery_intents');
      expect(after.rows).toHaveLength(1);
      expect(after.rows[0]?.status).toBe('cancelled');
      expect(after.rows[0]?.content_ref).toBeNull();
      // Bounded non-content dedup record remains preserved!
      expect(after.rows[0]?.dedup_digest).toBeDefined();

      // 2. Contact is removed from job_alert_contacts
      const contacts = await pool.query('SELECT * FROM job_alert_contacts WHERE learner_id = $1', [
        learnerA.id,
      ]);
      expect(contacts.rows).toHaveLength(0);

      // 3. A replay within the dedup window does NOT re-enqueue
      const replay = await matching.matchAndEnqueue(job, T0);
      expect(replay.enqueued).toBe(0);
    });

    it('preserves contact and unrelated active subscriptions when unsubscribing one of multiple subscriptions', async () => {
      // Learner A has two subscriptions on Telegram and one on SMS:
      const subTg1 = await preferences.subscribe(learnerA, {
        channel: 'telegram',
        destination: 'tg:shared',
        categories: ['administrative'],
      });
      const subTg2 = await preferences.subscribe(learnerA, {
        channel: 'telegram',
        destination: 'tg:shared',
        categories: ['technology'],
      });
      const subSms = await preferences.subscribe(learnerA, {
        channel: 'sms',
        destination: '+251911000000',
        categories: ['administrative'],
      });

      // Unsubscribe only subTg1
      const unsub = await preferences.unsubscribe(learnerA, subTg1!.id, T0);
      expect(unsub?.contactRemoved).toBe(false);

      // subTg2 remains active!
      const activeTg = await preferences.getOwned(learnerA, subTg2!.id);
      expect(activeTg?.active).toBe(true);

      // Telegram contact is still preserved because subTg2 is active!
      const tgContact = await pool.query(
        "SELECT * FROM job_alert_contacts WHERE learner_id = $1 AND channel = 'telegram'",
        [learnerA.id],
      );
      expect(tgContact.rows).toHaveLength(1);

      // Unrelated SMS subscription and contact are completely preserved!
      const smsSub = await preferences.getOwned(learnerA, subSms!.id);
      expect(smsSub?.active).toBe(true);

      const smsContact = await pool.query(
        "SELECT * FROM job_alert_contacts WHERE learner_id = $1 AND channel = 'sms'",
        [learnerA.id],
      );
      expect(smsContact.rows).toHaveLength(1);
    });

    it('cancels pending intents when a job is withdrawn', async () => {
      await preferences.subscribe(learnerA, {
        channel: 'telegram',
        destination: 'tg:dest',
        categories: ['administrative'],
      });

      const job = sampleJob();
      await matching.matchAndEnqueue(job, T0);

      const countPending = await pool.query<{ count: string }>(
        "SELECT count(*) FROM delivery_intents WHERE status = 'pending'",
      );
      expect(countPending.rows[0]?.count).toBe('1');

      // The job is withdrawn
      const withdrawnJob = { ...job, withdrawn: true };
      await matching.matchAndEnqueue(withdrawnJob, T0);

      // The queued intent for this withdrawn job was cancelled!
      const afterCancel = await pool.query<{ status: string; content_ref: string | null }>(
        'SELECT status, content_ref FROM delivery_intents',
      );
      expect(afterCancel.rows[0]?.status).toBe('cancelled');
      expect(afterCancel.rows[0]?.content_ref).toBeNull();
    });
  });

  describe('HTTP Presentation Routes (/api/careers/subscriptions)', () => {
    async function makeApp() {
      const { buildApp } = await import('../../bootstrap/app.ts');
      const { ResolvePrincipal } = await import('../identity/application/resolve-principal.ts');
      const { PostgresPrincipalRepository } =
        await import('../identity/infrastructure/postgres-principal-repository.ts');
      const { PostgresJobRepository } = await import('./infrastructure/postgres-job-repository.ts');
      const { DemoRecords } = await import('../demo-records/demo-records.ts');
      const { DemoSessions } = await import('../identity/application/demo-sessions.ts');
      const { Tutoring } = await import('../tutoring/application/tutoring.ts');
      const { ContentAccess } = await import('../content/application/content-access.ts');

      return buildApp({
        checkReadiness: () => Promise.resolve({ ready: true }),
        resolvePrincipal: new ResolvePrincipal(new PostgresPrincipalRepository(pool), true),
        demoRecords: new DemoRecords({
          list: () => Promise.resolve([]),
          find: () => Promise.resolve(null),
        }),
        demoSessions: new DemoSessions(
          {
            createHandoff: () => Promise.resolve(false),
            consumeHandoff: () => Promise.resolve(null),
            createSession: () => Promise.resolve(),
            revokeSession: () => Promise.resolve(false),
          },
          true,
        ),
        demoAllowedOrigins: ['http://localhost:5173'],
        tutoring: new Tutoring({
          createConversation: () => Promise.resolve(null),
          findConversation: () => Promise.resolve(null),
          claimRequest: () => Promise.resolve(null),
          findRequestById: () => Promise.resolve(null),
          findRequestByRequestId: () => Promise.resolve(null),
          listHistory: () => Promise.resolve([]),
          recordOutcome: () => Promise.resolve(null),
          clearHistory: () => Promise.resolve(),
          purgeExpired: () => Promise.resolve(0),
        }),
        content: new ContentAccess(
          {
            search: () => Promise.resolve([]),
            resolve: () => Promise.resolve({ kind: 'not_found' }),
          },
          [],
        ),
        jobRepository: new PostgresJobRepository(pool),
        jobPreferences: preferences,
      });
    }

    it('rejects unauthenticated requests with 401', async () => {
      const app = await makeApp();
      try {
        const res = await app.inject({
          method: 'GET',
          url: '/api/careers/subscriptions',
        });
        expect(res.statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });

    it('rejects non-learner roles with 403', async () => {
      const app = await makeApp();
      try {
        const res = await app.inject({
          method: 'GET',
          url: '/api/careers/subscriptions',
          headers: { authorization: `Bearer ${'s'.repeat(43)}` },
        });
        expect(res.statusCode).toBe(403);
      } finally {
        await app.close();
      }
    });

    it('creates, lists, and deletes subscriptions over HTTP for authenticated learners', async () => {
      const app = await makeApp();
      try {
        const token = 'a'.repeat(43);

        // POST /api/careers/subscriptions
        const postRes = await app.inject({
          method: 'POST',
          url: '/api/careers/subscriptions',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            channel: 'telegram',
            destination: 'tg:mychannel',
            categories: ['administrative'],
            locations: ['Addis Ababa'],
          },
        });
        expect(postRes.statusCode).toBe(201);
        const postBody = postRes.json<{ subscription: { id: string; channel: string } }>();
        expect(postBody.subscription.id).toBeDefined();
        expect(postBody.subscription.channel).toBe('telegram');

        // GET /api/careers/subscriptions
        const getRes = await app.inject({
          method: 'GET',
          url: '/api/careers/subscriptions',
          headers: { authorization: `Bearer ${token}` },
        });
        expect(getRes.statusCode).toBe(200);
        const getBody = getRes.json<{ subscriptions: Array<{ id: string }> }>();
        expect(getBody.subscriptions).toHaveLength(1);
        expect(getBody.subscriptions[0]?.id).toBe(postBody.subscription.id);

        // DELETE /api/careers/subscriptions/:id
        const deleteRes = await app.inject({
          method: 'DELETE',
          url: `/api/careers/subscriptions/${postBody.subscription.id}`,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(deleteRes.statusCode).toBe(200);
        const deleteBody = deleteRes.json<{ status: string; contactRemoved: boolean }>();
        expect(deleteBody.status).toBe('unsubscribed');
        expect(deleteBody.contactRemoved).toBe(true);

        // Subsequent GET shows 1 subscription with active = false
        const getAfter = await app.inject({
          method: 'GET',
          url: '/api/careers/subscriptions',
          headers: { authorization: `Bearer ${token}` },
        });
        expect(getAfter.statusCode).toBe(200);
        const getAfterBody = getAfter.json<{
          subscriptions: Array<{ id: string; active: boolean }>;
        }>();
        expect(getAfterBody.subscriptions[0]?.active).toBe(false);
      } finally {
        await app.close();
      }
    });

    it('returns 400 for invalid subscription payloads', async () => {
      const app = await makeApp();
      try {
        const token = 'a'.repeat(43);
        const res = await app.inject({
          method: 'POST',
          url: '/api/careers/subscriptions',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            // missing channel and destination
            categories: ['administrative'],
          },
        });
        expect(res.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });

    it('returns 404 when attempting to delete a non-existent or unowned subscription', async () => {
      const app = await makeApp();
      try {
        const token = 'b'.repeat(43); // Learner B
        const res = await app.inject({
          method: 'DELETE',
          url: `/api/careers/subscriptions/${randomUUID()}`,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });
  });
});
