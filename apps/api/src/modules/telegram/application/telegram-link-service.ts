// Application service for Telegram identity linking and revocation (T3-012-A / T3-019-C).
// Manages single-use link codes, expiry, replay prevention, private chat enforcement,
// update authenticity verification, rate limits, job question routing, and unlinking.
import { createHash, randomBytes } from 'node:crypto';
import type { JobAnswers, JobCitation } from '../../careers/application/job-answers.ts';
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
import { type RateLimiter, SlidingWindowRateLimiter } from './rate-limiter.ts';
import { verifyWebhookSecret } from './telegram-authenticity.ts';

/** Link code time-to-live: 15 minutes. */
export const TELEGRAM_LINK_CODE_TTL_MS = 15 * 60 * 1000;

export interface TelegramSender {
  sendMessage(params: { chatId: string | number; text: string }): Promise<boolean>;
}

export class FetchTelegramSender implements TelegramSender {
  readonly #botToken: string;

  constructor(botToken: string) {
    this.#botToken = botToken;
  }

  async sendMessage(params: { chatId: string | number; text: string }): Promise<boolean> {
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.#botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: params.chatId,
          text: params.text,
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export interface TelegramLinkServiceOptions {
  readonly webhookSecret?: string | undefined;
  readonly botToken?: string | undefined;
  readonly jobAnswers?: JobAnswers | undefined;
  readonly rateLimiter?: RateLimiter | undefined;
  readonly sender?: TelegramSender | undefined;
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
  | {
      readonly status: 'linked';
      readonly identity: TelegramIdentity;
      readonly replayed?: boolean | undefined;
    }
  | {
      readonly status: 'link_failed';
      readonly reason:
        LinkFailureReason | 'group_chats_not_allowed' | 'bots_not_allowed' | 'invalid_user_id';
      readonly replayed?: boolean | undefined;
    }
  | {
      readonly status: 'unlinked';
      readonly unlinked: boolean;
      readonly replayed?: boolean | undefined;
    }
  | {
      readonly status: 'answered';
      readonly answer: string;
      readonly citations: readonly JobCitation[];
      readonly kind: 'answered' | 'insufficient_evidence';
      readonly answerLang: 'en' | 'am';
      readonly matchedJobId?: string | undefined;
      readonly replayed?: boolean | undefined;
    }
  | {
      readonly status: 'rate_limited';
      readonly message: string;
      readonly retryAfterSec?: number | undefined;
    }
  | {
      readonly status: 'authenticated';
      readonly principal: Principal;
      readonly replayed?: boolean | undefined;
    }
  | { readonly status: 'unauthenticated'; readonly replayed?: boolean | undefined };

export function digestLinkCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export class TelegramLinkService {
  readonly #repository: TelegramLinkRepository;
  readonly #webhookSecret?: string | undefined;
  readonly #botToken?: string | undefined;
  readonly #jobAnswers?: JobAnswers | undefined;
  readonly #rateLimiter: RateLimiter;
  readonly #sender?: TelegramSender | undefined;
  readonly #now: () => Date;

  constructor(repository: TelegramLinkRepository, options: TelegramLinkServiceOptions = {}) {
    this.#repository = repository;
    this.#webhookSecret = options.webhookSecret;
    this.#botToken = options.botToken;
    this.#jobAnswers = options.jobAnswers;
    this.#now = options.now ?? (() => new Date());
    this.#rateLimiter = options.rateLimiter ?? new SlidingWindowRateLimiter(15, 60_000, this.#now);
    this.#sender =
      options.sender ?? (options.botToken ? new FetchTelegramSender(options.botToken) : undefined);
  }

  get webhookSecret(): string | undefined {
    return this.#webhookSecret;
  }

  get botToken(): string | undefined {
    return this.#botToken;
  }

  get jobAnswers(): JobAnswers | undefined {
    return this.#jobAnswers;
  }

  get rateLimiter(): RateLimiter {
    return this.#rateLimiter;
  }

  get sender(): TelegramSender | undefined {
    return this.#sender;
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
   * Verifies authenticity, enforces private chats, replay protection, rate limits,
   * handles /start <code>, /unlink, and answers approved job questions.
   */
  async handleWebhookUpdate(
    update: TelegramUpdate,
    secretHeader?: string,
  ): Promise<WebhookHandlingResult> {
    // 1. Verify webhook secret if configured
    if (this.#webhookSecret && !verifyWebhookSecret(secretHeader, this.#webhookSecret)) {
      return { status: 'unauthorized' };
    }

    const message = update?.message;
    if (!message) {
      return { status: 'ignored' };
    }

    // 2. Enforce private chats: group chats never establish learner access
    if (!isPrivateChat(message.chat)) {
      return { status: 'rejected', reason: 'group_chats_not_allowed' };
    }

    // 3. Enforce non-bot sender
    if (message.from?.isBot) {
      return { status: 'rejected', reason: 'bots_not_allowed' };
    }

    if (!message.from) {
      return { status: 'ignored' };
    }

    const text = message.text?.trim() ?? '';

    // 4. Handle linking command: /start <code> or /link <code>
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

      return linkResult.success
        ? { status: 'linked', identity: linkResult.identity }
        : { status: 'link_failed', reason: linkResult.reason };
    }

    // 5. Handle unlinking command: /unlink
    if (/^\/unlink(?:@\w+)?$/i.test(text)) {
      const unlinked = await this.unlinkByTelegram({
        telegramUserId: message.from.id,
        chatType: message.chat.type,
      });
      return { status: 'unlinked', unlinked };
    }

    // 6. Replay check by update_id for incoming questions / updates
    if (update.updateId && update.updateId > 0) {
      const cached = await this.#repository.findProcessedUpdate(update.updateId);
      if (cached) {
        return {
          ...cached.responsePayload,
          status: cached.responseStatus as WebhookHandlingResult['status'],
          replayed: true,
        } as WebhookHandlingResult;
      }
    }

    // 7. For other messages, check if sender is an actively linked learner
    const principal = await this.resolveLearner(message.from.id);
    if (!principal) {
      const outcome: WebhookHandlingResult = { status: 'unauthenticated' };
      if (update.updateId && update.updateId > 0) {
        await this.#repository.recordProcessedUpdate({
          updateId: update.updateId,
          telegramUserId: String(message.from.id),
          responseStatus: 'unauthenticated',
          responsePayload: outcome,
          now: this.#now(),
        });
      }
      return outcome;
    }

    // 8. Shared rate limit check across channel invocations
    const rateCheck = this.#rateLimiter.consume(String(message.from.id));
    if (!rateCheck.allowed) {
      const isAmharic = /[\u1200-\u137F]/.test(text);
      const msg = isAmharic
        ? 'በጣም ብዙ ጥያቄዎች ቀርበዋል። እባክዎ ጥቂት ደቂቃ ቆይተው እንደገና ይሞክሩ።'
        : 'Too many requests. Please wait a moment before trying again.';
      return {
        status: 'rate_limited',
        message: msg,
        retryAfterSec: rateCheck.retryAfterSec,
      };
    }

    // 9. Job question check (T3-019-C)
    if (this.#jobAnswers && this.#jobAnswers.isJobQuestion(text)) {
      const jobResult = await this.#jobAnswers.answer(principal, text, this.#now());
      const outcome: WebhookHandlingResult = {
        status: 'answered',
        answer: jobResult.answerText,
        citations: jobResult.citations,
        kind: jobResult.kind,
        answerLang: jobResult.answerLang,
        matchedJobId: jobResult.matchedJobId,
      };

      if (update.updateId && update.updateId > 0) {
        await this.#repository.recordProcessedUpdate({
          updateId: update.updateId,
          telegramUserId: String(message.from.id),
          responseStatus: 'answered',
          responsePayload: outcome,
          now: this.#now(),
        });
      }

      if (this.#sender) {
        await this.#sender.sendMessage({
          chatId: message.chat.id,
          text: jobResult.answerText,
        });
      }

      return outcome;
    }

    // 10. General authenticated message
    const outcome: WebhookHandlingResult = { status: 'authenticated', principal };
    if (update.updateId && update.updateId > 0) {
      await this.#repository.recordProcessedUpdate({
        updateId: update.updateId,
        telegramUserId: String(message.from.id),
        responseStatus: 'authenticated',
        responsePayload: { status: 'authenticated' },
        now: this.#now(),
      });
    }
    return outcome;
  }
}
