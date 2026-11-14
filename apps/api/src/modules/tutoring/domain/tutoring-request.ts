// Domain model for a persisted tutoring request. A request tracks an atomic
// question submission by an authenticated learner within a granted course.

export type TutoringRequestState = 'pending' | 'completed' | 'recoverable_failure';

export interface TutoringRequest {
  readonly id: string;
  readonly conversationId: string;
  readonly ownerId: string;
  readonly courseId: string;
  readonly requestId: string;
  readonly question: string;
  readonly state: TutoringRequestState;
  readonly answerText: string | null;
  readonly answerLang: string | null;
  readonly errorReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  /** ISO-8601 timestamp after which this request may be purged (created_at + 7 days). */
  readonly expiresAt: string;
  /** Set when private content (question/answer) has been removed by the expiry purge. */
  readonly purgedAt: string | null;
}
