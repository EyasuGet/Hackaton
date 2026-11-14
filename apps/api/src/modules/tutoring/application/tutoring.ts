// Tutoring use cases enforcing the learner-owned access rule.
// Non-learner principals have no scope and receive null or empty results.
// Integrates FaqProvider for deterministic cited answers (T3-007-A).
import { ownedScope, type Principal } from '../../identity/domain/principal.ts';
import type { FaqAnswerResult } from '../domain/faq.ts';
import type {
  ClaimRequestInput,
  ClaimResult,
  RecordOutcomeInput,
  TutoringRepository,
} from './ports/tutoring-repository.ts';
import type { FaqProvider } from './faq-provider.ts';
import type { TutoringConversation } from '../domain/conversation.ts';
import type { TutoringRequest } from '../domain/tutoring-request.ts';

export interface AskFaqResult {
  readonly request: TutoringRequest;
  readonly faqResult: FaqAnswerResult;
}

export class Tutoring {
  readonly #repository: TutoringRepository;
  readonly #faqProvider: FaqProvider | undefined;

  constructor(repository: TutoringRepository, faqProvider?: FaqProvider) {
    this.#repository = repository;
    this.#faqProvider = faqProvider;
  }

  async claim(principal: Principal, input: ClaimRequestInput): Promise<ClaimResult | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    return this.#repository.claimRequest(scope, input);
  }

  async askFaq(principal: Principal, input: ClaimRequestInput): Promise<AskFaqResult | null> {
    const scope = ownedScope(principal);
    if (!scope || !scope.courseIds.includes(input.courseId)) return null;

    // 1. Atomically claim request (idempotent for retries)
    const claimRes = await this.#repository.claimRequest(scope, input);
    if (!claimRes) return null;

    const request = claimRes.request;

    // If already completed, return existing completed request
    if (request.state === 'completed' && request.answerText !== null) {
      return {
        request,
        faqResult: {
          kind: 'answered',
          answerText: request.answerText,
          answerLang: (request.answerLang as 'en' | 'am') ?? 'en',
          citations: [],
        },
      };
    }

    // 2. Query FAQ provider if available
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

    // 3. Persist outcome
    const updated = await this.#repository.recordOutcome(scope, request.id, {
      state: 'completed',
      answerText: faqResult.answerText,
      answerLang: faqResult.answerLang,
    });

    return {
      request: updated ?? request,
      faqResult,
    };
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
