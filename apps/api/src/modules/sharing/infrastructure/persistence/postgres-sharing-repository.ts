// PostgreSQL adapter for sharing session persistence (T3-018-A).
// All writes enforce state-transition constraints to prevent invalid transitions.
import type pg from 'pg';
import type { SharingRepository } from '../../application/ports/sharing-repository.ts';
import type { SharingSession, SharingSessionState } from '../../domain/sharing-session.ts';

interface SharingSessionRow {
  id: string;
  help_request_id: string;
  learner_id: string;
  support_id: string;
  state: SharingSessionState;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

function toSession(row: SharingSessionRow): SharingSession {
  return {
    id: row.id,
    helpRequestId: row.help_request_id,
    learnerId: row.learner_id,
    supportId: row.support_id,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
  };
}

const SELECT = `
  SELECT id, help_request_id, learner_id, support_id, state,
         created_at, expires_at, revoked_at
  FROM sharing_sessions
`;

export class PostgresSharingRepository implements SharingRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async createSession(
    helpRequestId: string,
    learnerId: string,
    supportId: string,
  ): Promise<SharingSession> {
    const result = await this.#pool.query<SharingSessionRow>(
      `INSERT INTO sharing_sessions (help_request_id, learner_id, support_id)
       VALUES ($1, $2, $3)
       RETURNING id, help_request_id, learner_id, support_id, state,
                 created_at, expires_at, revoked_at`,
      [helpRequestId, learnerId, supportId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('sharing_session: insert returned no row');
    return toSession(row);
  }

  async findById(id: string): Promise<SharingSession | null> {
    const result = await this.#pool.query<SharingSessionRow>(`${SELECT} WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row ? toSession(row) : null;
  }

  async findByHelpRequestId(helpRequestId: string): Promise<SharingSession | null> {
    const result = await this.#pool.query<SharingSessionRow>(
      `${SELECT} WHERE help_request_id = $1`,
      [helpRequestId],
    );
    const row = result.rows[0];
    return row ? toSession(row) : null;
  }

  async revokeSession(id: string): Promise<void> {
    await this.#pool.query(
      `UPDATE sharing_sessions
         SET state = 'revoked', revoked_at = now()
       WHERE id = $1
         AND state NOT IN ('revoked', 'expired')`,
      [id],
    );
  }

  async expireSession(id: string): Promise<void> {
    await this.#pool.query(
      `UPDATE sharing_sessions
         SET state = 'expired'
       WHERE id = $1
         AND state NOT IN ('revoked', 'expired')`,
      [id],
    );
  }

  async activateSession(id: string): Promise<SharingSession | null> {
    const result = await this.#pool.query<SharingSessionRow>(
      `UPDATE sharing_sessions
         SET state = 'active'
       WHERE id = $1
         AND state = 'pending'
         AND expires_at > now()
       RETURNING id, help_request_id, learner_id, support_id, state,
                 created_at, expires_at, revoked_at`,
      [id],
    );
    const row = result.rows[0];
    return row ? toSession(row) : null;
  }
}
