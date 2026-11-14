// Domain model for a signalling session that restricts screen-sharing access
// to exactly two authorised participants: the learner who owns the help request
// and the support person who claimed it. This leaf (T3-018-A) proves signalling
// permissions only — not remote screen delivery or capture.

export type SharingSessionState = 'pending' | 'active' | 'revoked' | 'expired';

export interface SharingSession {
  readonly id: string;
  readonly helpRequestId: string;
  /** Owner of the help request. */
  readonly learnerId: string;
  /** Support staff who claimed the help request. */
  readonly supportId: string;
  readonly state: SharingSessionState;
  readonly createdAt: string;
  /** ISO 8601 instant; 1 hour after creation. */
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}
