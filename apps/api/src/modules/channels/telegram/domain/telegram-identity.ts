// Private Telegram identity linking and token domain types (T3-012-A).
// Links authenticated learner principals to private Telegram accounts.
// Usernames and unapproved group chats never establish learner access.
// Tokens are stored as SHA-256 digests; raw tokens never appear in database storage or logs.
import { createHash, randomBytes } from 'node:crypto';

export interface TelegramIdentity {
  readonly id: string;
  readonly principalId: string;
  readonly telegramUserId: string;
  readonly chatId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly revokedAt: Date | null;
}

export interface TelegramLinkingToken {
  readonly tokenDigest: string;
  readonly principalId: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly createdAt: Date;
}

export interface TelegramUser {
  readonly id: number | string;
  readonly is_bot?: boolean;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
}

export interface TelegramChat {
  readonly id: number | string;
  readonly type: string;
  readonly title?: string;
  readonly username?: string;
}

export interface TelegramMessage {
  readonly message_id: number;
  readonly from?: TelegramUser;
  readonly chat: TelegramChat;
  readonly date: number;
  readonly text?: string;
}

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
}

export type LinkFailureReason =
  | 'invalid_token'
  | 'expired_token'
  | 'token_already_used'
  | 'group_chat_forbidden'
  | 'already_linked_to_other_account'
  | 'account_already_linked';

export type LinkTelegramOutcome =
  | { readonly success: true; readonly identity: TelegramIdentity; readonly message: string }
  | { readonly success: false; readonly reason: LinkFailureReason; readonly message: string };

/** Computes the SHA-256 digest of a trimmed linking token. */
export function hashLinkingToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

/** Generates a cryptographically random, single-use linking token. */
export function generateLinkingToken(): string {
  return `tlk_${randomBytes(16).toString('hex')}`;
}

/** Masks a Telegram user ID for display in learner-facing interfaces without leaking details. */
export function maskTelegramUserId(userId: string): string {
  const clean = userId.trim();
  if (clean.length <= 4) return '***';
  return `***${clean.slice(-4)}`;
}

export interface ParsedTelegramCommand {
  readonly command: string;
  readonly argument?: string | undefined;
}

/**
 * Parses Telegram command text such as:
 * - `/link <token>`
 * - `/start <token>` (Telegram deep-link payload)
 * - `/link@bot_username <token>`
 * - `/unlink`
 * - `/status`
 */
export function parseTelegramCommand(text: string): ParsedTelegramCommand | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Telegram bot commands start with '/' or specifically 'start ' / 'link '
  if (!trimmed.startsWith('/') && !/^start\s+/i.test(trimmed) && !/^link\s+/i.test(trimmed)) {
    return null;
  }

  // Match /cmd or cmd followed by optional @bot_username and optional arguments
  const match = /^\/?([a-zA-Z0-9_]+)(?:@\w+)?(?:\s+(.+))?$/s.exec(trimmed);
  if (!match) return null;

  const rawCmd = match[1]?.toLowerCase();
  if (!rawCmd) return null;

  const rawArg = match[2]?.trim();
  return {
    command: rawCmd,
    argument: rawArg || undefined,
  };
}
