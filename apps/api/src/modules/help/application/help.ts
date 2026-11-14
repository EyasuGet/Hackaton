// Help use cases enforcing learner ownership. Non-learner principals have no
// scope and receive null or empty results. The spec forbids promising staff
// availability or capturing screens in this leaf (T3-016-A).
import { ownedScope, type Principal } from '../../identity/domain/principal.ts';
import type { HelpRequest } from '../domain/help-request.ts';
import type { HelpRepository, SubmitHelpInput, SubmitResult } from './ports/help-repository.ts';

export class Help {
  readonly #repository: HelpRepository;

  constructor(repository: HelpRepository) {
    this.#repository = repository;
  }

  /**
   * Submits a help request on behalf of a learner principal.
   * Returns null for non-learner principals or empty context.
   */
  async submit(principal: Principal, input: SubmitHelpInput): Promise<SubmitResult | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    if (!input.contextSnapshot.trim()) return null;
    return this.#repository.submit(scope, input);
  }

  /**
   * Cancels an owned waiting help request. Returns null when the principal
   * is not a learner, the request is not found, or it is not in waiting state.
   */
  async cancel(principal: Principal, id: string): Promise<HelpRequest | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    return this.#repository.cancel(scope, id);
  }

  /**
   * Retrieves an owned help request by id. Returns null for requests that
   * belong to another learner or do not exist.
   */
  async getById(principal: Principal, id: string): Promise<HelpRequest | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    return this.#repository.findById(scope, id);
  }

  /**
   * Lists non-expired help requests for the learner, newest first.
   */
  async listOwned(principal: Principal): Promise<readonly HelpRequest[]> {
    const scope = ownedScope(principal);
    if (!scope) return [];
    return this.#repository.listOwned(scope);
  }
}
