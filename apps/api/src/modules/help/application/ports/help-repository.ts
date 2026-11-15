// Storage port for help requests. All reads include the owner scope so another
// learner's requests are never returned, even when their ID is known.
// Staff operations use StaffScope to prevent cross-principal data leakage.
import type { OwnedScope } from '../../../identity/domain/principal.ts';
import type { HelpReply, HelpRequest } from '../../domain/help-request.ts';

export interface SubmitHelpInput {
  /** Caller-supplied idempotency key unique for this owner. */
  readonly clientRequestId: string;
  /** Context the learner consented to share; must not be empty. */
  readonly contextSnapshot: string;
}

export type SubmitResult =
  | { readonly kind: 'submitted'; readonly request: HelpRequest }
  | { readonly kind: 'existing'; readonly request: HelpRequest };

/** Metadata the queue list exposes to staff; contextSnapshot is omitted to
 *  limit disclosure before a request is explicitly claimed. */
export interface QueueItem {
  readonly id: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: 'waiting';
}

export type ClaimResult =
  | { readonly kind: 'claimed'; readonly request: HelpRequest }
  | { readonly kind: 'already_claimed'; readonly request: HelpRequest };

export type AddReplyResult =
  | { readonly kind: 'added'; readonly reply: HelpReply }
  | { readonly kind: 'existing'; readonly reply: HelpReply };

export interface HelpRepository {
  /**
   * Atomically submits a new help request under owner scope.
   * If (owner_id, client_request_id) already exists, returns the existing
   * record as `existing`. Never creates two rows for the same key.
   */
  submit(scope: OwnedScope, input: SubmitHelpInput): Promise<SubmitResult>;

  /**
   * Transitions a waiting request to cancelled within owner scope.
   * Returns null when the request does not exist for this owner, is not
   * in `waiting` state, or has expired.
   */
  cancel(scope: OwnedScope, id: string): Promise<HelpRequest | null>;

  /**
   * Finds a help request by id within owner scope. Returns null for another
   * owner's request or a non-existent id, so callers cannot probe existence.
   */
  findById(scope: OwnedScope, id: string): Promise<HelpRequest | null>;

  /**
   * Finds a help request by id without owner scope (staff access).
   * Returns null when the request does not exist.
   */
  findByIdAsStaff(id: string): Promise<HelpRequest | null>;

  /**
   * Lists non-expired help requests for the owner, newest first.
   */
  listOwned(scope: OwnedScope): Promise<readonly HelpRequest[]>;

  /**
   * Lists all non-expired waiting requests, oldest first (support queue view).
   * Returns only queue metadata — no context snapshots — so staff see the
   * queue before choosing which request to claim.
   */
  listQueue(): Promise<readonly QueueItem[]>;

  /**
   * Atomically transitions a waiting request to claimed, assigning staffId.
   * Returns `claimed` with the full request (including contextSnapshot) when
   * the transition succeeds, or `already_claimed` with the existing record
   * when another staff member beat this one. Returns null when the request
   * does not exist or is not in waiting state.
   */
  claimRequest(id: string, staffId: string): Promise<ClaimResult | null>;

  /**
   * Adds a reply to a help request. The (help_request_id, client_reply_id)
   * unique constraint makes retries idempotent.
   * Returns null when the request does not exist, is in a terminal/expired
   * state, or when the reply is not authorised for this author.
   */
  addReply(
    helpRequestId: string,
    authorId: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddReplyResult | null>;

  /**
   * Lists replies for a help request in chronological order.
   */
  listReplies(helpRequestId: string): Promise<readonly HelpReply[]>;

  /**
   * Marks all replies not already read as read for the given reader.
   * Only marks replies authored by others (the reader's own replies are
   * considered already read).
   */
  markRepliesRead(helpRequestId: string, readerId: string): Promise<void>;

  /**
   * Transitions a claimed request to resolved.
   * Returns the updated request on success, or null when the request does not
   * exist, is not in `claimed` state, or has expired.
   */
  resolveRequest(helpRequestId: string, supportId: string): Promise<HelpRequest | null>;
}
