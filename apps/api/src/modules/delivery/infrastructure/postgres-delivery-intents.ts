// PostgreSQL storage for delivery intents. Enqueue runs on the caller's
// transaction, so an intent commits or rolls back with the action that needs it.
// Every comparison uses the `now` the caller supplies (one injectable clock).
import type pg from 'pg';
import {
  dedupDigest,
  dedupExpiry,
  type EnqueueOutcome,
  type NewDeliveryIntent,
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
        WHERE id = $1 AND status = 'pending' AND content_ref IS NOT NULL AND content_expires_at > $2`,
      [id, now],
    );
    return result.rows[0]?.content_ref ?? null;
  }

  /**
   * Cancels intents whose content has expired, removing the reference, and
   * deletes intents past the dedup bound. Idempotent; safe to run concurrently.
   */
  async scrubExpired(now: Date): Promise<{ cancelled: number; deleted: number }> {
    const cancelled = await this.#pool.query(
      `UPDATE delivery_intents SET content_ref = NULL, status = 'cancelled'
        WHERE content_ref IS NOT NULL AND content_expires_at <= $1`,
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
