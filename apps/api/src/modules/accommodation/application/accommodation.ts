// Accommodation use cases enforcing learner ownership and coordinator access (T3-022-A).
// Only learner principals may submit and cancel their own requests.
// Both learner principals (own records) and support principals (any record by ID)
// may read accommodation content; no other role has access.
import { ownedScope, type Principal } from '../../identity/domain/principal.ts';
import type { AccommodationRequest } from '../domain/accommodation-request.ts';
import type {
  AccommodationRepository,
  SubmitAccommodationInput,
  SubmitAccommodationResult,
} from './ports/accommodation-repository.ts';

export class Accommodation {
  readonly #repository: AccommodationRepository;

  constructor(repository: AccommodationRepository) {
    this.#repository = repository;
  }

  /**
   * Submits an accommodation request on behalf of a learner principal.
   * Returns null for non-learner principals or empty supportDescription/jobId.
   */
  async submit(
    principal: Principal,
    input: SubmitAccommodationInput,
  ): Promise<SubmitAccommodationResult | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    if (!input.supportDescription.trim()) return null;
    if (!input.jobId.trim()) return null;
    return this.#repository.submit(scope, input);
  }

  /**
   * Cancels an owned waiting accommodation request. Returns null when the principal
   * is not a learner, the request is not found, or it is not in waiting state.
   */
  async cancel(principal: Principal, id: string): Promise<AccommodationRequest | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    return this.#repository.cancel(scope, id);
  }

  /**
   * Retrieves an owned accommodation request by id for a learner, or any
   * non-expired request by id for a support principal. Returns null for
   * other roles or when not found.
   */
  async getById(principal: Principal, id: string): Promise<AccommodationRequest | null> {
    if (principal.role === 'support') {
      return this.#repository.coordinatorFindById(id);
    }
    const scope = ownedScope(principal);
    if (!scope) return null;
    return this.#repository.findById(scope, id);
  }

  /**
   * Lists non-expired accommodation requests for the learner, newest first.
   * Support principals receive an empty list (use getById for specific records).
   */
  async listOwned(principal: Principal): Promise<readonly AccommodationRequest[]> {
    const scope = ownedScope(principal);
    if (!scope) return [];
    return this.#repository.listOwned(scope);
  }
}
