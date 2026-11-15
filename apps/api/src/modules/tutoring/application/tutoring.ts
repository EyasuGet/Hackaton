// Tutoring use cases enforcing the learner-owned access rule.
// Non-learner principals have no scope and receive null or empty results.
// Integrates FaqProvider and OnlineAnswerProvider with explicit consent,
// authorized retrieval, and truthful failure/limitation states (T3-007-A & T3-007-C).
import type { JobAnswers } from '../../careers/application/job-answers.ts';
import type { ContentAccess } from '../../content/application/content-access.ts';
import { ownedScope, type OwnedScope, type Principal } from '../../identity/domain/principal.ts';
import type { TutoringConversation } from '../domain/conversation.ts';
import type { FaqAnswerResult, FaqCitation } from '../domain/faq.ts';
import type { TutoringRequest } from '../domain/tutoring-request.ts';
import type { FaqProvider } from './faq-provider.ts';
import type { OnlineAnswerProvider, OnlineAnswerResponse } from './ports/online-answer-provider.ts';
import type {
  ClaimRequestInput,
  ClaimResult,
  RecordOutcomeInput,
  TutoringRepository,
} from './ports/tutoring-repository.ts';
import {
  ProviderAdmissionController,
  ProviderAdmissionError,
  type AdmissionLease,
} from './provider-admission.ts';

export type TutoringErrorCode =
  | 'invented_citation'
  | 'unsupported_output'
  | 'timeout'
  | 'provider_error'
  | 'unverified_citation'
  | 'busy'
  | 'rate_limited'
  | 'input_too_large';

export class TutoringError extends Error {
  readonly code: TutoringErrorCode;
  readonly retryAfterSeconds?: number | undefined;

  constructor(code: TutoringErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'TutoringError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface AskAnswerInput extends ClaimRequestInput {
  readonly externalConsent?: boolean;
}

export interface AnswerResult {
  readonly request: TutoringRequest;
  readonly answerText: string;
  readonly answerLang: 'en' | 'am';
  readonly kind: 'answered' | 'insufficient_evidence';
  readonly provider: 'online' | 'faq' | 'job';
  readonly citations: readonly FaqCitation[];
}

export interface AskFaqResult {
  readonly request: TutoringRequest;
  readonly faqResult: FaqAnswerResult;
}

const HONEST_LIMITATIONS = {
  en: 'I do not have an approved course answer for that question in the materials.',
  am: 'በተሰጠው የትምህርት መረጃ ውስጥ ለቀረበው ጥያቄ የተረጋገጠ መልስ አልተገኘም።',
} as const;

export class Tutoring {
  readonly #repository: TutoringRepository;
  readonly #faqProvider: FaqProvider | undefined;
  readonly #onlineProvider: OnlineAnswerProvider | undefined;
  readonly #content: ContentAccess | undefined;
  readonly #admissionController: ProviderAdmissionController;
  readonly #jobAnswers: JobAnswers | undefined;

  constructor(
    repository: TutoringRepository,
    faqProvider?: FaqProvider,
    onlineProvider?: OnlineAnswerProvider,
    content?: ContentAccess,
    admissionController?: ProviderAdmissionController,
    jobAnswers?: JobAnswers,
  ) {
    this.#repository = repository;
    this.#faqProvider = faqProvider;
    this.#onlineProvider = onlineProvider;
    this.#content = content;
    this.#admissionController = admissionController ?? new ProviderAdmissionController();
    this.#jobAnswers = jobAnswers;
  }

  get admissionController(): ProviderAdmissionController {
    return this.#admissionController;
  }

  async claim(principal: Principal, input: ClaimRequestInput): Promise<ClaimResult | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    return this.#repository.claimRequest(scope, input);
  }

  /**
   * Primary answer endpoint enforcing authorized retrieval and external-processing consent.
   * If consent is declined or provider is unavailable, falls back safely to the labelled FAQ path.
   * Routes job/career questions to JobAnswers without mixing course evidence (T3-019-B).
   */
  async ask(
    principal: Principal,
    input: AskAnswerInput,
    options?: { signal?: AbortSignal },
  ): Promise<AnswerResult | null> {
    const scope = ownedScope(principal);
    if (!scope || !scope.courseIds.includes(input.courseId)) return null;

    try {
      this.#admissionController.assertQuestionSize(input.question);
    } catch (err: unknown) {
      if (err instanceof ProviderAdmissionError) {
        throw new TutoringError(err.code, err.message, err.retryAfterSeconds);
      }
      throw err;
    }

    // 1. Atomically claim request (idempotent for retries)
    const claimRes = await this.#repository.claimRequest(scope, input);
    if (!claimRes) return null;

    const request = claimRes.request;

    // If already completed, return existing completed request
    if (request.state === 'completed' && request.answerText !== null) {
      return {
        request,
        answerText: request.answerText,
        answerLang: (request.answerLang as 'en' | 'am') ?? 'en',
        kind: 'answered',
        provider: 'faq',
        citations: [],
      };
    }

    // 2. Check if this is a job/career question (T3-019-B)
    if (this.#jobAnswers && this.#jobAnswers.isJobQuestion(input.question)) {
      const jobResult = await this.#jobAnswers.answer(principal, input.question);
      const updated = await this.#repository.recordOutcome(scope, request.id, {
        state: 'completed',
        answerText: jobResult.answerText,
        answerLang: jobResult.answerLang,
      });

      return {
        request: updated ?? request,
        answerText: jobResult.answerText,
        answerLang: jobResult.answerLang,
        kind: jobResult.kind,
        provider: 'job',
        citations: jobResult.citations,
      };
    }

    // 3. Determine whether online processing is consented and available
    const consented = input.externalConsent === true;
    const useOnline =
      consented && this.#onlineProvider !== undefined && this.#onlineProvider.isAvailable();

    if (!useOnline) {
      return this.#executeFaqAnswer(scope, request, principal, input);
    }

    // 4. Online path with permission-filtered retrieval and bounded provider admission
    return this.#executeOnlineAnswer(scope, request, principal, input, options?.signal);
  }

  /**
   * Deterministic FAQ answer helper for backward compatibility (T3-007-A).
   */
  async askFaq(principal: Principal, input: ClaimRequestInput): Promise<AskFaqResult | null> {
    const res = await this.ask(principal, { ...input, externalConsent: false });
    if (!res) return null;
    return {
      request: res.request,
      faqResult: {
        kind: res.kind,
        answerText: res.answerText,
        answerLang: res.answerLang,
        citations: res.citations,
      },
    };
  }

  async #executeFaqAnswer(
    scope: OwnedScope,
    request: TutoringRequest,
    principal: Principal,
    input: ClaimRequestInput,
  ): Promise<AnswerResult> {
    let faqResult: FaqAnswerResult;
    if (this.#faqProvider) {
      faqResult = await this.#faqProvider.answer(principal, input.courseId, input.question);
    } else {
      faqResult = {
        kind: 'insufficient_evidence',
        answerText: 'No answer available in FAQ.',
        answerLang: 'en',
        citations: [],
      };
    }

    const updated = await this.#repository.recordOutcome(scope, request.id, {
      state: 'completed',
      answerText: faqResult.answerText,
      answerLang: faqResult.answerLang,
    });

    return {
      request: updated ?? request,
      answerText: faqResult.answerText,
      answerLang: faqResult.answerLang,
      kind: faqResult.kind,
      provider: 'faq',
      citations: faqResult.citations,
    };
  }

  async #executeOnlineAnswer(
    scope: OwnedScope,
    request: TutoringRequest,
    principal: Principal,
    input: ClaimRequestInput,
    signal?: AbortSignal,
  ): Promise<AnswerResult> {
    const isAmharic = /[\u1200-\u137F]/.test(input.question);
    const lang: 'en' | 'am' = isAmharic ? 'am' : 'en';

    // Retrieve authorized course passages via ContentAccess
    const passages = this.#content ? await this.#content.search(principal, input.question) : [];
    const coursePassages = passages.filter((p) => p.courseId === input.courseId);

    // If no course passages match, honest refusal (missing evidence)
    if (coursePassages.length === 0) {
      const refusalText = HONEST_LIMITATIONS[lang];
      const updated = await this.#repository.recordOutcome(scope, request.id, {
        state: 'completed',
        answerText: refusalText,
        answerLang: lang,
      });

      return {
        request: updated ?? request,
        answerText: refusalText,
        answerLang: lang,
        kind: 'insufficient_evidence',
        provider: 'online',
        citations: [],
      };
    }

    // Acquire admission lease for external provider invocation
    let lease: AdmissionLease;
    try {
      lease = await this.#admissionController.acquire(principal.id, signal);
    } catch (err: unknown) {
      if (err instanceof ProviderAdmissionError) {
        await this.#repository.recordOutcome(scope, request.id, {
          state: 'recoverable_failure',
          errorReason: err.code,
        });
        throw new TutoringError(err.code, err.message, err.retryAfterSeconds);
      }
      throw err;
    }

    try {
      // Query online provider with timeout protection
      let onlineResponse: OnlineAnswerResponse;
      try {
        if (!this.#onlineProvider) {
          throw new TutoringError('provider_error', 'Online provider not available');
        }
        onlineResponse = await this.#onlineProvider.generateAnswer({
          question: input.question,
          language: lang,
          passages: coursePassages.map((p) => ({
            id: p.sectionId,
            heading: p.heading,
            text: p.text,
          })),
        });
      } catch (err: unknown) {
        if (err instanceof TutoringError) throw err;
        const isTimeout =
          (err instanceof Error &&
            (err.name === 'TimeoutError' || err.message.toLowerCase().includes('timeout'))) ||
          (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ETIMEDOUT');
        const errorCode: TutoringErrorCode = isTimeout ? 'timeout' : 'provider_error';
        await this.#repository.recordOutcome(scope, request.id, {
          state: 'recoverable_failure',
          errorReason: errorCode,
        });
        throw new TutoringError(
          errorCode,
          isTimeout ? 'Online answer provider timed out' : 'Online answer provider failed',
        );
      }

    // 1. Reject invented citation IDs
    const validSectionIds = new Set(coursePassages.map((p) => p.sectionId));
    const invented = onlineResponse.citedPassageIds.filter((id) => !validSectionIds.has(id));
    if (invented.length > 0) {
      await this.#repository.recordOutcome(scope, request.id, {
        state: 'recoverable_failure',
        errorReason: 'invented_citation',
      });
      throw new TutoringError(
        'invented_citation',
        `Online provider produced fabricated citation IDs: [${invented.join(', ')}]`,
      );
    }

    // 2. Reject unsupported output (citations on honest limitation)
    if (
      onlineResponse.outcome === 'honest_limitation' &&
      onlineResponse.citedPassageIds.length > 0
    ) {
      await this.#repository.recordOutcome(scope, request.id, {
        state: 'recoverable_failure',
        errorReason: 'unsupported_output',
      });
      throw new TutoringError(
        'unsupported_output',
        'Online provider attached citations to an honest limitation',
      );
    }

    // 3. Verify citations against ContentAccess
    const verifiedCitations: FaqCitation[] = [];
    if (this.#content) {
      for (const citedId of onlineResponse.citedPassageIds) {
        const passage = coursePassages.find((p) => p.sectionId === citedId);
        if (!passage) continue;
        const resolved = await this.#content.resolve(
          principal,
          passage.sourceId,
          passage.sectionId,
        );
        if (resolved.kind === 'section') {
          verifiedCitations.push({
            sourceId: passage.sourceId,
            sectionId: passage.sectionId,
            sourceTitle: passage.sourceTitle,
            heading: passage.heading,
          });
        }
      }
    }

    if (onlineResponse.citedPassageIds.length > 0 && verifiedCitations.length === 0) {
      await this.#repository.recordOutcome(scope, request.id, {
        state: 'recoverable_failure',
        errorReason: 'unverified_citation',
      });
      throw new TutoringError(
        'unverified_citation',
        'None of the cited sections could be verified',
      );
    }

    const kind =
      onlineResponse.outcome === 'honest_limitation' ? 'insufficient_evidence' : 'answered';
    const updated = await this.#repository.recordOutcome(scope, request.id, {
      state: 'completed',
      answerText: onlineResponse.answer,
      answerLang: lang,
    });

    return {
      request: updated ?? request,
      answerText: onlineResponse.answer,
      answerLang: lang,
      kind,
      provider: 'online',
      citations: verifiedCitations,
    };
    } finally {
      lease.release();
    }
  }

  async getRequest(principal: Principal, id: string): Promise<TutoringRequest | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    return this.#repository.findRequestById(scope, id);
  }

  async getConversation(principal: Principal, id: string): Promise<TutoringConversation | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    return this.#repository.findConversation(scope, id);
  }

  async listHistory(principal: Principal, courseId?: string): Promise<readonly TutoringRequest[]> {
    const scope = ownedScope(principal);
    if (!scope) return [];
    return this.#repository.listHistory(scope, courseId);
  }

  async recordOutcome(
    principal: Principal,
    requestId: string,
    outcome: RecordOutcomeInput,
  ): Promise<TutoringRequest | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    return this.#repository.recordOutcome(scope, requestId, outcome);
  }

  /**
   * Removes all conversations and requests owned by the principal. Non-learners
   * receive a no-op (no scope, no delete).
   */
  async clearHistory(principal: Principal): Promise<boolean> {
    const scope = ownedScope(principal);
    if (!scope) return false;
    await this.#repository.clearHistory(scope);
    return true;
  }

  /**
   * Purges expired records as of `now`. Content (question/answer/error) is
   * redacted in-place and purged_at is stamped. Idempotent across restarts.
   * Returns the count of request rows purged.
   */
  async purgeExpired(now: Date): Promise<number> {
    return this.#repository.purgeExpired(now);
  }
}
