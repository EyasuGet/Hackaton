import { createHash, randomBytes } from 'node:crypto';
import type { JobPreferencesRepository } from '../../careers/application/ports/job-preferences-repository.ts';
import { ownedScope, type Principal } from '../../identity/domain/principal.ts';
import {
  isPrivateChat,
  type TelegramIdentity,
  type TelegramUpdate,
} from '../domain/telegram-identity.ts';
import type { TelegramClient } from './ports/telegram-client.ts';
import type {
  ConsumeLinkResult,
  LinkFailureReason,
  TelegramLinkRepository,
} from './ports/telegram-link-repository.ts';
import { verifyWebhookSecret } from './telegram-authenticity.ts';
import { TELEGRAM_JOB_UNSUBSCRIBE_CALLBACK_DATA } from './telegram-job-alert-dispatcher.ts';

/** Link code time-to-live: 15 minutes. */
export const TELEGRAM_LINK_CODE_TTL_MS = 15 * 60 * 1000;

export interface TelegramLinkServiceOptions {
  readonly webhookSecret?: string | undefined;
  readonly botToken?: string | undefined;
  readonly now?: (() => Date) | undefined;
  readonly jobPreferencesRepository?: JobPreferencesRepository | undefined;
  readonly telegramClient?: TelegramClient | undefined;
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
        | LinkFailureReason
        | 'group_chats_not_allowed'
        | 'bots_not_allowed'
        | 'invalid_user_id';
    };

export type WebhookHandlingResult =
  | { readonly status: 'unauthorized' }
  | { readonly status: 'ignored' }
  | { readonly status: 'rejected'; readonly reason: 'group_chats_not_allowed' | 'bots_not_allowed' }
  | { readonly status: 'linked'; readonly identity: TelegramIdentity }
  | {
      readonly status: 'link_failed';
      readonly reason:
        | LinkFailureReason
        | 'group_chats_not_allowed'
        | 'bots_not_allowed'
        | 'invalid_user_id';
    }
  | { readonly status: 'unlinked'; readonly unlinked: boolean }
  | {
      readonly status: 'unsubscribed';
      readonly unlinked: boolean;
      readonly channel: string;
      readonly principal?: Principal | undefined;
    }
  | { readonly status: 'authenticated'; readonly principal: Principal }
  | { readonly status: 'unauthenticated' };

export function digestLinkCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export class TelegramLinkService {
  readonly #repository: TelegramLinkRepository;
  readonly #webhookSecret?: string | undefined;
  readonly #botToken?: string | undefined;
  readonly #jobPreferencesRepository?: JobPreferencesRepository | undefined;
  readonly #telegramClient?: TelegramClient | undefined;
  readonly #now: () => Date;

  constructor(repository: TelegramLinkRepository, options: TelegramLinkServiceOptions = {}) {
    this.#repository = repository;
    this.#webhookSecret = options.webhookSecret;
    this.#botToken = options.botToken;
    this.#jobPreferencesRepository = options.jobPreferencesRepository;
    this.#telegramClient = options.telegramClient;
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
   * Revokes subsequent protected access immediately and cancels any queued Telegram alerts.
   */
  async unlinkByLearner(learner: Principal): Promise<boolean> {
    if (learner.role !== 'learner') return false;
    const unlinked = await this.#repository.unlinkByLearnerId(learner.id, this.#now());
    const scope = ownedScope(learner);
    if (unlinked && scope && this.#jobPreferencesRepository) {
      await this.#jobPreferencesRepository.unsubscribeAll(scope, 'telegram', this.#now());
    }
    return unlinked;
  }

  /**
   * Unlinks an active Telegram identity directly from Telegram (e.g. /unlink command).
   * Only permitted from private chats. Immediately suppresses queued Telegram alerts.
   */
  async unlinkByTelegram(params: {
    readonly telegramUserId: string | number;
    readonly chatType: string;
  }): Promise<boolean> {
    if (params.chatType !== 'private') return false;
    const telegramUserId = String(params.telegramUserId).trim();
    const principal = await this.resolveLearner(telegramUserId);
    const unlinked = await this.#repository.unlinkByTelegramUserId(telegramUserId, this.#now());
    const scope = principal ? ownedScope(principal) : null;
    if (unlinked && scope && this.#jobPreferencesRepository) {
      await this.#jobPreferencesRepository.unsubscribeAll(scope, 'telegram', this.#now());
    }
    return unlinked;
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
   * Verifies authenticity, enforces private chats, and handles /start <code>, /unlink,
   * /unsubscribe commands, and callback queries for job alert unsubscribes.
   */
  async handleWebhookUpdate(
    update: TelegramUpdate,
    secretHeader?: string,
  ): Promise<WebhookHandlingResult> {
    // Verify webhook secret if configured
    if (this.#webhookSecret && !verifyWebhookSecret(secretHeader, this.#webhookSecret)) {
      return { status: 'unauthorized' };
    }

    // Handle callback query (inline button clicks)
    if (update?.callbackQuery) {
      const cb = update.callbackQuery;
      if (cb.from?.isBot) {
        return { status: 'rejected', reason: 'bots_not_allowed' };
      }
      if (cb.data === TELEGRAM_JOB_UNSUBSCRIBE_CALLBACK_DATA) {
        const principal = await this.resolveLearner(cb.from.id);
        if (principal) {
          const scope = ownedScope(principal);
          if (scope && this.#jobPreferencesRepository) {
            await this.#jobPreferencesRepository.unsubscribeAll(scope, 'telegram', this.#now());
          }
          if (this.#telegramClient) {
            await this.#telegramClient.answerCallbackQuery?.({
              callbackQueryId: cb.id,
              text: 'Unsubscribed from job alerts',
            });
            if (cb.message?.chat.id) {
              await this.#telegramClient.sendMessage({
                chatId: String(cb.message.chat.id),
                text: 'You have unsubscribed from job alerts.',
              });
            }
          }
          return { status: 'unsubscribed', unlinked: false, channel: 'telegram', principal };
        }
        return { status: 'unauthenticated' };
      }
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

    // Handle unsubscribe command: /unsubscribe or /unsub
    if (/^\/(?:unsubscribe|unsub|stop)(?:@\w+)?$/i.test(text)) {
      const principal = await this.resolveLearner(message.from.id);
      if (principal) {
        const scope = ownedScope(principal);
        if (scope && this.#jobPreferencesRepository) {
          await this.#jobPreferencesRepository.unsubscribeAll(scope, 'telegram', this.#now());
        }
        if (this.#telegramClient) {
          await this.#telegramClient.sendMessage({
            chatId: String(message.chat.id),
            text: 'You have unsubscribed from job alerts.',
          });
        }
        return { status: 'unsubscribed', unlinked: false, channel: 'telegram', principal };
      }
      if (this.#telegramClient) {
        await this.#telegramClient.sendMessage({
          chatId: String(message.chat.id),
          text: 'No active linked account found.',
        });
      }
      return { status: 'unauthenticated' };
    }

    // For other messages, check if sender is an actively linked learner
    const principal = await this.resolveLearner(message.from.id);
    if (principal) {
      return { status: 'authenticated', principal };
    }
    return { status: 'unauthenticated' };
  }
}
