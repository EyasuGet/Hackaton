// PostgreSQL repository for Telegram identities and linking tokens (T3-012-A).
// Manages single-use token records and active identity associations.
// Enforces table and partial unique constraints at the database level.
import type pg from 'pg';
import type { TelegramIdentityRepository } from '../../application/ports/telegram-identity-repository.ts';
import type { TelegramIdentity, TelegramLinkingToken } from '../../domain/telegram-identity.ts';

interface TokenRow {
  readonly token_digest: string;
  readonly principal_id: string;
  readonly expires_at: Date;
  readonly used_at: Date | null;
  readonly created_at: Date;
}

interface IdentityRow {
  readonly id: string;
  readonly principal_id: string;
  readonly telegram_user_id: string;
  readonly chat_id: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly revoked_at: Date | null;
}

function toLinkingToken(row: TokenRow): TelegramLinkingToken {
  return {
    tokenDigest: row.token_digest,
    principalId: row.principal_id,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdAt: row.created_at,
  };
}

function toIdentity(row: IdentityRow): TelegramIdentity {
  return {
    id: row.id,
    principalId: row.principal_id,
    telegramUserId: row.telegram_user_id,
    chatId: row.chat_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at,
  };
}

export class PostgresTelegramIdentityRepository implements TelegramIdentityRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async createLinkingToken(token: {
    readonly tokenDigest: string;
    readonly principalId: string;
    readonly expiresAt: Date;
    readonly createdAt?: Date;
  }): Promise<void> {
    const createdAt = token.createdAt ?? new Date();
    await this.#pool.query(
      `INSERT INTO telegram_linking_tokens (token_digest, principal_id, expires_at, created_at)
       VALUES ($1, $2, $3, $4)`,
      [token.tokenDigest, token.principalId, token.expiresAt, createdAt],
    );
  }

  async findLinkingToken(tokenDigest: string): Promise<TelegramLinkingToken | null> {
    const result = await this.#pool.query<TokenRow>(
      `SELECT token_digest, principal_id, expires_at, used_at, created_at
       FROM telegram_linking_tokens
       WHERE token_digest = $1`,
      [tokenDigest],
    );
    const row = result.rows[0];
    return row ? toLinkingToken(row) : null;
  }

  async markTokenUsed(tokenDigest: string, usedAt: Date): Promise<void> {
    await this.#pool.query(
      `UPDATE telegram_linking_tokens
       SET used_at = $2
       WHERE token_digest = $1`,
      [tokenDigest, usedAt],
    );
  }

  async findActiveByPrincipalId(principalId: string): Promise<TelegramIdentity | null> {
    const result = await this.#pool.query<IdentityRow>(
      `SELECT id, principal_id, telegram_user_id, chat_id, created_at, updated_at, revoked_at
       FROM telegram_identities
       WHERE principal_id = $1 AND revoked_at IS NULL`,
      [principalId],
    );
    const row = result.rows[0];
    return row ? toIdentity(row) : null;
  }

  async findActiveByTelegramUserId(telegramUserId: string): Promise<TelegramIdentity | null> {
    const result = await this.#pool.query<IdentityRow>(
      `SELECT id, principal_id, telegram_user_id, chat_id, created_at, updated_at, revoked_at
       FROM telegram_identities
       WHERE telegram_user_id = $1 AND revoked_at IS NULL`,
      [telegramUserId],
    );
    const row = result.rows[0];
    return row ? toIdentity(row) : null;
  }

  async upsertActiveIdentity(params: {
    readonly principalId: string;
    readonly telegramUserId: string;
    readonly chatId: string;
    readonly now: Date;
  }): Promise<TelegramIdentity> {
    const result = await this.#pool.query<IdentityRow>(
      `INSERT INTO telegram_identities (principal_id, telegram_user_id, chat_id, created_at, updated_at, revoked_at)
       VALUES ($1, $2, $3, $4, $4, NULL)
       ON CONFLICT (principal_id, telegram_user_id)
       DO UPDATE SET chat_id = EXCLUDED.chat_id, updated_at = EXCLUDED.updated_at, revoked_at = NULL
       RETURNING id, principal_id, telegram_user_id, chat_id, created_at, updated_at, revoked_at`,
      [params.principalId, params.telegramUserId, params.chatId, params.now],
    );
    return toIdentity(result.rows[0]!);
  }

  async revokeByPrincipalId(principalId: string, revokedAt: Date): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE telegram_identities
       SET revoked_at = $2, updated_at = $2
       WHERE principal_id = $1 AND revoked_at IS NULL`,
      [principalId, revokedAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async revokeByTelegramUserId(telegramUserId: string, revokedAt: Date): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE telegram_identities
       SET revoked_at = $2, updated_at = $2
       WHERE telegram_user_id = $1 AND revoked_at IS NULL`,
      [telegramUserId, revokedAt],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
