// PostgreSQL storage for delivery intents. Enqueue runs on the caller's
// transaction, so an intent commits or rolls back with the action that needs it.
// Worker claims, leases, and recoveries (T3-014-B) execute as atomic bounded
// queries without holding open transactions across network operations.
// Every comparison uses the `now` the caller supplies (one injectable clock).
import type pg from 'pg';
import {
  DEFAULT_CLAIM_BATCH_SIZE,
  DEFAULT_LEASE_DURATION_MS,
  MAX_CLAIM_BATCH_SIZE,
  dedupDigest,
  dedupExpiry,
  type ClaimOptions,
  type ClaimedDeliveryIntent,
  type CompleteOutcome,
  type DeliveryIntentRecord,
  type DeliveryIntentStatus,
  type EnqueueOutcome,
  type FailOutcome,
  type MarkUncertainOutcome,
  type NewDeliveryIntent,
  type ReleaseOutcome,
} from '../domain/delivery-intent.ts';

export class PostgresDeliveryIntents {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  /**
   * Records the intent inside the caller's open transaction on `client`; the
   * caller commits or rolls back. A repeated logical key stores nothing new.
   */
  async enqueue(
    client: pg.ClientBase,
    intent: NewDeliveryIntent,
    now: Date,
  ): Promise<EnqueueOutcome> {
    if (intent.contentExpiresAt <= now) return { status: 'content_expired' };

    // ON CONFLICT rather than check-then-insert: a concurrent transaction with
    // the same key waits on the unique index and then reports a duplicate.
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO delivery_intents
         (dedup_digest, recipient_id, channel, content_ref, content_expires_at, dedup_expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (dedup_digest) DO NOTHING
       RETURNING id`,
      [
        dedupDigest(intent.dedupKey),
        intent.recipientId,
        intent.channel,
        intent.contentRef,
        intent.contentExpiresAt,
        dedupExpiry(now),
        now,
      ],
    );
    const row = inserted.rows[0];
    return row ? { status: 'enqueued', id: row.id } : { status: 'duplicate' };
  }

  /**
   * The content reference a worker may still deliver, or null. Expired
   * references are never returned, even before `scrubExpired` has run, so a
   * resumed worker cannot re-expose deleted content.
   */
  async deliverableContentRef(id: string, now: Date): Promise<string | null> {
    const result = await this.#pool.query<{ content_ref: string }>(
      `SELECT content_ref FROM delivery_intents
        WHERE id = $1 AND status IN ('pending', 'leased') AND content_ref IS NOT NULL AND content_expires_at > $2`,
      [id, now],
    );
    return result.rows[0]?.content_ref ?? null;
  }

  /**
   * Claims a bounded batch of due delivery work under a time-bounded lease.
   * Uses FOR UPDATE SKIP LOCKED so concurrent workers acquire disjoint batches
   * without contention. Abandoned leases (lease_expires_at <= now) are recovered.
   * Expired content is never leased.
   */
  async claimDueWork(options: ClaimOptions): Promise<ClaimedDeliveryIntent[]> {
    const batchSize = Math.max(
      1,
      Math.min(options.batchSize ?? DEFAULT_CLAIM_BATCH_SIZE, MAX_CLAIM_BATCH_SIZE),
    );
    const leaseDuration = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    const leaseExpiresAt = new Date(options.now.getTime() + leaseDuration);

    const query = `
      WITH due AS (
        SELECT id
        FROM delivery_intents
        WHERE (status = 'pending' OR (status = 'leased' AND lease_expires_at <= $1))
          AND content_expires_at > $1
          AND content_ref IS NOT NULL
        ORDER BY created_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE delivery_intents
      SET status = 'leased',
          claimed_by = $3,
          claimed_at = $1,
          lease_expires_at = $4,
          attempt_count = attempt_count + 1
      FROM due
      WHERE delivery_intents.id = due.id
      RETURNING
        delivery_intents.id,
        delivery_intents.recipient_id,
        delivery_intents.channel,
        delivery_intents.content_ref,
        delivery_intents.content_expires_at,
        delivery_intents.attempt_count,
        delivery_intents.claimed_by,
        delivery_intents.claimed_at,
        delivery_intents.lease_expires_at
    `;

    const result = await this.#pool.query<{
      id: string;
      recipient_id: string;
      channel: string;
      content_ref: string;
      content_expires_at: Date;
      attempt_count: number;
      claimed_by: string;
      claimed_at: Date;
      lease_expires_at: Date;
    }>(query, [options.now, batchSize, options.workerId, leaseExpiresAt]);

    return result.rows.map((row) => ({
      id: row.id,
      recipientId: row.recipient_id,
      channel: row.channel,
      contentRef: row.content_ref,
      contentExpiresAt: new Date(row.content_expires_at),
      attemptCount: row.attempt_count,
      claimedBy: row.claimed_by,
      claimedAt: new Date(row.claimed_at),
      leaseExpiresAt: new Date(row.lease_expires_at),
    }));
  }

  /**
   * Marks a leased intent as successfully completed.
   * Fencing check: only succeeds if the lease is still held by the caller.
   */
  async complete(id: string, workerId: string, now: Date): Promise<CompleteOutcome> {
    const result = await this.#pool.query(
      `UPDATE delivery_intents
       SET status = 'completed',
           claimed_by = NULL,
           lease_expires_at = NULL,
           completed_at = $3
       WHERE id = $1 AND status = 'leased' AND claimed_by = $2`,
      [id, workerId, now],
    );

    if ((result.rowCount ?? 0) > 0) {
      return { status: 'completed' };
    }

    const existing = await this.#pool.query<{ id: string }>(
      'SELECT id FROM delivery_intents WHERE id = $1',
      [id],
    );
    return existing.rows.length === 0 ? { status: 'not_found' } : { status: 'lost_lease' };
  }

  /**
   * Relinquishes an active lease back to pending status.
   * Fencing check: only succeeds if the lease is still held by the caller.
   */
  async release(id: string, workerId: string): Promise<ReleaseOutcome> {
    const result = await this.#pool.query(
      `UPDATE delivery_intents
       SET status = 'pending',
           claimed_by = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL
       WHERE id = $1 AND status = 'leased' AND claimed_by = $2`,
      [id, workerId],
    );

    if ((result.rowCount ?? 0) > 0) {
      return { status: 'released' };
    }

    const existing = await this.#pool.query<{ id: string }>(
      'SELECT id FROM delivery_intents WHERE id = $1',
      [id],
    );
    return existing.rows.length === 0 ? { status: 'not_found' } : { status: 'lost_lease' };
  }

  /**
   * Marks a leased intent as permanently failed (dead letter); no further dispatch will be attempted.
   * Fencing check: only succeeds if the lease is still held by the caller.
   */
  async fail(id: string, workerId: string, now: Date): Promise<FailOutcome> {
    const result = await this.#pool.query(
      `UPDATE delivery_intents
       SET status = 'failed',
           claimed_by = NULL,
           lease_expires_at = NULL,
           completed_at = $3
       WHERE id = $1 AND status = 'leased' AND claimed_by = $2`,
      [id, workerId, now],
    );

    if ((result.rowCount ?? 0) > 0) {
      return { status: 'failed' };
    }

    const existing = await this.#pool.query<{ id: string }>(
      'SELECT id FROM delivery_intents WHERE id = $1',
      [id],
    );
    return existing.rows.length === 0 ? { status: 'not_found' } : { status: 'lost_lease' };
  }

  /**
   * Records that dispatch was attempted but outcome is unknown (e.g. network timeout).
   * The message may or may not have been received by the learner.
   * Fencing check: only succeeds if the lease is still held by the caller.
   */
  async markUncertain(id: string, workerId: string): Promise<MarkUncertainOutcome> {
    const result = await this.#pool.query(
      `UPDATE delivery_intents
       SET status = 'uncertain',
           claimed_by = NULL,
           lease_expires_at = NULL
       WHERE id = $1 AND status = 'leased' AND claimed_by = $2`,
      [id, workerId],
    );

    if ((result.rowCount ?? 0) > 0) {
      return { status: 'uncertain' };
    }

    const existing = await this.#pool.query<{ id: string }>(
      'SELECT id FROM delivery_intents WHERE id = $1',
      [id],
    );
    return existing.rows.length === 0 ? { status: 'not_found' } : { status: 'lost_lease' };
  }

  /**
   * Looks up the full intent record by ID, for inspection and test assertions.
   */
  async findById(id: string): Promise<DeliveryIntentRecord | null> {
    const result = await this.#pool.query<{
      id: string;
      dedup_digest: string;
      recipient_id: string;
      channel: string;
      status: DeliveryIntentStatus;
      content_ref: string | null;
      content_expires_at: Date;
      dedup_expires_at: Date;
      created_at: Date;
      claimed_by: string | null;
      claimed_at: Date | null;
      lease_expires_at: Date | null;
      attempt_count: number;
      completed_at: Date | null;
    }>('SELECT * FROM delivery_intents WHERE id = $1', [id]);

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      dedupDigest: row.dedup_digest,
      recipientId: row.recipient_id,
      channel: row.channel,
      status: row.status,
      contentRef: row.content_ref,
      contentExpiresAt: new Date(row.content_expires_at),
      dedupExpiresAt: new Date(row.dedup_expires_at),
      createdAt: new Date(row.created_at),
      claimedBy: row.claimed_by,
      claimedAt: row.claimed_at ? new Date(row.claimed_at) : null,
      leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at) : null,
      attemptCount: row.attempt_count,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
    };
  }

  /**
   * Cancels intents whose content has expired, removing the reference, and
   * deletes intents past the dedup bound. Idempotent; safe to run concurrently.
   */
  async scrubExpired(now: Date): Promise<{ cancelled: number; deleted: number }> {
    const cancelled = await this.#pool.query(
      `UPDATE delivery_intents SET content_ref = NULL, status = 'cancelled'
        WHERE content_ref IS NOT NULL AND content_expires_at <= $1 AND status IN ('pending', 'leased')`,
      [now],
    );
    await this.#pool.query(
      `UPDATE delivery_intents SET content_ref = NULL
        WHERE content_ref IS NOT NULL AND content_expires_at <= $1 AND status NOT IN ('pending', 'leased')`,
      [now],
    );
    // Content expiry is rechecked so a long-lived reference is never dropped while still deliverable.
    const deleted = await this.#pool.query(
      'DELETE FROM delivery_intents WHERE dedup_expires_at <= $1 AND content_expires_at <= $1',
      [now],
    );
    return { cancelled: cancelled.rowCount ?? 0, deleted: deleted.rowCount ?? 0 };
  }
}
