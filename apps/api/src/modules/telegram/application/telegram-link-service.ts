// Application service for Telegram identity linking, tutoring answers, and job alerts (T3-012-A / T3-012-B / T3-019-C / T3-020-B).
import { createHash, randomBytes } from 'node:crypto';
import type { JobAnswers, JobCitation } from '../../careers/application/job-answers.ts';
import type { JobPreferencesRepository } from '../../careers/application/ports/job-preferences-repository.ts';
import type { ContentAccess } from '../../content/application/content-access.ts';
import { ownedScope, type Principal } from '../../identity/domain/principal.ts';
import {
  TutoringError,
  type AnswerResult,
  type Tutoring,
} from '../../tutoring/application/tutoring.ts';
import type { FaqCitation } from '../../tutoring/domain/faq.ts';
import {
  formatTelegramTutorResponse,
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
import type { TelegramMessenger } from './ports/telegram-messenger.ts';
import { type RateLimiter, SlidingWindowRateLimiter } from './rate-limiter.ts';
import { verifyWebhookSecret } from './telegram-authenticity.ts';
import { TELEGRAM_JOB_UNSUBSCRIBE_CALLBACK_DATA } from './telegram-job-alert-dispatcher.ts';

/** Link code time-to-live: 15 minutes. */
export const TELEGRAM_LINK_CODE_TTL_MS = 15 * 60 * 1000;

const HONEST_LIMITATIONS = {
  en: 'I do not have an approved course answer for that question in the materials.',
  am: 'በተሰጠው የትምህርት መረጃ ውስጥ ለቀረበው ጥያቄ የተረጋገጠ መልስ አልተገኘም።',
} as const;

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
  readonly jobPreferencesRepository?: JobPreferencesRepository | undefined;
  readonly telegramClient?: TelegramClient | undefined;
  readonly tutoring?: Tutoring | undefined;
  readonly content?: ContentAccess | undefined;
  readonly messenger?: TelegramMessenger | undefined;
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
  readonly externalConsent?: boolean | undefined;
  readonly activeCourseId?: string | undefined;
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
  | {
      readonly status: 'rejected';
      readonly reason: 'group_chats_not_allowed' | 'bots_not_allowed' | 'course_not_granted';
    }
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
      readonly status: 'unsubscribed';
      readonly unlinked: boolean;
      readonly channel: string;
      readonly principal?: Principal | undefined;
    }
  | {
      readonly status: 'answered';
      readonly answer: string;
      readonly rawAnswer?: string | undefined;
      readonly citations: readonly (JobCitation | FaqCitation)[];
      readonly kind: 'answered' | 'insufficient_evidence';
      readonly answerLang?: 'en' | 'am' | undefined;
      readonly lang?: 'en' | 'am' | undefined;
      readonly provider?: 'online' | 'faq' | 'job' | undefined;
      readonly requestId?: string | undefined;
      readonly matchedJobId?: string | undefined;
      readonly replayed?: boolean | undefined;
    }
  | {
      readonly status: 'preference_updated';
      readonly externalConsent?: boolean | undefined;
      readonly activeCourseId?: string | undefined;
    }
  | {
      readonly status: 'citation';
      readonly sourceId: string;
      readonly sectionId: string;
      readonly text: string;
      readonly heading?: string | undefined;
      readonly sourceTitle?: string | undefined;
    }
  | {
      readonly status: 'error';
      readonly error: string;
      readonly message: string;
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
  readonly #jobPreferencesRepository?: JobPreferencesRepository | undefined;
  readonly #telegramClient?: TelegramClient | undefined;
  readonly #tutoring?: Tutoring | undefined;
  readonly #content?: ContentAccess | undefined;
  readonly #messenger?: TelegramMessenger | undefined;
  readonly #now: () => Date;

  constructor(repository: TelegramLinkRepository, options: TelegramLinkServiceOptions = {}) {
    this.#repository = repository;
    this.#webhookSecret = options.webhookSecret;
    this.#botToken = options.botToken;
    this.#jobAnswers = options.jobAnswers;
    this.#jobPreferencesRepository = options.jobPreferencesRepository;
    this.#telegramClient = options.telegramClient;
    this.#tutoring = options.tutoring;
    this.#content = options.content;
    this.#messenger = options.messenger;
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

  async issueLinkCode(learner: Principal): Promise<IssuedTelegramLinkCode> {
    if (learner.role !== 'learner') {
      throw new Error('Only learner principals may link a Telegram identity');
    }

    const code = randomBytes(24).toString('base64url');
    const digest = digestLinkCode(code);
    const expiresAt = new Date(this.#now().getTime() + TELEGRAM_LINK_CODE_TTL_MS);

    await this.#repository.createLinkCode(learner.id, digest, expiresAt);
    return { code, expiresAt };
  }

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

    const codeDigest = digestLinkCode(params.code);
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

  async unlinkByLearner(learner: Principal): Promise<boolean> {
    if (learner.role !== 'learner') return false;
    const unlinked = await this.#repository.unlinkByLearnerId(learner.id, this.#now());
    const scope = ownedScope(learner);
    if (unlinked && scope && this.#jobPreferencesRepository) {
      await this.#jobPreferencesRepository.unsubscribeAll(scope, 'telegram', this.#now());
    }
    return unlinked;
  }

  async unlinkByTelegram(params: {
    readonly telegramUserId: string | number;
    readonly chatType: string;
  }): Promise<boolean> {
    if (params.chatType !== 'private') {
      return false;
    }
    const telegramUserId = String(params.telegramUserId).trim();
    const principal = await this.resolveLearner(telegramUserId);
    const unlinked = await this.#repository.unlinkByTelegramUserId(telegramUserId, this.#now());
    const scope = principal ? ownedScope(principal) : null;
    if (unlinked && scope && this.#jobPreferencesRepository) {
      await this.#jobPreferencesRepository.unsubscribeAll(scope, 'telegram', this.#now());
    }
    return unlinked;
  }

  async resolveLearner(telegramUserId: string | number): Promise<Principal | null> {
    const idStr = String(telegramUserId).trim();
    if (!idStr) return null;
    return this.#repository.findPrincipalByTelegramUserId(idStr);
  }

  async getStatus(learner: Principal): Promise<TelegramLinkStatus> {
    if (learner.role !== 'learner') {
      return { linked: false };
    }
    const identity = await this.#repository.findIdentityByLearnerId(learner.id);
    if (!identity || identity.revokedAt) {
      return { linked: false };
    }
    return {
      linked: true,
      telegramUserId: identity.telegramUserId,
      ...(identity.telegramUsername ? { telegramUsername: identity.telegramUsername } : {}),
      linkedAt: identity.linkedAt.toISOString(),
      ...(identity.externalConsent !== undefined
        ? { externalConsent: identity.externalConsent }
        : {}),
      ...(identity.activeCourseId ? { activeCourseId: identity.activeCourseId } : {}),
    };
  }

  async setPreferences(
    learner: Principal,
    preferences: { readonly externalConsent?: boolean; readonly activeCourseId?: string },
  ): Promise<TelegramIdentity | null> {
    if (learner.role !== 'learner') return null;
    return this.#repository.setPreferences(learner.id, preferences);
  }

  async handleWebhookUpdate(
    update: TelegramUpdate,
    secretHeader?: string,
  ): Promise<WebhookHandlingResult> {
    // 1. Verify webhook secret if configured
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
    if (!text) {
      return { status: 'ignored' };
    }

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

      if (linkResult.success) {
        await this.#messenger?.sendMessage({
          chatId: message.chat.id,
          text: 'Account linked successfully to Savanna! You can now ask questions grounded in your course materials.',
          replyToMessageId: message.messageId,
        });
        return { status: 'linked', identity: linkResult.identity };
      }
      return { status: 'link_failed', reason: linkResult.reason };
    }

    // 5. Handle unlinking command: /unlink
    if (/^\/unlink(?:@\w+)?$/i.test(text)) {
      const unlinked = await this.unlinkByTelegram({
        telegramUserId: message.from.id,
        chatType: message.chat.type,
      });
      if (unlinked) {
        await this.#messenger?.sendMessage({
          chatId: message.chat.id,
          text: 'Your Telegram identity has been unlinked from Savanna.',
          replyToMessageId: message.messageId,
        });
      }
      return { status: 'unlinked', unlinked };
    }

    // 6. Handle unsubscribe command: /unsubscribe or /unsub
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

    // 7. Replay check by update_id for incoming questions / updates
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

    // 8. Resolve learner principal for authenticated operations
    const principal = await this.resolveLearner(message.from.id);
    if (!principal) {
      const unlinkedNotice =
        'Your Telegram account is not linked to a Savanna learner account. Please link your account from the web application first using /start <code> or /link <code>.';
      await this.#messenger?.sendMessage({
        chatId: message.chat.id,
        text: unlinkedNotice,
        replyToMessageId: message.messageId,
      });
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

    const identity = await this.#repository.findIdentityByTelegramUserId(String(message.from.id));

    // 9. Handle consent command: /consent [on|off]
    const consentCmdMatch = /^\/consent(?:\s+(on|off|true|false|yes|no))?$/i.exec(text);
    if (consentCmdMatch) {
      const toggle = consentCmdMatch[1]?.toLowerCase();
      if (toggle === 'on' || toggle === 'true' || toggle === 'yes') {
        await this.#repository.setPreferences(principal.id, { externalConsent: true });
        const notice =
          'External AI processing consent enabled. Questions may be answered using cloud AI models when available.';
        await this.#messenger?.sendMessage({
          chatId: message.chat.id,
          text: notice,
          replyToMessageId: message.messageId,
        });
        return { status: 'preference_updated', externalConsent: true };
      }
      if (toggle === 'off' || toggle === 'false' || toggle === 'no') {
        await this.#repository.setPreferences(principal.id, { externalConsent: false });
        const notice =
          'External AI processing consent disabled. Questions will only be answered using approved course FAQ materials.';
        await this.#messenger?.sendMessage({
          chatId: message.chat.id,
          text: notice,
          replyToMessageId: message.messageId,
        });
        return { status: 'preference_updated', externalConsent: false };
      }

      const current = identity?.externalConsent === true;
      const notice = `External AI processing consent is currently ${current ? 'enabled' : 'disabled'}. Use /consent on or /consent off to change.`;
      await this.#messenger?.sendMessage({
        chatId: message.chat.id,
        text: notice,
        replyToMessageId: message.messageId,
      });
      return { status: 'preference_updated', externalConsent: current };
    }

    // 10. Handle course selection command: /course [courseId]
    const courseCmdMatch = /^\/course(?:\s+(\S+))?$/i.exec(text);
    if (courseCmdMatch) {
      const requestedCourse = courseCmdMatch[1];
      if (requestedCourse) {
        if (!principal.courseIds.includes(requestedCourse)) {
          const notice = 'Course not found or access not granted.';
          await this.#messenger?.sendMessage({
            chatId: message.chat.id,
            text: notice,
            replyToMessageId: message.messageId,
          });
          return { status: 'rejected', reason: 'course_not_granted' };
        }
        await this.#repository.setPreferences(principal.id, { activeCourseId: requestedCourse });
        const notice = `Active course set to ${requestedCourse}.`;
        await this.#messenger?.sendMessage({
          chatId: message.chat.id,
          text: notice,
          replyToMessageId: message.messageId,
        });
        return { status: 'preference_updated', activeCourseId: requestedCourse };
      }

      const active =
        identity?.activeCourseId && principal.courseIds.includes(identity.activeCourseId)
          ? identity.activeCourseId
          : (principal.courseIds[0] ?? 'none');
      const notice = `Active course: ${active}. Available courses: ${principal.courseIds.join(', ') || 'none'}. Use /course <id> to switch.`;
      await this.#messenger?.sendMessage({
        chatId: message.chat.id,
        text: notice,
        replyToMessageId: message.messageId,
      });
      return { status: 'preference_updated', activeCourseId: active };
    }

    // 11. Handle citation following command: /cite <sourceId> <sectionId>
    const citeCmdMatch = /^\/(?:cite|citation)\s+(\S+)\s+(\S+)$/i.exec(text);
    if (citeCmdMatch) {
      const sourceId = citeCmdMatch[1]!;
      const sectionId = citeCmdMatch[2]!;

      if (this.#content) {
        const resolved = await this.#content.resolve(principal, sourceId, sectionId);
        if (resolved.kind === 'section') {
          const passageText = `Source: ${resolved.section.sourceTitle}\nSection: ${resolved.section.heading}\n\n${resolved.section.text}`;
          await this.#messenger?.sendMessage({
            chatId: message.chat.id,
            text: passageText,
            replyToMessageId: message.messageId,
          });
          return {
            status: 'citation',
            sourceId,
            sectionId,
            text: resolved.section.text,
            heading: resolved.section.heading,
            sourceTitle: resolved.section.sourceTitle,
          };
        }
        if (resolved.kind === 'unavailable') {
          const notice = `The requested section is unavailable (${resolved.reason}).`;
          await this.#messenger?.sendMessage({
            chatId: message.chat.id,
            text: notice,
            replyToMessageId: message.messageId,
          });
          return { status: 'citation', sourceId, sectionId, text: notice };
        }
      }

      const notFoundNotice = 'Citation section not found or not accessible.';
      await this.#messenger?.sendMessage({
        chatId: message.chat.id,
        text: notFoundNotice,
        replyToMessageId: message.messageId,
      });
      return { status: 'citation', sourceId, sectionId, text: notFoundNotice };
    }

    // 12. Shared rate limit check across channel invocations
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

    // 13. Job question check (T3-019-C)
    if (this.#jobAnswers && this.#jobAnswers.isJobQuestion(text)) {
      const jobResult = await this.#jobAnswers.answer(principal, text, this.#now());
      const outcome: WebhookHandlingResult = {
        status: 'answered',
        answer: jobResult.answerText,
        citations: jobResult.citations,
        kind: jobResult.kind,
        answerLang: jobResult.answerLang,
        lang: jobResult.answerLang,
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

    // 14. If tutoring is not wired, return authenticated principal
    if (!this.#tutoring) {
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

    // 15. Determine course scope
    const activeCourse =
      identity?.activeCourseId && principal.courseIds.includes(identity.activeCourseId)
        ? identity.activeCourseId
        : principal.courseIds[0];

    const isAmharic = /[\u1200-\u137F]/.test(text);
    const lang: 'en' | 'am' = isAmharic ? 'am' : 'en';

    if (!activeCourse) {
      const refusalText = HONEST_LIMITATIONS[lang];
      await this.#messenger?.sendMessage({
        chatId: message.chat.id,
        text: refusalText,
        replyToMessageId: message.messageId,
      });
      const outcome: WebhookHandlingResult = {
        status: 'answered',
        answer: refusalText,
        rawAnswer: refusalText,
        citations: [],
        kind: 'insufficient_evidence',
        lang,
        answerLang: lang,
        provider: 'faq',
        requestId: `telegram-update-${update.updateId}`,
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
      return outcome;
    }

    // 16. Determine consent and deterministic idempotency key
    const externalConsent = identity?.externalConsent === true;
    const requestId = `telegram-update-${update.updateId}`;

    // 17. Ask tutor
    let result: AnswerResult | null;
    try {
      result = await this.#tutoring.ask(principal, {
        courseId: activeCourse,
        requestId,
        question: text,
        externalConsent,
      });
    } catch (err: unknown) {
      if (err instanceof TutoringError) {
        const errorMsg = 'An error occurred while answering your question. Please try again.';
        await this.#messenger?.sendMessage({
          chatId: message.chat.id,
          text: errorMsg,
          replyToMessageId: message.messageId,
        });
        return { status: 'error', error: err.code, message: err.message };
      }
      throw err;
    }

    if (!result) {
      const refusalText = HONEST_LIMITATIONS[lang];
      await this.#messenger?.sendMessage({
        chatId: message.chat.id,
        text: refusalText,
        replyToMessageId: message.messageId,
      });
      const outcome: WebhookHandlingResult = {
        status: 'answered',
        answer: refusalText,
        rawAnswer: refusalText,
        citations: [],
        kind: 'insufficient_evidence',
        lang,
        answerLang: lang,
        provider: 'faq',
        requestId,
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
      return outcome;
    }

    // 18. Format citations cleanly for Telegram chat (source, section title, reference)
    const formattedText = formatTelegramTutorResponse(
      result.answerText,
      result.citations,
      result.answerLang,
    );

    await this.#messenger?.sendMessage({
      chatId: message.chat.id,
      text: formattedText,
      replyToMessageId: message.messageId,
    });

    const outcome: WebhookHandlingResult = {
      status: 'answered',
      answer: formattedText,
      rawAnswer: result.answerText,
      citations: result.citations,
      kind: result.kind,
      lang: result.answerLang,
      answerLang: result.answerLang,
      provider: result.provider,
      requestId,
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

    return outcome;
  }
}
