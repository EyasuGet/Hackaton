// Real-PostgreSQL integration tests for dispatch, bounded retries, and unknown outcomes (T3-014-C).
// Proves that each dispatch outcome is correctly recorded, that max-attempt intents are failed
// without dispatch, that an adapter exception is treated as uncertain, and that the stale-release
// fencing check works correctly. Each test run uses its own isolated database.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDatabaseConfig } from '../../bootstrap/config.ts';
import { createPool } from '../../infrastructure/database/connection.ts';
import {
  loadMigrations,
  migrate,
  MIGRATIONS_DIR,
} from '../../infrastructure/database/migrations.ts';
import { DeliveryWorker, type DispatchPort } from './application/delivery-worker.ts';
import { MAX_ATTEMPT_COUNT, type NewDeliveryIntent } from './domain/delivery-intent.ts';
import { PostgresDeliveryIntents } from './infrastructure/postgres-delivery-intents.ts';

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_${randomUUID().replaceAll('-', '')}`;
const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const T0 = new Date('2026-11-14T11:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

let admin: pg.Pool;
let pool: pg.Pool;
let intents: PostgresDeliveryIntents;
let learnerId: string;

function intent(dedupKey: string, contentRef = 'ref:1'): NewDeliveryIntent {
  return {
    dedupKey,
    recipientId: learnerId,
    channel: 'telegram',
    contentRef,
    contentExpiresAt: at(168 * HOUR),
  };
}

async function enqueue(dedupKey: string, contentRef = 'ref:1'): Promise<string> {
  const client = await pool.connect();
  try {
    const result = await intents.enqueue(client, intent(dedupKey, contentRef), T0);
    if (result.status !== 'enqueued') throw new Error(`expected enqueued, got ${result.status}`);
    return result.id;
  } finally {
    client.release();
  }
}

function sentPort(): DispatchPort {
  return { dispatch: vi.fn().mockResolvedValue({ status: 'sent' }) };
}

function failedPort(): DispatchPort {
  return { dispatch: vi.fn().mockResolvedValue({ status: 'failed' }) };
}

function uncertainPort(): DispatchPort {
  return { dispatch: vi.fn().mockResolvedValue({ status: 'uncertain' }) };
}

function throwingPort(): DispatchPort {
  return { dispatch: vi.fn().mockRejectedValue(new Error('Network timeout')) };
}

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  intents = new PostgresDeliveryIntents(pool);
  const learner = await pool.query<{ id: string }>(
    "INSERT INTO principals (role, label, is_demo, demo_key) VALUES ('learner', 'Demo learner', true, 'dispatch-learner') RETURNING id",
  );
  learnerId = learner.rows[0]!.id;
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin?.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE delivery_intents');
});

describe('dispatch outcomes', () => {
  it('marks an intent completed when the adapter reports sent', async () => {
    const id = await enqueue('dispatch-sent');
    const worker = new DeliveryWorker({ workerId: 'w1', intents });

    const result = await worker.dispatchBatch(T0, sentPort());

    expect(result).toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
      uncertain: 0,
      retried: 0,
      cancelled: 0,
      exceeded: 0,
    });
    const record = await intents.findById(id);
    expect(record?.status).toBe('completed');
    expect(record?.completedAt).toEqual(T0);
    expect(record?.claimedBy).toBeNull();
    expect(record?.leaseExpiresAt).toBeNull();
  });

  it('marks an intent failed when the adapter reports failure', async () => {
    const id = await enqueue('dispatch-failed');
    const worker = new DeliveryWorker({ workerId: 'w1', intents });

    const result = await worker.dispatchBatch(T0, failedPort());

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 1,
      uncertain: 0,
      retried: 0,
      cancelled: 0,
      exceeded: 0,
    });
    const record = await intents.findById(id);
    expect(record?.status).toBe('failed');
    expect(record?.completedAt).toEqual(T0);
    expect(record?.claimedBy).toBeNull();
  });

  it('marks an intent uncertain when the adapter reports uncertain outcome', async () => {
    const id = await enqueue('dispatch-uncertain');
    const worker = new DeliveryWorker({ workerId: 'w1', intents });

    const result = await worker.dispatchBatch(T0, uncertainPort());

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 0,
      uncertain: 1,
      retried: 0,
      cancelled: 0,
      exceeded: 0,
    });
    const record = await intents.findById(id);
    expect(record?.status).toBe('uncertain');
    expect(record?.completedAt).toBeNull();
    expect(record?.claimedBy).toBeNull();
  });

  it('treats an adapter exception as uncertain — message may have been sent', async () => {
    const id = await enqueue('dispatch-throw');
    const worker = new DeliveryWorker({ workerId: 'w1', intents });

    const result = await worker.dispatchBatch(T0, throwingPort());

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 0,
      uncertain: 1,
      retried: 0,
      cancelled: 0,
      exceeded: 0,
    });
    const record = await intents.findById(id);
    expect(record?.status).toBe('uncertain');
  });
});

describe('bounded retries', () => {
  it('fails an intent without dispatch once attempt_count exceeds the maximum', async () => {
    const id = await enqueue('dispatch-max-retries');
    const dispatchFn = vi.fn().mockResolvedValue({ status: 'sent' });
    const port: DispatchPort = { dispatch: dispatchFn };

    // Exhaust all attempts by abandoning (not completing) each claim.
    for (let i = 0; i < MAX_ATTEMPT_COUNT; i++) {
      const worker = new DeliveryWorker({
        workerId: `w-attempt-${i}`,
        intents,
        leaseDurationMs: 10 * SECOND,
      });
      // Claim and do NOT release or complete — lease expires at T0 + 10s.
      await worker.claimDue(at(i * 20 * SECOND));
    }

    // attempt_count is now MAX_ATTEMPT_COUNT; the next claim will increment to MAX + 1.
    const finalWorker = new DeliveryWorker({
      workerId: 'w-final',
      intents,
      leaseDurationMs: 30 * SECOND,
    });
    // Advance time past all prior lease expirations so the intent is claimable.
    const result = await finalWorker.dispatchBatch(
      at(MAX_ATTEMPT_COUNT * 20 * SECOND + SECOND),
      port,
    );

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 0,
      uncertain: 0,
      retried: 0,
      cancelled: 0,
      exceeded: 1,
    });
    expect(dispatchFn).not.toHaveBeenCalled();

    const record = await intents.findById(id);
    expect(record?.status).toBe('failed');
    expect(record?.attemptCount).toBe(MAX_ATTEMPT_COUNT + 1);
  });
});

describe('fencing checks', () => {
  it('release fencing: a stale worker receives lost_lease and cannot reset a live lease', async () => {
    const id = await enqueue('release-fence');

    const worker1 = new DeliveryWorker({
      workerId: 'worker-1',
      intents,
      leaseDurationMs: 20 * SECOND,
    });
    const worker2 = new DeliveryWorker({
      workerId: 'worker-2',
      intents,
      leaseDurationMs: 20 * SECOND,
    });

    // Worker 1 claims, then its lease expires; worker 2 recovers it.
    await worker1.claimDue(T0);
    await worker2.claimDue(at(21 * SECOND));

    // Worker 1 "wakes up" and tries to release its stale lease.
    const staleRelease = await intents.release(id, 'worker-1');
    expect(staleRelease).toEqual({ status: 'lost_lease' });

    // Worker 2's claim is unaffected.
    const record = await intents.findById(id);
    expect(record?.claimedBy).toBe('worker-2');
    expect(record?.status).toBe('leased');
  });

  it('fail fencing: a stale worker receives lost_lease and cannot overwrite a live claim', async () => {
    const id = await enqueue('fail-fence');

    const worker1 = new DeliveryWorker({
      workerId: 'worker-1',
      intents,
      leaseDurationMs: 20 * SECOND,
    });

    await worker1.claimDue(T0);

    // Simulate lease expiry and re-claim by another worker.
    const worker2 = new DeliveryWorker({ workerId: 'worker-2', intents });
    await worker2.claimDue(at(21 * SECOND));

    // Worker 1 tries to mark its stale claim as failed.
    const staleFail = await intents.fail(id, 'worker-1', at(25 * SECOND));
    expect(staleFail).toEqual({ status: 'lost_lease' });

    const record = await intents.findById(id);
    expect(record?.claimedBy).toBe('worker-2');
    expect(record?.status).toBe('leased');
  });
});

describe('dispatch batch with multiple intents', () => {
  it('processes mixed outcomes in a single batch and counts each correctly', async () => {
    // Enqueue 3 intents for distinct outcomes.
    await enqueue('multi-sent', 'ref:sent');
    await enqueue('multi-failed', 'ref:failed');
    await enqueue('multi-uncertain', 'ref:uncertain');

    const worker = new DeliveryWorker({ workerId: 'w-multi', intents, batchSize: 10 });

    let callIndex = 0;
    const mixedPort: DispatchPort = {
      dispatch: vi.fn().mockImplementation(() => {
        const outcomes = [
          { status: 'sent' as const },
          { status: 'failed' as const },
          { status: 'uncertain' as const },
        ];
        return Promise.resolve(outcomes[callIndex++]!);
      }),
    };

    const result = await worker.dispatchBatch(T0, mixedPort);
    expect(result).toEqual({
      claimed: 3,
      sent: 1,
      failed: 1,
      uncertain: 1,
      retried: 0,
      cancelled: 0,
      exceeded: 0,
    });

    const rows = await pool.query<{ status: string }>(
      'SELECT status FROM delivery_intents ORDER BY created_at',
    );
    const statuses = rows.rows.map((r) => r.status).sort();
    expect(statuses).toEqual(['completed', 'failed', 'uncertain']);
  });
});
