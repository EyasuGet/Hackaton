// Application service for Telegram identity linking, tutoring answers, and job alerts (T3-012-A / T3-012-B / T3-019-C / T3-020-B / T3-013-A).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { JobAnswers, JobCitation } from '../../careers/application/job-answers.ts';
import type { JobPreferencesRepository } from '../../careers/application/ports/job-preferences-repository.ts';
import type { ContentAccess } from '../../content/application/content-access.ts';
import { ownedScope, type Principal } from '../../identity/domain/principal.ts';
import type { TranscriptionPort } from '../../tutoring/application/ports/transcription-port.ts';
import type { SpeechSynthesizerProvider } from '../../tutoring/application/ports/speech-synthesizer-provider.ts';
import type { ProviderAdmissionController } from '../../tutoring/application/provider-admission.ts';
import type { Help } from '../../help/application/help.ts';
import {
  TutoringError,
  type AnswerResult,
  type Tutoring,
} from '../../tutoring/application/tutoring.ts';
import { labelQuote, type FaqCitation } from '../../tutoring/domain/faq.ts';
import {
  formatTelegramTutorResponse,
  isPrivateChat,
  type PendingVoiceReview,
  type TelegramIdentity,
  type TelegramUpdate,
} from '../domain/telegram-identity.ts';
import { detectAudioMimeType } from './audio-sniffer.ts';
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
  readonly transcription?: TranscriptionPort | undefined;
  readonly speechProvider?: SpeechSynthesizerProvider | undefined;
  readonly admissionController?: ProviderAdmissionController | undefined;
  readonly help?: Help | undefined;
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
  readonly speechEnabled?: boolean | undefined;
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
      readonly reason:
        | 'group_chats_not_allowed'
        | 'bots_not_allowed'
        | 'course_not_granted'
        | 'unauthorized_callback'
        | 'review_expired_or_processed';
    }
  | {
      readonly status: 'voice_prompt';
      readonly reviewId: string;
      readonly transcript: string;
      readonly detectedLang?: 'en' | 'am' | 'unknown' | undefined;
    }
  | {
      readonly status: 'voice_error';
      readonly reason:
        | 'voice_too_long'
        | 'voice_too_large'
        | 'voice_unsupported_format'
        | 'voice_empty'
        | 'voice_transcription_failed'
        | 'voice_download_failed';
      readonly message: string;
    }
  | {
      readonly status: 'voice_reviewed';
      readonly action: 'approved' | 'discarded' | 'awaiting_edit';
      readonly reviewId: string;
      readonly question?: string | undefined;
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
      readonly provider?: 'online' | 'faq' | 'job' | 'local' | undefined;
      readonly requestId?: string | undefined;
      readonly matchedJobId?: string | undefined;
      readonly replayed?: boolean | undefined;
    }
  | {
      readonly status: 'preference_updated';
      readonly externalConsent?: boolean | undefined;
      readonly activeCourseId?: string | undefined;
      readonly speechEnabled?: boolean | undefined;
    }
  | {
      readonly status: 'speech_sent';
      readonly updateId: number;
      readonly messageId?: number | undefined;
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
  | {
      readonly status: 'help_preview';
      readonly contextId: string;
      readonly question?: string | undefined;
    }
  | {
      readonly status: 'help_submitted';
      readonly helpRequestId?: string | undefined;
    }
  | {
      readonly status: 'help_cancelled';
    }
  | {
      readonly status: 'help_instructions';
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
  readonly #transcription?: TranscriptionPort | undefined;
  readonly #speechProvider?: SpeechSynthesizerProvider | undefined;
  readonly #admissionController?: ProviderAdmissionController | undefined;
  readonly #help?: Help | undefined;
  readonly #now: () => Date;
  readonly #pendingHelpContexts = new Map<
    string,
    {
      learnerId: string;
      courseId: string;
      question: string;
      answerText?: string;
      timestamp: number;
    }
  >();

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
    this.#transcription = options.transcription;
    this.#speechProvider = options.speechProvider;
    this.#admissionController = options.admissionController;
    this.#help = options.help;
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

  get transcription(): TranscriptionPort | undefined {
    return this.#transcription;
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
      ...(identity.speechEnabled !== undefined ? { speechEnabled: identity.speechEnabled } : {}),
    };
  }

  async setPreferences(
    learner: Principal,
    preferences: {
      readonly externalConsent?: boolean;
      readonly activeCourseId?: string;
      readonly speechEnabled?: boolean;
    },
  ): Promise<TelegramIdentity | null> {
    if (learner.role !== 'learner') return null;
    return this.#repository.setPreferences(learner.id, preferences);
  }

  async #synthesizeSpeech(
    text: string,
    lang: 'en' | 'am',
    principalId?: string,
  ): Promise<Buffer | null> {
    if (!this.#speechProvider || !this.#speechProvider.isAvailable()) {
      return null;
    }

    if (this.#admissionController) {
      if (text.length > this.#admissionController.limits.maxSpeechTextLength) {
        throw new Error(
          `Speech text exceeds maximum allowed length of ${this.#admissionController.limits.maxSpeechTextLength} characters`,
        );
      }
    }

    let lease;
    if (this.#admissionController && principalId) {
      lease = await this.#admissionController.acquire(principalId);
    }

    try {
      const buffer = await this.#speechProvider.synthesize({
        text,
        language: lang,
      });
      return buffer;
    } finally {
      lease?.release();
    }
  }

  async #tryDeliverSpeech(params: {
    chatId: string | number;
    text: string;
    lang: 'en' | 'am';
    replyToMessageId?: number | undefined;
    principalId?: string | undefined;
  }): Promise<{ ok: boolean; messageId?: number }> {
    if (
      !this.#speechProvider ||
      !this.#speechProvider.isAvailable() ||
      !this.#telegramClient?.sendVoice
    ) {
      return { ok: false };
    }

    let audioBuffer: Buffer | null = null;
    try {
      audioBuffer = await this.#synthesizeSpeech(params.text, params.lang, params.principalId);
      if (!audioBuffer) return { ok: false };

      const res = await this.#telegramClient.sendVoice({
        chatId: params.chatId,
        voice: audioBuffer,
        replyToMessageId: params.replyToMessageId,
      });
      return { ok: res.ok, ...(res.messageId !== undefined ? { messageId: res.messageId } : {}) };
    } catch {
      return { ok: false };
    } finally {
      if (audioBuffer) {
        audioBuffer.fill(0);
      }
    }
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

      // Human help request preview callback (T3-041)
      const helpAskMatch = /^hlp:ask:([a-zA-Z0-9_-]+)$/i.exec(cb.data ?? '');
      if (helpAskMatch) {
        const contextId = helpAskMatch[1]!;
        const principal = await this.resolveLearner(cb.from.id);
        if (!principal) {
          await this.#telegramClient?.answerCallbackQuery?.({
            callbackQueryId: cb.id,
            text: 'No active linked account found.',
          });
          return { status: 'unauthenticated' };
        }

        const identity = await this.#repository.findIdentityByTelegramUserId(String(cb.from.id));
        if (!identity || identity.revokedAt) {
          await this.#telegramClient?.answerCallbackQuery?.({
            callbackQueryId: cb.id,
            text: 'Linked account has been revoked.',
          });
          return { status: 'unauthenticated' };
        }

        const context = this.#pendingHelpContexts.get(contextId);
        const courseId =
          context?.courseId ??
          identity.activeCourseId ??
          principal.courseIds[0] ??
          'course-alx-foundations';
        const question = context?.question ?? 'Course question';

        await this.#telegramClient?.answerCallbackQuery?.({
          callbackQueryId: cb.id,
          text: 'Opening help preview...',
        });

        const previewText = [
          '👤 Human Help Request Preview / የሰው ድጋፍ ቅድመ-እይታ:',
          '',
          'Only you and an authorized support coordinator will see this request.',
          'Context shared with support:',
          `• Course: ${courseId}`,
          `• Question: "${question}"`,
          '',
          'Do you want to submit this request to support?',
          'ጥያቄውን ወደ ድጋፍ ሰራተኞች ለመላክ ያረጋግጡ፡',
        ].join('\n');

        const markup = {
          inline_keyboard: [
            [
              { text: '✅ Confirm & Send / አረጋግጥና ላክ', callback_data: `hlp:send:${contextId}` },
              { text: '❌ Cancel / ሰርዝ', callback_data: `hlp:cancel:${contextId}` },
            ],
          ],
        };

        if (this.#telegramClient && cb.message?.chat.id) {
          await this.#telegramClient.sendMessage({
            chatId: String(cb.message.chat.id),
            text: previewText,
            replyMarkup: markup,
          });
        } else if (this.#messenger && cb.message?.chat.id) {
          await this.#messenger.sendMessage({
            chatId: cb.message.chat.id,
            text: previewText,
            replyMarkup: markup,
          });
        }

        return { status: 'help_preview', contextId, question };
      }

      // Human help submit confirmation callback (T3-041)
      const helpSendMatch = /^hlp:send:([a-zA-Z0-9_-]+)$/i.exec(cb.data ?? '');
      if (helpSendMatch) {
        const contextId = helpSendMatch[1]!;
        const principal = await this.resolveLearner(cb.from.id);
        if (!principal) {
          await this.#telegramClient?.answerCallbackQuery?.({
            callbackQueryId: cb.id,
            text: 'No active linked account found.',
          });
          return { status: 'unauthenticated' };
        }

        const identity = await this.#repository.findIdentityByTelegramUserId(String(cb.from.id));
        if (!identity || identity.revokedAt) {
          await this.#telegramClient?.answerCallbackQuery?.({
            callbackQueryId: cb.id,
            text: 'Linked account has been revoked.',
          });
          return { status: 'unauthenticated' };
        }

        let helpRequestId: string | undefined;
        if (this.#help) {
          const context = this.#pendingHelpContexts.get(contextId);
          const courseId =
            context?.courseId ??
            identity.activeCourseId ??
            principal.courseIds[0] ??
            'course-alx-foundations';
          const question = context?.question ?? 'Telegram assistance inquiry';
          const clientRequestId = `tg-help-${contextId}-${this.#now().getTime()}`;
          const contextSnapshot = `Telegram help request for course ${courseId}: "${question}"`;
          const submitRes = await this.#help.submit(principal, {
            clientRequestId,
            contextSnapshot,
          });
          if (submitRes) {
            helpRequestId = submitRes.request.id;
          }
          await this.#help.optIn(principal, 'telegram');
        }

        await this.#telegramClient?.answerCallbackQuery?.({
          callbackQueryId: cb.id,
          text: 'Help request submitted.',
        });

        const confirmNotice = [
          '✅ Your help request has been submitted to the support queue.',
          'A support coordinator will reply to you here in Telegram chat.',
          '',
          'የድጋፍ ጥያቄዎ ደርሷል። የድጋፍ ሰራተኛ በቴሌግራም መልስ ይሰጥዎታል።',
        ].join('\n');

        if (this.#telegramClient && cb.message?.chat.id) {
          await this.#telegramClient.sendMessage({
            chatId: String(cb.message.chat.id),
            text: confirmNotice,
          });
        } else if (this.#messenger && cb.message?.chat.id) {
          await this.#messenger.sendMessage({
            chatId: cb.message.chat.id,
            text: confirmNotice,
          });
        }

        this.#pendingHelpContexts.delete(contextId);
        return { status: 'help_submitted', helpRequestId };
      }

      // Human help cancel callback (T3-041)
      const helpCancelMatch = /^hlp:cancel:([a-zA-Z0-9_-]+)$/i.exec(cb.data ?? '');
      if (helpCancelMatch) {
        const contextId = helpCancelMatch[1]!;
        await this.#telegramClient?.answerCallbackQuery?.({
          callbackQueryId: cb.id,
          text: 'Help request cancelled.',
        });

        const cancelNotice = [
          '❌ Help request cancelled. No information was shared.',
          '',
          'የድጋፍ ጥያቄው ተሰርዟል። ምንም መረጃ አልተጋራም።',
        ].join('\n');

        if (this.#telegramClient && cb.message?.chat.id) {
          await this.#telegramClient.sendMessage({
            chatId: String(cb.message.chat.id),
            text: cancelNotice,
          });
        } else if (this.#messenger && cb.message?.chat.id) {
          await this.#messenger.sendMessage({
            chatId: cb.message.chat.id,
            text: cancelNotice,
          });
        }

        this.#pendingHelpContexts.delete(contextId);
        return { status: 'help_cancelled' };
      }

      // On-demand speech synthesis callback (T3-013-B)
      const speechMatch = /^ts:(\d+)$/i.exec(cb.data ?? '');
      if (speechMatch) {
        const targetUpdateId = parseInt(speechMatch[1]!, 10);
        const principal = await this.resolveLearner(cb.from.id);
        if (!principal) {
          await this.#telegramClient?.answerCallbackQuery?.({
            callbackQueryId: cb.id,
            text: 'No active linked account found.',
          });
          return { status: 'unauthenticated' };
        }

        const cached = await this.#repository.findProcessedUpdate(targetUpdateId);
        if (!cached || !cached.responsePayload) {
          await this.#telegramClient?.answerCallbackQuery?.({
            callbackQueryId: cb.id,
            text: 'Answer audio is no longer available.',
          });
          return { status: 'rejected', reason: 'review_expired_or_processed' };
        }

        const payload = cached.responsePayload;
        const rawAnswer =
          typeof payload.rawAnswer === 'string'
            ? payload.rawAnswer
            : typeof payload.answer === 'string'
              ? payload.answer
              : '';
        const lang: 'en' | 'am' =
          payload.lang === 'am' || payload.answerLang === 'am' ? 'am' : 'en';

        if (
          !this.#speechProvider ||
          !this.#speechProvider.isAvailable() ||
          !this.#telegramClient?.sendVoice
        ) {
          await this.#telegramClient?.answerCallbackQuery?.({
            callbackQueryId: cb.id,
            text:
              lang === 'am'
                ? 'የድምፅ አገልግሎት ለጊዜው አይገኝም'
                : 'Speech synthesis is currently unavailable.',
          });
          return { status: 'rejected', reason: 'unauthorized_callback' };
        }

        let audioBuffer: Buffer | null = null;
        try {
          audioBuffer = await this.#synthesizeSpeech(rawAnswer, lang, principal.id);
          if (!audioBuffer) {
            await this.#telegramClient?.answerCallbackQuery?.({
              callbackQueryId: cb.id,
              text:
                lang === 'am'
                  ? 'የድምፅ አገልግሎት ለጊዜው አይገኝም'
                  : 'Speech synthesis is currently unavailable.',
            });
            return { status: 'rejected', reason: 'unauthorized_callback' };
          }

          const sendRes = await this.#telegramClient.sendVoice({
            chatId: cb.message?.chat.id ?? cb.from.id,
            voice: audioBuffer,
            replyToMessageId: cb.message?.messageId,
          });

          await this.#telegramClient.answerCallbackQuery?.({
            callbackQueryId: cb.id,
            text: lang === 'am' ? 'ድምፅ ተልኳል' : 'Audio sent',
          });

          return {
            status: 'speech_sent',
            updateId: targetUpdateId,
            ...(sendRes.messageId !== undefined ? { messageId: sendRes.messageId } : {}),
          };
        } catch {
          await this.#telegramClient?.answerCallbackQuery?.({
            callbackQueryId: cb.id,
            text: lang === 'am' ? 'ድምፅ ማመንጨት አልተሳካም' : 'Could not generate speech audio.',
          });
          return { status: 'rejected', reason: 'unauthorized_callback' };
        } finally {
          if (audioBuffer) {
            audioBuffer.fill(0);
          }
        }
      }

      // Voice review actions (T3-013-A)
      const voiceReviewMatch = /^vt:(a|d|e):([a-f0-9-]+)$/i.exec(cb.data ?? '');
      if (voiceReviewMatch) {
        const actionCode = voiceReviewMatch[1]!.toLowerCase();
        const reviewId = voiceReviewMatch[2]!;

        const review = await this.#repository.findVoiceReview(reviewId);
        if (!review || review.expiresAt <= this.#now()) {
          await this.#telegramClient?.answerCallbackQuery?.({
            callbackQueryId: cb.id,
            text: 'This voice review request has expired or does not exist.',
          });
          return { status: 'rejected', reason: 'review_expired_or_processed' };
        }

        // Ownership verification (cross-user callback forgery prevention)
        if (review.telegramUserId !== String(cb.from.id)) {
          await this.#telegramClient?.answerCallbackQuery?.({
            callbackQueryId: cb.id,
            text: "Unauthorized: You cannot review another user's voice transcript.",
          });
          return { status: 'rejected', reason: 'unauthorized_callback' };
        }

        if (actionCode === 'd') {
          // Discard
          const success = await this.#repository.resolveVoiceReview(
            reviewId,
            'discarded',
            this.#now(),
          );
          if (!success) {
            await this.#telegramClient?.answerCallbackQuery?.({
              callbackQueryId: cb.id,
              text: 'This review request has already been processed or expired.',
            });
            return { status: 'rejected', reason: 'review_expired_or_processed' };
          }
          await this.#telegramClient?.answerCallbackQuery?.({
            callbackQueryId: cb.id,
            text: 'Transcript discarded.',
          });
          if (this.#messenger) {
            await this.#messenger.sendMessage({
              chatId: review.telegramChatId,
              text: 'Voice transcript discarded.',
            });
          }
          return { status: 'voice_reviewed', action: 'discarded', reviewId };
        }

        if (actionCode === 'e') {
          // Edit
          const success = await this.#repository.resolveVoiceReview(
            reviewId,
            'awaiting_edit',
            this.#now(),
          );
          if (!success) {
            await this.#telegramClient?.answerCallbackQuery?.({
              callbackQueryId: cb.id,
              text: 'This review request has already been processed or expired.',
            });
            return { status: 'rejected', reason: 'review_expired_or_processed' };
          }
          await this.#telegramClient?.answerCallbackQuery?.({
            callbackQueryId: cb.id,
            text: 'Ready for edit.',
          });
          if (this.#messenger) {
            await this.#messenger.sendMessage({
              chatId: review.telegramChatId,
              text: `Current transcript: "${review.transcript}"\n\nPlease send your edited question in chat:`,
            });
          }
          return { status: 'voice_reviewed', action: 'awaiting_edit', reviewId };
        }

        if (actionCode === 'a') {
          // Approve
          const success = await this.#repository.resolveVoiceReview(
            reviewId,
            'approved',
            this.#now(),
          );
          if (!success) {
            await this.#telegramClient?.answerCallbackQuery?.({
              callbackQueryId: cb.id,
              text: 'This review request has already been processed or expired.',
            });
            return { status: 'rejected', reason: 'review_expired_or_processed' };
          }
          await this.#telegramClient?.answerCallbackQuery?.({
            callbackQueryId: cb.id,
            text: 'Question submitted.',
          });

          const principal = await this.resolveLearner(cb.from.id);
          if (!principal) {
            return { status: 'unauthenticated' };
          }
          const identity = await this.#repository.findIdentityByTelegramUserId(String(cb.from.id));
          const activeCourse =
            identity?.activeCourseId && principal.courseIds.includes(identity.activeCourseId)
              ? identity.activeCourseId
              : review.courseId || principal.courseIds[0];

          const isAmharic = /[\u1200-\u137F]/.test(review.transcript);
          const lang: 'en' | 'am' = isAmharic ? 'am' : 'en';

          if (!activeCourse) {
            const refusalText = HONEST_LIMITATIONS[lang];
            await this.#messenger?.sendMessage({
              chatId: review.telegramChatId,
              text: refusalText,
            });
            return {
              status: 'answered',
              answer: refusalText,
              citations: [],
              kind: 'insufficient_evidence',
              lang,
            };
          }

          if (this.#jobAnswers && this.#jobAnswers.isJobQuestion(review.transcript)) {
            const jobResult = await this.#jobAnswers.answer(
              principal,
              review.transcript,
              this.#now(),
            );
            if (this.#sender) {
              await this.#sender.sendMessage({
                chatId: review.telegramChatId,
                text: jobResult.answerText,
              });
            } else if (this.#messenger) {
              await this.#messenger.sendMessage({
                chatId: review.telegramChatId,
                text: jobResult.answerText,
              });
            }
            return {
              status: 'answered',
              answer: jobResult.answerText,
              citations: jobResult.citations,
              kind: jobResult.kind,
              answerLang: jobResult.answerLang,
              lang: jobResult.answerLang,
              matchedJobId: jobResult.matchedJobId,
            };
          }

          if (this.#tutoring) {
            const externalConsent = identity?.externalConsent === true;
            const requestId = `telegram-voice-${reviewId}`;
            const tutorRes = await this.#tutoring.ask(principal, {
              courseId: activeCourse,
              requestId,
              question: review.transcript,
              externalConsent,
            });

            if (!tutorRes) {
              return {
                status: 'voice_reviewed',
                action: 'approved',
                reviewId,
                question: review.transcript,
              };
            }

            const formatted = formatTelegramTutorResponse(
              labelQuote(tutorRes.answerText, tutorRes.answerLang, tutorRes.quoted),
              tutorRes.citations.map((c) => ({
                sourceId: c.sourceId,
                sectionId: c.sectionId,
                sourceTitle: c.sourceTitle,
                heading: c.heading,
              })),
              tutorRes.answerLang,
            );

            const helpContextId = randomUUID();
            this.#pendingHelpContexts.set(helpContextId, {
              learnerId: principal.id,
              courseId: activeCourse,
              question: review.transcript,
              answerText: tutorRes.answerText,
              timestamp: this.#now().getTime(),
            });

            const speechEnabled = identity?.speechEnabled === true;
            const markupRows: Array<Array<{ text: string; callback_data: string }>> = [];
            if (
              !speechEnabled &&
              this.#speechProvider?.isAvailable() &&
              update.updateId &&
              update.updateId > 0
            ) {
              markupRows.push([
                {
                  text: tutorRes.answerLang === 'am' ? '🔊 አዳምጥ' : '🔊 Listen',
                  callback_data: `ts:${update.updateId}`,
                },
              ]);
            }
            markupRows.push([
              {
                text: tutorRes.answerLang === 'am' ? '👤 ሰው ያነጋግሩ' : '👤 Talk to a person',
                callback_data: `hlp:ask:${helpContextId}`,
              },
            ]);
            const voiceAnswerMarkup = { inline_keyboard: markupRows };

            let sentMsgId: number | undefined;
            if (this.#telegramClient) {
              const res = await this.#telegramClient.sendMessage({
                chatId: review.telegramChatId,
                text: formatted,
                replyMarkup: voiceAnswerMarkup,
              });
              if (res.ok) sentMsgId = res.messageId;
            } else if (this.#messenger) {
              const res = await this.#messenger.sendMessage({
                chatId: review.telegramChatId,
                text: formatted,
                replyMarkup: voiceAnswerMarkup,
              });
              sentMsgId = res.messageId;
            } else if (this.#sender) {
              await this.#sender.sendMessage({
                chatId: review.telegramChatId,
                text: formatted,
              });
            }

            if (speechEnabled) {
              await this.#tryDeliverSpeech({
                chatId: review.telegramChatId,
                text: tutorRes.answerText,
                lang: tutorRes.answerLang,
                replyToMessageId: sentMsgId,
                principalId: principal.id,
              });
            }

            const outcome: WebhookHandlingResult = {
              status: 'answered',
              answer: formatted,
              rawAnswer: tutorRes.answerText,
              citations: tutorRes.citations,
              kind: tutorRes.kind,
              lang: tutorRes.answerLang,
              answerLang: tutorRes.answerLang,
              provider: tutorRes.provider,
              requestId,
            };

            if (update.updateId && update.updateId > 0) {
              await this.#repository.recordProcessedUpdate({
                updateId: update.updateId,
                telegramUserId: String(cb.from.id),
                responseStatus: 'answered',
                responsePayload: outcome,
                now: this.#now(),
              });
            }

            return outcome;
          }

          return {
            status: 'voice_reviewed',
            action: 'approved',
            reviewId,
            question: review.transcript,
          };
        }
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

    // Voice message handling (T3-013-A)
    if (message.voice) {
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

      // Rate limit check
      const rateCheck = this.#rateLimiter.consume(String(message.from.id));
      if (!rateCheck.allowed) {
        const msg = 'Too many requests. Please wait a moment before trying again.';
        return {
          status: 'rate_limited',
          message: msg,
          retryAfterSec: rateCheck.retryAfterSec,
        };
      }

      // Voice bounds check (anti-DoS)
      if (message.voice.duration > 120) {
        const errorMsg = 'Voice message too long. Please keep voice questions under 2 minutes.';
        await this.#messenger?.sendMessage({
          chatId: message.chat.id,
          text: errorMsg,
          replyToMessageId: message.messageId,
        });
        return {
          status: 'voice_error',
          reason: 'voice_too_long',
          message: errorMsg,
        };
      }

      if (message.voice.file_size && message.voice.file_size > 10 * 1024 * 1024) {
        const errorMsg = 'Voice message exceeds maximum size limit (10 MB).';
        await this.#messenger?.sendMessage({
          chatId: message.chat.id,
          text: errorMsg,
          replyToMessageId: message.messageId,
        });
        return {
          status: 'voice_error',
          reason: 'voice_too_large',
          message: errorMsg,
        };
      }

      if (!this.#telegramClient?.getFile || !this.#telegramClient?.downloadFile) {
        const errorMsg = 'Voice processing is currently unavailable.';
        await this.#messenger?.sendMessage({
          chatId: message.chat.id,
          text: errorMsg,
          replyToMessageId: message.messageId,
        });
        return {
          status: 'voice_error',
          reason: 'voice_download_failed',
          message: 'TelegramClient file methods not configured',
        };
      }

      const fileInfo = await this.#telegramClient.getFile(message.voice.file_id);
      if (!fileInfo.ok || !fileInfo.filePath) {
        const errorMsg =
          'Could not download voice message. Please try again or type your question.';
        await this.#messenger?.sendMessage({
          chatId: message.chat.id,
          text: errorMsg,
          replyToMessageId: message.messageId,
        });
        return {
          status: 'voice_error',
          reason: 'voice_download_failed',
          message: fileInfo.error ?? 'Missing file path',
        };
      }

      let rawAudio: Uint8Array | null = null;
      try {
        rawAudio = await this.#telegramClient.downloadFile(fileInfo.filePath);
        if (!rawAudio || rawAudio.length === 0) {
          const errorMsg = 'Voice message was empty. Please try recording again.';
          await this.#messenger?.sendMessage({
            chatId: message.chat.id,
            text: errorMsg,
            replyToMessageId: message.messageId,
          });
          return {
            status: 'voice_error',
            reason: 'voice_empty',
            message: errorMsg,
          };
        }

        const detectedMime = detectAudioMimeType(rawAudio);
        if (!detectedMime) {
          const errorMsg =
            'Unsupported or unverified audio format. Please send a standard voice message or type your question.';
          await this.#messenger?.sendMessage({
            chatId: message.chat.id,
            text: errorMsg,
            replyToMessageId: message.messageId,
          });
          return {
            status: 'voice_error',
            reason: 'voice_unsupported_format',
            message: errorMsg,
          };
        }

        if (!this.#transcription) {
          const errorMsg =
            'Voice transcription is currently unavailable. Please type your question.';
          await this.#messenger?.sendMessage({
            chatId: message.chat.id,
            text: errorMsg,
            replyToMessageId: message.messageId,
          });
          return {
            status: 'voice_error',
            reason: 'voice_transcription_failed',
            message: errorMsg,
          };
        }

        const audioBase64 = Buffer.from(rawAudio).toString('base64');
        const outcome = await this.#transcription.transcribe({
          audioBase64,
          mimeType: detectedMime,
        });

        if (outcome.status !== 'transcribed' || !outcome.transcript.trim()) {
          const errorMsg =
            'Could not transcribe audio. Please try speaking clearly or typing your question.';
          await this.#messenger?.sendMessage({
            chatId: message.chat.id,
            text: errorMsg,
            replyToMessageId: message.messageId,
          });
          return {
            status: 'voice_error',
            reason: 'voice_transcription_failed',
            message: errorMsg,
          };
        }

        const reviewId = randomUUID();
        const identity = await this.#repository.findIdentityByTelegramUserId(
          String(message.from.id),
        );
        const activeCourse =
          identity?.activeCourseId && principal.courseIds.includes(identity.activeCourseId)
            ? identity.activeCourseId
            : (principal.courseIds[0] ?? 'course-1');

        const review: PendingVoiceReview = {
          id: reviewId,
          learnerId: principal.id,
          telegramUserId: String(message.from.id),
          telegramChatId: String(message.chat.id),
          courseId: activeCourse,
          transcript: outcome.transcript.trim(),
          status: 'pending',
          expiresAt: new Date(this.#now().getTime() + TELEGRAM_LINK_CODE_TTL_MS),
          createdAt: this.#now(),
        };
        await this.#repository.createVoiceReview(review);

        const promptText = `Voice transcript:\n\n"${review.transcript}"\n\nPlease choose an action:`;
        if (this.#telegramClient) {
          await this.#telegramClient.sendMessage({
            chatId: String(message.chat.id),
            text: promptText,
            replyMarkup: {
              inline_keyboard: [
                [
                  { text: 'Ask this question', callback_data: `vt:a:${reviewId}` },
                  { text: 'Edit', callback_data: `vt:e:${reviewId}` },
                  { text: 'Discard', callback_data: `vt:d:${reviewId}` },
                ],
              ],
            },
          });
        } else if (this.#messenger) {
          await this.#messenger.sendMessage({
            chatId: message.chat.id,
            text: promptText,
            replyToMessageId: message.messageId,
          });
        }

        const resultOutcome: WebhookHandlingResult = {
          status: 'voice_prompt',
          reviewId,
          transcript: review.transcript,
          detectedLang: outcome.detectedLang,
        };

        if (update.updateId && update.updateId > 0) {
          await this.#repository.recordProcessedUpdate({
            updateId: update.updateId,
            telegramUserId: String(message.from.id),
            responseStatus: 'voice_prompt',
            responsePayload: resultOutcome,
            now: this.#now(),
          });
        }

        return resultOutcome;
      } finally {
        if (rawAudio) {
          rawAudio.fill(0);
        }
      }
    }

    const text = message.text?.trim() ?? '';
    if (!text) {
      return { status: 'ignored' };
    }

    // Check if user has an active review in awaiting_edit status (T3-013-A)
    if (!text.startsWith('/')) {
      const awaitingReview = await this.#repository.findAwaitingEditReview(String(message.from.id));
      if (awaitingReview) {
        await this.#repository.resolveVoiceReview(awaitingReview.id, 'approved', this.#now(), text);
      }
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

    // 8.5. Handle help command: /help or /ድጋፍ (T3-041)
    const helpCmdMatch = /^(\/help|\/ድጋፍ)$/i.exec(text);
    if (helpCmdMatch) {
      const helpContextId = randomUUID();
      const course = identity?.activeCourseId ?? principal.courseIds[0] ?? 'course-alx-foundations';
      this.#pendingHelpContexts.set(helpContextId, {
        learnerId: principal.id,
        courseId: course,
        question: 'Help requested via /help command',
        timestamp: this.#now().getTime(),
      });
      const helpText = [
        'Need help from a person? You can escalate your question to a human coordinator.',
        'የሰው ድጋፍ ይፈልጋሉ? ጥያቄዎን ለድጋፍ ሰራተኛ ማስተላለፍ ይችላሉ።',
      ].join('\n');
      const markup = {
        inline_keyboard: [
          [
            {
              text: '👤 Talk to a person / ሰው ያነጋግሩ',
              callback_data: `hlp:ask:${helpContextId}`,
            },
          ],
        ],
      };
      if (this.#telegramClient) {
        await this.#telegramClient.sendMessage({
          chatId: String(message.chat.id),
          text: helpText,
          replyToMessageId: message.messageId,
          replyMarkup: markup,
        });
      } else if (this.#messenger) {
        await this.#messenger.sendMessage({
          chatId: message.chat.id,
          text: helpText,
          replyToMessageId: message.messageId,
          replyMarkup: markup,
        });
      }
      return { status: 'help_instructions' };
    }

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

    // 10b. Handle voice preference command: /voice [on|off] or /audio [on|off]
    const voiceCmdMatch = /^\/(?:voice|audio)(?:\s+(on|off|true|false|yes|no))?$/i.exec(text);
    if (voiceCmdMatch) {
      const toggle = voiceCmdMatch[1]?.toLowerCase();
      if (toggle === 'on' || toggle === 'true' || toggle === 'yes') {
        await this.#repository.setPreferences(principal.id, { speechEnabled: true });
        const notice =
          'Audio speech answers enabled. Tutor answers will be accompanied by a voice message.';
        await this.#messenger?.sendMessage({
          chatId: message.chat.id,
          text: notice,
          replyToMessageId: message.messageId,
        });
        return { status: 'preference_updated', speechEnabled: true };
      }
      if (toggle === 'off' || toggle === 'false' || toggle === 'no') {
        await this.#repository.setPreferences(principal.id, { speechEnabled: false });
        const notice =
          'Audio speech answers disabled. Tutor answers will only be sent as text with the 🔊 Listen button.';
        await this.#messenger?.sendMessage({
          chatId: message.chat.id,
          text: notice,
          replyToMessageId: message.messageId,
        });
        return { status: 'preference_updated', speechEnabled: false };
      }

      const current = identity?.speechEnabled === true;
      const notice = `Audio speech answers are currently ${current ? 'enabled' : 'disabled'}. Use /voice on or /voice off to change.`;
      await this.#messenger?.sendMessage({
        chatId: message.chat.id,
        text: notice,
        replyToMessageId: message.messageId,
      });
      return { status: 'preference_updated', speechEnabled: current };
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
      const helpContextId = randomUUID();
      this.#pendingHelpContexts.set(helpContextId, {
        learnerId: principal.id,
        courseId: activeCourse,
        question: text,
        answerText: refusalText,
        timestamp: this.#now().getTime(),
      });
      const refusalMarkup = {
        inline_keyboard: [
          [
            {
              text: lang === 'am' ? '👤 ሰው ያነጋግሩ' : '👤 Talk to a person',
              callback_data: `hlp:ask:${helpContextId}`,
            },
          ],
        ],
      };
      if (this.#telegramClient) {
        await this.#telegramClient.sendMessage({
          chatId: String(message.chat.id),
          text: refusalText,
          replyToMessageId: message.messageId,
          replyMarkup: refusalMarkup,
        });
      } else if (this.#messenger) {
        await this.#messenger.sendMessage({
          chatId: message.chat.id,
          text: refusalText,
          replyToMessageId: message.messageId,
          replyMarkup: refusalMarkup,
        });
      }
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
      labelQuote(result.answerText, result.answerLang, result.quoted),
      result.citations,
      result.answerLang,
    );

    const helpContextId = randomUUID();
    this.#pendingHelpContexts.set(helpContextId, {
      learnerId: principal.id,
      courseId: activeCourse,
      question: text,
      answerText: result.answerText,
      timestamp: this.#now().getTime(),
    });

    const speechEnabled = identity?.speechEnabled === true;
    const markupRows: Array<Array<{ text: string; callback_data: string }>> = [];
    if (
      !speechEnabled &&
      this.#speechProvider?.isAvailable() &&
      update.updateId &&
      update.updateId > 0
    ) {
      markupRows.push([
        {
          text: result.answerLang === 'am' ? '🔊 አዳምጥ' : '🔊 Listen',
          callback_data: `ts:${update.updateId}`,
        },
      ]);
    }
    markupRows.push([
      {
        text: result.answerLang === 'am' ? '👤 ሰው ያነጋግሩ' : '👤 Talk to a person',
        callback_data: `hlp:ask:${helpContextId}`,
      },
    ]);
    const answerMarkup = { inline_keyboard: markupRows };

    let sentMsgId: number | undefined;
    if (this.#telegramClient) {
      const res = await this.#telegramClient.sendMessage({
        chatId: String(message.chat.id),
        text: formattedText,
        replyToMessageId: message.messageId,
        replyMarkup: answerMarkup,
      });
      if (res.ok) sentMsgId = res.messageId;
    } else if (this.#messenger) {
      const res = await this.#messenger.sendMessage({
        chatId: message.chat.id,
        text: formattedText,
        replyToMessageId: message.messageId,
        replyMarkup: answerMarkup,
      });
      sentMsgId = res.messageId;
    }

    if (speechEnabled) {
      await this.#tryDeliverSpeech({
        chatId: message.chat.id,
        text: result.answerText,
        lang: result.answerLang,
        replyToMessageId: sentMsgId ?? message.messageId,
        principalId: principal.id,
      });
    }

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
