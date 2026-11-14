// Domain model for a learner-owned accommodation request targeting an approved job.
// A request captures the support description the learner explicitly reviewed and
// confirmed, without storing diagnosis or medical proof fields.

export type AccommodationState = 'waiting' | 'cancelled';

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
}
