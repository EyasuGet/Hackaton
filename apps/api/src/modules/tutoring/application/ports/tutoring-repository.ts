// Storage port for tutoring conversations and requests. Enforces owner and course
// scope at the database level so unauthorized records are never leaked.
import type { OwnedScope } from '../../../identity/domain/principal.ts';
import type { TutoringConversation } from '../../domain/conversation.ts';
import type { TutoringRequest } from '../../domain/tutoring-request.ts';

export interface ClaimRequestInput {
  readonly courseId: string;
  readonly requestId: string;
  readonly question: string;
  readonly conversationId?: string;
}

export type ClaimResult =
  | { readonly kind: 'claimed'; readonly request: TutoringRequest }
  | { readonly kind: 'existing'; readonly request: TutoringRequest };

export interface RecordOutcomeInput {
  readonly state: 'completed' | 'recoverable_failure';
  readonly answerText?: string;
  readonly answerLang?: string;
  readonly errorReason?: string;
}

export interface TutoringRepository {
  /**
   * Creates a new conversation for an owner and granted course.
   */
  createConversation(scope: OwnedScope, courseId: string): Promise<TutoringConversation | null>;

  /**
   * Retrieves an owned conversation by id if within scope.
   */
  findConversation(scope: OwnedScope, conversationId: string): Promise<TutoringConversation | null>;

  /**
   * Atomically claims a request ID within owner scope.
   * If a record with (owner_id, request_id) already exists, returns the existing record.
   * If a new claim is made, inserts a pending record and returns it.
   * Automatically resolves or creates a conversation if none is provided.
   */
  claimRequest(scope: OwnedScope, input: ClaimRequestInput): Promise<ClaimResult | null>;

  /**
   * Finds a tutoring request by id within owner scope.
   */
  findRequestById(scope: OwnedScope, id: string): Promise<TutoringRequest | null>;

  /**
   * Finds a tutoring request by client requestId within owner scope.
   */
  findRequestByRequestId(scope: OwnedScope, requestId: string): Promise<TutoringRequest | null>;

  /**
   * Lists requests for an owner across all granted courses (or optionally filtered by courseId),
   * ordered newest first.
   */
  listHistory(scope: OwnedScope, courseId?: string): Promise<readonly TutoringRequest[]>;

  /**
   * Records the completion or recoverable failure outcome of a request within scope.
   */
  recordOutcome(
    scope: OwnedScope,
    requestId: string,
    outcome: RecordOutcomeInput,
  ): Promise<TutoringRequest | null>;

  /** Removes all conversations and requests owned by the given scope. */
  clearHistory(scope: OwnedScope): Promise<void>;

  /**
   * Purges private content from rows whose expires_at <= now and sets purged_at.
   * Idempotent across restarts. Returns the count of purged request rows.
   */
  purgeExpired(now: Date): Promise<number>;
}
