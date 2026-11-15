// Unit and route tests for teacher frequently asked topics analytics (T3-030).
// Asserts role authentication, course isolation, k-anonymity suppression (k >= 3),
// and strict exclusion of learner personal fields and transcripts.
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../bootstrap/app.ts';
import type { Readiness } from '../../infrastructure/database/migrations.ts';
import { DemoRecords } from '../demo-records/demo-records.ts';
import { DemoSessions } from '../identity/application/demo-sessions.ts';
import { digestToken, ResolvePrincipal } from '../identity/application/resolve-principal.ts';
import type { OwnedScope, Principal } from '../identity/domain/principal.ts';
import { ContentAccess } from '../content/application/content-access.ts';
import type { CitationResult, CitedSection } from '../content/domain/retrieval.ts';
import { FaqProvider } from './application/faq-provider.ts';
import type {
  ClaimRequestInput,
  ClaimResult,
  TutoringRepository,
} from './application/ports/tutoring-repository.ts';
import type { TutoringConversation } from './domain/conversation.ts';
import type { TutoringRequest } from './domain/tutoring-request.ts';
import { Tutoring } from './application/tutoring.ts';

class InMemoryTutoringRepository implements TutoringRepository {
  readonly conversations: TutoringConversation[] = [];
  readonly requests: TutoringRequest[] = [];
  #counter = 1;

  createConversation(scope: OwnedScope, courseId: string): Promise<TutoringConversation | null> {
    if (!scope.courseIds.includes(courseId)) return Promise.resolve(null);
    const now = new Date();
    const conv: TutoringConversation = {
      id: `00000000-0000-0000-0000-${String(this.#counter++).padStart(12, '0')}`,
      ownerId: scope.ownerId,
      courseId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
      purgedAt: null,
    };
    this.conversations.push(conv);
    return Promise.resolve(conv);
  }

  findConversation(
    scope: OwnedScope,
    conversationId: string,
  ): Promise<TutoringConversation | null> {
    const conv = this.conversations.find((c) => c.id === conversationId);
    if (!conv || conv.ownerId !== scope.ownerId || !scope.courseIds.includes(conv.courseId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(conv);
  }

  claimRequest(scope: OwnedScope, input: ClaimRequestInput): Promise<ClaimResult | null> {
    if (!scope.courseIds.includes(input.courseId)) return Promise.resolve(null);
    const existing = this.requests.find(
      (r) => r.ownerId === scope.ownerId && r.requestId === input.requestId,
    );
    if (existing) return Promise.resolve({ kind: 'existing', request: existing });

    const now = new Date();
    const req: TutoringRequest = {
      id: `00000000-0000-0000-0000-${String(this.#counter++).padStart(12, '0')}`,
      conversationId: input.conversationId ?? '00000000-0000-0000-0000-000000000001',
      ownerId: scope.ownerId,
      courseId: input.courseId,
      requestId: input.requestId,
      question: input.question,
      state: 'completed',
      answerText: 'Answer',
      answerLang: 'en',
      errorReason: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
      purgedAt: null,
    };
    this.requests.push(req);
    return Promise.resolve({ kind: 'claimed', request: req });
  }

  findRequestById(scope: OwnedScope, id: string): Promise<TutoringRequest | null> {
    const req = this.requests.find((r) => r.id === id);
    if (!req || req.ownerId !== scope.ownerId || !scope.courseIds.includes(req.courseId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(req);
  }

  findRequestByRequestId(scope: OwnedScope, requestId: string): Promise<TutoringRequest | null> {
    const req = this.requests.find((r) => r.ownerId === scope.ownerId && r.requestId === requestId);
    if (!req || !scope.courseIds.includes(req.courseId)) return Promise.resolve(null);
    return Promise.resolve(req);
  }

  listHistory(scope: OwnedScope, courseId?: string): Promise<readonly TutoringRequest[]> {
    return Promise.resolve(
      this.requests.filter(
        (r) =>
          r.ownerId === scope.ownerId &&
          scope.courseIds.includes(r.courseId) &&
          (courseId === undefined || r.courseId === courseId),
      ),
    );
  }

  recordOutcome(): Promise<TutoringRequest | null> {
    return Promise.resolve(null);
  }

  clearHistory(scope: OwnedScope): Promise<void> {
    for (let i = this.requests.length - 1; i >= 0; i--) {
      if (this.requests[i]?.ownerId === scope.ownerId) this.requests.splice(i, 1);
    }
    return Promise.resolve();
  }

  purgeExpired(now: Date): Promise<number> {
    let count = 0;
    for (const r of this.requests) {
      if (new Date(r.expiresAt) <= now && r.purgedAt === null) {
        (r as { question: string }).question = '';
        (r as { purgedAt: string | null }).purgedAt = now.toISOString();
        count++;
      }
    }
    return Promise.resolve(count);
  }

  listCourseQuestionsForAnalytics(courseId: string): Promise<readonly string[]> {
    return Promise.resolve(
      this.requests
        .filter((r) => r.courseId === courseId && r.purgedAt === null && r.question?.trim())
        .map((r) => r.question),
    );
  }
}

const learnerUser: Principal = {
  id: '10000000-0000-0000-0000-000000000001',
  role: 'learner',
  label: 'Learner One',
  demo: true,
  courseIds: ['course-1'],
};

const teacherUser: Principal = {
  id: '20000000-0000-0000-0000-000000000001',
  role: 'teacher',
  label: 'Teacher One',
  demo: true,
  courseIds: ['course-1'],
};

const teacherOtherCourse: Principal = {
  id: '20000000-0000-0000-0000-000000000002',
  role: 'teacher',
  label: 'Teacher Other',
  demo: true,
  courseIds: ['course-2'],
};

const supportUser: Principal = {
  id: '30000000-0000-0000-0000-000000000001',
  role: 'support',
  label: 'Support Staff',
  demo: true,
  courseIds: ['course-1'],
};

const learnerToken = 'l'.repeat(43);
const teacherToken = 't'.repeat(43);
const teacherOtherToken = 'o'.repeat(43);
const supportToken = 's'.repeat(43);

const tokenMap: Record<string, Principal> = {
  [digestToken(learnerToken)]: learnerUser,
  [digestToken(teacherToken)]: teacherUser,
  [digestToken(teacherOtherToken)]: teacherOtherCourse,
  [digestToken(supportToken)]: supportUser,
};

function createMockContent(): ContentAccess {
  return new ContentAccess(
    {
      search: () => Promise.resolve([]),
      resolve: (courseIds, sourceId, sectionId): Promise<CitationResult> => {
        const sec: CitedSection = {
          sourceId,
          sectionId,
          sourceTitle: 'The Future of the VA Industry',
          heading:
            sectionId === 'introduction'
              ? 'Introduction'
              : 'Artificial Intelligence and the Future of VA Work',
          text: 'Lesson body',
          language: 'en',
          courseId: 'course-1',
          version: '1',
          anchor: sectionId,
          provenance: { kind: 'demo', note: 'test' },
        };
        return Promise.resolve({ kind: 'section', section: sec });
      },
    },
    [],
  );
}

function setupTest() {
  const repo = new InMemoryTutoringRepository();
  const content = createMockContent();
  const faqProvider = new FaqProvider(content);
  const tutoring = new Tutoring(repo, faqProvider);

  const resolvePrincipal = new ResolvePrincipal(
    {
      findDemoByTokenDigest: (digest) => Promise.resolve(tokenMap[digest] ?? null),
    },
    true,
  );

  const app = buildApp({
    checkReadiness: () => Promise.resolve({ ready: true } as Readiness),
    resolvePrincipal,
    demoRecords: new DemoRecords({
      list: () => Promise.resolve([]),
      find: () => Promise.resolve(null),
    }),
    demoSessions: new DemoSessions(
      {
        createHandoff: () => Promise.resolve(false),
        consumeHandoff: () => Promise.resolve(null),
        createSession: () => Promise.resolve(),
        revokeSession: () => Promise.resolve(false),
        extendSession: () => Promise.resolve(false),
      },
      true,
    ),
    demoAllowedOrigins: ['http://localhost:5173'],
    tutoring,
    content,
  });

  return { app, repo };
}

interface TeacherTopicsResponse {
  courseId: string;
  totalQuestions: number;
  kThreshold: number;
  topics: Array<{ topic: string; count: number }>;
  suppressedCount: number;
}

function parseBody<T>(res: { body: string }): T {
  const parsed: unknown = JSON.parse(res.body);
  return parsed as T;
}

describe('Teacher Frequently Asked Topics Analytics (T3-030)', () => {
  it('returns 401 Unauthorized for unauthenticated requests', async () => {
    const { app } = setupTest();

    // No authorization header
    const resNoAuth = await app.inject({
      method: 'GET',
      url: '/api/tutoring/teacher/topics?courseId=course-1',
    });
    expect(resNoAuth.statusCode).toBe(401);
    expect(resNoAuth.json()).toMatchObject({ error: 'unauthenticated' });

    // Invalid bearer token
    const resBadAuth = await app.inject({
      method: 'GET',
      url: '/api/tutoring/teacher/topics?courseId=course-1',
      headers: { authorization: 'Bearer invalid-token-that-does-not-exist' },
    });
    expect(resBadAuth.statusCode).toBe(401);
    expect(resBadAuth.json()).toMatchObject({ error: 'unauthenticated' });
  });

  it('returns 403 Forbidden for learner role', async () => {
    const { app } = setupTest();

    const response = await app.inject({
      method: 'GET',
      url: '/api/tutoring/teacher/topics?courseId=course-1',
      headers: { authorization: `Bearer ${learnerToken}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'forbidden' });
  });

  it('validates ?courseId= query param and validates course grant', async () => {
    const { app } = setupTest();

    // Missing courseId
    const resMissing = await app.inject({
      method: 'GET',
      url: '/api/tutoring/teacher/topics',
      headers: { authorization: `Bearer ${teacherToken}` },
    });
    expect(resMissing.statusCode).toBe(400);
    expect(resMissing.json()).toMatchObject({ error: 'invalid_course_id' });

    // Empty courseId
    const resEmpty = await app.inject({
      method: 'GET',
      url: '/api/tutoring/teacher/topics?courseId=   ',
      headers: { authorization: `Bearer ${teacherToken}` },
    });
    expect(resEmpty.statusCode).toBe(400);
    expect(resEmpty.json()).toMatchObject({ error: 'invalid_course_id' });

    // Teacher not granted course-2
    const resUngranted = await app.inject({
      method: 'GET',
      url: '/api/tutoring/teacher/topics?courseId=course-2',
      headers: { authorization: `Bearer ${teacherToken}` },
    });
    expect(resUngranted.statusCode).toBe(403);
    expect(resUngranted.json()).toMatchObject({ error: 'forbidden' });
  });

  it('returns 200 for teacher role with course-scoped aggregate data', async () => {
    const { app, repo } = setupTest();

    // Seed questions for course-1 (Savanna VA)
    // 4 questions matching FAQ 1 ("Introduction")
    const q1 = [
      'What is a virtual assistant?',
      'What does virtual assistant mean?',
      'Virtual assistant meaning',
      'Tell me about the two meanings of virtual assistant',
    ];
    // 3 questions matching FAQ 2 ("Artificial Intelligence and the Future of VA Work")
    const q2 = [
      'What routine tasks can AI help with?',
      'What tasks can AI tools help a virtual assistant with?',
      'How can AI support virtual assistants?',
    ];
    // 2 questions matching FAQ 3 ("What Clients Are Likely to Value More and More") - low count!
    const q3 = [
      'What human skills will clients value?',
      'What differentiators and qualities will clients value most?',
    ];
    // 1 unmatched general question - low count!
    const q4 = ['Can you help me with something general?'];

    // Also seed questions for course-2 to ensure course-level isolation
    const qCourse2 = [
      'ቀኑን ከመጀመርዎ በፊት ምን እንዲያደርጉ ተመክረዋል',
      'ስለ እቅድ ማውጣት ምን ተብሏል',
      'የሥራ እቅድ',
      'ቀኑ ከመጀመሩ በፊት',
    ];

    let counter = 1;
    for (const text of [...q1, ...q2, ...q3, ...q4]) {
      repo.requests.push({
        id: `00000000-0000-0000-0000-${String(counter++).padStart(12, '0')}`,
        conversationId: '00000000-0000-0000-0000-000000000001',
        ownerId: learnerUser.id,
        courseId: 'course-1',
        requestId: `req-${counter}`,
        question: text,
        state: 'completed',
        answerText: 'Answer',
        answerLang: 'en',
        errorReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        purgedAt: null,
      });
    }

    for (const text of qCourse2) {
      repo.requests.push({
        id: `00000000-0000-0000-0000-${String(counter++).padStart(12, '0')}`,
        conversationId: '00000000-0000-0000-0000-000000000002',
        ownerId: learnerUser.id,
        courseId: 'course-2',
        requestId: `req-${counter}`,
        question: text,
        state: 'completed',
        answerText: 'መልስ',
        answerLang: 'am',
        errorReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        purgedAt: null,
      });
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/tutoring/teacher/topics?courseId=course-1',
      headers: { authorization: `Bearer ${teacherToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = parseBody<TeacherTopicsResponse>(response);

    expect(body.courseId).toBe('course-1');
    expect(body.totalQuestions).toBe(10); // 4 + 3 + 2 + 1
    expect(body.kThreshold).toBe(3);

    // Only topics meeting the k >= 3 threshold are returned under their own names
    expect(body.topics).toEqual([
      { topic: 'Introduction', count: 4 },
      { topic: 'Artificial Intelligence and the Future of VA Work', count: 3 },
    ]);

    // Low-count topics (< 3) are suppressed: 2 from FAQ 3 + 1 from unmatched = 3
    expect(body.suppressedCount).toBe(3);

    // Assert course isolation: course-2 topics are NOT present in course-1
    expect(body.topics.some((t: { topic: string }) => t.topic.includes('እቅድ'))).toBe(false);
  });

  it('enforces low-count k-anonymity suppression (k < 3)', async () => {
    const { app, repo } = setupTest();

    // 4 questions for Topic A (meets k >= 3)
    // 2 questions for Topic B (low count: k < 3)
    // 1 question for Topic C (low count: k < 3)
    const questions = [
      '[Topic A] Question 1',
      '[Topic A] Question 2',
      '[Topic A] Question 3',
      '[Topic A] Question 4',
      '[Topic B] Question 1',
      '[Topic B] Question 2',
      '[Topic C] Question 1',
    ];

    let counter = 1;
    for (const q of questions) {
      repo.requests.push({
        id: `00000000-0000-0000-0000-${String(counter++).padStart(12, '0')}`,
        conversationId: '00000000-0000-0000-0000-000000000001',
        ownerId: learnerUser.id,
        courseId: 'course-1',
        requestId: `req-${counter}`,
        question: q,
        state: 'completed',
        answerText: 'Answer',
        answerLang: 'en',
        errorReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        purgedAt: null,
      });
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/tutoring/teacher/topics?courseId=course-1',
      headers: { authorization: `Bearer ${teacherToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = parseBody<TeacherTopicsResponse>(response);

    // Topic B and Topic C must NOT appear as topic entries
    const topicNames = body.topics.map((t: { topic: string }) => t.topic);
    expect(topicNames).toContain('Topic A');
    expect(topicNames).not.toContain('Topic B');
    expect(topicNames).not.toContain('Topic C');

    // Suppressed count reflects the 3 suppressed questions
    expect(body.suppressedCount).toBe(3);

    // When groupByOther=true is requested, low count occurrences are grouped under 'Other / General'
    const responseGrouped = await app.inject({
      method: 'GET',
      url: '/api/tutoring/teacher/topics?courseId=course-1&groupByOther=true',
      headers: { authorization: `Bearer ${teacherToken}` },
    });
    expect(responseGrouped.statusCode).toBe(200);
    const bodyGrouped = parseBody<TeacherTopicsResponse>(responseGrouped);
    expect(bodyGrouped.topics).toEqual([
      { topic: 'Topic A', count: 4 },
      { topic: 'Other / General', count: 3 },
    ]);
  });

  it('strictly excludes personal fields, learner IDs, and raw conversation transcripts', async () => {
    const { app, repo } = setupTest();

    // Seed questions with identifiable text in the conversation
    repo.requests.push({
      id: '00000000-0000-0000-0000-000000000099',
      conversationId: '00000000-0000-0000-0000-000000000001',
      ownerId: learnerUser.id,
      courseId: 'course-1',
      requestId: 'req-secret-1',
      question:
        '[Topic A] My name is John Doe and my phone is +251911223344 with accommodation visual-impairment',
      state: 'completed',
      answerText: 'Secret transcript answer text',
      answerLang: 'en',
      errorReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      purgedAt: null,
    });
    repo.requests.push({
      id: '00000000-0000-0000-0000-000000000100',
      conversationId: '00000000-0000-0000-0000-000000000001',
      ownerId: learnerUser.id,
      courseId: 'course-1',
      requestId: 'req-secret-2',
      question: '[Topic A] Another question on topic A',
      state: 'completed',
      answerText: 'Transcript two',
      answerLang: 'en',
      errorReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      purgedAt: null,
    });
    repo.requests.push({
      id: '00000000-0000-0000-0000-000000000101',
      conversationId: '00000000-0000-0000-0000-000000000001',
      ownerId: learnerUser.id,
      courseId: 'course-1',
      requestId: 'req-secret-3',
      question: '[Topic A] Third question on topic A',
      state: 'completed',
      answerText: 'Transcript three',
      answerLang: 'en',
      errorReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      purgedAt: null,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/tutoring/teacher/topics?courseId=course-1',
      headers: { authorization: `Bearer ${teacherToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = parseBody<TeacherTopicsResponse>(response);
    const rawJson = JSON.stringify(body);

    // Verify response schema only contains approved aggregate metadata
    expect(Object.keys(body).sort()).toEqual([
      'courseId',
      'kThreshold',
      'suppressedCount',
      'topics',
      'totalQuestions',
    ]);

    for (const item of body.topics) {
      expect(Object.keys(item).sort()).toEqual(['count', 'topic']);
    }

    // Verify complete absence of learner ID, personal names, phone numbers, accommodation, or transcripts
    expect(body).not.toHaveProperty('ownerId');
    expect(body).not.toHaveProperty('owner_id');
    expect(body).not.toHaveProperty('learnerId');
    expect(body).not.toHaveProperty('learner_id');
    expect(body).not.toHaveProperty('transcripts');
    expect(body).not.toHaveProperty('transcript');
    expect(body).not.toHaveProperty('conversationId');
    expect(body).not.toHaveProperty('questions');

    expect(rawJson).not.toContain(learnerUser.id);
    expect(rawJson).not.toContain('John Doe');
    expect(rawJson).not.toContain('+251911223344');
    expect(rawJson).not.toContain('visual-impairment');
    expect(rawJson).not.toContain('Secret transcript');
  });

  it('excludes purged rows according to retention policy', async () => {
    const { app, repo } = setupTest();

    // 2 active questions on Topic A
    // 2 purged questions on Topic A
    const now = new Date();
    repo.requests.push({
      id: '00000000-0000-0000-0000-000000000201',
      conversationId: '00000000-0000-0000-0000-000000000001',
      ownerId: learnerUser.id,
      courseId: 'course-1',
      requestId: 'active-1',
      question: '[Topic A] Active 1',
      state: 'completed',
      answerText: 'Answer',
      answerLang: 'en',
      errorReason: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
      purgedAt: null,
    });
    repo.requests.push({
      id: '00000000-0000-0000-0000-000000000202',
      conversationId: '00000000-0000-0000-0000-000000000001',
      ownerId: learnerUser.id,
      courseId: 'course-1',
      requestId: 'active-2',
      question: '[Topic A] Active 2',
      state: 'completed',
      answerText: 'Answer',
      answerLang: 'en',
      errorReason: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
      purgedAt: null,
    });
    repo.requests.push({
      id: '00000000-0000-0000-0000-000000000203',
      conversationId: '00000000-0000-0000-0000-000000000001',
      ownerId: learnerUser.id,
      courseId: 'course-1',
      requestId: 'purged-1',
      question: '[Topic A] Purged 1',
      state: 'completed',
      answerText: null,
      answerLang: null,
      errorReason: null,
      createdAt: new Date(now.getTime() - 10 * 86400000).toISOString(),
      updatedAt: now.toISOString(),
      completedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() - 3 * 86400000).toISOString(),
      purgedAt: now.toISOString(),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/tutoring/teacher/topics?courseId=course-1',
      headers: { authorization: `Bearer ${teacherToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = parseBody<TeacherTopicsResponse>(response);
    // Only the 2 active questions are counted; the purged question is omitted
    expect(body.totalQuestions).toBe(2);
    // Because 2 < 3, Topic A is suppressed
    expect(body.topics).toEqual([]);
    expect(body.suppressedCount).toBe(2);
  });

  it('allows support role with course grant to access aggregate topics', async () => {
    const { app, repo } = setupTest();

    for (let i = 1; i <= 3; i++) {
      repo.requests.push({
        id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
        conversationId: '00000000-0000-0000-0000-000000000001',
        ownerId: learnerUser.id,
        courseId: 'course-1',
        requestId: `support-test-${i}`,
        question: '[Topic S] Support topic question',
        state: 'completed',
        answerText: 'Answer',
        answerLang: 'en',
        errorReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        purgedAt: null,
      });
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/tutoring/teacher/topics?courseId=course-1',
      headers: { authorization: `Bearer ${supportToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = parseBody<TeacherTopicsResponse>(response);
    expect(body.topics).toEqual([{ topic: 'Topic S', count: 3 }]);
    expect(body.suppressedCount).toBe(0);
  });
});
