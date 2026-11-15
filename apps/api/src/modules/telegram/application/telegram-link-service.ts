// Application service for Telegram identity linking and revocation (T3-012-A).
// Manages single-use link codes, expiry, replay prevention, private chat enforcement,
// update authenticity verification, and unlinking.
import { createHash, randomBytes } from 'node:crypto';
import type { Principal } from '../../identity/domain/principal.ts';
import {
  isPrivateChat,
  type TelegramIdentity,
  type TelegramUpdate,
} from '../domain/telegram-identity.ts';
import type {
  ConsumeLinkResult,
  LinkFailureReason,
  TelegramLinkRepository,
} from './ports/telegram-link-repository.ts';
import { verifyWebhookSecret } from './telegram-authenticity.ts';

/** Link code time-to-live: 15 minutes. */
export const TELEGRAM_LINK_CODE_TTL_MS = 15 * 60 * 1000;

export interface TelegramLinkServiceOptions {
  readonly webhookSecret?: string | undefined;
  readonly botToken?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface IssuedTelegramLinkCode {
  readonly code: string;
  readonly expiresAt: Date;
}

export interface TelegramLinkStatus {
  readonly linked: boolean;
  readonly telegramUserId?: string | undefined;
  readonly telegramUsername?: string | undefined;
  readonly linkedAt?: string | undefined;
}

export type LinkResult =
  | { readonly success: true; readonly identity: TelegramIdentity }
  | {
      readonly success: false;
      readonly reason:
        LinkFailureReason | 'group_chats_not_allowed' | 'bots_not_allowed' | 'invalid_user_id';
    };

export type WebhookHandlingResult =
  | { readonly status: 'unauthorized' }
  | { readonly status: 'ignored' }
  | { readonly status: 'rejected'; readonly reason: 'group_chats_not_allowed' | 'bots_not_allowed' }
  | { readonly status: 'linked'; readonly identity: TelegramIdentity }
  | {
      readonly status: 'link_failed';
      readonly reason:
        LinkFailureReason | 'group_chats_not_allowed' | 'bots_not_allowed' | 'invalid_user_id';
    }
  | { readonly status: 'unlinked'; readonly unlinked: boolean }
  | { readonly status: 'authenticated'; readonly principal: Principal }
  | { readonly status: 'unauthenticated' };

export function digestLinkCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export class TelegramLinkService {
  readonly #repository: TelegramLinkRepository;
  readonly #webhookSecret?: string | undefined;
  readonly #botToken?: string | undefined;
  readonly #now: () => Date;

  constructor(repository: TelegramLinkRepository, options: TelegramLinkServiceOptions = {}) {
    this.#repository = repository;
    this.#webhookSecret = options.webhookSecret;
    this.#botToken = options.botToken;
    this.#now = options.now ?? (() => new Date());
  }

  get webhookSecret(): string | undefined {
    return this.#webhookSecret;
  }

  get botToken(): string | undefined {
    return this.#botToken;
  }

  /**
   * Generates a single-use expiring link code for an authenticated learner.
   * Only learner principals may request link codes. The code itself is returned once
   * and never logged; only its SHA-256 digest is stored.
   */
  async issueLinkCode(learner: Principal): Promise<IssuedTelegramLinkCode> {
    if (learner.role !== 'learner') {
      throw new Error('Only learner principals may link a Telegram identity');
    }

    // 24 random bytes in base64url (32 url-safe chars)
    const code = randomBytes(24).toString('base64url');
    const digest = digestLinkCode(code);
    const expiresAt = new Date(this.#now().getTime() + TELEGRAM_LINK_CODE_TTL_MS);

    await this.#repository.createLinkCode(learner.id, digest, expiresAt);
    return { code, expiresAt };
  }

  /**
   * Links a private Telegram user account to a learner using a single-use code.
   * Rejects unapproved group chats, bots, expired codes, and replay/cross-user link attempts.
   */
  async linkAccount(params: {
    readonly code: string;
    readonly telegramUserId: string | number;
    readonly telegramChatId: string | number;
    readonly chatType: string;
    readonly isBot?: boolean | undefined;
    readonly telegramUsername?: string | undefined;
  }): Promise<LinkResult> {
    if (params.chatType !== 'private') {
      return { success: false, reason: 'group_chats_not_allowed' };
    }

    if (params.isBot) {
      return { success: false, reason: 'bots_not_allowed' };
    }

    const telegramUserId = String(params.telegramUserId).trim();
    if (!telegramUserId || !/^-?\d+$/.test(telegramUserId)) {
      return { success: false, reason: 'invalid_user_id' };
    }

    const telegramChatId = String(params.telegramChatId).trim();
    const cleanUsername = params.telegramUsername?.trim().replace(/^@/, '') || undefined;
    const codeDigest = digestLinkCode(params.code.trim());

    const result: ConsumeLinkResult = await this.#repository.consumeLinkCode({
      codeDigest,
      telegramUserId,
      telegramChatId,
      telegramUsername: cleanUsername,
      now: this.#now(),
    });

    if (!result.success) {
      return { success: false, reason: result.reason };
    }

    return { success: true, identity: result.identity };
  }

  /**
   * Unlinks an active Telegram identity for a learner principal.
   * Revokes subsequent protected access immediately.
   */
  async unlinkByLearner(learner: Principal): Promise<boolean> {
    if (learner.role !== 'learner') return false;
    return this.#repository.unlinkByLearnerId(learner.id, this.#now());
  }

  /**
   * Unlinks an active Telegram identity directly from Telegram (e.g. /unlink command).
   * Only permitted from private chats.
   */
  async unlinkByTelegram(params: {
    readonly telegramUserId: string | number;
    readonly chatType: string;
  }): Promise<boolean> {
    if (params.chatType !== 'private') return false;
    const telegramUserId = String(params.telegramUserId).trim();
    return this.#repository.unlinkByTelegramUserId(telegramUserId, this.#now());
  }

  /**
   * Resolves the authenticated Principal for an actively linked Telegram user ID.
   * Returns null if unlinked, revoked, or non-existent.
   */
  async resolveLearner(telegramUserId: string | number): Promise<Principal | null> {
    return this.#repository.findPrincipalByTelegramUserId(String(telegramUserId).trim());
  }

  /**
   * Returns the current Telegram linking status for an authenticated learner.
   * Never exposes raw link codes or secret tokens.
   */
  async getStatus(learner: Principal): Promise<TelegramLinkStatus> {
    const identity = await this.#repository.findIdentityByLearnerId(learner.id);
    if (!identity) {
      return { linked: false };
    }
    return {
      linked: true,
      telegramUserId: identity.telegramUserId,
      linkedAt: identity.linkedAt.toISOString(),
      ...(identity.telegramUsername ? { telegramUsername: identity.telegramUsername } : {}),
    };
  }

  /**
   * Processes an incoming Telegram update (e.g. from a webhook).
   * Verifies authenticity, enforces private chats, and handles /start <code> and /unlink.
   */
  async handleWebhookUpdate(
    update: TelegramUpdate,
    secretHeader?: string,
  ): Promise<WebhookHandlingResult> {
    // Verify webhook secret if configured
    if (this.#webhookSecret && !verifyWebhookSecret(secretHeader, this.#webhookSecret)) {
      return { status: 'unauthorized' };
    }

    const message = update?.message;
    if (!message) {
      return { status: 'ignored' };
    }

    // Enforce private chats: group chats never establish learner access
    if (!isPrivateChat(message.chat)) {
      return { status: 'rejected', reason: 'group_chats_not_allowed' };
    }

    // Enforce non-bot sender
    if (message.from?.isBot) {
      return { status: 'rejected', reason: 'bots_not_allowed' };
    }

    if (!message.from) {
      return { status: 'ignored' };
    }

    const text = message.text?.trim() ?? '';

    // Handle linking command: /start <code> or /link <code>
    const linkMatch = /^\/(?:start|link)\s+([A-Za-z0-9_-]{20,128})$/i.exec(text);
    if (linkMatch) {
      const code = linkMatch[1]!;
      const linkResult = await this.linkAccount({
        code,
        telegramUserId: message.from.id,
        telegramChatId: message.chat.id,
        chatType: message.chat.type,
        isBot: message.from.isBot,
        telegramUsername: message.from.username,
      });

      if (linkResult.success) {
        return { status: 'linked', identity: linkResult.identity };
      }
      return { status: 'link_failed', reason: linkResult.reason };
    }

    // Handle unlinking command: /unlink
    if (/^\/unlink(?:@\w+)?$/i.test(text)) {
      const unlinked = await this.unlinkByTelegram({
        telegramUserId: message.from.id,
        chatType: message.chat.type,
      });
      return { status: 'unlinked', unlinked };
    }

    // For other messages, check if sender is an actively linked learner
    const principal = await this.resolveLearner(message.from.id);
    if (principal) {
      return { status: 'authenticated', principal };
    }
    return { status: 'unauthenticated' };
  }
}
