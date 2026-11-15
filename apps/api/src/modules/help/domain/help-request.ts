// Domain model for a learner-owned asynchronous help request.
// A request captures the context the learner explicitly chose to share after
// seeing the disclosure, and tracks its lifecycle from waiting to cancelled or resolved.

export type HelpRequestState = 'waiting' | 'cancelled' | 'claimed' | 'resolved';

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
  /** Set when a support staff member claims the request (T3-017-A). */
  readonly claimedBy: string | null;
  readonly claimedAt: string | null;
  /** Set when support staff resolves the conversation (T3-017-B). */
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
}

/** A single reply in a help request thread (T3-017-B). */
export interface HelpReply {
  readonly id: string;
  readonly helpRequestId: string;
  readonly authorId: string;
  /** Caller-supplied idempotency key; unique per request. */
  readonly clientReplyId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}
