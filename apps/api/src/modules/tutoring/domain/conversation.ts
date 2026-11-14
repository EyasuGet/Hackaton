// Domain model for an owned tutoring conversation grouping related requests
// within a course.

export interface TutoringConversation {
  readonly id: string;
  readonly ownerId: string;
  readonly courseId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** ISO-8601 timestamp after which this conversation may be purged (created_at + 7 days). */
  readonly expiresAt: string;
  /** Set when private content has been removed by the expiry purge. */
  readonly purgedAt: string | null;
}
