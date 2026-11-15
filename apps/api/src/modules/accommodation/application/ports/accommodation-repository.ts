// Storage port for accommodation requests (T3-022-A, T3-022-B). All learner reads include owner scope
// so another learner's requests are never returned, even when their ID is known.
// A coordinator (support role) may access content by ID via coordinatorFindById, claim requests,
// exchange replies, and resolve requests.
import type { OwnedScope } from '../../../identity/domain/principal.ts';
import type {
  AccommodationQueueItem,
  AccommodationReply,
  AccommodationRequest,
} from '../../domain/accommodation-request.ts';

export interface SubmitAccommodationInput {
  /** Caller-supplied idempotency key unique for this owner. */
  readonly clientRequestId: string;
  /** The approved job this request targets. */
  readonly jobId: string;
  /** Support the learner described after reviewing the preview; must not be empty. */
  readonly supportDescription: string;
}

export type SubmitAccommodationResult =
  | { readonly kind: 'submitted'; readonly request: AccommodationRequest }
  | { readonly kind: 'existing'; readonly request: AccommodationRequest }
  | { readonly kind: 'job_not_found' };

export type ClaimAccommodationResult =
  | { readonly kind: 'claimed'; readonly request: AccommodationRequest }
  | { readonly kind: 'already_claimed'; readonly request: AccommodationRequest };

export type AddAccommodationReplyResult =
  | { readonly kind: 'added'; readonly reply: AccommodationReply }
  | { readonly kind: 'existing'; readonly reply: AccommodationReply };

export interface AccommodationRepository {
  /**
   * Atomically submits a new accommodation request under owner scope.
   * If (owner_id, client_request_id) already exists, returns the existing
   * record as `existing`. Never creates two rows for the same key.
   * Returns `job_not_found` when the referenced job_id does not exist.
   */
  submit(scope: OwnedScope, input: SubmitAccommodationInput): Promise<SubmitAccommodationResult>;

  /**
   * Transitions a waiting request to cancelled within owner scope.
   * Returns null when the request does not exist for this owner, is not
   * in `waiting` state, or has expired.
   */
  cancel(scope: OwnedScope, id: string): Promise<AccommodationRequest | null>;

  /**
   * Finds a request by id within owner scope. Returns null for another
   * owner's request or a non-existent id, so callers cannot probe existence.
   */
  findById(scope: OwnedScope, id: string): Promise<AccommodationRequest | null>;

  /**
   * Lists non-expired accommodation requests for the owner, newest first.
   */
  listOwned(scope: OwnedScope): Promise<readonly AccommodationRequest[]>;

  /**
   * Finds any accommodation request by id for a coordinator (support role).
   * Returns null when the id does not exist or has expired.
   */
  coordinatorFindById(id: string): Promise<AccommodationRequest | null>;

  /**
   * Lists non-expired waiting requests for the coordinator queue (without raw support description).
   */
  listQueue(): Promise<readonly AccommodationQueueItem[]>;

  /**
   * Lists non-expired requests for coordinator tracking (newest first).
   */
  listForCoordinator(): Promise<readonly AccommodationRequest[]>;

  /**
   * Atomically claims a waiting request for the given coordinator.
   */
  claimRequest(id: string, coordinatorId: string): Promise<ClaimAccommodationResult | null>;

  /**
   * Adds a reply to an accommodation request thread (idempotent on clientReplyId).
   */
  addReply(
    accommodationRequestId: string,
    authorId: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddAccommodationReplyResult | null>;

  /**
   * Lists replies for an accommodation request in chronological order.
   */
  listReplies(accommodationRequestId: string): Promise<readonly AccommodationReply[]>;

  /**
   * Marks unread replies (by others) on the request as read for readerId.
   */
  markRepliesRead(accommodationRequestId: string, readerId: string): Promise<void>;

  /**
   * Transitions a claimed request to resolved.
   */
  resolveRequest(
    accommodationRequestId: string,
    coordinatorId: string,
  ): Promise<AccommodationRequest | null>;
}
