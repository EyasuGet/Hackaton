// PostgreSQL adapter for sharing session persistence (T3-018-A / T3-018-B).
// All writes enforce state-transition constraints to prevent invalid transitions.
import type pg from 'pg';
import type { SharingRepository } from '../../application/ports/sharing-repository.ts';
import type {
  SharingSession,
  SharingSessionState,
  SharingSignal,
  SignalType,
} from '../../domain/sharing-session.ts';

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

interface SharingSignalRow {
  id: string;
  session_id: string;
  sender_id: string;
  type: SignalType;
  payload: unknown;
  created_at: Date;
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

function toSignal(row: SharingSignalRow): SharingSignal {
  return {
    id: String(row.id),
    sessionId: row.session_id,
    senderId: row.sender_id,
    type: row.type,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
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
       ON CONFLICT (help_request_id) DO UPDATE
         SET state = 'pending',
             learner_id = EXCLUDED.learner_id,
             support_id = EXCLUDED.support_id,
             created_at = now(),
             expires_at = (now() + interval '1 hour'),
             revoked_at = NULL
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

  async createSignal(
    sessionId: string,
    senderId: string,
    type: SignalType,
    payload: unknown,
  ): Promise<SharingSignal> {
    const result = await this.#pool.query<SharingSignalRow>(
      `INSERT INTO sharing_signals (session_id, sender_id, type, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, session_id, sender_id, type, payload, created_at`,
      [sessionId, senderId, type, JSON.stringify(payload)],
    );
    const row = result.rows[0];
    if (!row) throw new Error('sharing_signals: insert returned no row');
    return toSignal(row);
  }

  async findSignals(
    sessionId: string,
    excludeSenderId: string,
    afterId?: string,
  ): Promise<readonly SharingSignal[]> {
    const after = afterId ? BigInt(afterId) : 0n;
    const result = await this.#pool.query<SharingSignalRow>(
      `SELECT id, session_id, sender_id, type, payload, created_at
       FROM sharing_signals
       WHERE session_id = $1
         AND sender_id <> $2
         AND id > $3
       ORDER BY id ASC`,
      [sessionId, excludeSenderId, after.toString()],
    );
    return result.rows.map(toSignal);
  }
}
