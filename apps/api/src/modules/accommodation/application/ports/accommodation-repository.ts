// Storage port for accommodation requests and coordinator replies (T3-022-A, T3-022-B).
// All learner reads include owner scope so another learner's requests are never returned,
// even when their ID is known.
// A coordinator (support role) may access content by ID via coordinatorFindById,
// list all requests in the coordinator inbox, update request status, and exchange private replies.
import type { OwnedScope } from '../../../identity/domain/principal.ts';
import type {
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
   * Finds a non-expired request by id within owner scope. Returns null for another
   * owner's request, expired request, or non-existent id, so callers cannot probe existence.
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
   * Lists all non-expired accommodation requests for the coordinator inbox, newest first.
   */
  coordinatorListAll(): Promise<readonly AccommodationRequest[]>;

  /**
   * Updates an accommodation request status (reviewing, confirmed, declined) by an authorised coordinator.
   * Returns null if not found, expired, or in a terminal state (cancelled).
   */
  updateStatus(
    id: string,
    coordinatorId: string,
    status: 'reviewing' | 'confirmed' | 'declined',
  ): Promise<AccommodationRequest | null>;

  /**
   * Adds a reply to a non-expired, non-cancelled accommodation request.
   * Returns null if the request does not exist, is expired, or is cancelled.
   * Idempotent on (accommodation_request_id, client_reply_id).
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
   * Marks unread replies (by others) on an accommodation request as read.
   */
  markRepliesRead(accommodationRequestId: string, readerPrincipalId: string): Promise<void>;
}
