// Domain model for a learner-owned accommodation request targeting an approved job (T3-022-A, T3-022-B).
// A request captures the support description the learner explicitly reviewed and
// confirmed, without storing diagnosis or medical proof fields.
// Status can be updated by an authorised coordinator (waiting -> reviewing -> confirmed / declined).

export type AccommodationState = 'waiting' | 'reviewing' | 'confirmed' | 'declined' | 'cancelled';

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
  readonly reviewedAt: string | null;
  readonly reviewedBy: string | null;
}

export interface AccommodationReply {
  readonly id: string;
  readonly accommodationRequestId: string;
  readonly authorId: string;
  readonly clientReplyId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}
