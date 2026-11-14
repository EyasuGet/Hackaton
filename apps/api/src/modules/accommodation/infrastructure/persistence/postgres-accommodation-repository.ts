// PostgreSQL adapter for accommodation request persistence (T3-022-A).
// All learner reads filter by owner_id so another learner's records are never
// reachable, even with their id. Coordinator reads use a separate path that
// does not expose ownership to the query caller. Duplicate submissions are
// resolved atomically via the unique (owner_id, client_request_id) constraint.
import type pg from 'pg';
import type { OwnedScope } from '../../../identity/domain/principal.ts';
import type {
  AccommodationRepository,
  SubmitAccommodationInput,
  SubmitAccommodationResult,
} from '../../application/ports/accommodation-repository.ts';
import type {
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
  };
}

const SELECT = `
  SELECT id, owner_id, job_id, client_request_id, support_description,
         state, created_at, expires_at, updated_at, cancelled_at
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
                 state, created_at, expires_at, updated_at, cancelled_at`,
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
                 state, created_at, expires_at, updated_at, cancelled_at`,
      [id, scope.ownerId],
    );
    const row = result.rows[0];
    return row ? toAccommodationRequest(row) : null;
  }

  async findById(scope: OwnedScope, id: string): Promise<AccommodationRequest | null> {
    const result = await this.#pool.query<AccommodationRequestRow>(
      `${SELECT} WHERE id = $1 AND owner_id = $2`,
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
