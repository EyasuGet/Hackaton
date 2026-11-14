// Tutoring use cases enforcing the learner-owned access rule.
// Non-learner principals have no scope and receive null or empty results.
import { ownedScope, type Principal } from '../../identity/domain/principal.ts';
import type {
  ClaimRequestInput,
  ClaimResult,
  RecordOutcomeInput,
  TutoringRepository,
} from './ports/tutoring-repository.ts';
import type { TutoringConversation } from '../domain/conversation.ts';
import type { TutoringRequest } from '../domain/tutoring-request.ts';

export class Tutoring {
  readonly #repository: TutoringRepository;

  constructor(repository: TutoringRepository) {
    this.#repository = repository;
  }

  async claim(principal: Principal, input: ClaimRequestInput): Promise<ClaimResult | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    return this.#repository.claimRequest(scope, input);
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
}
