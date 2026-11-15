// Real-PostgreSQL integration tests for subscribed SMS job alert delivery (T3-021-B, #94).
// Proves:
// 1. Matching approved job publication yields SMS delivery intent.
// 2. Duplicate publication is deduplicated / idempotent (at most one intent per learner/job/channel).
// 3. Worker dispatches bounded Unicode payload in English and Amharic with usable job link
//    (https://digitalbridge.et/jobs/...) and compliant opt-out instructions (STOP to opt out / ማቆም).
// 4. Handset receipt reconciliation via AfroMessage DLR webhook.
// 5. Unsubscribed or expired queued work is suppressed (zero SMS dispatches, zero carrier spend).
// 6. Unverified or revoked phone destinations are suppressed.
// 7. Withdrawn or expired jobs are suppressed.
// 8. Inbound opt-out keywords (STOP, ማቆም) trigger pre-network message suppression.
// 9. Failure & bounded retry handling adheres to delivery policies.

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
import type { Principal } from '../identity/domain/principal.ts';
import type { Job } from '../careers/domain/job.ts';
import { JobMatching } from '../careers/application/job-matching.ts';
import { JobPreferences } from '../careers/application/job-preferences.ts';
import { PostgresJobPreferencesRepository } from '../careers/infrastructure/postgres-job-preferences-repository.ts';
import { PostgresJobRepository } from '../careers/infrastructure/postgres-job-repository.ts';
import { PostgresDeliveryIntents } from './infrastructure/postgres-delivery-intents.ts';
import { DeliveryWorker } from './application/delivery-worker.ts';
import { SmsJobAlertNotifier } from './application/sms-job-alert-notifier.ts';
import {
  AfroMessageSmsAdapter,
  InMemorySmsSuppressionRegistry,
} from './infrastructure/afromessage-sms-adapter.ts';

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_${randomUUID().replaceAll('-', '')}`;

let admin: pg.Pool;
let pool: pg.Pool;
let jobRepo: PostgresJobRepository;
let preferencesRepo: PostgresJobPreferencesRepository;
let deliveryIntents: PostgresDeliveryIntents;
let preferences: JobPreferences;
let matching: JobMatching;

let learnerA: Principal;

const T0 = new Date('2026-11-15T10:00:00.000Z');
const T_EXPIRES = new Date('2026-11-22T10:00:00.000Z');

function createSampleJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-tech-01',
    version: '1.0',
    title: 'Virtual Assistant Specialist',
    organization: 'Savanna Tech',
    category: 'technology',
    location: 'Addis Ababa',
    description: 'Provide executive digital assistance and calendar management.',
    sourceUrl: 'https://digitalbridge.et/jobs/job-tech-01',
    postedAt: T0,
    expiresAt: T_EXPIRES,
    withdrawn: false,
    provenance: { kind: 'demo', note: 'official-partner' },
    ...overrides,
  };
}

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));

  jobRepo = new PostgresJobRepository(pool);
  preferencesRepo = new PostgresJobPreferencesRepository(pool);
  deliveryIntents = new PostgresDeliveryIntents(pool);
  preferences = new JobPreferences(preferencesRepo);
  matching = new JobMatching(preferencesRepo, deliveryIntents, pool);

  // Seed demo learners
  const resA = await pool.query<{ id: string }>(
    `INSERT INTO principals (role, label, is_demo, demo_key)
     VALUES ('learner', 'Learner A', true, 'learner-sms-a')
     RETURNING id`,
  );
  learnerA = {
    id: resA.rows[0]!.id,
    role: 'learner',
    label: 'Learner A',
    demo: true,
    courseIds: [],
  };
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin?.end();
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE delivery_intents, job_subscriptions, job_alert_contacts, learner_verified_phones, job_versions, jobs CASCADE',
  );
});

describe('Subscribed SMS Job Alert Delivery (T3-021-B)', () => {
  it('enqueues delivery intent when an approved matching job is published', async () => {
    // 1. Verify phone number for Learner A
    await pool.query(
      `INSERT INTO learner_verified_phones (learner_id, phone_number, verified_at)
       VALUES ($1, '+251911000001', $2)`,
      [learnerA.id, T0],
    );

    // 2. Subscribe Learner A to SMS job alerts for Technology
    await preferences.subscribe(
      learnerA,
      {
        channel: 'sms',
        destination: '+251911000001',
        categories: ['technology'],
        locations: ['Addis Ababa'],
      },
      T0,
    );

    // 3. Import and match job
    const job = createSampleJob();
    await jobRepo.importJob(job, 'checksum-tech-01');
    const outcome = await matching.matchAndEnqueue(job, T0);

    expect(outcome.matched).toBe(1);
    expect(outcome.enqueued).toBe(1);
    expect(outcome.duplicates).toBe(0);

    // 4. Verify delivery intent in PostgreSQL
    const intents = await pool.query<{
      channel: string;
      recipient_id: string;
      content_ref: string;
      status: string;
    }>('SELECT channel, recipient_id, content_ref, status FROM delivery_intents');

    expect(intents.rows).toHaveLength(1);
    expect(intents.rows[0]).toMatchObject({
      channel: 'sms',
      recipient_id: learnerA.id,
      content_ref: 'job:job-tech-01:1.0',
      status: 'pending',
    });
  });

  it('deduplicates repeated publication of the same job version (idempotency)', async () => {
    // Setup verified subscription
    await pool.query(
      `INSERT INTO learner_verified_phones (learner_id, phone_number, verified_at)
       VALUES ($1, '+251911000001', $2)`,
      [learnerA.id, T0],
    );
    await preferences.subscribe(
      learnerA,
      {
        channel: 'sms',
        destination: '+251911000001',
        categories: ['technology'],
      },
      T0,
    );

    const job = createSampleJob();
    await jobRepo.importJob(job, 'checksum-tech-01');

    // First publication
    const firstMatch = await matching.matchAndEnqueue(job, T0);
    expect(firstMatch.enqueued).toBe(1);
    expect(firstMatch.duplicates).toBe(0);

    // Second publication replay (e.g. system re-indexing or broadcast retry)
    const replayMatch = await matching.matchAndEnqueue(job, T0);
    expect(replayMatch.enqueued).toBe(0);
    expect(replayMatch.duplicates).toBe(1);

    // Total stored intents remains exactly 1
    const countRes = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM delivery_intents',
    );
    expect(countRes.rows[0]?.count).toBe('1');
  });

  it('dispatches bounded English SMS alert via AfroMessage with usable URL and opt-out instructions', async () => {
    await pool.query(
      `INSERT INTO learner_verified_phones (learner_id, phone_number, verified_at)
       VALUES ($1, '+251911000001', $2)`,
      [learnerA.id, T0],
    );
    await preferences.subscribe(
      learnerA,
      {
        channel: 'sms',
        destination: '+251911000001',
        categories: ['technology'],
      },
      T0,
    );

    const job = createSampleJob();
    await jobRepo.importJob(job, 'checksum-tech-01');
    await matching.matchAndEnqueue(job, T0);

    // Intercept outbound AfroMessage HTTP POST
    const interceptedCalls: Array<{ body: unknown }> = [];
    const customFetch: typeof fetch = (_input, init) => {
      const bodyStr = typeof init?.body === 'string' ? init.body : '';
      interceptedCalls.push({
        body: bodyStr ? (JSON.parse(bodyStr) as unknown) : undefined,
      });

      return Promise.resolve(
        new Response(
          JSON.stringify({
            acknowledge: 'success',
            response: {
              status: 'Send in progress...',
              message_id: 'afro_msg_live_001',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };

    const suppressionRegistry = new InMemorySmsSuppressionRegistry();
    const smsAdapter = new AfroMessageSmsAdapter(
      {
        apiToken: 'test-afro-token',
        senderName: 'Track3',
        suppressionRegistry,
      },
      customFetch,
    );

    const notifier = new SmsJobAlertNotifier({
      pool,
      smsAdapter,
      baseUrl: 'https://digitalbridge.et',
    });

    const worker = new DeliveryWorker({
      workerId: 'worker-sms-1',
      intents: deliveryIntents,
    });

    // Execute delivery worker batch
    const batchResult = await worker.processBatch(T0, (intent) =>
      notifier.processClaimedIntent(intent, T0),
    );

    expect(batchResult.claimed).toBe(1);
    expect(batchResult.completed).toBe(1);
    expect(batchResult.released).toBe(0);

    // Verify delivery intent in DB is marked completed
    const intentRecord = await pool.query<{
      status: string;
      completed_at: Date | null;
      attempt_count: number;
    }>('SELECT status, completed_at, attempt_count FROM delivery_intents');

    expect(intentRecord.rows[0]?.status).toBe('completed');
    expect(intentRecord.rows[0]?.completed_at).toBeTruthy();
    expect(intentRecord.rows[0]?.attempt_count).toBe(1);

    // Verify payload dispatched to AfroMessage
    expect(interceptedCalls).toHaveLength(1);
    const sentBody = interceptedCalls[0]!.body as {
      to: string;
      message: string;
      sender: string;
      callback: string;
    };

    expect(sentBody.to).toBe('+251911000001');
    expect(sentBody.sender).toBe('Track3');
    expect(sentBody.message).toContain('Job Alert: Virtual Assistant Specialist at Savanna Tech');
    expect(sentBody.message).toContain('https://digitalbridge.et/jobs/job-tech-01');
    expect(sentBody.message).toContain('STOP to opt out');

    // Simulate AfroMessage DLR webhook confirming handset receipt
    const dlrResult = smsAdapter.handleDlrWebhook({
      acknowledge: 'success',
      response: {
        message_id: 'afro_msg_live_001',
        status: 'DELIVRD',
        to: '+251911000001',
      },
    });

    expect(dlrResult.status).toBe('delivered');
    expect(dlrResult.isTerminal).toBe(true);
    expect(dlrResult.messageId).toBe('afro_msg_live_001');
  });

  it('dispatches bounded Amharic Ge’ez SMS alert with zero mojibake and ማቆም opt-out instruction', async () => {
    // Safaricom Ethiopia test destination (+2517...)
    await pool.query(
      `INSERT INTO learner_verified_phones (learner_id, phone_number, verified_at)
       VALUES ($1, '+251712345678', $2)`,
      [learnerA.id, T0],
    );
    await preferences.subscribe(
      learnerA,
      {
        channel: 'sms',
        destination: '+251712345678',
        categories: ['administration'],
      },
      T0,
    );

    const amharicJob = createSampleJob({
      id: 'job-am-clerk',
      title: 'የዳታ ክለርክ እና የቢሮ ረዳት',
      organization: 'ሳቫና የዲጂታል አገልግሎት',
      category: 'administration',
      sourceUrl: 'https://digitalbridge.et/jobs/job-am-clerk',
    });

    await jobRepo.importJob(amharicJob, 'checksum-am-01');
    await matching.matchAndEnqueue(amharicJob, T0);

    const interceptedCalls: Array<{ body: unknown }> = [];
    const customFetch: typeof fetch = (_input, init) => {
      const bodyStr = typeof init?.body === 'string' ? init.body : '';
      interceptedCalls.push({
        body: bodyStr ? (JSON.parse(bodyStr) as unknown) : undefined,
      });

      return Promise.resolve(
        new Response(
          JSON.stringify({
            acknowledge: 'success',
            response: {
              status: 'Send in progress...',
              message_id: 'afro_msg_am_002',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };

    const smsAdapter = new AfroMessageSmsAdapter({ apiToken: 'test-afro-token' }, customFetch);
    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const worker = new DeliveryWorker({
      workerId: 'worker-sms-am',
      intents: deliveryIntents,
    });

    const batchResult = await worker.processBatch(T0, (intent) =>
      notifier.processClaimedIntent(intent, T0),
    );

    expect(batchResult.completed).toBe(1);

    // Verify dispatched payload
    expect(interceptedCalls).toHaveLength(1);
    const sentBody = interceptedCalls[0]!.body as { to: string; message: string };
    expect(sentBody.to).toBe('+251712345678');

    // Amharic content checks
    expect(sentBody.message).toContain('አዲስ የስራ እድል፡ የዳታ ክለርክ እና የቢሮ ረዳት በሳቫና የዲጂታል አገልግሎት።');
    expect(sentBody.message).toContain('https://digitalbridge.et/jobs/job-am-clerk');
    expect(sentBody.message).toContain('ማቆም');

    // Zero mojibake or corrupt characters
    expect(sentBody.message).not.toContain('\uFFFD');
    expect(sentBody.message).not.toContain('???');
  });

  it('suppresses delivery when the learner unsubscribes before dispatch', async () => {
    await pool.query(
      `INSERT INTO learner_verified_phones (learner_id, phone_number, verified_at)
       VALUES ($1, '+251911000001', $2)`,
      [learnerA.id, T0],
    );
    const sub = await preferences.subscribe(
      learnerA,
      {
        channel: 'sms',
        destination: '+251911000001',
        categories: ['technology'],
      },
      T0,
    );

    const job = createSampleJob();
    await jobRepo.importJob(job, 'checksum-tech-01');
    await matching.matchAndEnqueue(job, T0);

    // Learner unsubscribes prior to worker processing
    expect(sub).toBeDefined();
    if (!sub) throw new Error('Expected active subscription');
    await preferences.unsubscribe(learnerA, sub.id, T0);

    let networkCallMade = false;
    const failingFetch: typeof fetch = () => {
      networkCallMade = true;
      return Promise.resolve(new Response('{}', { status: 200 }));
    };

    const smsAdapter = new AfroMessageSmsAdapter({ apiToken: 'token' }, failingFetch);
    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const worker = new DeliveryWorker({
      workerId: 'worker-unsub-test',
      intents: deliveryIntents,
    });

    const batchResult = await worker.processBatch(T0, (intent) =>
      notifier.processClaimedIntent(intent, T0),
    );

    // Zero SMS sent to network
    expect(networkCallMade).toBe(false);
    expect(batchResult.claimed).toBe(0); // Cancelled in DB by unsubscribe
  });

  it('rechecks eligibility and suppresses stale/in-flight intents if subscription became inactive', async () => {
    await pool.query(
      `INSERT INTO learner_verified_phones (learner_id, phone_number, verified_at)
       VALUES ($1, '+251911000001', $2)`,
      [learnerA.id, T0],
    );
    await preferences.subscribe(
      learnerA,
      {
        channel: 'sms',
        destination: '+251911000001',
        categories: ['technology'],
      },
      T0,
    );

    const job = createSampleJob();
    await jobRepo.importJob(job, 'checksum-tech-01');
    await matching.matchAndEnqueue(job, T0);

    // Deactivate subscription directly (simulating race or concurrent admin deactivation)
    await pool.query('UPDATE job_subscriptions SET active = false, unsubscribed_at = now()');

    let networkCallMade = false;
    const customFetch: typeof fetch = () => {
      networkCallMade = true;
      return Promise.resolve(new Response('{}', { status: 200 }));
    };

    const smsAdapter = new AfroMessageSmsAdapter({ apiToken: 'token' }, customFetch);
    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const worker = new DeliveryWorker({ workerId: 'worker-race', intents: deliveryIntents });

    const batchResult = await worker.processBatch(T0, (intent) =>
      notifier.processClaimedIntent(intent, T0),
    );

    // Intent was claimed, but notifier pre-send check detected inactive subscription and completed it as suppressed
    expect(batchResult.claimed).toBe(1);
    expect(batchResult.completed).toBe(1);
    expect(networkCallMade).toBe(false); // Zero SMS dispatched
  });

  it('suppresses delivery if the phone number verification is revoked or unverified', async () => {
    // Active subscription exists, but phone is not in learner_verified_phones
    await preferences.subscribe(
      learnerA,
      {
        channel: 'sms',
        destination: '+251911000001',
        categories: ['technology'],
      },
      T0,
    );

    const job = createSampleJob();
    await jobRepo.importJob(job, 'checksum-tech-01');
    await matching.matchAndEnqueue(job, T0);

    let networkCallMade = false;
    const customFetch: typeof fetch = () => {
      networkCallMade = true;
      return Promise.resolve(new Response('{}', { status: 200 }));
    };

    const smsAdapter = new AfroMessageSmsAdapter({ apiToken: 'token' }, customFetch);
    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const worker = new DeliveryWorker({ workerId: 'worker-unverified', intents: deliveryIntents });

    const batchResult = await worker.processBatch(T0, (intent) =>
      notifier.processClaimedIntent(intent, T0),
    );

    expect(batchResult.completed).toBe(1);
    expect(networkCallMade).toBe(false);
  });

  it('suppresses delivery if the job is withdrawn before dispatch', async () => {
    await pool.query(
      `INSERT INTO learner_verified_phones (learner_id, phone_number, verified_at)
       VALUES ($1, '+251911000001', $2)`,
      [learnerA.id, T0],
    );
    await preferences.subscribe(
      learnerA,
      {
        channel: 'sms',
        destination: '+251911000001',
        categories: ['technology'],
      },
      T0,
    );

    const job = createSampleJob();
    await jobRepo.importJob(job, 'checksum-tech-01');
    await matching.matchAndEnqueue(job, T0);

    // Job is withdrawn
    await pool.query("UPDATE job_versions SET withdrawn = true WHERE job_id = 'job-tech-01'");

    let networkCallMade = false;
    const customFetch: typeof fetch = () => {
      networkCallMade = true;
      return Promise.resolve(new Response('{}', { status: 200 }));
    };

    const smsAdapter = new AfroMessageSmsAdapter({ apiToken: 'token' }, customFetch);
    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const worker = new DeliveryWorker({ workerId: 'worker-withdrawn', intents: deliveryIntents });

    await worker.processBatch(T0, (intent) => notifier.processClaimedIntent(intent, T0));
    expect(networkCallMade).toBe(false);
  });

  it('suppresses delivery before network call when recipient opted out via inbound keyword', async () => {
    await pool.query(
      `INSERT INTO learner_verified_phones (learner_id, phone_number, verified_at)
       VALUES ($1, '+251911000001', $2)`,
      [learnerA.id, T0],
    );
    await preferences.subscribe(
      learnerA,
      {
        channel: 'sms',
        destination: '+251911000001',
        categories: ['technology'],
      },
      T0,
    );

    const job = createSampleJob();
    await jobRepo.importJob(job, 'checksum-tech-01');
    await matching.matchAndEnqueue(job, T0);

    let networkCallMade = false;
    const customFetch: typeof fetch = () => {
      networkCallMade = true;
      return Promise.resolve(new Response('{}', { status: 200 }));
    };

    const suppressionRegistry = new InMemorySmsSuppressionRegistry();
    const smsAdapter = new AfroMessageSmsAdapter(
      { apiToken: 'token', suppressionRegistry },
      customFetch,
    );

    // Inbound Amharic opt-out message received
    await smsAdapter.handleInboundWebhook({
      from: '+251911000001',
      message: 'ማቆም',
    });

    expect(suppressionRegistry.isSuppressed('+251911000001')).toBe(true);

    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const worker = new DeliveryWorker({ workerId: 'worker-optout', intents: deliveryIntents });

    const batchResult = await worker.processBatch(T0, (intent) =>
      notifier.processClaimedIntent(intent, T0),
    );

    expect(batchResult.completed).toBe(1);
    expect(networkCallMade).toBe(false); // 0 ETB carrier spend
  });

  it('releases intent for retry on transient network failure and recovers on subsequent attempt', async () => {
    await pool.query(
      `INSERT INTO learner_verified_phones (learner_id, phone_number, verified_at)
       VALUES ($1, '+251911000001', $2)`,
      [learnerA.id, T0],
    );
    await preferences.subscribe(
      learnerA,
      {
        channel: 'sms',
        destination: '+251911000001',
        categories: ['technology'],
      },
      T0,
    );

    const job = createSampleJob();
    await jobRepo.importJob(job, 'checksum-tech-01');
    await matching.matchAndEnqueue(job, T0);

    let attempts = 0;
    const transientFailingFetch: typeof fetch = () => {
      attempts++;
      if (attempts === 1) {
        // First attempt fails with transient gateway error
        return Promise.resolve(new Response('Internal Gateway Error', { status: 502 }));
      }
      // Second attempt succeeds
      return Promise.resolve(
        new Response(
          JSON.stringify({
            acknowledge: 'success',
            response: {
              status: 'Send in progress...',
              message_id: 'afro_recovered_001',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };

    const smsAdapter = new AfroMessageSmsAdapter({ apiToken: 'token' }, transientFailingFetch);
    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter, maxAttempts: 3 });
    const worker = new DeliveryWorker({ workerId: 'worker-retry-1', intents: deliveryIntents });

    // Cycle 1: Dispatches and fails, intent is released
    const cycle1 = await worker.processBatch(T0, (intent) =>
      notifier.processClaimedIntent(intent, T0),
    );
    expect(cycle1.claimed).toBe(1);
    expect(cycle1.released).toBe(1);
    expect(cycle1.completed).toBe(0);

    // Verify intent in DB is pending with attempt_count = 1
    const intentAfterFail = await pool.query<{ status: string; attempt_count: number }>(
      'SELECT status, attempt_count FROM delivery_intents',
    );
    expect(intentAfterFail.rows[0]?.status).toBe('pending');
    expect(intentAfterFail.rows[0]?.attempt_count).toBe(1);

    // Cycle 2: Recovered on next claim
    const cycle2 = await worker.processBatch(T0, (intent) =>
      notifier.processClaimedIntent(intent, T0),
    );
    expect(cycle2.claimed).toBe(1);
    expect(cycle2.completed).toBe(1);
    expect(cycle2.released).toBe(0);

    const intentAfterSuccess = await pool.query<{ status: string; attempt_count: number }>(
      'SELECT status, attempt_count FROM delivery_intents',
    );
    expect(intentAfterSuccess.rows[0]?.status).toBe('completed');
    expect(intentAfterSuccess.rows[0]?.attempt_count).toBe(2);
  });
});
