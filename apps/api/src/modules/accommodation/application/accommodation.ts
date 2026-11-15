// Accommodation use cases enforcing learner ownership and coordinator access (T3-022-A, T3-022-B).
// Only learner principals may submit and cancel their own requests.
// Both learner principals (own records) and support principals (any record by ID)
// may read accommodation content; no other role has access.
// Authorised coordinators (support role) can list all requests, update status, and exchange private replies.
import { ownedScope, type Principal } from '../../identity/domain/principal.ts';
import type {
  AccommodationReply,
  AccommodationRequest,
} from '../domain/accommodation-request.ts';
import type {
  AccommodationRepository,
  AddAccommodationReplyResult,
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
   * Support principals receive an empty list (use listCoordinatorQueue for coordinator inbox).
   */
  async listOwned(principal: Principal): Promise<readonly AccommodationRequest[]> {
    const scope = ownedScope(principal);
    if (!scope) return [];
    return this.#repository.listOwned(scope);
  }

  /**
   * Lists all non-expired accommodation requests for the coordinator inbox, newest first.
   * Only support principals can access this; returns null for non-support principals.
   */
  async listCoordinatorQueue(
    principal: Principal,
  ): Promise<readonly AccommodationRequest[] | null> {
    if (principal.role !== 'support') return null;
    return this.#repository.coordinatorListAll();
  }

  /**
   * Updates the status of an accommodation request (reviewing, confirmed, declined).
   * Only support principals can perform this action.
   */
  async updateStatus(
    principal: Principal,
    id: string,
    status: 'reviewing' | 'confirmed' | 'declined',
  ): Promise<AccommodationRequest | null> {
    if (principal.role !== 'support') return null;
    if (status !== 'reviewing' && status !== 'confirmed' && status !== 'declined') {
      return null;
    }
    return this.#repository.updateStatus(id, principal.id, status);
  }

  /**
   * Adds a private reply to an accommodation request.
   * Learner may reply to their owned active request; coordinator may reply to any active request.
   * Returns null if not authorized, terminal/cancelled, expired, or invalid.
   */
  async addReply(
    principal: Principal,
    id: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddAccommodationReplyResult | null> {
    if (!body.trim() || !clientReplyId.trim()) return null;

    if (principal.role === 'learner') {
      const owned = await this.getById(principal, id);
      if (!owned || owned.state === 'cancelled') return null;
      return this.#repository.addReply(id, principal.id, clientReplyId.trim(), body.trim());
    }

    if (principal.role === 'support') {
      const request = await this.#repository.coordinatorFindById(id);
      if (!request || request.state === 'cancelled') return null;
      return this.#repository.addReply(id, principal.id, clientReplyId.trim(), body.trim());
    }

    return null;
  }

  /**
   * Lists replies for an accommodation request in chronological order.
   * Learner can list replies for their own request; coordinator can list for any request.
   */
  async listReplies(
    principal: Principal,
    id: string,
  ): Promise<readonly AccommodationReply[] | null> {
    if (principal.role === 'learner') {
      const owned = await this.getById(principal, id);
      if (!owned) return null;
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
   * Marks unread replies on an accommodation request as read for the calling principal.
   */
  async markRepliesRead(principal: Principal, id: string): Promise<boolean> {
    if (principal.role === 'learner') {
      const owned = await this.getById(principal, id);
      if (!owned) return false;
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
