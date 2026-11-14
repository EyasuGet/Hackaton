// Domain model for an owned tutoring conversation grouping related requests
// within a course.

export interface TutoringConversation {
  readonly id: string;
  readonly ownerId: string;
  readonly courseId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
