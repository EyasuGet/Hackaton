// Real-PostgreSQL checks for delivery intents: an intent commits or rolls back
// with its action, survives a restart, is stored once per logical key, and
// never exposes a reference to expired content. A synthetic fixture-record
// insert stands in for the business action. Each run uses its own database.
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
import { DEDUP_RETENTION_MS, type NewDeliveryIntent } from './domain/delivery-intent.ts';
import { PostgresDeliveryIntents } from './infrastructure/postgres-delivery-intents.ts';

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_${randomUUID().replaceAll('-', '')}`;
const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-11-14T09:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

let admin: pg.Pool;
let pool: pg.Pool;
let intents: PostgresDeliveryIntents;
let learnerId: string;

function intent(dedupKey: string, contentRef = 'demo-record:1'): NewDeliveryIntent {
  return {
    dedupKey,
    recipientId: learnerId,
    channel: 'telegram',
    contentRef,
    contentExpiresAt: at(168 * HOUR),
  };
}

/** The synthetic action: stores a fixture record and enqueues its delivery in one transaction. */
async function recordAndNotify(
  client: pg.PoolClient,
  demoKey: string,
  dedupKey: string,
  outcome: 'commit' | 'rollback',
) {
  await client.query('BEGIN');
  await client.query(
    "INSERT INTO demo_records (demo_key, owner_id, course_id, body) VALUES ($1, $2, 'course-a', 'synthetic')",
    [demoKey, learnerId],
  );
  const result = await intents.enqueue(client, intent(dedupKey, `demo-record:${demoKey}`), T0);
  await client.query(outcome === 'commit' ? 'COMMIT' : 'ROLLBACK');
  return result;
}

async function counts(on: pg.Pool) {
  const result = await on.query<{ records: string; intents: string }>(
    'SELECT (SELECT count(*) FROM demo_records) AS records, (SELECT count(*) FROM delivery_intents) AS intents',
  );
  const row = result.rows[0]!; // An aggregate SELECT always returns one row.
  return { records: Number(row.records), intents: Number(row.intents) };
}

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  intents = new PostgresDeliveryIntents(pool);
  const learner = await pool.query<{ id: string }>(
    "INSERT INTO principals (role, label, is_demo, demo_key) VALUES ('learner', 'Demo learner', true, 'outbox-learner') RETURNING id",
  );
  learnerId = learner.rows[0]!.id;
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin?.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE delivery_intents, demo_records');
});

describe('enqueueing a delivery intent with its action', () => {
  it('persists the action and its intent together, and both survive a restart', async () => {
    const client = await pool.connect();
    try {
      expect(await recordAndNotify(client, 'r1', 'notify:r1', 'commit')).toMatchObject({
        status: 'enqueued',
      });
    } finally {
      client.release();
    }

    // A fresh pool stands in for a restarted process.
    const restarted = createPool({ ...config, database: testDatabase }, () => {});
    try {
      expect(await counts(restarted)).toEqual({ records: 1, intents: 1 });
    } finally {
      await restarted.end();
    }
  });

  it('removes both the action and its intent when the transaction rolls back', async () => {
    const client = await pool.connect();
    try {
      await recordAndNotify(client, 'r1', 'notify:r1', 'rollback');
    } finally {
      client.release();
    }

    expect(await counts(pool)).toEqual({ records: 0, intents: 0 });
  });

  it('stores one intent per logical key, keeping only a digest of the key', async () => {
    const client = await pool.connect();
    try {
      await recordAndNotify(client, 'r1', 'notify:learner-1:r1', 'commit');
      // A replayed event: the action runs again, but no second delivery is queued.
      expect(await recordAndNotify(client, 'r2', 'notify:learner-1:r1', 'commit')).toEqual({
        status: 'duplicate',
      });
    } finally {
      client.release();
    }

    expect(await counts(pool)).toEqual({ records: 2, intents: 1 });
    const stored = await pool.query('SELECT * FROM delivery_intents');
    expect(JSON.stringify(stored.rows)).not.toContain('notify:learner-1:r1');
  });

  it('queues only one intent when two transactions race with the same key', async () => {
    const [first, second] = [await pool.connect(), await pool.connect()];
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      const firstResult = await intents.enqueue(first, intent('race'), T0);
      // The second insert waits on the unique index until the first commits.
      const secondResult = intents.enqueue(second, intent('race'), T0);
      await first.query('COMMIT');
      expect([firstResult.status, (await secondResult).status]).toEqual(['enqueued', 'duplicate']);
      await second.query('COMMIT');
    } finally {
      first.release();
      second.release();
    }

    expect((await counts(pool)).intents).toBe(1);
  });

  it('stores nothing for content that has already expired', async () => {
    const client = await pool.connect();
    try {
      const expired = { ...intent('late'), contentExpiresAt: T0 };
      expect(await intents.enqueue(client, expired, T0)).toEqual({ status: 'content_expired' });
    } finally {
      client.release();
    }

    expect((await counts(pool)).intents).toBe(0);
  });
});

describe('expired content references', () => {
  async function enqueued(dedupKey: string) {
    const client = await pool.connect();
    try {
      const result = await intents.enqueue(client, intent(dedupKey), T0);
      if (result.status !== 'enqueued') throw new Error(`expected enqueued, got ${result.status}`);
      return result.id;
    } finally {
      client.release();
    }
  }

  it('stops exposing a reference at the content expiry, before any scrub runs', async () => {
    const id = await enqueued('k');

    expect(await intents.deliverableContentRef(id, at(168 * HOUR - 1))).toBe('demo-record:1');
    expect(await intents.deliverableContentRef(id, at(168 * HOUR))).toBeNull();
  });

  it('scrubs the reference but keeps the dedup record until its bound, so a replay is not re-queued', async () => {
    const id = await enqueued('k');

    expect(await intents.scrubExpired(at(168 * HOUR))).toEqual({ cancelled: 1, deleted: 0 });
    const scrubbed = await pool.query('SELECT status, content_ref FROM delivery_intents');
    expect(scrubbed.rows).toEqual([{ status: 'cancelled', content_ref: null }]);
    expect(await intents.deliverableContentRef(id, at(168 * HOUR))).toBeNull();

    // A replay inside the dedup window cannot bring the delivery back.
    const client = await pool.connect();
    try {
      const replay = { ...intent('k'), contentExpiresAt: at(400 * HOUR) };
      expect(await intents.enqueue(client, replay, at(200 * HOUR))).toEqual({
        status: 'duplicate',
      });
    } finally {
      client.release();
    }

    // Running the scrub again changes nothing; at the dedup bound the record goes.
    expect(await intents.scrubExpired(at(168 * HOUR))).toEqual({ cancelled: 0, deleted: 0 });
    expect(await intents.scrubExpired(at(DEDUP_RETENTION_MS))).toEqual({
      cancelled: 0,
      deleted: 1,
    });
    expect((await counts(pool)).intents).toBe(0);
  });
});
