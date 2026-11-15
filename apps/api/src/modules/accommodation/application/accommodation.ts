// Accommodation use cases enforcing learner ownership and coordinator access (T3-022-A, T3-022-B).
// Only learner principals may submit and cancel their own requests.
// Both learner principals (own records) and support principals (any record by ID)
// may read accommodation content, exchange replies, and track status; no other role has access.
import { ownedScope, type Principal } from '../../identity/domain/principal.ts';
import type {
  AccommodationQueueItem,
  AccommodationReply,
  AccommodationRequest,
} from '../domain/accommodation-request.ts';
import type {
  AccommodationRepository,
  AddAccommodationReplyResult,
  ClaimAccommodationResult,
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
   * Support principals receive an empty list (use listForCoordinator for coordinator view).
   */
  async listOwned(principal: Principal): Promise<readonly AccommodationRequest[]> {
    const scope = ownedScope(principal);
    if (!scope) return [];
    return this.#repository.listOwned(scope);
  }

  /**
   * Returns queue metadata for all non-expired waiting requests, oldest first.
   * Support descriptions are withheld until a request is claimed or opened.
   * Returns null for non-support principals.
   */
  async listQueue(principal: Principal): Promise<readonly AccommodationQueueItem[] | null> {
    if (principal.role !== 'support') return null;
    return this.#repository.listQueue();
  }

  /**
   * Lists non-expired accommodation requests for the coordinator, newest first.
   * Returns null for non-support principals.
   */
  async listForCoordinator(principal: Principal): Promise<readonly AccommodationRequest[] | null> {
    if (principal.role !== 'support') return null;
    return this.#repository.listForCoordinator();
  }

  /**
   * Atomically claims a waiting request for the given coordinator (support principal).
   * Returns null for non-support principals.
   */
  async claimRequest(principal: Principal, id: string): Promise<ClaimAccommodationResult | null> {
    if (principal.role !== 'support') return null;
    return this.#repository.claimRequest(id, principal.id);
  }

  /**
   * Transitions a claimed request to resolved.
   * Returns the updated request on success, null for non-support principals
   * or when the request does not exist or cannot be resolved.
   */
  async resolveRequest(principal: Principal, id: string): Promise<AccommodationRequest | null> {
    if (principal.role !== 'support') return null;
    return this.#repository.resolveRequest(id, principal.id);
  }

  /**
   * Adds a reply to an accommodation request.
   * Learner (owner) may reply to their own waiting/claimed request.
   * Coordinator (support) may reply to any non-expired waiting/claimed request.
   * Returns null when forbidden, in a terminal state, or expired.
   */
  async addReply(
    principal: Principal,
    id: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddAccommodationReplyResult | null> {
    if (!body.trim()) return null;
    if (!clientReplyId.trim()) return null;

    if (principal.role === 'learner') {
      const scope = ownedScope(principal);
      if (!scope) return null;
      // Confirm the learner owns this request before allowing a reply.
      const request = await this.#repository.findById(scope, id);
      if (!request) return null;
      return this.#repository.addReply(id, principal.id, clientReplyId.trim(), body.trim());
    }

    if (principal.role === 'support') {
      // Confirm the request exists and is accessible.
      const request = await this.#repository.coordinatorFindById(id);
      if (!request) return null;
      return this.#repository.addReply(id, principal.id, clientReplyId.trim(), body.trim());
    }

    return null;
  }

  /**
   * Lists replies for an accommodation request in chronological order.
   * Learner (owner) may list their own request's replies.
   * Support staff may list any request's replies.
   */
  async listReplies(
    principal: Principal,
    id: string,
  ): Promise<readonly AccommodationReply[] | null> {
    if (principal.role === 'learner') {
      const scope = ownedScope(principal);
      if (!scope) return null;
      const request = await this.#repository.findById(scope, id);
      if (!request) return null;
      return this.#repository.listReplies(id);
    }

    if (principal.role === 'support') {
      const request = await this.#repository.coordinatorFindById(id);
      if (!request) return null;
      return this.#repository.listReplies(id);
    }

    return null;
  }

  /**
   * Marks unread replies (by the other party) as read.
   * Learner marks coordinator replies as read.
   * Coordinator marks learner replies as read.
   */
  async markRepliesRead(principal: Principal, id: string): Promise<boolean> {
    if (principal.role === 'learner') {
      const scope = ownedScope(principal);
      if (!scope) return false;
      const request = await this.#repository.findById(scope, id);
      if (!request) return false;
      await this.#repository.markRepliesRead(id, principal.id);
      return true;
    }

    if (principal.role === 'support') {
      const request = await this.#repository.coordinatorFindById(id);
      if (!request) return false;
      await this.#repository.markRepliesRead(id, principal.id);
      return true;
    }

    return false;
  }
}
