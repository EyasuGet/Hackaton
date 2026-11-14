// PostgreSQL adapter for help request persistence. All reads filter by
// owner_id so another learner's records are never reachable, even with
// their id. Duplicate submissions are resolved atomically via the unique
// (owner_id, client_request_id) constraint.
import type pg from 'pg';
import type { OwnedScope } from '../../../identity/domain/principal.ts';
import type {
  HelpRepository,
  SubmitHelpInput,
  SubmitResult,
} from '../../application/ports/help-repository.ts';
import type { HelpRequest, HelpRequestState } from '../../domain/help-request.ts';

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
  };
}

const SELECT = `
  SELECT id, owner_id, client_request_id, context_snapshot, consent_given,
         state, created_at, expires_at, updated_at, cancelled_at
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
                 state, created_at, expires_at, updated_at, cancelled_at`,
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
                 state, created_at, expires_at, updated_at, cancelled_at`,
      [id, scope.ownerId],
    );
    const row = result.rows[0];
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

  async listOwned(scope: OwnedScope): Promise<readonly HelpRequest[]> {
    const result = await this.#pool.query<HelpRequestRow>(
      `${SELECT} WHERE owner_id = $1 AND expires_at > now() ORDER BY created_at DESC`,
      [scope.ownerId],
    );
    return result.rows.map(toHelpRequest);
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
