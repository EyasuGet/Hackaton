// PostgreSQL implementation of TelegramLinkRepository (T3-012-A).
// Uses transactions with row-level locks and partial unique indexes to guarantee
// single-use link codes, strict replay prevention, cross-user conflict prevention,
// and atomic link revocation.
import type pg from 'pg';
import type { Principal, Role } from '../../../identity/domain/principal.ts';
import type { TelegramIdentity } from '../../domain/telegram-identity.ts';
import type {
  ConsumeLinkParams,
  ConsumeLinkResult,
  TelegramLinkRepository,
} from '../../application/ports/telegram-link-repository.ts';

export class PostgresTelegramLinkRepository implements TelegramLinkRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async createLinkCode(learnerId: string, codeDigest: string, expiresAt: Date): Promise<void> {
    await this.#pool.query(
      `INSERT INTO telegram_link_codes (code_digest, learner_id, expires_at)
       VALUES ($1, $2, $3)`,
      [codeDigest, learnerId, expiresAt],
    );
  }

  async consumeLinkCode(params: ConsumeLinkParams): Promise<ConsumeLinkResult> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Inspect and lock link code row
      const codeRes = await client.query<{
        learner_id: string;
        used_at: Date | null;
        expires_at: Date;
      }>(
        `SELECT learner_id, used_at, expires_at
         FROM telegram_link_codes
         WHERE code_digest = $1
         FOR UPDATE`,
        [params.codeDigest],
      );

      if (codeRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'invalid_code' };
      }

      const codeRow = codeRes.rows[0]!;
      if (codeRow.used_at !== null) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'code_already_used' };
      }

      if (codeRow.expires_at <= params.now) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'code_expired' };
      }

      // 2. Mark code as used atomically
      await client.query(`UPDATE telegram_link_codes SET used_at = $2 WHERE code_digest = $1`, [
        params.codeDigest,
        params.now,
      ]);

      // 3. Verify Telegram user is not already actively linked
      const existingUserRes = await client.query<{ learner_id: string }>(
        `SELECT learner_id FROM telegram_identities
         WHERE telegram_user_id = $1 AND revoked_at IS NULL
         FOR UPDATE`,
        [params.telegramUserId],
      );

      if ((existingUserRes.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'telegram_user_already_linked' };
      }

      // 4. Verify learner does not already have an active linked Telegram account
      const existingLearnerRes = await client.query<{ id: string }>(
        `SELECT id FROM telegram_identities
         WHERE learner_id = $1 AND revoked_at IS NULL
         FOR UPDATE`,
        [codeRow.learner_id],
      );

      if ((existingLearnerRes.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'learner_already_linked' };
      }

      // 5. Establish new active Telegram identity link
      const insertRes = await client.query<{
        id: string;
        learner_id: string;
        telegram_user_id: string;
        telegram_chat_id: string;
        telegram_username: string | null;
        linked_at: Date;
      }>(
        `INSERT INTO telegram_identities (learner_id, telegram_user_id, telegram_chat_id, telegram_username, linked_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, learner_id, telegram_user_id, telegram_chat_id, telegram_username, linked_at`,
        [
          codeRow.learner_id,
          params.telegramUserId,
          params.telegramChatId,
          params.telegramUsername ?? null,
          params.now,
        ],
      );

      await client.query('COMMIT');

      const row = insertRes.rows[0]!;
      return {
        success: true,
        identity: {
          id: row.id,
          learnerId: row.learner_id,
          telegramUserId: row.telegram_user_id,
          telegramChatId: row.telegram_chat_id,
          telegramUsername: row.telegram_username ?? undefined,
          linkedAt: row.linked_at,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async unlinkByLearnerId(learnerId: string, now: Date): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE telegram_identities SET revoked_at = $2
       WHERE learner_id = $1 AND revoked_at IS NULL`,
      [learnerId, now],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async unlinkByTelegramUserId(telegramUserId: string, now: Date): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE telegram_identities SET revoked_at = $2
       WHERE telegram_user_id = $1 AND revoked_at IS NULL`,
      [telegramUserId, now],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findIdentityByTelegramUserId(telegramUserId: string): Promise<TelegramIdentity | null> {
    const result = await this.#pool.query<{
      id: string;
      learner_id: string;
      telegram_user_id: string;
      telegram_chat_id: string;
      telegram_username: string | null;
      linked_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, learner_id, telegram_user_id, telegram_chat_id, telegram_username, linked_at, revoked_at
       FROM telegram_identities
       WHERE telegram_user_id = $1 AND revoked_at IS NULL`,
      [telegramUserId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      learnerId: row.learner_id,
      telegramUserId: row.telegram_user_id,
      telegramChatId: row.telegram_chat_id,
      telegramUsername: row.telegram_username ?? undefined,
      linkedAt: row.linked_at,
      revokedAt: row.revoked_at ?? undefined,
    };
  }

  async findIdentityByLearnerId(learnerId: string): Promise<TelegramIdentity | null> {
    const result = await this.#pool.query<{
      id: string;
      learner_id: string;
      telegram_user_id: string;
      telegram_chat_id: string;
      telegram_username: string | null;
      linked_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, learner_id, telegram_user_id, telegram_chat_id, telegram_username, linked_at, revoked_at
       FROM telegram_identities
       WHERE learner_id = $1 AND revoked_at IS NULL`,
      [learnerId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      learnerId: row.learner_id,
      telegramUserId: row.telegram_user_id,
      telegramChatId: row.telegram_chat_id,
      telegramUsername: row.telegram_username ?? undefined,
      linkedAt: row.linked_at,
      revokedAt: row.revoked_at ?? undefined,
    };
  }

  async findPrincipalByTelegramUserId(telegramUserId: string): Promise<Principal | null> {
    const result = await this.#pool.query<{
      id: string;
      role: Role;
      label: string;
      is_demo: boolean;
      course_ids: string[];
    }>(
      `SELECT
         p.id, p.role, p.label, p.is_demo,
         COALESCE(array_agg(cg.course_id) FILTER (WHERE cg.course_id IS NOT NULL), '{}') AS course_ids
       FROM telegram_identities ti
       JOIN principals p ON p.id = ti.learner_id
       LEFT JOIN course_grants cg ON cg.principal_id = p.id
       WHERE ti.telegram_user_id = $1 AND ti.revoked_at IS NULL
       GROUP BY p.id, p.role, p.label, p.is_demo`,
      [telegramUserId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      role: row.role,
      label: row.label,
      demo: row.is_demo,
      courseIds: row.course_ids,
    };
  }
}
