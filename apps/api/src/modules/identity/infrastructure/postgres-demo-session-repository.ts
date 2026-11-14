// PostgreSQL storage for demo handoff codes and sessions (digests only).
import type pg from 'pg';
import type { DemoSessionRepository } from '../application/demo-sessions.ts';

export class PostgresDemoSessionRepository implements DemoSessionRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async createHandoff(
    principalKey: string,
    audience: string,
    codeDigest: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const result = await this.#pool.query(
      `INSERT INTO demo_handoffs (code_digest, principal_id, audience, expires_at)
       SELECT $3, id, $2, $4 FROM principals WHERE demo_key = $1 AND is_demo`,
      [principalKey, audience, codeDigest, expiresAt],
    );
    return result.rowCount === 1;
  }

  async consumeHandoff(codeDigest: string, audience: string, now: Date): Promise<string | null> {
    // One conditional UPDATE: of two concurrent exchanges, only one sees used_at IS NULL.
    const result = await this.#pool.query<{ principal_id: string }>(
      `UPDATE demo_handoffs SET used_at = $3
        WHERE code_digest = $1 AND audience = $2 AND used_at IS NULL AND expires_at > $3
        RETURNING principal_id`,
      [codeDigest, audience, now],
    );
    return result.rows[0]?.principal_id ?? null;
  }

  async createSession(principalId: string, tokenDigest: string, expiresAt: Date): Promise<void> {
    await this.#pool.query(
      'INSERT INTO demo_sessions (token_digest, principal_id, expires_at) VALUES ($1, $2, $3)',
      [tokenDigest, principalId, expiresAt],
    );
  }

  async revokeSession(tokenDigest: string, now: Date): Promise<boolean> {
    const result = await this.#pool.query(
      'UPDATE demo_sessions SET revoked_at = $2 WHERE token_digest = $1 AND revoked_at IS NULL',
      [tokenDigest, now],
    );
    return result.rowCount === 1;
  }
}
