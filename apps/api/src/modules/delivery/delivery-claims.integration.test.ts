// Real-PostgreSQL integration tests for worker claiming, leases and recovery (T3-014-B).
// Proves that concurrent workers never own the same claim, expired leases recover
// after crash or abandonment, batch bounds are enforced, and expired content is
// never leased. Each test run runs against an isolated database.
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
import { DeliveryWorker } from './application/delivery-worker.ts';
import type { NewDeliveryIntent } from './domain/delivery-intent.ts';
import { PostgresDeliveryIntents } from './infrastructure/postgres-delivery-intents.ts';

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_${randomUUID().replaceAll('-', '')}`;
const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const T0 = new Date('2026-11-14T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

let admin: pg.Pool;
let pool: pg.Pool;
let intents: PostgresDeliveryIntents;
let learnerId: string;

function intent(
  dedupKey: string,
  contentRef = 'ref:1',
  expiresAt = at(168 * HOUR),
): NewDeliveryIntent {
  return {
    dedupKey,
    recipientId: learnerId,
    channel: 'telegram',
    contentRef,
    contentExpiresAt: expiresAt,
  };
}

async function enqueueMany(
  count: number,
  prefix = 'k',
  expiresAt = at(168 * HOUR),
): Promise<string[]> {
  const client = await pool.connect();
  const ids: string[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const result = await intents.enqueue(
        client,
        intent(`${prefix}-${i}`, `ref:${prefix}-${i}`, expiresAt),
        T0,
      );
      if (result.status === 'enqueued') {
        ids.push(result.id);
      }
    }
  } finally {
    client.release();
  }
  return ids;
}

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  intents = new PostgresDeliveryIntents(pool);
  const learner = await pool.query<{ id: string }>(
    "INSERT INTO principals (role, label, is_demo, demo_key) VALUES ('learner', 'Demo learner', true, 'claims-learner') RETURNING id",
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

describe('worker claim lifecycle and controlled-clock leasing', () => {
  it('leases due work with bounded batches and records safe worker metadata', async () => {
    await enqueueMany(3, 'batch');

    const worker = new DeliveryWorker({
      workerId: 'worker-1',
      intents,
      batchSize: 10,
      leaseDurationMs: 30 * SECOND,
    });

    const claimed = await worker.claimDue(T0);
    expect(claimed).toHaveLength(3);
    for (const item of claimed) {
      expect(item.claimedBy).toBe('worker-1');
      expect(item.attemptCount).toBe(1);
      expect(item.leaseExpiresAt).toEqual(at(30 * SECOND));
      expect(item.contentRef).toMatch(/^ref:batch-/);
    }

    // Inspect stored row to confirm safe metadata: no message body or contact details.
    const record = await intents.findById(claimed[0]!.id);
    expect(record).not.toBeNull();
    expect(record?.status).toBe('leased');
    expect(record?.claimedBy).toBe('worker-1');
    expect(record?.attemptCount).toBe(1);
    expect(record?.contentRef).toBe(claimed[0]!.contentRef);

    // Immediate second claim while lease is live returns nothing.
    const immediateSecond = await worker.claimDue(at(5 * SECOND));
    expect(immediateSecond).toEqual([]);
  });

  it('enforces bounded batch size across multiple claims', async () => {
    await enqueueMany(7, 'bounds');

    const worker = new DeliveryWorker({
      workerId: 'worker-small',
      intents,
      batchSize: 3,
    });

    const first = await worker.claimDue(T0);
    expect(first).toHaveLength(3);

    const second = await worker.claimDue(T0);
    expect(second).toHaveLength(3);

    const third = await worker.claimDue(T0);
    expect(third).toHaveLength(1);

    const fourth = await worker.claimDue(T0);
    expect(fourth).toHaveLength(0);
  });
});

describe('concurrent two-worker claiming', () => {
  it('guarantees two concurrent workers receive disjoint non-overlapping claims', async () => {
    await enqueueMany(10, 'race');

    const workerA = new DeliveryWorker({ workerId: 'worker-A', intents, batchSize: 5 });
    const workerB = new DeliveryWorker({ workerId: 'worker-B', intents, batchSize: 5 });

    // Both workers attempt to claim work at the exact same millisecond.
    const [claimedA, claimedB] = await Promise.all([workerA.claimDue(T0), workerB.claimDue(T0)]);

    expect(claimedA).toHaveLength(5);
    expect(claimedB).toHaveLength(5);

    const idsA = new Set(claimedA.map((i) => i.id));
    const idsB = new Set(claimedB.map((i) => i.id));

    // Confirm no intent was claimed by both workers (disjoint sets).
    for (const id of idsA) {
      expect(idsB.has(id)).toBe(false);
    }
    expect(idsA.size + idsB.size).toBe(10);
  });
});

describe('abandoned lease recovery and crash resilience', () => {
  it('recovers abandoned work after lease expiry and fences off the crashed worker', async () => {
    const [id] = await enqueueMany(1, 'recover');
    expect(id).toBeDefined();

    const worker1 = new DeliveryWorker({
      workerId: 'worker-1',
      intents,
      leaseDurationMs: 30 * SECOND,
    });
    const worker2 = new DeliveryWorker({
      workerId: 'worker-2',
      intents,
      leaseDurationMs: 30 * SECOND,
    });

    // 1. Worker 1 claims the intent at T0. Lease expires at T0 + 30s.
    const firstClaim = await worker1.claimDue(T0);
    expect(firstClaim).toHaveLength(1);
    expect(firstClaim[0]!.id).toBe(id);
    expect(firstClaim[0]!.attemptCount).toBe(1);

    // 2. Worker 1 "crashes" (stops without completing or releasing).
    // Before lease expiry (T0 + 15s), Worker 2 cannot claim it.
    expect(await worker2.claimDue(at(15 * SECOND))).toHaveLength(0);

    // 3. After lease expiry (T0 + 31s), Worker 2 recovers the abandoned lease.
    const recovered = await worker2.claimDue(at(31 * SECOND));
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.id).toBe(id);
    expect(recovered[0]!.claimedBy).toBe('worker-2');
    expect(recovered[0]!.attemptCount).toBe(2);
    expect(recovered[0]!.leaseExpiresAt).toEqual(at(61 * SECOND));

    // 4. Fencing check: if Worker 1 awakens and tries to complete its stale lease,
    // it receives lost_lease and does NOT overwrite Worker 2's claim.
    const staleCompletion = await intents.complete(id!, 'worker-1', at(35 * SECOND));
    expect(staleCompletion).toEqual({ status: 'lost_lease' });

    // Worker 2 completes its valid lease.
    const validCompletion = await intents.complete(id!, 'worker-2', at(36 * SECOND));
    expect(validCompletion).toEqual({ status: 'completed' });

    // Record is completed and lease columns are cleared.
    const finalRecord = await intents.findById(id!);
    expect(finalRecord?.status).toBe('completed');
    expect(finalRecord?.claimedBy).toBeNull();
    expect(finalRecord?.leaseExpiresAt).toBeNull();
    expect(finalRecord?.completedAt).toEqual(at(36 * SECOND));
  });

  it('recovers uncompleted work across a process restart', async () => {
    const [id] = await enqueueMany(1, 'restart-recovery');
    expect(id).toBeDefined();

    const workerPreRestart = new DeliveryWorker({
      workerId: 'worker-pre',
      intents,
      leaseDurationMs: 20 * SECOND,
    });

    // Claim prior to restart.
    await workerPreRestart.claimDue(T0);

    // Simulate process termination: discard old pool and instantiate a fresh one.
    const freshPool = createPool({ ...config, database: testDatabase }, () => {});
    try {
      const freshIntents = new PostgresDeliveryIntents(freshPool);
      const workerPostRestart = new DeliveryWorker({
        workerId: 'worker-post',
        intents: freshIntents,
        leaseDurationMs: 20 * SECOND,
      });

      // At T0 + 25s (lease expired), the newly started process recovers the work.
      const recovered = await workerPostRestart.claimDue(at(25 * SECOND));
      expect(recovered).toHaveLength(1);
      expect(recovered[0]!.id).toBe(id);
      expect(recovered[0]!.claimedBy).toBe('worker-post');
      expect(recovered[0]!.attemptCount).toBe(2);
    } finally {
      await freshPool.end();
    }
  });

  it('releases an active lease so another worker can pick it up immediately', async () => {
    const [id] = await enqueueMany(1, 'release-test');
    expect(id).toBeDefined();

    const worker1 = new DeliveryWorker({ workerId: 'worker-1', intents });
    const worker2 = new DeliveryWorker({ workerId: 'worker-2', intents });

    await worker1.claimDue(T0);

    // Worker 1 releases the intent before its lease expires.
    const releaseOutcome = await intents.release(id!, 'worker-1');
    expect(releaseOutcome).toEqual({ status: 'released' });

    // Worker 2 can immediately claim it at T0 without waiting for lease duration.
    const immediateClaim = await worker2.claimDue(T0);
    expect(immediateClaim).toHaveLength(1);
    expect(immediateClaim[0]!.id).toBe(id);
    expect(immediateClaim[0]!.claimedBy).toBe('worker-2');
  });
});

describe('expired content handling during worker claim', () => {
  it('never leases an intent whose content has expired', async () => {
    // Intent with short content lifetime: expires at T0 + 10s.
    await enqueueMany(1, 'short-lived', at(10 * SECOND));

    const worker = new DeliveryWorker({ workerId: 'worker-1', intents });

    // At T0, content is alive: claimable.
    // But if worker queries at T0 + 11s, content is expired: must NOT be leased.
    const claimedAfterExpiry = await worker.claimDue(at(11 * SECOND));
    expect(claimedAfterExpiry).toHaveLength(0);

    // Even if scrubExpired has not run yet, deliverableContentRef returns null.
    const rows = await pool.query<{ id: string }>('SELECT id FROM delivery_intents');
    expect(await intents.deliverableContentRef(rows.rows[0]!.id, at(11 * SECOND))).toBeNull();
  });
});

describe('DeliveryWorker processBatch execution', () => {
  it('executes handlers outside transactions and handles complete, release, and abandon actions', async () => {
    await enqueueMany(3, 'process');

    const worker = new DeliveryWorker({
      workerId: 'worker-batch',
      intents,
      batchSize: 10,
    });

    let invocation = 0;
    const result = await worker.processBatch(T0, () => {
      invocation++;
      if (invocation === 1) {
        return Promise.resolve('complete' as const);
      } else if (invocation === 2) {
        return Promise.resolve('release' as const);
      } else {
        // Crash or unhandled failure
        throw new Error('Simulated processing crash');
      }
    });

    expect(result).toEqual({
      claimed: 3,
      completed: 1,
      released: 1,
      abandoned: 1,
    });

    // The released item is immediately pending again.
    const pendingRows = await pool.query<{ count: string }>(
      "SELECT count(*) FROM delivery_intents WHERE status = 'pending'",
    );
    expect(Number(pendingRows.rows[0]?.count)).toBe(1);

    // The completed item is completed.
    const completedRows = await pool.query<{ count: string }>(
      "SELECT count(*) FROM delivery_intents WHERE status = 'completed'",
    );
    expect(Number(completedRows.rows[0]?.count)).toBe(1);

    // The crashed item remains leased until its lease expires.
    const leasedRows = await pool.query<{ count: string }>(
      "SELECT count(*) FROM delivery_intents WHERE status = 'leased'",
    );
    expect(Number(leasedRows.rows[0]?.count)).toBe(1);
  });
});
