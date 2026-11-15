// Persistence port for Telegram identity links and single-use codes (T3-012-A).
import type { Principal } from '../../../identity/domain/principal.ts';
import type { TelegramIdentity } from '../../domain/telegram-identity.ts';

export type LinkFailureReason =
  | 'invalid_code'
  | 'code_expired'
  | 'code_already_used'
  | 'telegram_user_already_linked'
  | 'learner_already_linked';

export type ConsumeLinkResult =
  | { readonly success: true; readonly identity: TelegramIdentity }
  | { readonly success: false; readonly reason: LinkFailureReason };

export interface ConsumeLinkParams {
  readonly codeDigest: string;
  readonly telegramUserId: string;
  readonly telegramChatId: string;
  readonly telegramUsername?: string | undefined;
  readonly now: Date;
}

export interface TelegramLinkRepository {
  /** Persists a single-use link code digest for a learner principal. */
  createLinkCode(learnerId: string, codeDigest: string, expiresAt: Date): Promise<void>;

  /**
   * Atomically consumes a link code and establishes an active Telegram identity link.
   * Enforces single-use, expiry, and ensures neither the learner nor the telegram user
   * is already linked to another active account.
   */
  consumeLinkCode(params: ConsumeLinkParams): Promise<ConsumeLinkResult>;

  /** Revokes the active Telegram link for a learner principal. Returns true if an active link was revoked. */
  unlinkByLearnerId(learnerId: string, now: Date): Promise<boolean>;

  /** Revokes the active Telegram link for a Telegram user ID. Returns true if an active link was revoked. */
  unlinkByTelegramUserId(telegramUserId: string, now: Date): Promise<boolean>;

  /** Finds active Telegram identity by Telegram user ID, or null if unlinked/revoked. */
  findIdentityByTelegramUserId(telegramUserId: string): Promise<TelegramIdentity | null>;

  /** Finds active Telegram identity by learner principal ID, or null if unlinked. */
  findIdentityByLearnerId(learnerId: string): Promise<TelegramIdentity | null>;

  /**
   * Resolves the authenticated Principal (with course grants) for an actively linked
   * Telegram user. Returns null if unlinked, revoked, or non-existent.
   */
  findPrincipalByTelegramUserId(telegramUserId: string): Promise<Principal | null>;
}
