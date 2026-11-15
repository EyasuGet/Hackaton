// Repository port interface for Telegram identities and linking tokens (T3-012-A).
// Implementation details (PostgreSQL, queries) stay in infrastructure/persistence.
import type { TelegramIdentity, TelegramLinkingToken } from '../../domain/telegram-identity.ts';

export interface TelegramIdentityRepository {
  /** Persists a single-use linking token digest for a learner. */
  createLinkingToken(token: {
    tokenDigest: string;
    principalId: string;
    expiresAt: Date;
    createdAt?: Date;
  }): Promise<void>;

  /** Retrieves a linking token record by its SHA-256 digest. */
  findLinkingToken(tokenDigest: string): Promise<TelegramLinkingToken | null>;

  /** Marks a token as used so it cannot be replayed. */
  markTokenUsed(tokenDigest: string, usedAt: Date): Promise<void>;

  /** Retrieves the active (non-revoked) identity for a learner principal, if any. */
  findActiveByPrincipalId(principalId: string): Promise<TelegramIdentity | null>;

  /** Retrieves the active (non-revoked) identity for a Telegram user ID, if any. */
  findActiveByTelegramUserId(telegramUserId: string): Promise<TelegramIdentity | null>;

  /**
   * Links or re-links a Telegram account to a learner principal.
   * If an existing revoked record exists for (principalId, telegramUserId), it is re-activated.
   */
  upsertActiveIdentity(params: {
    principalId: string;
    telegramUserId: string;
    chatId: string;
    now: Date;
  }): Promise<TelegramIdentity>;

  /** Revokes any active Telegram link for a learner principal. Returns true if a link was revoked. */
  revokeByPrincipalId(principalId: string, revokedAt: Date): Promise<boolean>;

  /** Revokes any active Telegram link for a Telegram user ID. Returns true if a link was revoked. */
  revokeByTelegramUserId(telegramUserId: string, revokedAt: Date): Promise<boolean>;
}
