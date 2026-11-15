// API client for teacher frequently asked topics analytics (T3-030).
// Enforces bearer authentication and course scoping.

export interface TeacherTopicItem {
  readonly topic: string;
  readonly count: number;
}

export interface TeacherTopicsData {
  readonly courseId: string;
  readonly totalQuestions: number;
  readonly topics: readonly TeacherTopicItem[];
  readonly suppressedCount: number;
  readonly kThreshold: number;
}

export type FetchTopicsResult =
  | { readonly kind: 'ok'; readonly data: TeacherTopicsData }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'error' };

export async function fetchTeacherTopics(
  token: string,
  courseId: string,
  options?: { groupByOther?: boolean },
): Promise<FetchTopicsResult> {
  try {
    const url = new URL('/api/tutoring/teacher/topics', window.location.origin);
    url.searchParams.set('courseId', courseId);
    if (options?.groupByOther) {
      url.searchParams.set('groupByOther', 'true');
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401) return { kind: 'unauthenticated' };
    if (response.status === 403) return { kind: 'forbidden' };
    if (!response.ok) return { kind: 'error' };

    const data = (await response.json()) as TeacherTopicsData;
    return { kind: 'ok', data };
  } catch {
    return { kind: 'error' };
  }
}
