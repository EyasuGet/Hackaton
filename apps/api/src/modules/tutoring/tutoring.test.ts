// Unit tests for tutoring use cases, FAQ answers, and routes (T3-007-A & T3-007-D).
// Verifies ownership boundaries, course scope, atomic claims, FAQ citation resolution,
// honest limitations for missing evidence, duplicate submission idempotency and input validation.
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../bootstrap/app.ts';
import type { Readiness } from '../../infrastructure/database/migrations.ts';
import { DemoRecords } from '../demo-records/demo-records.ts';
import { DemoSessions } from '../identity/application/demo-sessions.ts';
import { digestToken, ResolvePrincipal } from '../identity/application/resolve-principal.ts';
import type { OwnedScope, Principal } from '../identity/domain/principal.ts';
import type {
  ClaimRequestInput,
  ClaimResult,
  RecordOutcomeInput,
  TutoringRepository,
} from './application/ports/tutoring-repository.ts';
import { Tutoring } from './application/tutoring.ts';
import { FaqProvider } from './application/faq-provider.ts';
import type { TutoringConversation } from './domain/conversation.ts';
import type { TutoringRequest } from './domain/tutoring-request.ts';
import { ContentAccess } from '../content/application/content-access.ts';
import type { CitationResult, CitedSection } from '../content/domain/retrieval.ts';

class InMemoryTutoringRepository implements TutoringRepository {
  readonly conversations: TutoringConversation[] = [];
  readonly requests: TutoringRequest[] = [];
  #counter = 1;

  createConversation(scope: OwnedScope, courseId: string): Promise<TutoringConversation | null> {
    if (!scope.courseIds.includes(courseId)) return Promise.resolve(null);
    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const conv: TutoringConversation = {
      id: `00000000-0000-0000-0000-${String(this.#counter++).padStart(12, '0')}`,
      ownerId: scope.ownerId,
      courseId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
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
    if (!conv) return Promise.resolve(null);
    if (conv.ownerId !== scope.ownerId || !scope.courseIds.includes(conv.courseId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(conv);
  }

  async claimRequest(scope: OwnedScope, input: ClaimRequestInput): Promise<ClaimResult | null> {
    if (!scope.courseIds.includes(input.courseId)) return null;

    const existing = this.requests.find(
      (r) => r.ownerId === scope.ownerId && r.requestId === input.requestId,
    );
    if (existing) {
      return { kind: 'existing', request: existing };
    }

    let convId = input.conversationId;
    if (!convId) {
      const conv = await this.createConversation(scope, input.courseId);
      if (!conv) return null;
      convId = conv.id;
    } else {
      const conv = await this.findConversation(scope, convId);
      if (!conv || conv.courseId !== input.courseId) return null;
    }

    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const req: TutoringRequest = {
      id: `00000000-0000-0000-0000-${String(this.#counter++).padStart(12, '0')}`,
      conversationId: convId,
      ownerId: scope.ownerId,
      courseId: input.courseId,
      requestId: input.requestId,
      question: input.question,
      state: 'pending',
      answerText: null,
      answerLang: null,
      errorReason: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: null,
      expiresAt: expires.toISOString(),
      purgedAt: null,
    };
    this.requests.push(req);
    return { kind: 'claimed', request: req };
  }

  findRequestById(scope: OwnedScope, id: string): Promise<TutoringRequest | null> {
    const req = this.requests.find((r) => r.id === id);
    if (!req) return Promise.resolve(null);
    if (req.ownerId !== scope.ownerId || !scope.courseIds.includes(req.courseId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(req);
  }

  findRequestByRequestId(scope: OwnedScope, requestId: string): Promise<TutoringRequest | null> {
    const req = this.requests.find((r) => r.requestId === requestId && r.ownerId === scope.ownerId);
    if (!req) return Promise.resolve(null);
    if (!scope.courseIds.includes(req.courseId)) return Promise.resolve(null);
    return Promise.resolve(req);
  }

  listHistory(scope: OwnedScope, courseId?: string): Promise<readonly TutoringRequest[]> {
    return Promise.resolve(
      this.requests.filter((r) => {
        if (r.ownerId !== scope.ownerId) return false;
        if (courseId && r.courseId !== courseId) return false;
        if (r.purgedAt !== null) return false;
        return scope.courseIds.includes(r.courseId);
      }),
    );
  }

  recordOutcome(
    scope: OwnedScope,
    requestId: string,
    outcome: RecordOutcomeInput,
  ): Promise<TutoringRequest | null> {
    const index = this.requests.findIndex((r) => r.id === requestId);
    if (index === -1) return Promise.resolve(null);
    const req = this.requests[index];
    if (!req || req.ownerId !== scope.ownerId || !scope.courseIds.includes(req.courseId)) {
      return Promise.resolve(null);
    }

    const now = new Date().toISOString();
    const updated: TutoringRequest = {
      ...req,
      state: outcome.state,
      answerText: outcome.answerText ?? null,
      answerLang: outcome.answerLang ?? null,
      errorReason: outcome.errorReason ?? null,
      updatedAt: now,
      completedAt: outcome.state === 'completed' ? now : req.completedAt,
    };
    this.requests[index] = updated;
    return Promise.resolve(updated);
  }

  clearHistory(scope: OwnedScope): Promise<void> {
    // Remove conversations owned by this scope
    for (let i = this.conversations.length - 1; i >= 0; i--) {
      if (this.conversations[i]!.ownerId === scope.ownerId) this.conversations.splice(i, 1);
    }
    // Remove requests owned by this scope
    for (let i = this.requests.length - 1; i >= 0; i--) {
      if (this.requests[i]!.ownerId === scope.ownerId) this.requests.splice(i, 1);
    }
    return Promise.resolve();
  }

  purgeExpired(now: Date): Promise<number> {
    let count = 0;
    for (let i = 0; i < this.requests.length; i++) {
      const r = this.requests[i]!;
      if (new Date(r.expiresAt) <= now && r.purgedAt === null) {
        this.requests[i] = {
          ...r,
          question: '',
          answerText: null,
          answerLang: null,
          errorReason: null,
          purgedAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };
        count++;
      }
    }
    return Promise.resolve(count);
  }
}

const learnerA: Principal = {
  id: '00000000-0000-0000-0000-000000000001',
  role: 'learner',
  label: 'Learner A',
  demo: true,
  courseIds: ['course-1'],
};

const learnerB: Principal = {
  id: '00000000-0000-0000-0000-000000000002',
  role: 'learner',
  label: 'Learner B',
  demo: true,
  courseIds: ['course-1', 'course-2'],
};

const supportUser: Principal = {
  id: '00000000-0000-0000-0000-000000000003',
  role: 'support',
  label: 'Support Staff',
  demo: true,
  courseIds: [],
};

const learnerAToken = 'a'.repeat(43);
const learnerBToken = 'b'.repeat(43);
const supportToken = 'c'.repeat(43);

const tokenMap: Record<string, Principal> = {
  [digestToken(learnerAToken)]: learnerA,
  [digestToken(learnerBToken)]: learnerB,
  [digestToken(supportToken)]: supportUser,
};

function createMockContentAccess(): ContentAccess {
  return new ContentAccess(
    {
      search: () => Promise.resolve([]),
      resolve: (courseIds, sourceId, sectionId): Promise<CitationResult> => {
        if (sourceId === 'savanna-va1-future-of-va-industry' && courseIds.includes('course-1')) {
          const sec: CitedSection = {
            sourceId,
            sectionId,
            sourceTitle: 'The Future of the VA Industry',
            heading:
              sectionId === 'introduction'
                ? 'Introduction'
                : 'Artificial Intelligence and the Future of VA Work',
            text: 'Section content...',
            language: 'en',
            courseId: 'course-1',
            version: 'starter-9e83ac7',
            anchor: sectionId,
            provenance: {
              kind: 'organiser',
              repository: 'alx-africa/Savanna-static-pages',
              commit: '9e83ac7',
              path: 'pages/concept-with-navigation.html',
            },
          };
          return Promise.resolve({ kind: 'section', section: sec });
        }
        if (sourceId === 'demo-time-management-am' && courseIds.includes('course-2')) {
          const sec: CitedSection = {
            sourceId,
            sectionId,
            sourceTitle: 'የጊዜ አጠቃቀም መሠረታዊ ነገሮች',
            heading: sectionId === 'planning' ? 'እቅድ ማውጣት' : 'እረፍት መውሰድ',
            text: 'የክፍል ጽሑፍ...',
            language: 'am',
            courseId: 'course-2',
            version: 'demo-1',
            anchor: null,
            provenance: { kind: 'demo', note: 'test' },
          };
          return Promise.resolve({ kind: 'section', section: sec });
        }
        return Promise.resolve({ kind: 'not_found' });
      },
    },
    [],
  );
}

function createTestApp(tutoringService: Tutoring, contentAccess?: ContentAccess) {
  const readiness: Readiness = { ready: true };
  const resolvePrincipal = new ResolvePrincipal(
    {
      findDemoByTokenDigest: (digest) => Promise.resolve(tokenMap[digest] ?? null),
    },
    true,
  );

  const content = contentAccess ?? createMockContentAccess();

  return buildApp({
    checkReadiness: () => Promise.resolve(readiness),
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
      },
      true,
    ),
    demoAllowedOrigins: [],
    tutoring: tutoringService,
    content,
  });
}

describe('Tutoring Use Cases', () => {
  it('allows an authorized learner to claim a request atomically', async () => {
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo);

    const result = await tutoring.claim(learnerA, {
      courseId: 'course-1',
      requestId: 'req-001',
      question: 'What is unit 1 about?',
    });

    expect(result).not.toBeNull();
    expect(result?.kind).toBe('claimed');
    expect(result?.request.state).toBe('pending');
    expect(result?.request.ownerId).toBe(learnerA.id);
    expect(result?.request.courseId).toBe('course-1');
    expect(result?.request.answerText).toBeNull();
  });

  it('returns existing request on duplicate claim without creating a new record', async () => {
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo);

    const first = await tutoring.claim(learnerA, {
      courseId: 'course-1',
      requestId: 'req-dup-1',
      question: 'Original question?',
    });

    const second = await tutoring.claim(learnerA, {
      courseId: 'course-1',
      requestId: 'req-dup-1',
      question: 'Retried question?',
    });

    expect(first?.kind).toBe('claimed');
    expect(second?.kind).toBe('existing');
    expect(second?.request.id).toBe(first?.request.id);
    expect(second?.request.question).toBe('Original question?');
    expect(repo.requests).toHaveLength(1);
  });

  it('isolates claims when different learners submit the same requestId', async () => {
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo);

    const resA = await tutoring.claim(learnerA, {
      courseId: 'course-1',
      requestId: 'shared-id',
      question: 'Question by A',
    });

    const resB = await tutoring.claim(learnerB, {
      courseId: 'course-1',
      requestId: 'shared-id',
      question: 'Question by B',
    });

    expect(resA?.kind).toBe('claimed');
    expect(resB?.kind).toBe('claimed');
    expect(resA?.request.id).not.toBe(resB?.request.id);
    expect(resA?.request.ownerId).toBe(learnerA.id);
    expect(resB?.request.ownerId).toBe(learnerB.id);
  });

  it('rejects claim for an ungranted course', async () => {
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo);

    const result = await tutoring.claim(learnerA, {
      courseId: 'course-2',
      requestId: 'req-ungranted',
      question: 'Should be rejected',
    });

    expect(result).toBeNull();
  });

  it('gives support staff zero scope (null result)', async () => {
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo);

    const result = await tutoring.claim(supportUser, {
      courseId: 'course-1',
      requestId: 'req-support',
      question: 'Support staff asking',
    });

    expect(result).toBeNull();
    const history = await tutoring.listHistory(supportUser);
    expect(history).toEqual([]);
  });

  it('records outcome transitions correctly', async () => {
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo);

    const claimed = await tutoring.claim(learnerA, {
      courseId: 'course-1',
      requestId: 'req-transition',
      question: 'Question to complete',
    });
    expect(claimed).not.toBeNull();
    const id = claimed!.request.id;

    const completed = await tutoring.recordOutcome(learnerA, id, {
      state: 'completed',
      answerText: 'Here is the answer.',
      answerLang: 'en',
    });

    expect(completed?.state).toBe('completed');
    expect(completed?.answerText).toBe('Here is the answer.');
    expect(completed?.completedAt).not.toBeNull();

    const failed = await tutoring.recordOutcome(learnerA, id, {
      state: 'recoverable_failure',
      errorReason: 'timeout',
    });

    expect(failed?.state).toBe('recoverable_failure');
    expect(failed?.errorReason).toBe('timeout');
    expect(failed?.answerText).toBeNull();
  });
});

describe('Tutoring FAQ Provider (T3-007-A)', () => {
  it('answers supported English questions and returns verified citations', async () => {
    const content = createMockContentAccess();
    const faq = new FaqProvider(content);
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo, faq);

    const res = await tutoring.askFaq(learnerA, {
      courseId: 'course-1',
      requestId: 'faq-req-1',
      question: 'What is a virtual assistant?',
    });

    expect(res).not.toBeNull();
    expect(res?.faqResult.kind).toBe('answered');
    expect(res?.faqResult.answerLang).toBe('en');
    expect(res?.faqResult.answerText).toContain('human remote professionals');
    expect(res?.faqResult.citations).toHaveLength(1);
    expect(res?.faqResult.citations[0]?.sourceId).toBe('savanna-va1-future-of-va-industry');
    expect(res?.faqResult.citations[0]?.sectionId).toBe('introduction');

    // Persisted in repository with completed state and answer text
    expect(res?.request.state).toBe('completed');
    expect(res?.request.answerText).toBe(res?.faqResult.answerText);
    expect(res?.request.completedAt).not.toBeNull();
  });

  it('answers supported Amharic questions with verified Amharic citations', async () => {
    const content = createMockContentAccess();
    const faq = new FaqProvider(content);
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo, faq);

    const res = await tutoring.askFaq(learnerB, {
      courseId: 'course-2',
      requestId: 'faq-req-am',
      question: 'ቀኑን ከመጀመርዎ በፊት ምን እንዲያደርጉ ተመክረዋል?',
    });

    expect(res).not.toBeNull();
    expect(res?.faqResult.kind).toBe('answered');
    expect(res?.faqResult.answerLang).toBe('am');
    expect(res?.faqResult.answerText).toContain('የሚሠሯቸውን ሥራዎች ይዘርዝሩ');
    expect(res?.faqResult.citations).toHaveLength(1);
    expect(res?.faqResult.citations[0]?.sourceId).toBe('demo-time-management-am');
    expect(res?.faqResult.citations[0]?.sectionId).toBe('planning');
  });

  it('returns explicit honest limitation when evidence is absent', async () => {
    const content = createMockContentAccess();
    const faq = new FaqProvider(content);
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo, faq);

    const res = await tutoring.askFaq(learnerA, {
      courseId: 'course-1',
      requestId: 'faq-req-missing',
      question: 'What is the hourly rate in US dollars?',
    });

    expect(res).not.toBeNull();
    expect(res?.faqResult.kind).toBe('insufficient_evidence');
    expect(res?.faqResult.answerText).toContain('do not have an approved course answer');
    expect(res?.faqResult.citations).toEqual([]);

    // Persisted as completed limitation, not unhandled failure
    expect(res?.request.state).toBe('completed');
    expect(res?.request.answerText).toContain('do not have an approved course answer');
  });

  it('returns limitation in Amharic when Amharic question lacks evidence', async () => {
    const content = createMockContentAccess();
    const faq = new FaqProvider(content);
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo, faq);

    const res = await tutoring.askFaq(learnerB, {
      courseId: 'course-2',
      requestId: 'faq-req-am-missing',
      question: 'ስለ ፖሞዶሮ ስንት ደቂቃ ነው?',
    });

    expect(res).not.toBeNull();
    expect(res?.faqResult.kind).toBe('insufficient_evidence');
    expect(res?.faqResult.answerLang).toBe('am');
    expect(res?.faqResult.answerText).toContain('የተረጋገጠ መልስ አልተገኘም');
    expect(res?.faqResult.citations).toEqual([]);
  });

  it('refuses to answer or access FAQs for an ungranted course', async () => {
    const content = createMockContentAccess();
    const faq = new FaqProvider(content);
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo, faq);

    // Learner A does not have course-2
    const res = await tutoring.askFaq(learnerA, {
      courseId: 'course-2',
      requestId: 'faq-req-ungranted',
      question: 'ቀኑን ከመጀመርዎ በፊት ምን እንዲያደርጉ ተመክረዋል?',
    });

    expect(res).toBeNull();
  });

  it('handles duplicate submissions idempotently returning the original answer', async () => {
    const content = createMockContentAccess();
    const faq = new FaqProvider(content);
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo, faq);

    const first = await tutoring.askFaq(learnerA, {
      courseId: 'course-1',
      requestId: 'faq-idempotent',
      question: 'What is a virtual assistant?',
    });

    const second = await tutoring.askFaq(learnerA, {
      courseId: 'course-1',
      requestId: 'faq-idempotent',
      question: 'What is a virtual assistant?',
    });

    expect(first?.request.id).toBe(second?.request.id);
    expect(second?.faqResult.answerText).toBe(first?.faqResult.answerText);
    expect(repo.requests).toHaveLength(1);
  });
});

describe('Tutoring HTTP Routes', () => {
  it('validates required request fields and enforces learner role on /api/tutoring/requests', async () => {
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo);
    const app = createTestApp(tutoring);

    // Missing authorization
    const unauth = await app.inject({
      method: 'POST',
      url: '/api/tutoring/requests',
      payload: { courseId: 'course-1', requestId: 'req-1', question: 'q' },
    });
    expect(unauth.statusCode).toBe(401);

    // Support role forbidden
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/tutoring/requests',
      headers: { authorization: `Bearer ${supportToken}` },
      payload: { courseId: 'course-1', requestId: 'req-1', question: 'q' },
    });
    expect(forbidden.statusCode).toBe(403);

    // Invalid body (missing question)
    const badReq = await app.inject({
      method: 'POST',
      url: '/api/tutoring/requests',
      headers: { authorization: `Bearer ${learnerAToken}` },
      payload: { courseId: 'course-1', requestId: 'req-1', question: '' },
    });
    expect(badReq.statusCode).toBe(400);

    // Valid claim returns 201
    const valid = await app.inject({
      method: 'POST',
      url: '/api/tutoring/requests',
      headers: { authorization: `Bearer ${learnerAToken}` },
      payload: { courseId: 'course-1', requestId: 'req-valid-1', question: 'Hello?' },
    });
    expect(valid.statusCode).toBe(201);
    expect(valid.json()).toMatchObject({
      kind: 'claimed',
      request: {
        state: 'pending',
        courseId: 'course-1',
        question: 'Hello?',
      },
    });

    await app.close();
  });

  it('answers cited FAQ questions via POST /api/tutoring/faq', async () => {
    const repo = new InMemoryTutoringRepository();
    const content = createMockContentAccess();
    const faq = new FaqProvider(content);
    const tutoring = new Tutoring(repo, faq);
    const app = createTestApp(tutoring, content);

    const response = await app.inject({
      method: 'POST',
      url: '/api/tutoring/faq',
      headers: { authorization: `Bearer ${learnerAToken}` },
      payload: {
        courseId: 'course-1',
        requestId: 'req-faq-route-1',
        question: 'What is a virtual assistant?',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      kind: string;
      answer: string;
      citations: Array<{ sourceId: string }>;
      request: { state: string };
    }>();
    expect(body.kind).toBe('answered');
    expect(body.answer).toContain('human remote professionals');
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0]?.sourceId).toBe('savanna-va1-future-of-va-industry');
    expect(body.request.state).toBe('completed');

    await app.close();
  });

  it('allows a learner to clear their own history via DELETE /api/tutoring/history', async () => {
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo);
    const app = createTestApp(tutoring);

    await app.inject({
      method: 'POST',
      url: '/api/tutoring/requests',
      headers: { authorization: `Bearer ${learnerAToken}` },
      payload: { courseId: 'course-1', requestId: 'req-to-clear', question: 'Will be cleared' },
    });
    expect(repo.requests).toHaveLength(1);

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/tutoring/history',
      headers: { authorization: `Bearer ${learnerAToken}` },
    });
    expect(del.statusCode).toBe(204);
    expect(repo.requests).toHaveLength(0);
    expect(repo.conversations).toHaveLength(0);

    await app.close();
  });

  it('forbids non-learners from clearing history via DELETE /api/tutoring/history', async () => {
    const repo = new InMemoryTutoringRepository();
    const app = createTestApp(new Tutoring(repo));

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/tutoring/history',
      headers: { authorization: `Bearer ${supportToken}` },
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });

  it('forbids learners from triggering purge via POST /api/tutoring/admin/purge', async () => {
    const app = createTestApp(new Tutoring(new InMemoryTutoringRepository()));

    const res = await app.inject({
      method: 'POST',
      url: '/api/tutoring/admin/purge',
      headers: { authorization: `Bearer ${learnerAToken}` },
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });

  it('allows support role to trigger purge via POST /api/tutoring/admin/purge', async () => {
    const app = createTestApp(new Tutoring(new InMemoryTutoringRepository()));

    const res = await app.inject({
      method: 'POST',
      url: '/api/tutoring/admin/purge',
      headers: { authorization: `Bearer ${supportToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ purged: 0 });

    await app.close();
  });
});

describe('Tutoring History Clear and Expiry (T3-023-B)', () => {
  it('clearHistory removes only the requesting learner records, not another learner', async () => {
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo);

    await tutoring.claim(learnerA, {
      courseId: 'course-1',
      requestId: 'req-a-clear',
      question: 'A question',
    });
    await tutoring.claim(learnerB, {
      courseId: 'course-1',
      requestId: 'req-b-clear',
      question: 'B question',
    });
    expect(repo.requests).toHaveLength(2);

    const cleared = await tutoring.clearHistory(learnerA);
    expect(cleared).toBe(true);

    expect(repo.requests.filter((r) => r.ownerId === learnerA.id)).toHaveLength(0);
    expect(repo.requests.filter((r) => r.ownerId === learnerB.id)).toHaveLength(1);
  });

  it('support principal cannot clear history (returns false)', async () => {
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo);
    expect(await tutoring.clearHistory(supportUser)).toBe(false);
  });

  it('purgeExpired redacts content of expired records and leaves non-expired records intact', async () => {
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo);
    const past = new Date('2020-01-01T00:00:00Z');

    await tutoring.claim(learnerA, {
      courseId: 'course-1',
      requestId: 'req-expired',
      question: 'Expired question',
    });
    await tutoring.claim(learnerA, {
      courseId: 'course-1',
      requestId: 'req-fresh',
      question: 'Fresh question',
    });

    // Force expiry on the first request to be in the past
    const expiredIdx = repo.requests.findIndex((r) => r.requestId === 'req-expired');
    repo.requests[expiredIdx] = { ...repo.requests[expiredIdx]!, expiresAt: past.toISOString() };

    const purged = await tutoring.purgeExpired(new Date('2025-01-01T00:00:00Z'));
    expect(purged).toBe(1);

    const expiredReq = repo.requests.find((r) => r.requestId === 'req-expired');
    expect(expiredReq?.question).toBe('');
    expect(expiredReq?.answerText).toBeNull();
    expect(expiredReq?.purgedAt).not.toBeNull();

    const freshReq = repo.requests.find((r) => r.requestId === 'req-fresh');
    expect(freshReq?.question).toBe('Fresh question');
    expect(freshReq?.purgedAt).toBeNull();

    // Purged records must not appear in listHistory
    const history = await tutoring.listHistory(learnerA);
    expect(history.some((r) => r.requestId === 'req-expired')).toBe(false);
    expect(history.some((r) => r.requestId === 'req-fresh')).toBe(true);
  });

  it('purgeExpired is idempotent across multiple runs', async () => {
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo);

    await tutoring.claim(learnerA, {
      courseId: 'course-1',
      requestId: 'req-idem',
      question: 'Idempotent check',
    });
    const idx = repo.requests.findIndex((r) => r.requestId === 'req-idem');
    repo.requests[idx] = {
      ...repo.requests[idx]!,
      expiresAt: new Date('2020-01-01T00:00:00Z').toISOString(),
    };

    const first = await tutoring.purgeExpired(new Date('2025-01-01T00:00:00Z'));
    const second = await tutoring.purgeExpired(new Date('2025-01-01T00:00:00Z'));
    expect(first).toBe(1);
    expect(second).toBe(0);
  });
});
