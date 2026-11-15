// Service for answering course questions over plain SMS (T3-040)
// and escalating to human support with HELP (T3-041).
// Strictly operates in FAQ mode only (no external AI processing over SMS).
// Enforces phone verification, per-destination rate limiting, and strict segment budgeting with pagination.

import type { PhoneVerificationRepository } from './ports/phone-verification-repository.ts';
import type { SmsAdapter } from './ports/sms-adapter.ts';
import type { Tutoring } from '../../tutoring/application/tutoring.ts';
import type { Help } from '../../help/application/help.ts';
import {
  type RateLimiter,
  SlidingWindowRateLimiter,
} from '../../telegram/application/rate-limiter.ts';
import type { SmsSuppressionRegistry } from '../infrastructure/afromessage-sms-adapter.ts';
import {
  checkSmsOptOut,
  parseAfroMessageInboundWebhook,
} from '../infrastructure/afromessage-sms-adapter.ts';
import { validateEthiopianPhoneNumber } from '../domain/phone-number.ts';
import { analyzeSmsText } from '../domain/sms-encoding.ts';
import type { Principal } from '../../identity/domain/principal.ts';
import { labelQuote, type FaqCitation } from '../../tutoring/domain/faq.ts';

export interface SmsTutorServiceOptions {
  readonly phoneVerificationRepository: PhoneVerificationRepository;
  readonly tutoring: Tutoring;
  readonly smsAdapter: SmsAdapter;
  readonly help?: Help | undefined;
  readonly rateLimiter?: RateLimiter | undefined;
  readonly suppressionRegistry?: SmsSuppressionRegistry | undefined;
  readonly maxSegmentsPerReply?: number | undefined;
  readonly defaultCourseId?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

export type SmsInboundStatus =
  | 'opt_out'
  | 'unverified_instructions'
  | 'rate_limited'
  | 'help_submitted'
  | 'more_sent'
  | 'more_empty'
  | 'answered'
  | 'limitation'
  | 'ignored'
  | 'rejected';

export interface SmsInboundResult {
  readonly status: SmsInboundStatus;
  readonly sender?: string | undefined;
  readonly reason?: string | undefined;
  readonly answerText?: string | undefined;
  readonly citations?: readonly FaqCitation[] | undefined;
  readonly paginated?: boolean | undefined;
  readonly helpRequestId?: string | undefined;
  readonly retryAfterSec?: number | undefined;
}

interface PaginationItem {
  readonly remainder: string;
  readonly courseId: string;
  readonly lang: 'en' | 'am';
  readonly timestamp: number;
}

const DEFAULT_COURSE_ID = 'course-alx-foundations';
const PAGINATION_TTL_MS = 60 * 60 * 1000; // 1 hour

const HELP_KEYWORDS = new Set(['HELP', 'HELP ME', 'HUMAN', 'SUPPORT', 'እርዳታ', 'ድጋፍ', 'ሰው']);

const MORE_KEYWORDS = new Set(['MORE', 'NEXT', 'ተጨማሪ', 'ቀጥል']);

export function isSmsHelpKeyword(text: string): boolean {
  const normalized = text.trim().toUpperCase();
  return HELP_KEYWORDS.has(normalized);
}

export function isSmsMoreKeyword(text: string): boolean {
  const normalized = text.trim().toUpperCase();
  return MORE_KEYWORDS.has(normalized);
}

export class SmsTutorService {
  readonly #phoneVerificationRepo: PhoneVerificationRepository;
  readonly #tutoring: Tutoring;
  readonly #smsAdapter: SmsAdapter;
  readonly #help: Help | undefined;
  readonly #rateLimiter: RateLimiter;
  readonly #suppressionRegistry: SmsSuppressionRegistry | undefined;
  readonly #maxSegmentsPerReply: number;
  readonly #defaultCourseId: string;
  readonly #now: () => Date;
  readonly #paginationCache = new Map<string, PaginationItem>();

  constructor(options: SmsTutorServiceOptions) {
    this.#phoneVerificationRepo = options.phoneVerificationRepository;
    this.#tutoring = options.tutoring;
    this.#smsAdapter = options.smsAdapter;
    this.#help = options.help;
    this.#rateLimiter =
      options.rateLimiter ?? new SlidingWindowRateLimiter(10, 60_000, options.now);
    this.#suppressionRegistry = options.suppressionRegistry;
    this.#maxSegmentsPerReply = options.maxSegmentsPerReply ?? 1;
    this.#defaultCourseId = options.defaultCourseId ?? DEFAULT_COURSE_ID;
    this.#now = options.now ?? (() => new Date());
  }

  get rateLimiter(): RateLimiter {
    return this.#rateLimiter;
  }

  async handleInboundMessage(payload: unknown): Promise<SmsInboundResult> {
    const parsed = parseAfroMessageInboundWebhook(payload);
    if (!parsed.sender || typeof parsed.message !== 'string') {
      return { status: 'ignored', reason: 'missing_sender_or_message' };
    }

    const recipientCheck = validateEthiopianPhoneNumber(parsed.sender);
    if (!recipientCheck.valid) {
      return { status: 'rejected', reason: recipientCheck.reason ?? 'invalid_phone' };
    }
    const sender = recipientCheck.normalized;
    const rawText = parsed.message.trim();

    // 1. Opt-out keyword handling (STOP / አቁም / ማቆም)
    const optOut = checkSmsOptOut(rawText);
    if (optOut.isOptOut) {
      if (this.#suppressionRegistry) {
        await this.#suppressionRegistry.suppress(
          sender,
          optOut.keyword ? `Opt-out keyword: ${optOut.keyword}` : 'Inbound opt-out',
        );
      }
      this.#paginationCache.delete(sender);
      await this.#smsAdapter.send({
        to: sender,
        message:
          'You have unsubscribed from Track 3 SMS. Reply START to resubscribe. / ከTrack 3 የኤስኤምኤስ አገልግሎት ተሰርዘዋል።',
      });
      return { status: 'opt_out', sender };
    }

    // 2. Phone verification check
    let principal: Principal | null = null;
    if (this.#phoneVerificationRepo.findPrincipalByPhoneNumber) {
      principal = await this.#phoneVerificationRepo.findPrincipalByPhoneNumber(sender);
    } else if (this.#phoneVerificationRepo.findLearnerByPhoneNumber) {
      const learnerId = await this.#phoneVerificationRepo.findLearnerByPhoneNumber(sender);
      if (learnerId) {
        principal = {
          id: learnerId,
          role: 'learner',
          label: 'SMS Learner',
          demo: false,
          courseIds: [this.#defaultCourseId],
        };
      }
    }

    if (!principal) {
      // Unverified numbers receive instructions only
      const instructions =
        'Welcome to Track 3. To ask course questions via SMS, please verify your phone on your web account: https://assistant.alxafrica.com\nእንኳን ወደ Track 3 በደህና መጡ። ጥያቄ ለመጠየቅ እባክዎ መጀመሪያ ስልክዎን በድህረ ገጻችን ያረጋግጡ።';
      await this.#smsAdapter.send({
        to: sender,
        message: instructions,
      });
      return { status: 'unverified_instructions', sender };
    }

    // 3. Per-number rate limiting
    const rateCheck = this.#rateLimiter.consume(sender);
    if (!rateCheck.allowed) {
      const rateNotice =
        'Rate limit reached. Please wait a few minutes before sending another question. / የጥያቄዎች ገደብ ደርሰዋል። እባክዎ ጥቂት ደቂቃዎች ቆይተው እንደገና ይሞክሩ።';
      await this.#smsAdapter.send({
        to: sender,
        message: rateNotice,
      });
      return {
        status: 'rate_limited',
        sender,
        retryAfterSec: rateCheck.retryAfterSec,
      };
    }

    // 4. Human Help escalation (HELP / እርዳታ)
    if (isSmsHelpKeyword(rawText)) {
      let helpRequestId: string | undefined;
      if (this.#help) {
        const clientRequestId = `sms-help-${sender}-${this.#now().getTime()}`;
        const submitResult = await this.#help.submit(principal, {
          clientRequestId,
          contextSnapshot: `Inbound SMS human help request from ${sender}: "${rawText}"`,
        });
        if (submitResult) {
          helpRequestId = submitResult.request.id;
        }
      }

      const confirmation =
        'Your help request has been received. A support coordinator will reply shortly. / የድጋፍ ጥያቄዎ ደርሶናል። የድጋፍ ሰራተኛ በቅርቡ ያነጋግርዎታል።';
      await this.#smsAdapter.send({
        to: sender,
        message: confirmation,
      });
      return { status: 'help_submitted', sender, helpRequestId };
    }

    // 5. Pagination continuation (MORE / ተጨማሪ)
    if (isSmsMoreKeyword(rawText)) {
      const cached = this.#paginationCache.get(sender);
      if (!cached || this.#now().getTime() - cached.timestamp > PAGINATION_TTL_MS) {
        this.#paginationCache.delete(sender);
        const emptyNotice =
          'No further parts to show. Send a new course question anytime. / ተጨማሪ ክፍል የለም። አዲስ የትምህርት ጥያቄ መላክ ይችላሉ።';
        await this.#smsAdapter.send({
          to: sender,
          message: emptyNotice,
        });
        return { status: 'more_empty', sender };
      }

      const { chunk, remainder } = this.#splitForBudget(
        cached.remainder,
        cached.lang,
        this.#maxSegmentsPerReply,
      );

      if (remainder.length > 0) {
        this.#paginationCache.set(sender, {
          remainder,
          courseId: cached.courseId,
          lang: cached.lang,
          timestamp: this.#now().getTime(),
        });
      } else {
        this.#paginationCache.delete(sender);
      }

      await this.#smsAdapter.send({
        to: sender,
        message: chunk,
      });

      return {
        status: 'more_sent',
        sender,
        answerText: chunk,
        paginated: remainder.length > 0,
      };
    }

    // 6. Course Question Answering (FAQ mode only)
    const courseId =
      principal.courseIds.length > 0 ? principal.courseIds[0]! : this.#defaultCourseId;

    const answerOutcome = await this.#tutoring.ask(principal, {
      question: rawText,
      courseId,
      externalConsent: false, // Strictly FAQ mode only! No external AI over SMS.
      requestId: `sms-q-${sender}-${this.#now().getTime()}`,
    });

    if (
      !answerOutcome ||
      !answerOutcome.answerText ||
      answerOutcome.kind === 'insufficient_evidence' ||
      answerOutcome.citations.length === 0
    ) {
      const limitation =
        'I could not find an approved answer for this question in course materials. Reply HELP to ask a human coordinator.\nበትምህርት ክፍለ ጊዜው ውስጥ ለዚህ ጥያቄ የተረጋገጠ መልስ አልተገኘም። የሰው ድጋፍ ለመጠየቅ HELP ብለው ይመልሱ።';
      await this.#smsAdapter.send({
        to: sender,
        message: limitation,
      });
      return { status: 'limitation', sender, answerText: limitation };
    }

    // Format citation code at the end (e.g. [L2-3])
    const shortCitation =
      answerOutcome.citations.length > 0
        ? ` [${answerOutcome.citations[0]!.sectionId ?? 'L2-3'}]`
        : '';
    const lang = answerOutcome.answerLang === 'am' ? 'am' : 'en';
    const answerText = labelQuote(answerOutcome.answerText.trim(), lang, answerOutcome.quoted);
    const fullAnswer = `${answerText}${shortCitation}`;

    // Segment budgeting
    const { chunk, remainder } = this.#splitForBudget(fullAnswer, lang, this.#maxSegmentsPerReply);

    if (remainder.length > 0) {
      this.#paginationCache.set(sender, {
        remainder,
        courseId,
        lang,
        timestamp: this.#now().getTime(),
      });
    } else {
      this.#paginationCache.delete(sender);
    }

    await this.#smsAdapter.send({
      to: sender,
      message: chunk,
    });

    return {
      status: 'answered',
      sender,
      answerText: chunk,
      citations: answerOutcome.citations,
      paginated: remainder.length > 0,
    };
  }

  /**
   * Splits an answer into a segment-budgeted chunk and an optional remainder.
   * In single-segment budget: GSM-7 is 160 chars; UCS-2 is 70 chars.
   */
  #splitForBudget(
    text: string,
    lang: 'en' | 'am',
    budgetSegments: number,
  ): { chunk: string; remainder: string } {
    const analysis = analyzeSmsText(text, 10);
    const segmentCapacity = analysis.hasUnicode ? 70 : 160;
    const totalBudget = segmentCapacity * budgetSegments;

    if (text.length <= totalBudget) {
      return { chunk: text, remainder: '' };
    }

    const morePrompt = lang === 'am' ? '\nተጨማሪ ለማንበብ MORE ብለው ይመልሱ' : '\nReply MORE for next part';

    const maxBodyLen = totalBudget - morePrompt.length;
    if (maxBodyLen <= 10) {
      return { chunk: text.slice(0, totalBudget), remainder: text.slice(totalBudget) };
    }

    // Try to cut at whitespace
    let cutIndex = text.lastIndexOf(' ', maxBodyLen);
    if (cutIndex <= maxBodyLen / 2) {
      cutIndex = maxBodyLen;
    }

    const chunkBody = text.slice(0, cutIndex).trim();
    const remainder = text.slice(cutIndex).trim();

    return {
      chunk: `${chunkBody}${morePrompt}`,
      remainder,
    };
  }
}
