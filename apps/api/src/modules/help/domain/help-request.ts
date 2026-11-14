// Domain model for a learner-owned asynchronous help request.
// A request captures the context the learner explicitly chose to share after
// seeing the disclosure, and tracks its lifecycle from waiting to cancelled.

export type HelpRequestState = 'waiting' | 'cancelled';

export interface HelpRequest {
  readonly id: string;
  readonly ownerId: string;
  /** Caller-supplied idempotency key; unique per owner. */
  readonly clientRequestId: string;
  /** Context the learner explicitly consented to share. */
  readonly contextSnapshot: string;
  /** True only after the learner confirmed the disclosure. */
  readonly consentGiven: boolean;
  readonly state: HelpRequestState;
  readonly createdAt: string;
  /** ISO 8601 expiry instant; 7 days after creation (T3-023-A). */
  readonly expiresAt: string;
  readonly updatedAt: string;
  readonly cancelledAt: string | null;
}
