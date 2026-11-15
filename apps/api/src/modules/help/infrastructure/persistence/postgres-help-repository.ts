// PostgreSQL adapter for help request persistence. All reads filter by
// owner_id so another learner's records are never reachable, even with
// their id. Duplicate submissions are resolved atomically via the unique
// (owner_id, client_request_id) constraint.
import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { OwnedScope } from '../../../identity/domain/principal.ts';
import type {
  AddReplyResult,
  ClaimResult,
  HelpRepository,
  QueueItem,
  SubmitHelpInput,
  SubmitResult,
} from '../../application/ports/help-repository.ts';
import type { HelpReply, HelpRequest, HelpRequestState } from '../../domain/help-request.ts';

interface HelpRequestRow {
  id: string;
  owner_id: string;
  client_request_id: string;
  context_snapshot: string;
  consent_given: boolean;
  state: HelpRequestState;
  created_at: Date;
  expires_at: Date;
  updated_at: Date;
  cancelled_at: Date | null;
  claimed_by: string | null;
  claimed_at: Date | null;
  resolved_at: Date | null;
  resolved_by: string | null;
}

interface HelpReplyRow {
  id: string;
  help_request_id: string;
  author_id: string;
  client_reply_id: string;
  body: string;
  created_at: Date;
  read_at: Date | null;
}

function toHelpRequest(row: HelpRequestRow): HelpRequest {
  return {
    id: row.id,
    ownerId: row.owner_id,
    clientRequestId: row.client_request_id,
    contextSnapshot: row.context_snapshot,
    consentGiven: row.consent_given,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    cancelledAt: row.cancelled_at ? row.cancelled_at.toISOString() : null,
    claimedBy: row.claimed_by ?? null,
    claimedAt: row.claimed_at ? row.claimed_at.toISOString() : null,
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
    resolvedBy: row.resolved_by ?? null,
  };
}

function toHelpReply(row: HelpReplyRow): HelpReply {
  return {
    id: row.id,
    helpRequestId: row.help_request_id,
    authorId: row.author_id,
    clientReplyId: row.client_reply_id,
    body: row.body,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at ? row.read_at.toISOString() : null,
  };
}

const SELECT = `
  SELECT id, owner_id, client_request_id, context_snapshot, consent_given,
         state, created_at, expires_at, updated_at, cancelled_at,
         claimed_by, claimed_at, resolved_at, resolved_by
  FROM help_requests
`;

export class PostgresHelpRepository implements HelpRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async submit(scope: OwnedScope, input: SubmitHelpInput): Promise<SubmitResult> {
    // Atomic upsert: ON CONFLICT DO NOTHING returns nothing when the row exists.
    const insertResult = await this.#pool.query<HelpRequestRow>(
      `INSERT INTO help_requests (owner_id, client_request_id, context_snapshot, consent_given)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (owner_id, client_request_id) DO NOTHING
       RETURNING id, owner_id, client_request_id, context_snapshot, consent_given,
                 state, created_at, expires_at, updated_at, cancelled_at,
                 claimed_by, claimed_at, resolved_at, resolved_by`,
      [scope.ownerId, input.clientRequestId, input.contextSnapshot],
    );

    if (insertResult.rows.length > 0 && insertResult.rows[0]) {
      return { kind: 'submitted', request: toHelpRequest(insertResult.rows[0]) };
    }

    // Row exists; fetch it scoped to this owner only.
    const existing = await this.findById(
      scope,
      await this.#resolveIdByClientKey(scope, input.clientRequestId),
    );
    if (!existing) {
      // The client_request_id belongs to another owner — should not reach here given
      // the unique constraint includes owner_id, but guard defensively.
      throw new Error('help_request conflict: unexpected cross-owner collision');
    }
    return { kind: 'existing', request: existing };
  }

  async cancel(scope: OwnedScope, id: string): Promise<HelpRequest | null> {
    const result = await this.#pool.query<HelpRequestRow>(
      `UPDATE help_requests
       SET state = 'cancelled',
           cancelled_at = now(),
           updated_at = now()
       WHERE id = $1
         AND owner_id = $2
         AND state = 'waiting'
         AND expires_at > now()
       RETURNING id, owner_id, client_request_id, context_snapshot, consent_given,
                 state, created_at, expires_at, updated_at, cancelled_at,
                 claimed_by, claimed_at, resolved_at, resolved_by`,
      [id, scope.ownerId],
    );
    const row = result.rows[0];
    if (row) {
      await this.#pool.query(
        `UPDATE delivery_intents
            SET status = 'cancelled',
                content_ref = NULL
          WHERE content_ref LIKE $1 AND status = 'pending'`,
        [`help_reply:${id}:%`],
      );
    }
    return row ? toHelpRequest(row) : null;
  }

  async findById(scope: OwnedScope, id: string): Promise<HelpRequest | null> {
    const result = await this.#pool.query<HelpRequestRow>(
      `${SELECT} WHERE id = $1 AND owner_id = $2`,
      [id, scope.ownerId],
    );
    const row = result.rows[0];
    return row ? toHelpRequest(row) : null;
  }

  async findByIdAsStaff(id: string): Promise<HelpRequest | null> {
    const result = await this.#pool.query<HelpRequestRow>(`${SELECT} WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row ? toHelpRequest(row) : null;
  }

  async listOwned(scope: OwnedScope): Promise<readonly HelpRequest[]> {
    const result = await this.#pool.query<HelpRequestRow>(
      `${SELECT} WHERE owner_id = $1 AND expires_at > now() ORDER BY created_at DESC`,
      [scope.ownerId],
    );
    return result.rows.map(toHelpRequest);
  }

  async listQueue(): Promise<readonly QueueItem[]> {
    const result = await this.#pool.query<{ id: string; created_at: Date; expires_at: Date }>(
      `SELECT id, created_at, expires_at
         FROM help_requests
        WHERE state = 'waiting' AND expires_at > now()
        ORDER BY created_at ASC`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      state: 'waiting' as const,
    }));
  }

  async claimRequest(id: string, staffId: string): Promise<ClaimResult | null> {
    // Atomic claim: succeeds only when the request is currently waiting.
    const result = await this.#pool.query<HelpRequestRow>(
      `UPDATE help_requests
          SET state      = 'claimed',
              claimed_by = $2,
              claimed_at = now(),
              updated_at = now()
        WHERE id = $1
          AND state = 'waiting'
          AND expires_at > now()
        RETURNING id, owner_id, client_request_id, context_snapshot, consent_given,
                  state, created_at, expires_at, updated_at, cancelled_at,
                  claimed_by, claimed_at, resolved_at, resolved_by`,
      [id, staffId],
    );

    if (result.rows[0]) {
      return { kind: 'claimed', request: toHelpRequest(result.rows[0]) };
    }

    // Check whether the request exists and is already claimed (idempotent re-check)
    // or someone else beat this staff member to it.
    const existing = await this.#pool.query<HelpRequestRow>(`${SELECT} WHERE id = $1`, [id]);
    const row = existing.rows[0];
    if (!row) return null;
    if (row.state === 'claimed') {
      return { kind: 'already_claimed', request: toHelpRequest(row) };
    }
    // cancelled, resolved, or other terminal state — cannot be claimed
    return null;
  }

  async addReply(
    helpRequestId: string,
    authorId: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddReplyResult | null> {
    // Verify the request exists, has not expired, and is in a replyable state.
    const reqResult = await this.#pool.query<{
      state: HelpRequestState;
      expires_at: Date;
      owner_id: string;
    }>(`SELECT state, expires_at, owner_id FROM help_requests WHERE id = $1`, [helpRequestId]);
    const req = reqResult.rows[0];
    if (!req) return null;
    if (req.state === 'cancelled' || req.state === 'resolved') return null;
    if (req.expires_at <= new Date()) return null;

    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');

      // Attempt insert; ON CONFLICT means the reply already exists (idempotent).
      const insertResult = await client.query<HelpReplyRow>(
        `INSERT INTO help_request_replies (help_request_id, author_id, client_reply_id, body)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (help_request_id, client_reply_id) DO NOTHING
         RETURNING id, help_request_id, author_id, client_reply_id, body, created_at, read_at`,
        [helpRequestId, authorId, clientReplyId, body],
      );

      if (insertResult.rows[0]) {
        const reply = insertResult.rows[0];

        // Notify opted-in learner of staff replies (never self-notify learner)
        if (authorId !== req.owner_id) {
          try {
            const eligibility = await client.query<{ is_eligible: boolean }>(
              `SELECT EXISTS(
                 SELECT 1
                   FROM help_notification_preferences p
                   JOIN telegram_identities t ON t.learner_id = p.learner_id AND t.revoked_at IS NULL
                  WHERE p.learner_id = $1 AND p.channel = 'telegram' AND p.opted_in = true
               ) AS is_eligible`,
              [req.owner_id],
            );

            if (eligibility.rows[0]?.is_eligible) {
              const dedupKey = `help-reply:${helpRequestId}:${reply.id}`;
              const dedupHex = createHash('sha256').update(dedupKey).digest('hex');
              const now = new Date();
              const dedupExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

              await client.query(
                `INSERT INTO delivery_intents
                   (dedup_digest, recipient_id, channel, content_ref, content_expires_at, dedup_expires_at, created_at)
                 VALUES ($1, $2, 'telegram', $3, $4, $5, $6)
                 ON CONFLICT (dedup_digest) DO NOTHING`,
                [
                  dedupHex,
                  req.owner_id,
                  `help_reply:${helpRequestId}:${reply.id}`,
                  req.expires_at,
                  dedupExpiresAt,
                  now,
                ],
              );
            }
          } catch {
            // A notification enqueue issue must never block or erase the persisted reply
          }
        }

        await client.query('COMMIT');
        return { kind: 'added', reply: toHelpReply(reply) };
      }

      await client.query('COMMIT');

      // Row already existed — return the existing reply.
      const existing = await this.#pool.query<HelpReplyRow>(
        `SELECT id, help_request_id, author_id, client_reply_id, body, created_at, read_at
           FROM help_request_replies
          WHERE help_request_id = $1 AND client_reply_id = $2`,
        [helpRequestId, clientReplyId],
      );
      const existingRow = existing.rows[0];
      if (!existingRow) throw new Error('help_reply: conflict row vanished');
      return { kind: 'existing', reply: toHelpReply(existingRow) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async listReplies(helpRequestId: string): Promise<readonly HelpReply[]> {
    const result = await this.#pool.query<HelpReplyRow>(
      `SELECT id, help_request_id, author_id, client_reply_id, body, created_at, read_at
         FROM help_request_replies
        WHERE help_request_id = $1
        ORDER BY created_at ASC`,
      [helpRequestId],
    );
    return result.rows.map(toHelpReply);
  }

  async markRepliesRead(helpRequestId: string, readerId: string): Promise<void> {
    // Only mark unread replies by others as read; skip the reader's own replies.
    await this.#pool.query(
      `UPDATE help_request_replies
          SET read_at = now()
        WHERE help_request_id = $1
          AND author_id != $2
          AND read_at IS NULL`,
      [helpRequestId, readerId],
    );
  }

  async resolveRequest(helpRequestId: string, supportId: string): Promise<HelpRequest | null> {
    const result = await this.#pool.query<HelpRequestRow>(
      `UPDATE help_requests
          SET state       = 'resolved',
              resolved_at = now(),
              resolved_by = $2,
              updated_at  = now()
        WHERE id = $1
          AND state = 'claimed'
          AND expires_at > now()
        RETURNING id, owner_id, client_request_id, context_snapshot, consent_given,
                  state, created_at, expires_at, updated_at, cancelled_at,
                  claimed_by, claimed_at, resolved_at, resolved_by`,
      [helpRequestId, supportId],
    );
    const row = result.rows[0];
    return row ? toHelpRequest(row) : null;
  }

  async getNotificationPreference(scope: OwnedScope, channel: string): Promise<boolean> {
    const result = await this.#pool.query<{ opted_in: boolean }>(
      `SELECT opted_in FROM help_notification_preferences WHERE learner_id = $1 AND channel = $2`,
      [scope.ownerId, channel],
    );
    return result.rows[0]?.opted_in ?? false;
  }

  async setNotificationPreference(
    scope: OwnedScope,
    channel: string,
    optedIn: boolean,
  ): Promise<boolean> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO help_notification_preferences (learner_id, channel, opted_in, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (learner_id, channel) DO UPDATE
         SET opted_in = EXCLUDED.opted_in,
             updated_at = now()`,
        [scope.ownerId, channel, optedIn],
      );
      if (!optedIn) {
        await client.query(
          `UPDATE delivery_intents
              SET status = 'cancelled',
                  content_ref = NULL
            WHERE recipient_id = $1 AND channel = $2 AND status = 'pending'`,
          [scope.ownerId, channel],
        );
      }
      await client.query('COMMIT');
      return optedIn;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelPendingIntentsForHelpRequest(helpRequestId: string): Promise<number> {
    const result = await this.#pool.query(
      `UPDATE delivery_intents
          SET status = 'cancelled',
              content_ref = NULL
        WHERE content_ref LIKE $1 AND status = 'pending'`,
      [`help_reply:${helpRequestId}:%`],
    );
    return result.rowCount ?? 0;
  }

  async cancelPendingIntentsForLearner(learnerId: string, channel: string): Promise<number> {
    const result = await this.#pool.query(
      `UPDATE delivery_intents
          SET status = 'cancelled',
              content_ref = NULL
        WHERE recipient_id = $1 AND channel = $2 AND status = 'pending'`,
      [learnerId, channel],
    );
    return result.rowCount ?? 0;
  }

  /** Resolves the internal UUID for a (owner, clientRequestId) pair. */
  async #resolveIdByClientKey(scope: OwnedScope, clientRequestId: string): Promise<string> {
    const result = await this.#pool.query<{ id: string }>(
      `SELECT id FROM help_requests WHERE owner_id = $1 AND client_request_id = $2`,
      [scope.ownerId, clientRequestId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('help_request not found after conflict');
    return row.id;
  }
}
