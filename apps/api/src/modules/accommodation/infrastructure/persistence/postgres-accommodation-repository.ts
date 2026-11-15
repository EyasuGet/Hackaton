// PostgreSQL adapter for accommodation request persistence (T3-022-A, T3-022-B).
// All learner reads filter by owner_id and expires_at so another learner's records are never
// reachable, even with their id. Coordinator reads use a separate path that
// does not expose ownership to the query caller. Duplicate submissions and replies are
// resolved atomically via unique constraints.
import type pg from 'pg';
import type { OwnedScope } from '../../../identity/domain/principal.ts';
import type {
  AccommodationRepository,
  AddAccommodationReplyResult,
  SubmitAccommodationInput,
  SubmitAccommodationResult,
} from '../../application/ports/accommodation-repository.ts';
import type {
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
  reviewed_at: Date | null;
  reviewed_by: string | null;
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
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    reviewedBy: row.reviewed_by,
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
         reviewed_at, reviewed_by
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
    const jobCheck = await this.#pool.query<{ id: string }>('SELECT id FROM jobs WHERE id = $1', [
      input.jobId,
    ]);
    if (jobCheck.rows.length === 0) return { kind: 'job_not_found' };

    const insertResult = await this.#pool.query<AccommodationRequestRow>(
      `INSERT INTO accommodation_requests
         (owner_id, job_id, client_request_id, support_description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (owner_id, client_request_id) DO NOTHING
       RETURNING id, owner_id, job_id, client_request_id, support_description,
                 state, created_at, expires_at, updated_at, cancelled_at,
                 reviewed_at, reviewed_by`,
      [scope.ownerId, input.jobId, input.clientRequestId, input.supportDescription],
    );

    if (insertResult.rows.length > 0 && insertResult.rows[0]) {
      return { kind: 'submitted', request: toAccommodationRequest(insertResult.rows[0]) };
    }

    const existing = await this.findById(
      scope,
      await this.#resolveIdByClientKey(scope, input.clientRequestId),
    );
    if (!existing) {
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
                 reviewed_at, reviewed_by`,
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
    const result = await this.#pool.query<AccommodationRequestRow>(
      `${SELECT} WHERE id = $1 AND expires_at > now()`,
      [id],
    );
    const row = result.rows[0];
    return row ? toAccommodationRequest(row) : null;
  }

  async coordinatorListAll(): Promise<readonly AccommodationRequest[]> {
    const result = await this.#pool.query<AccommodationRequestRow>(
      `${SELECT} WHERE expires_at > now() ORDER BY created_at DESC`,
    );
    return result.rows.map(toAccommodationRequest);
  }

  async updateStatus(
    id: string,
    coordinatorId: string,
    status: 'reviewing' | 'confirmed' | 'declined',
  ): Promise<AccommodationRequest | null> {
    const result = await this.#pool.query<AccommodationRequestRow>(
      `UPDATE accommodation_requests
       SET state = $1,
           reviewed_by = $2,
           reviewed_at = now(),
           updated_at = now()
       WHERE id = $3
         AND state != 'cancelled'
         AND expires_at > now()
       RETURNING id, owner_id, job_id, client_request_id, support_description,
                 state, created_at, expires_at, updated_at, cancelled_at,
                 reviewed_at, reviewed_by`,
      [status, coordinatorId, id],
    );
    const row = result.rows[0];
    return row ? toAccommodationRequest(row) : null;
  }

  async addReply(
    accommodationRequestId: string,
    authorId: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddAccommodationReplyResult | null> {
    const requestCheck = await this.#pool.query<{ id: string }>(
      `SELECT id FROM accommodation_requests
       WHERE id = $1 AND state != 'cancelled' AND expires_at > now()`,
      [accommodationRequestId],
    );
    if (requestCheck.rows.length === 0) return null;

    const insertResult = await this.#pool.query<AccommodationReplyRow>(
      `INSERT INTO accommodation_request_replies
         (accommodation_request_id, author_id, client_reply_id, body)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (accommodation_request_id, client_reply_id) DO NOTHING
       RETURNING id, accommodation_request_id, author_id, client_reply_id, body,
                 created_at, read_at`,
      [accommodationRequestId, authorId, clientReplyId, body],
    );

    if (insertResult.rows.length > 0 && insertResult.rows[0]) {
      return { kind: 'added', reply: toAccommodationReply(insertResult.rows[0]) };
    }

    const existingResult = await this.#pool.query<AccommodationReplyRow>(
      `SELECT id, accommodation_request_id, author_id, client_reply_id, body,
              created_at, read_at
       FROM accommodation_request_replies
       WHERE accommodation_request_id = $1 AND client_reply_id = $2`,
      [accommodationRequestId, clientReplyId],
    );
    const row = existingResult.rows[0];
    if (!row) throw new Error('accommodation_request_replies conflict: row not found');
    return { kind: 'existing', reply: toAccommodationReply(row) };
  }

  async listReplies(accommodationRequestId: string): Promise<readonly AccommodationReply[]> {
    const result = await this.#pool.query<AccommodationReplyRow>(
      `SELECT id, accommodation_request_id, author_id, client_reply_id, body,
              created_at, read_at
       FROM accommodation_request_replies
       WHERE accommodation_request_id = $1
       ORDER BY created_at ASC`,
      [accommodationRequestId],
    );
    return result.rows.map(toAccommodationReply);
  }

  async markRepliesRead(accommodationRequestId: string, readerPrincipalId: string): Promise<void> {
    await this.#pool.query(
      `UPDATE accommodation_request_replies
       SET read_at = now()
       WHERE accommodation_request_id = $1
         AND author_id != $2
         AND read_at IS NULL`,
      [accommodationRequestId, readerPrincipalId],
    );
  }

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
