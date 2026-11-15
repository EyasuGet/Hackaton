// Domain model for a learner-owned accommodation request targeting an approved job (T3-022-A, T3-022-B).
// A request captures the support description the learner explicitly reviewed and
// confirmed, without storing diagnosis or medical proof fields.

export type AccommodationState = 'waiting' | 'cancelled' | 'claimed' | 'resolved';

export interface AccommodationRequest {
  readonly id: string;
  readonly ownerId: string;
  /** The approved job this request targets. */
  readonly jobId: string;
  /** Caller-supplied idempotency key; unique per owner. */
  readonly clientRequestId: string;
  /** Support the learner described, explicitly reviewed before submission. */
  readonly supportDescription: string;
  readonly state: AccommodationState;
  readonly createdAt: string;
  /** ISO 8601 expiry instant; 7 days after creation (T3-023-A). */
  readonly expiresAt: string;
  readonly updatedAt: string;
  readonly cancelledAt: string | null;
  /** Set when a coordinator claims the request (T3-022-B). */
  readonly claimedBy: string | null;
  readonly claimedAt: string | null;
  /** Set when a coordinator resolves the conversation (T3-022-B). */
  readonly resolvedBy: string | null;
  readonly resolvedAt: string | null;
}

/** A single reply in an accommodation request thread (T3-022-B). */
export interface AccommodationReply {
  readonly id: string;
  readonly accommodationRequestId: string;
  readonly authorId: string;
  /** Caller-supplied idempotency key; unique per request. */
  readonly clientReplyId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}

/** Queue summary for coordinators: intentionally omits raw supportDescription (docs/architecture.md). */
export interface AccommodationQueueItem {
  readonly id: string;
  readonly jobId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: 'waiting';
}
