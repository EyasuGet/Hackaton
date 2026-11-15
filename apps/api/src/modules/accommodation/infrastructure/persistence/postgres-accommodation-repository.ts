// PostgreSQL adapter for accommodation request persistence (T3-022-A, T3-022-B).
// All learner reads filter by owner_id so another learner's records are never
// reachable, even with their id. Coordinator reads use a separate path that
// does not expose ownership to the query caller. Duplicate submissions and replies are
// resolved atomically via unique constraints.
import type pg from 'pg';
import type { OwnedScope } from '../../../identity/domain/principal.ts';
import type {
  AccommodationRepository,
  AddAccommodationReplyResult,
  ClaimAccommodationResult,
  SubmitAccommodationInput,
  SubmitAccommodationResult,
} from '../../application/ports/accommodation-repository.ts';
import type {
  AccommodationQueueItem,
  AccommodationReply,
  AccommodationRequest,
  AccommodationState,
} from '../../domain/accommodation-request.ts';

interface AccommodationRequestRow {
  id: string;
  owner_id: string;
  job_id: string;
  client_request_id: string;
  support_description: string;
  state: AccommodationState;
  created_at: Date;
  expires_at: Date;
  updated_at: Date;
  cancelled_at: Date | null;
  claimed_by: string | null;
  claimed_at: Date | null;
  resolved_at: Date | null;
  resolved_by: string | null;
}

interface AccommodationReplyRow {
  id: string;
  accommodation_request_id: string;
  author_id: string;
  client_reply_id: string;
  body: string;
  created_at: Date;
  read_at: Date | null;
}

function toAccommodationRequest(row: AccommodationRequestRow): AccommodationRequest {
  return {
    id: row.id,
    ownerId: row.owner_id,
    jobId: row.job_id,
    clientRequestId: row.client_request_id,
    supportDescription: row.support_description,
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

function toAccommodationReply(row: AccommodationReplyRow): AccommodationReply {
  return {
    id: row.id,
    accommodationRequestId: row.accommodation_request_id,
    authorId: row.author_id,
    clientReplyId: row.client_reply_id,
    body: row.body,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at ? row.read_at.toISOString() : null,
  };
}

const SELECT = `
  SELECT id, owner_id, job_id, client_request_id, support_description,
         state, created_at, expires_at, updated_at, cancelled_at,
         claimed_by, claimed_at, resolved_at, resolved_by
  FROM accommodation_requests
`;

export class PostgresAccommodationRepository implements AccommodationRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async submit(
    scope: OwnedScope,
    input: SubmitAccommodationInput,
  ): Promise<SubmitAccommodationResult> {
    // Verify the job exists before inserting. A FK violation from the INSERT would
    // also catch this, but an explicit check gives a typed application result.
    const jobCheck = await this.#pool.query<{ id: string }>('SELECT id FROM jobs WHERE id = $1', [
      input.jobId,
    ]);
    if (jobCheck.rows.length === 0) return { kind: 'job_not_found' };

    // Atomic upsert: ON CONFLICT DO NOTHING returns nothing when the row exists.
    const insertResult = await this.#pool.query<AccommodationRequestRow>(
      `INSERT INTO accommodation_requests
         (owner_id, job_id, client_request_id, support_description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (owner_id, client_request_id) DO NOTHING
       RETURNING id, owner_id, job_id, client_request_id, support_description,
                 state, created_at, expires_at, updated_at, cancelled_at,
                 claimed_by, claimed_at, resolved_at, resolved_by`,
      [scope.ownerId, input.jobId, input.clientRequestId, input.supportDescription],
    );

    if (insertResult.rows.length > 0 && insertResult.rows[0]) {
      return { kind: 'submitted', request: toAccommodationRequest(insertResult.rows[0]) };
    }

    // Row exists; fetch it scoped to this owner only.
    const existing = await this.findById(
      scope,
      await this.#resolveIdByClientKey(scope, input.clientRequestId),
    );
    if (!existing) {
      // The client_request_id belongs to another owner — should not reach here given
      // the unique constraint includes owner_id, but guard defensively.
      throw new Error('accommodation_request conflict: unexpected cross-owner collision');
    }
    return { kind: 'existing', request: existing };
  }

  async cancel(scope: OwnedScope, id: string): Promise<AccommodationRequest | null> {
    const result = await this.#pool.query<AccommodationRequestRow>(
      `UPDATE accommodation_requests
       SET state = 'cancelled',
           cancelled_at = now(),
           updated_at = now()
       WHERE id = $1
         AND owner_id = $2
         AND state = 'waiting'
         AND expires_at > now()
       RETURNING id, owner_id, job_id, client_request_id, support_description,
                 state, created_at, expires_at, updated_at, cancelled_at,
                 claimed_by, claimed_at, resolved_at, resolved_by`,
      [id, scope.ownerId],
    );
    const row = result.rows[0];
    return row ? toAccommodationRequest(row) : null;
  }

  async findById(scope: OwnedScope, id: string): Promise<AccommodationRequest | null> {
    const result = await this.#pool.query<AccommodationRequestRow>(
      `${SELECT} WHERE id = $1 AND owner_id = $2 AND expires_at > now()`,
      [id, scope.ownerId],
    );
    const row = result.rows[0];
    return row ? toAccommodationRequest(row) : null;
  }

  async listOwned(scope: OwnedScope): Promise<readonly AccommodationRequest[]> {
    const result = await this.#pool.query<AccommodationRequestRow>(
      `${SELECT} WHERE owner_id = $1 AND expires_at > now() ORDER BY created_at DESC`,
      [scope.ownerId],
    );
    return result.rows.map(toAccommodationRequest);
  }

  async coordinatorFindById(id: string): Promise<AccommodationRequest | null> {
    // Coordinator can read any non-expired request; expiry check is intentional
    // so expired content is not surfaced.
    const result = await this.#pool.query<AccommodationRequestRow>(
      `${SELECT} WHERE id = $1 AND expires_at > now()`,
      [id],
    );
    const row = result.rows[0];
    return row ? toAccommodationRequest(row) : null;
  }

  async listQueue(): Promise<readonly AccommodationQueueItem[]> {
    const result = await this.#pool.query<{
      id: string;
      job_id: string;
      created_at: Date;
      expires_at: Date;
    }>(
      `SELECT id, job_id, created_at, expires_at
         FROM accommodation_requests
        WHERE state = 'waiting' AND expires_at > now()
        ORDER BY created_at ASC`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      state: 'waiting' as const,
    }));
  }

  async listForCoordinator(): Promise<readonly AccommodationRequest[]> {
    const result = await this.#pool.query<AccommodationRequestRow>(
      `${SELECT} WHERE expires_at > now() ORDER BY created_at DESC`,
    );
    return result.rows.map(toAccommodationRequest);
  }

  async claimRequest(id: string, coordinatorId: string): Promise<ClaimAccommodationResult | null> {
    // Atomic claim: succeeds only when the request is currently waiting.
    const result = await this.#pool.query<AccommodationRequestRow>(
      `UPDATE accommodation_requests
          SET state = 'claimed',
              claimed_by = $2,
              claimed_at = now(),
              updated_at = now()
        WHERE id = $1
          AND state = 'waiting'
          AND expires_at > now()
        RETURNING id, owner_id, job_id, client_request_id, support_description,
                  state, created_at, expires_at, updated_at, cancelled_at,
                  claimed_by, claimed_at, resolved_at, resolved_by`,
      [id, coordinatorId],
    );

    if (result.rows[0]) {
      return { kind: 'claimed', request: toAccommodationRequest(result.rows[0]) };
    }

    // Check whether the request exists and is already claimed (idempotent re-check)
    const existing = await this.#pool.query<AccommodationRequestRow>(`${SELECT} WHERE id = $1`, [
      id,
    ]);
    const row = existing.rows[0];
    if (!row) return null;
    if (row.state === 'claimed') {
      return { kind: 'already_claimed', request: toAccommodationRequest(row) };
    }
    // cancelled, resolved, or other terminal state — cannot be claimed
    return null;
  }

  async addReply(
    accommodationRequestId: string,
    authorId: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddAccommodationReplyResult | null> {
    // Verify the request exists, has not expired, and is in a replyable state.
    const reqResult = await this.#pool.query<{ state: AccommodationState; expires_at: Date }>(
      `SELECT state, expires_at FROM accommodation_requests WHERE id = $1`,
      [accommodationRequestId],
    );
    const req = reqResult.rows[0];
    if (!req) return null;
    if (req.state === 'cancelled' || req.state === 'resolved') return null;
    if (req.expires_at <= new Date()) return null;

    // Attempt insert; ON CONFLICT means the reply already exists (idempotent).
    const insertResult = await this.#pool.query<AccommodationReplyRow>(
      `INSERT INTO accommodation_request_replies (accommodation_request_id, author_id, client_reply_id, body)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (accommodation_request_id, client_reply_id) DO NOTHING
       RETURNING id, accommodation_request_id, author_id, client_reply_id, body, created_at, read_at`,
      [accommodationRequestId, authorId, clientReplyId, body],
    );

    if (insertResult.rows[0]) {
      return { kind: 'added', reply: toAccommodationReply(insertResult.rows[0]) };
    }

    // Row already existed — return the existing reply.
    const existing = await this.#pool.query<AccommodationReplyRow>(
      `SELECT id, accommodation_request_id, author_id, client_reply_id, body, created_at, read_at
         FROM accommodation_request_replies
        WHERE accommodation_request_id = $1 AND client_reply_id = $2`,
      [accommodationRequestId, clientReplyId],
    );
    const existingRow = existing.rows[0];
    if (!existingRow) throw new Error('accommodation_reply: conflict row vanished');
    return { kind: 'existing', reply: toAccommodationReply(existingRow) };
  }

  async listReplies(accommodationRequestId: string): Promise<readonly AccommodationReply[]> {
    const result = await this.#pool.query<AccommodationReplyRow>(
      `SELECT id, accommodation_request_id, author_id, client_reply_id, body, created_at, read_at
         FROM accommodation_request_replies
        WHERE accommodation_request_id = $1
        ORDER BY created_at ASC`,
      [accommodationRequestId],
    );
    return result.rows.map(toAccommodationReply);
  }

  async markRepliesRead(accommodationRequestId: string, readerId: string): Promise<void> {
    // Only mark unread replies by others as read; skip the reader's own replies.
    await this.#pool.query(
      `UPDATE accommodation_request_replies
          SET read_at = now()
        WHERE accommodation_request_id = $1
          AND author_id != $2
          AND read_at IS NULL`,
      [accommodationRequestId, readerId],
    );
  }

  async resolveRequest(
    accommodationRequestId: string,
    coordinatorId: string,
  ): Promise<AccommodationRequest | null> {
    const result = await this.#pool.query<AccommodationRequestRow>(
      `UPDATE accommodation_requests
          SET state = 'resolved',
              resolved_at = now(),
              resolved_by = $2,
              updated_at = now()
        WHERE id = $1
          AND state = 'claimed'
          AND expires_at > now()
        RETURNING id, owner_id, job_id, client_request_id, support_description,
                  state, created_at, expires_at, updated_at, cancelled_at,
                  claimed_by, claimed_at, resolved_at, resolved_by`,
      [accommodationRequestId, coordinatorId],
    );
    const row = result.rows[0];
    return row ? toAccommodationRequest(row) : null;
  }

  /** Resolves the internal UUID for a (owner, clientRequestId) pair. */
  async #resolveIdByClientKey(scope: OwnedScope, clientRequestId: string): Promise<string> {
    const result = await this.#pool.query<{ id: string }>(
      'SELECT id FROM accommodation_requests WHERE owner_id = $1 AND client_request_id = $2',
      [scope.ownerId, clientRequestId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('accommodation_request not found after conflict');
    return row.id;
  }
}
