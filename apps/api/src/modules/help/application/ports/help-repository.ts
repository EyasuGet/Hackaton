// Storage port for help requests. All reads include the owner scope so another
// learner's requests are never returned, even when their ID is known.
import type { OwnedScope } from '../../../identity/domain/principal.ts';
import type { HelpRequest } from '../../domain/help-request.ts';

export interface SubmitHelpInput {
  /** Caller-supplied idempotency key unique for this owner. */
  readonly clientRequestId: string;
  /** Context the learner consented to share; must not be empty. */
  readonly contextSnapshot: string;
}

export type SubmitResult =
  | { readonly kind: 'submitted'; readonly request: HelpRequest }
  | { readonly kind: 'existing'; readonly request: HelpRequest };

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
   * Lists non-expired help requests for the owner, newest first.
   */
  listOwned(scope: OwnedScope): Promise<readonly HelpRequest[]>;
}
