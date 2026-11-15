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
import { GeminiGroundedAnswerProvider } from '../../evaluations/grounding/provider-adapter.ts';
import { ContentAccess, type LessonReader } from '../content/application/content-access.ts';
import type {
  CitationResult,
  CitedSection,
  GlossaryGroup,
  Passage,
} from '../content/domain/retrieval.ts';
import { JobAnswers } from '../careers/application/job-answers.ts';
import type { JobRecord } from '../careers/domain/job.ts';
import { FaqProvider } from './application/faq-provider.ts';
import type {
  OnlineAnswerProvider,
  OnlineAnswerRequest,
} from './application/ports/online-answer-provider.ts';
import type {
  ClaimRequestInput,
  ClaimResult,
  RecordOutcomeInput,
  TutoringRepository,
} from './application/ports/tutoring-repository.ts';
import type { TutoringConversation } from './domain/conversation.ts';
import type { TutoringRequest } from './domain/tutoring-request.ts';
import { Tutoring, TutoringError } from './application/tutoring.ts';

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

function createRetrievalContentAccess(): ContentAccess {
  const glossary: GlossaryGroup[] = [
    { en: ['virtual assistant', 'va', 'industry'], am: ['ረዳት', 'ቨርቹዋል'] },
    { en: ['planning', 'plan', 'commencing', 'daily tasks'], am: ['እቅድ', 'ቀኑን', 'ሥራዎች'] },
    { en: ['breaks', 'break'], am: ['እረፍት'] },
  ];

  const passages: Passage[] = [
    {
      sourceId: 'savanna-va1-future-of-va-industry',
      sectionId: 'introduction',
      sourceTitle: 'The Future of the VA Industry',
      heading: 'Introduction',
      text: 'Virtual Assistant can mean AI software assistants such as chatbots or human remote professionals providing business support online.',
      language: 'en',
      courseId: 'course-1',
      version: 'starter-9e83ac7',
    },
    {
      sourceId: 'savanna-va1-future-of-va-industry',
      sectionId: 'artificial-intelligence-and-the-future-of-va-work',
      sourceTitle: 'The Future of the VA Industry',
      heading: 'Artificial Intelligence and the Future of VA Work',
      text: 'AI tools can assist with routine tasks including drafting emails, summarizing meetings, and organizing workflows.',
      language: 'en',
      courseId: 'course-1',
      version: 'starter-9e83ac7',
    },
    {
      sourceId: 'savanna-va1-future-of-va-industry',
      sectionId: 'what-clients-are-likely-to-value-more-and-more',
      sourceTitle: 'The Future of the VA Industry',
      heading: 'What Clients Are Likely to Value More and More',
      text: 'Clients will increasingly value human differentiators including responsiveness, dependability, and emotional intelligence.',
      language: 'en',
      courseId: 'course-1',
      version: 'starter-9e83ac7',
    },
    {
      sourceId: 'demo-time-management-am',
      sectionId: 'planning',
      sourceTitle: 'የጊዜ አጠቃቀም መሠረታዊ ነገሮች',
      heading: 'እቅድ ማውጣት',
      text: 'ቀኑን ከመጀመርዎ በፊት የሚሠሩትን ሥራዎች በቅድሚያ እንዲዘረዝሩ እና በጣም አስፈላጊ ለሆኑት ሥራዎች ቅድሚያ ሰጥተው እንዲሠሩ ተመክረዋል።',
      language: 'am',
      courseId: 'course-2',
      version: 'demo-1',
    },
    {
      sourceId: 'demo-time-management-am',
      sectionId: 'breaks',
      sourceTitle: 'የጊዜ አጠቃቀም መሠረታዊ ነገሮች',
      heading: 'እረፍት መውሰድ',
      text: 'በሥራ መካከል አጭር እረፍት መውሰድ ትኩረትን ለመጠበቅ ይረዳል።',
      language: 'am',
      courseId: 'course-2',
      version: 'demo-1',
    },
  ];

  const reader: LessonReader = {
    // eslint-disable-next-line @typescript-eslint/require-await
    search: async (courseIds, question) => {
      const q = question.toLowerCase();
      if (
        q.includes('hourly rate') ||
        q.includes('pomodoro') ||
        q.includes('ፖሞዶሮ') ||
        q.includes('postgresql') ||
        q.includes('pricing')
      ) {
        return [];
      }

      return passages.filter((p) => {
        if (!courseIds.includes(p.courseId)) return false;
        if (p.courseId === 'course-2') {
          if (
            p.sectionId === 'planning' &&
            (q.includes('planning') ||
              q.includes('ቀኑን') ||
              q.includes('እቅድ') ||
              q.includes('commencing') ||
              q.includes('plan'))
          ) {
            return true;
          }
          if (p.sectionId === 'breaks' && (q.includes('breaks') || q.includes('እረፍት'))) {
            return true;
          }
          return false;
        }

        if (p.courseId === 'course-1') {
          if (
            p.sectionId === 'artificial-intelligence-and-the-future-of-va-work' &&
            (q.includes('routine') || q.includes('tasks can ai') || q.includes('ai tools'))
          ) {
            return true;
          }
          if (
            p.sectionId === 'what-clients-are-likely-to-value-more-and-more' &&
            (q.includes('human value') || q.includes('differentiators'))
          ) {
            return true;
          }
          if (
            p.sectionId === 'introduction' &&
            (q.includes('virtual assistant') || q.includes('ረዳት') || q.includes('ሁለት የተለያዩ'))
          ) {
            return true;
          }
          return false;
        }

        return false;
      });
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    resolve: async (courseIds, sourceId, sectionId) => {
      const found = passages.find(
        (p) =>
          courseIds.includes(p.courseId) && p.sourceId === sourceId && p.sectionId === sectionId,
      );
      if (!found) return { kind: 'not_found' };
      const sec: CitedSection = {
        ...found,
        anchor: found.sectionId,
        provenance: { kind: 'demo', note: 'test' },
      };
      return { kind: 'section', section: sec };
    },
  };

  return new ContentAccess(reader, glossary);
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
        extendSession: () => Promise.resolve(false),
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

describe('Online Grounded Answer Path with Safe Fallback (T3-007-C)', () => {
  it('repeats supported English evidence case with permission-filtered retrieval', async () => {
    const content = createRetrievalContentAccess();
    const faq = new FaqProvider(content);
    const online = new GeminiGroundedAnswerProvider();
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo, faq, online, content);

    const result = await tutoring.ask(learnerA, {
      courseId: 'course-1',
      requestId: 'online-req-en-supp',
      question: 'What routine tasks can AI tools help a Virtual Assistant with?',
      externalConsent: true,
    });

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('online');
    expect(result?.kind).toBe('answered');
    expect(result?.answerLang).toBe('en');
    expect(result?.answerText).toContain('drafting emails');
    expect(result?.citations).toHaveLength(1);
    expect(result?.citations[0]?.sourceId).toBe('savanna-va1-future-of-va-industry');
    expect(result?.citations[0]?.sectionId).toBe(
      'artificial-intelligence-and-the-future-of-va-work',
    );
    expect(result?.request.state).toBe('completed');
  });

  it('repeats supported Amharic evidence case with permission-filtered retrieval', async () => {
    const content = createRetrievalContentAccess();
    const faq = new FaqProvider(content);
    const online = new GeminiGroundedAnswerProvider();
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo, faq, online, content);

    const result = await tutoring.ask(learnerB, {
      courseId: 'course-2',
      requestId: 'online-req-am-supp',
      question: 'ቀኑን ከመጀመርዎ በፊት ምን እንዲያደርጉ ተመክረዋል?',
      externalConsent: true,
    });

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('online');
    expect(result?.kind).toBe('answered');
    expect(result?.answerLang).toBe('am');
    expect(result?.answerText).toContain('ሥራዎች');
    expect(result?.citations).toHaveLength(1);
    expect(result?.citations[0]?.sourceId).toBe('demo-time-management-am');
    expect(result?.citations[0]?.sectionId).toBe('planning');
    expect(result?.request.state).toBe('completed');
  });

  it('repeats missing evidence English case with honest limitation and 0 citations', async () => {
    const content = createRetrievalContentAccess();
    const faq = new FaqProvider(content);
    const online = new GeminiGroundedAnswerProvider();
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo, faq, online, content);

    const result = await tutoring.ask(learnerA, {
      courseId: 'course-1',
      requestId: 'online-req-en-missing',
      question: 'What is the hourly rate in US dollars?',
      externalConsent: true,
    });

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('online');
    expect(result?.kind).toBe('insufficient_evidence');
    expect(result?.citations).toEqual([]);
    expect(result?.answerText).toContain('do not have an approved course answer');
    expect(result?.request.state).toBe('completed');
  });

  it('repeats missing evidence Amharic case with honest limitation and 0 citations', async () => {
    const content = createRetrievalContentAccess();
    const faq = new FaqProvider(content);
    const online = new GeminiGroundedAnswerProvider();
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo, faq, online, content);

    const result = await tutoring.ask(learnerB, {
      courseId: 'course-2',
      requestId: 'online-req-am-missing',
      question: 'ስለ ፖሞዶሮ ቴክኒክ ስንት ደቂቃ እረፍት መውሰድ እንዳለበት ተጠቅሷል?',
      externalConsent: true,
    });

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('online');
    expect(result?.kind).toBe('insufficient_evidence');
    expect(result?.answerLang).toBe('am');
    expect(result?.citations).toEqual([]);
    expect(result?.answerText).toContain('የተረጋገጠ መልስ አልተገኘም');
    expect(result?.request.state).toBe('completed');
  });

  it('repeats cross-language English source to Amharic query with glossary expansion', async () => {
    const content = createRetrievalContentAccess();
    const faq = new FaqProvider(content);
    const online = new GeminiGroundedAnswerProvider();
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo, faq, online, content);

    // Amharic question referencing English VA course
    const result = await tutoring.ask(learnerA, {
      courseId: 'course-1',
      requestId: 'online-req-cross-am-q',
      question: 'በመግቢያው ክፍል መሠረት Virtual Assistant ሁለት የተለያዩ ትርጉሞችን ይይዛል?',
      externalConsent: true,
    });

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('online');
    expect(result?.kind).toBe('answered');
    expect(result?.answerLang).toBe('am');
    expect(result?.citations).toHaveLength(1);
    expect(result?.citations[0]?.sourceId).toBe('savanna-va1-future-of-va-industry');
    expect(result?.citations[0]?.sectionId).toBe('introduction');
  });

  it('repeats cross-language Amharic source to English query with glossary expansion', async () => {
    const content = createRetrievalContentAccess();
    const faq = new FaqProvider(content);
    const online = new GeminiGroundedAnswerProvider();
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo, faq, online, content);

    // English question referencing Amharic time management course
    const result = await tutoring.ask(learnerB, {
      courseId: 'course-2',
      requestId: 'online-req-cross-en-q',
      question:
        'According to the planning lesson, what should a learner do prior to commencing daily tasks?',
      externalConsent: true,
    });

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('online');
    expect(result?.kind).toBe('answered');
    expect(result?.answerLang).toBe('en');
    expect(result?.citations).toHaveLength(1);
    expect(result?.citations[0]?.sourceId).toBe('demo-time-management-am');
    expect(result?.citations[0]?.sectionId).toBe('planning');
  });

  it('enforces course permission: learner cannot retrieve or answer ungranted course', async () => {
    const content = createRetrievalContentAccess();
    const faq = new FaqProvider(content);
    const online = new GeminiGroundedAnswerProvider();
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo, faq, online, content);

    // Learner A does not have course-2
    const result = await tutoring.ask(learnerA, {
      courseId: 'course-2',
      requestId: 'online-req-ungranted',
      question: 'ቀኑን ከመጀመርዎ በፊት ምን እንዲያደርጉ ተመክረዋል?',
      externalConsent: true,
    });

    expect(result).toBeNull();
  });

  it('rejects invented citation IDs and records recoverable_failure with errorReason="invented_citation"', async () => {
    const content = createRetrievalContentAccess();
    const faq = new FaqProvider(content);
    const repo = new InMemoryTutoringRepository();

    const fakeProvider: OnlineAnswerProvider = {
      name: 'hallucinating-citations-provider',
      isAvailable: () => true,
      // eslint-disable-next-line @typescript-eslint/require-await
      generateAnswer: async () => ({
        answer: 'This answer cites an invented section [fabricated-non-existent-section].',
        outcome: 'grounded_answer',
        citedPassageIds: ['fabricated-non-existent-section'],
      }),
    };

    const tutoring = new Tutoring(repo, faq, fakeProvider, content);

    await expect(
      tutoring.ask(learnerA, {
        courseId: 'course-1',
        requestId: 'req-fake-cite',
        question: 'What routine tasks can AI tools help a Virtual Assistant with?',
        externalConsent: true,
      }),
    ).rejects.toThrow(TutoringError);

    const record = repo.requests.find((r) => r.requestId === 'req-fake-cite');
    expect(record?.state).toBe('recoverable_failure');
    expect(record?.errorReason).toBe('invented_citation');
    expect(record?.answerText).toBeNull();
  });

  it('rejects citations attached to honest limitation as unsupported_output', async () => {
    const content = createRetrievalContentAccess();
    const faq = new FaqProvider(content);
    const repo = new InMemoryTutoringRepository();

    const contradictoryProvider: OnlineAnswerProvider = {
      name: 'contradictory-provider',
      isAvailable: () => true,
      // eslint-disable-next-line @typescript-eslint/require-await
      generateAnswer: async () => ({
        answer: 'I do not have sufficient evidence to answer this question.',
        outcome: 'honest_limitation',
        citedPassageIds: ['artificial-intelligence-and-the-future-of-va-work'],
      }),
    };

    const tutoring = new Tutoring(repo, faq, contradictoryProvider, content);

    await expect(
      tutoring.ask(learnerA, {
        courseId: 'course-1',
        requestId: 'req-unsupported-limitation',
        question: 'What routine tasks can AI tools help a Virtual Assistant with?',
        externalConsent: true,
      }),
    ).rejects.toThrow(TutoringError);

    const record = repo.requests.find((r) => r.requestId === 'req-unsupported-limitation');
    expect(record?.state).toBe('recoverable_failure');
    expect(record?.errorReason).toBe('unsupported_output');
  });

  it('truthfully records and reports provider timeout as recoverable_failure', async () => {
    const content = createRetrievalContentAccess();
    const faq = new FaqProvider(content);
    const repo = new InMemoryTutoringRepository();

    const timingOutProvider: OnlineAnswerProvider = {
      name: 'timing-out-provider',
      isAvailable: () => true,
      // eslint-disable-next-line @typescript-eslint/require-await
      generateAnswer: async () => {
        const err = new Error('Request timed out after 5000ms');
        err.name = 'TimeoutError';
        throw err;
      },
    };

    const tutoring = new Tutoring(repo, faq, timingOutProvider, content);

    await expect(
      tutoring.ask(learnerA, {
        courseId: 'course-1',
        requestId: 'req-timeout',
        question: 'What routine tasks can AI tools help a Virtual Assistant with?',
        externalConsent: true,
      }),
    ).rejects.toThrow(TutoringError);

    const record = repo.requests.find((r) => r.requestId === 'req-timeout');
    expect(record?.state).toBe('recoverable_failure');
    expect(record?.errorReason).toBe('timeout');
    expect(record?.answerText).toBeNull();
  });

  it('truthfully records and reports provider failure as recoverable_failure', async () => {
    const content = createRetrievalContentAccess();
    const faq = new FaqProvider(content);
    const repo = new InMemoryTutoringRepository();

    const failingProvider: OnlineAnswerProvider = {
      name: 'failing-provider',
      isAvailable: () => true,
      // eslint-disable-next-line @typescript-eslint/require-await
      generateAnswer: async () => {
        throw new Error('500 Internal Server Error from upstream');
      },
    };

    const tutoring = new Tutoring(repo, faq, failingProvider, content);

    await expect(
      tutoring.ask(learnerA, {
        courseId: 'course-1',
        requestId: 'req-provider-fail',
        question: 'What routine tasks can AI tools help a Virtual Assistant with?',
        externalConsent: true,
      }),
    ).rejects.toThrow(TutoringError);

    const record = repo.requests.find((r) => r.requestId === 'req-provider-fail');
    expect(record?.state).toBe('recoverable_failure');
    expect(record?.errorReason).toBe('provider_error');
    expect(record?.answerText).toBeNull();
  });

  it('falls back to labelled FAQ path when externalConsent is false', async () => {
    const content = createRetrievalContentAccess();
    const faq = new FaqProvider(content);
    const online = new GeminiGroundedAnswerProvider();
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo, faq, online, content);

    const result = await tutoring.ask(learnerA, {
      courseId: 'course-1',
      requestId: 'req-declined-consent',
      question: 'What is a virtual assistant?',
      externalConsent: false,
    });

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('faq');
    expect(result?.kind).toBe('answered');
    expect(result?.answerText).toContain('human remote professionals');
    expect(result?.citations).toHaveLength(1);
    expect(result?.citations[0]?.sourceId).toBe('savanna-va1-future-of-va-industry');
    expect(result?.citations[0]?.sectionId).toBe('introduction');
  });

  it('falls back to labelled FAQ path when online provider is unavailable', async () => {
    const content = createRetrievalContentAccess();
    const faq = new FaqProvider(content);
    const repo = new InMemoryTutoringRepository();

    const unavailableProvider: OnlineAnswerProvider = {
      name: 'offline-provider',
      isAvailable: () => false,
      generateAnswer: () => Promise.reject(new Error('Should not be called')),
    };

    const tutoring = new Tutoring(repo, faq, unavailableProvider, content);

    const result = await tutoring.ask(learnerA, {
      courseId: 'course-1',
      requestId: 'req-unavailable-provider',
      question: 'What is a virtual assistant?',
      externalConsent: true, // consent given, but provider unavailable
    });

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('faq');
    expect(result?.kind).toBe('answered');
    expect(result?.answerText).toContain('human remote professionals');
  });

  it('serves online answers and handles truthful error states on POST /api/tutoring/answers', async () => {
    const content = createRetrievalContentAccess();
    const faq = new FaqProvider(content);
    const online = new GeminiGroundedAnswerProvider();
    const repo = new InMemoryTutoringRepository();
    const tutoring = new Tutoring(repo, faq, online, content);
    const app = createTestApp(tutoring, content);

    // 1. Valid consented online request
    const validRes = await app.inject({
      method: 'POST',
      url: '/api/tutoring/answers',
      headers: { authorization: `Bearer ${learnerAToken}` },
      payload: {
        courseId: 'course-1',
        requestId: 'http-online-req-1',
        question: 'What routine tasks can AI tools help a Virtual Assistant with?',
        externalConsent: true,
      },
    });

    expect(validRes.statusCode).toBe(200);
    const validBody = validRes.json<{
      provider: string;
      answer: string;
      citations: Array<{ sectionId: string }>;
    }>();
    expect(validBody.provider).toBe('online');
    expect(validBody.answer).toContain('drafting emails');
    expect(validBody.citations[0]?.sectionId).toBe(
      'artificial-intelligence-and-the-future-of-va-work',
    );

    // 2. Unconsented request routes to FAQ
    const unconsentedRes = await app.inject({
      method: 'POST',
      url: '/api/tutoring/answers',
      headers: { authorization: `Bearer ${learnerAToken}` },
      payload: {
        courseId: 'course-1',
        requestId: 'http-faq-req-1',
        question: 'What is a virtual assistant?',
        externalConsent: false,
      },
    });

    expect(unconsentedRes.statusCode).toBe(200);
    const unconsentedBody = unconsentedRes.json<{ provider: string; answer: string }>();
    expect(unconsentedBody.provider).toBe('faq');
    expect(unconsentedBody.answer).toContain('human remote professionals');

    // 3. Fake citation provider returns 422
    const fakeRepo = new InMemoryTutoringRepository();
    const fakeTutoring = new Tutoring(
      fakeRepo,
      faq,
      {
        name: 'fake',
        isAvailable: () => true,
        // eslint-disable-next-line @typescript-eslint/require-await
        generateAnswer: async () => ({
          answer: 'Invented answer [fake-sec]',
          outcome: 'grounded_answer',
          citedPassageIds: ['fake-sec'],
        }),
      },
      content,
    );
    const fakeApp = createTestApp(fakeTutoring, content);

    const fakeRes = await fakeApp.inject({
      method: 'POST',
      url: '/api/tutoring/answers',
      headers: { authorization: `Bearer ${learnerAToken}` },
      payload: {
        courseId: 'course-1',
        requestId: 'http-fake-cite-req',
        question: 'What routine tasks can AI tools help a Virtual Assistant with?',
        externalConsent: true,
      },
    });

    expect(fakeRes.statusCode).toBe(422);
    expect(fakeRes.json()).toMatchObject({
      error: 'unsupported_output',
      reason: 'invented_citation',
    });

    // 4. Timeout returns 504
    const timeoutTutoring = new Tutoring(
      fakeRepo,
      faq,
      {
        name: 'timeout',
        isAvailable: () => true,
        // eslint-disable-next-line @typescript-eslint/require-await
        generateAnswer: async () => {
          const err = new Error('Timeout');
          err.name = 'TimeoutError';
          throw err;
        },
      },
      content,
    );
    const timeoutApp = createTestApp(timeoutTutoring, content);

    const timeoutRes = await timeoutApp.inject({
      method: 'POST',
      url: '/api/tutoring/answers',
      headers: { authorization: `Bearer ${learnerAToken}` },
      payload: {
        courseId: 'course-1',
        requestId: 'http-timeout-req',
        question: 'What routine tasks can AI tools help a Virtual Assistant with?',
        externalConsent: true,
      },
    });

    expect(timeoutRes.statusCode).toBe(504);
    expect(timeoutRes.json()).toMatchObject({ error: 'timeout' });

    await app.close();
    await fakeApp.close();
    await timeoutApp.close();
  });

  describe('Automated verification: Live supported/unsupported questions per language', () => {
    it('verifies English live supported question ("What tasks can AI tools assist a Virtual Assistant with?")', async () => {
      const content = createRetrievalContentAccess();
      const faq = new FaqProvider(content);
      const online = new GeminiGroundedAnswerProvider();
      const repo = new InMemoryTutoringRepository();
      const tutoring = new Tutoring(repo, faq, online, content);

      const res = await tutoring.ask(learnerA, {
        courseId: 'course-1',
        requestId: 'live-check-en-supp',
        question: 'What routine tasks can AI tools help a Virtual Assistant with?',
        externalConsent: true,
      });

      expect(res).not.toBeNull();
      expect(res?.kind).toBe('answered');
      expect(res?.answerLang).toBe('en');
      expect(res?.citations).toHaveLength(1);
      expect(res?.citations[0]?.sectionId).toBe(
        'artificial-intelligence-and-the-future-of-va-work',
      );
    });

    it('verifies English live unsupported question ("What is the hourly rate in US dollars for a virtual assistant?")', async () => {
      const content = createRetrievalContentAccess();
      const faq = new FaqProvider(content);
      const online = new GeminiGroundedAnswerProvider();
      const repo = new InMemoryTutoringRepository();
      const tutoring = new Tutoring(repo, faq, online, content);

      const res = await tutoring.ask(learnerA, {
        courseId: 'course-1',
        requestId: 'live-check-en-unsupp',
        question: 'What is the hourly rate in US dollars?',
        externalConsent: true,
      });

      expect(res).not.toBeNull();
      expect(res?.kind).toBe('insufficient_evidence');
      expect(res?.citations).toEqual([]);
      expect(res?.answerText).toContain('do not have an approved course answer');
    });

    it('verifies Amharic live supported question ("በሥራ መካከል አጭር እረፍት መውሰድ ምን ጥቅም አለው?")', async () => {
      const content = createRetrievalContentAccess();
      const faq = new FaqProvider(content);
      const online = new GeminiGroundedAnswerProvider();
      const repo = new InMemoryTutoringRepository();
      const tutoring = new Tutoring(repo, faq, online, content);

      const res = await tutoring.ask(learnerB, {
        courseId: 'course-2',
        requestId: 'live-check-am-supp',
        question: 'በሥራ መካከል አጭር እረፍት መውሰድ ምን ጥቅም አለው?',
        externalConsent: true,
      });

      expect(res).not.toBeNull();
      expect(res?.kind).toBe('answered');
      expect(res?.answerLang).toBe('am');
      expect(res?.citations).toHaveLength(1);
      expect(res?.citations[0]?.sectionId).toBe('breaks');
    });

    it('verifies Amharic live unsupported question ("ስለ ፖሞዶሮ ቴክኒክ ስንት ደቂቃ እረፍት መውሰድ እንዳለበት ተጠቅሷል?")', async () => {
      const content = createRetrievalContentAccess();
      const faq = new FaqProvider(content);
      const online = new GeminiGroundedAnswerProvider();
      const repo = new InMemoryTutoringRepository();
      const tutoring = new Tutoring(repo, faq, online, content);

      const res = await tutoring.ask(learnerB, {
        courseId: 'course-2',
        requestId: 'live-check-am-unsupp',
        question: 'ስለ ፖሞዶሮ ቴክኒክ ስንት ደቂቃ እረፍት መውሰድ እንዳለበት ተጠቅሷል?',
        externalConsent: true,
      });

      expect(res).not.toBeNull();
      expect(res?.kind).toBe('insufficient_evidence');
      expect(res?.answerLang).toBe('am');
      expect(res?.citations).toEqual([]);
      expect(res?.answerText).toContain('የተረጋገጠ መልስ አልተገኘም');
    });
  });

  describe('Job Question Routing and Evidence Segregation (T3-019-B)', () => {
    const testActiveJob: JobRecord = {
      id: 'job-va-specialist-01',
      publicationId: 'pub-va-01',
      version: 'starter-1.0',
      title: 'Virtual Assistant Specialist',
      organization: 'Savanna Digital Services',
      category: 'administrative',
      location: 'Addis Ababa',
      description:
        'Managing calendars, correspondence in English and Amharic, digital document filing, and remote tools.',
      sourceUrl: 'https://digitalbridge.et/jobs/job-va-specialist-01',
      postedAt: new Date('2026-11-01T08:00:00.000Z'),
      expiresAt: new Date('2026-12-31T23:59:59.000Z'),
      withdrawn: false,
      status: 'active',
      isDemo: true,
      importedAt: new Date('2026-11-01T08:00:00.000Z'),
      provenance: { kind: 'demo', note: 'test' },
    };

    const testExpiredJob: JobRecord = {
      id: 'job-data-clerk-02',
      publicationId: 'pub-data-02',
      version: 'starter-1.0',
      title: 'Data Entry and Records Clerk',
      organization: 'Ethio Tech Solutions',
      category: 'administrative',
      location: 'Addis Ababa',
      description: 'Accurately transcribe bilingual survey forms.',
      sourceUrl: 'https://digitalbridge.et/jobs/job-data-clerk-02',
      postedAt: new Date('2026-09-01T08:00:00.000Z'),
      expiresAt: new Date('2026-10-01T17:00:00.000Z'),
      withdrawn: false,
      status: 'expired',
      isDemo: true,
      importedAt: new Date('2026-09-01T08:00:00.000Z'),
      provenance: { kind: 'demo', note: 'test' },
    };

    function createJobMockRepo(jobs: JobRecord[]) {
      return {
        importJob: () => Promise.reject(new Error('not implemented')),
        getJob: (id: string) => Promise.resolve(jobs.find((j) => j.id === id) ?? null),
        listJobs: (filter: { status?: string } = {}) => {
          let res = [...jobs];
          if (filter.status && filter.status !== 'all') {
            res = res.filter((j) => j.status === filter.status);
          }
          return Promise.resolve(res);
        },
        getPublicationEvent: () => Promise.resolve(null),
      };
    }

    it('routes job questions to JobAnswers without mixing course evidence', async () => {
      const content = createRetrievalContentAccess();
      const faq = new FaqProvider(content);
      const repo = new InMemoryTutoringRepository();
      const jobRepo = createJobMockRepo([testActiveJob, testExpiredJob]);
      const jobAnswers = new JobAnswers(jobRepo);
      const tutoring = new Tutoring(repo, faq, undefined, content, jobAnswers);

      const res = await tutoring.ask(learnerA, {
        courseId: 'course-1',
        requestId: 'job-routing-req-1',
        question: 'Are there any virtual assistant jobs available?',
      });

      expect(res).not.toBeNull();
      expect(res?.provider).toBe('job');
      expect(res?.kind).toBe('answered');
      expect(res?.answerText).toContain('Virtual Assistant Specialist');
      expect(res?.answerText).toContain('Savanna Digital Services');
      expect(res?.citations).toHaveLength(1);
      expect(res?.citations[0]?.sourceId).toBe('job-va-specialist-01');
      expect(res?.citations[0]?.url).toBe('https://digitalbridge.et/jobs/job-va-specialist-01');
      // Verify no course sections are cited in job answer
      expect(res?.citations.some((c) => c.sourceId.startsWith('savanna-va1'))).toBe(false);
    });

    it('routes course questions to course FAQ without mixing job evidence', async () => {
      const content = createRetrievalContentAccess();
      const faq = new FaqProvider(content);
      const repo = new InMemoryTutoringRepository();
      const jobRepo = createJobMockRepo([testActiveJob, testExpiredJob]);
      const jobAnswers = new JobAnswers(jobRepo);
      const tutoring = new Tutoring(repo, faq, undefined, content, jobAnswers);

      const res = await tutoring.ask(learnerA, {
        courseId: 'course-1',
        requestId: 'course-routing-req-1',
        question: 'What is a virtual assistant?',
      });

      expect(res).not.toBeNull();
      expect(res?.provider).toBe('faq');
      expect(res?.kind).toBe('answered');
      expect(res?.citations).toHaveLength(1);
      expect(res?.citations[0]?.sourceId).toBe('savanna-va1-future-of-va-industry');
      // Verify no job records are cited in course answer
      expect(res?.citations.some((c) => c.sourceId.startsWith('job-'))).toBe(false);
    });

    it('answers job questions via POST /api/tutoring/answers endpoint', async () => {
      const content = createRetrievalContentAccess();
      const faq = new FaqProvider(content);
      const repo = new InMemoryTutoringRepository();
      const jobRepo = createJobMockRepo([testActiveJob, testExpiredJob]);
      const jobAnswers = new JobAnswers(jobRepo);
      const tutoring = new Tutoring(repo, faq, undefined, content, jobAnswers);
      const app = createTestApp(tutoring, content);

      // 1. Active job
      const activeRes = await app.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${learnerAToken}` },
        payload: {
          courseId: 'course-1',
          requestId: 'http-job-req-1',
          question: 'What are the requirements for Virtual Assistant Specialist?',
        },
      });

      expect(activeRes.statusCode).toBe(200);
      const activeBody = activeRes.json<{
        provider: string;
        citations: Array<{ sourceId: string; url: string }>;
        answer: string;
      }>();
      expect(activeBody.provider).toBe('job');
      expect(activeBody.answer).toContain('Requirements for Virtual Assistant Specialist');
      expect(activeBody.citations[0]?.sourceId).toBe('job-va-specialist-01');
      expect(activeBody.citations[0]?.url).toBe(
        'https://digitalbridge.et/jobs/job-va-specialist-01',
      );

      // 2. Expired job handling
      const expiredRes = await app.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${learnerAToken}` },
        payload: {
          courseId: 'course-1',
          requestId: 'http-job-req-2',
          question: 'Is the Data Entry and Records Clerk job open?',
        },
      });

      expect(expiredRes.statusCode).toBe(200);
      const expiredBody = expiredRes.json<{
        provider: string;
        citations: Array<{ sourceId: string; heading: string }>;
        answer: string;
      }>();
      expect(expiredBody.provider).toBe('job');
      expect(expiredBody.answer).toContain(
        'expired on 2026-10-01 and is no longer open for applications',
      );
      expect(expiredBody.citations[0]?.sourceId).toBe('job-data-clerk-02');
      expect(expiredBody.citations[0]?.heading).toContain('Expired');

      // 3. Unknown job limitation (no web search)
      const unknownRes = await app.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${learnerAToken}` },
        payload: {
          courseId: 'course-1',
          requestId: 'http-job-req-3',
          question: 'Is Google hiring in Addis Ababa?',
        },
      });

      expect(unknownRes.statusCode).toBe(200);
      const unknownBody = unknownRes.json<{
        kind: string;
        provider: string;
        citations: unknown[];
        answer: string;
      }>();
      expect(unknownBody.provider).toBe('job');
      expect(unknownBody.kind).toBe('insufficient_evidence');
      expect(unknownBody.citations).toEqual([]);
      expect(unknownBody.answer).toContain('External web search is not used');

      await app.close();
    });
  });

  describe('Learner-Selected Simple-Language Mode (T3-029)', () => {
    it('passes simpleLanguage flag to online answer provider and returns simpleLanguage: true in result', async () => {
      const content = createRetrievalContentAccess();
      const faq = new FaqProvider(content);
      let capturedRequest: OnlineAnswerRequest | undefined;
      const mockOnline: OnlineAnswerProvider = {
        name: 'mock-simple',
        isAvailable: () => true,
        // eslint-disable-next-line @typescript-eslint/require-await
        generateAnswer: async (req) => {
          capturedRequest = req;
          return {
            answer:
              'AI tools help virtual assistants with easy everyday tasks [artificial-intelligence-and-the-future-of-va-work].',
            outcome: 'grounded_answer',
            citedPassageIds: ['artificial-intelligence-and-the-future-of-va-work'],
          };
        },
      };
      const repo = new InMemoryTutoringRepository();
      const tutoring = new Tutoring(repo, faq, mockOnline, content);

      const result = await tutoring.ask(learnerA, {
        courseId: 'course-1',
        requestId: 'simple-lang-req-1',
        question: 'What routine tasks can AI tools help a Virtual Assistant with?',
        externalConsent: true,
        simpleLanguage: true,
      });

      expect(capturedRequest?.simpleLanguage).toBe(true);
      expect(result).not.toBeNull();
      expect(result?.simpleLanguage).toBe(true);
      expect(result?.answerText).toContain('easy everyday tasks');
      expect(result?.citations).toHaveLength(1);
      expect(result?.citations[0]?.sectionId).toBe(
        'artificial-intelligence-and-the-future-of-va-work',
      );
    });

    it('preserves citations and honest limitation when simpleLanguage is requested for missing evidence', async () => {
      const content = createRetrievalContentAccess();
      const faq = new FaqProvider(content);
      const online = new GeminiGroundedAnswerProvider();
      const repo = new InMemoryTutoringRepository();
      const tutoring = new Tutoring(repo, faq, online, content);

      const result = await tutoring.ask(learnerA, {
        courseId: 'course-1',
        requestId: 'simple-lang-missing',
        question: 'What is the hourly rate in US dollars?',
        externalConsent: true,
        simpleLanguage: true,
      });

      expect(result).not.toBeNull();
      expect(result?.simpleLanguage).toBe(true);
      expect(result?.kind).toBe('insufficient_evidence');
      expect(result?.citations).toEqual([]);
      expect(result?.answerText).toContain('do not have an approved course answer');
    });

    it('returns simpleLanguage: true in HTTP response from POST /api/tutoring/answers', async () => {
      const content = createRetrievalContentAccess();
      const faq = new FaqProvider(content);
      const mockOnline: OnlineAnswerProvider = {
        name: 'mock-simple-http',
        isAvailable: () => true,
        // eslint-disable-next-line @typescript-eslint/require-await
        generateAnswer: async () => ({
          answer: 'Short plain answer [artificial-intelligence-and-the-future-of-va-work].',
          outcome: 'grounded_answer',
          citedPassageIds: ['artificial-intelligence-and-the-future-of-va-work'],
        }),
      };
      const repo = new InMemoryTutoringRepository();
      const tutoring = new Tutoring(repo, faq, mockOnline, content);
      const app = createTestApp(tutoring, content);

      const response = await app.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${learnerAToken}` },
        payload: {
          courseId: 'course-1',
          requestId: 'http-simple-req-1',
          question: 'What routine tasks can AI tools help a Virtual Assistant with?',
          externalConsent: true,
          simpleLanguage: true,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        provider: string;
        simpleLanguage: boolean;
        answer: string;
        citations: Array<{ sectionId: string }>;
      }>();
      expect(body.provider).toBe('online');
      expect(body.simpleLanguage).toBe(true);
      expect(body.answer).toContain('Short plain answer');
      expect(body.citations).toHaveLength(1);

      await app.close();
    });
  });

  describe('Pluggable AI layer and local model mode (T3-037)', () => {
    it('executes local model without externalConsent and returns provider: local', async () => {
      const content = createRetrievalContentAccess();
      const faq = new FaqProvider(content);
      let capturedRequest: OnlineAnswerRequest | null = null;
      const mockLocalProvider: OnlineAnswerProvider = {
        name: 'local-ollama (qwen2.5:3b)',
        isLocal: true,
        isAvailable: () => true,
        // eslint-disable-next-line @typescript-eslint/require-await
        generateAnswer: async (req) => {
          capturedRequest = req;
          return {
            answer:
              'Local on-device grounded answer [artificial-intelligence-and-the-future-of-va-work].',
            outcome: 'grounded_answer',
            citedPassageIds: ['artificial-intelligence-and-the-future-of-va-work'],
          };
        },
      };
      const repo = new InMemoryTutoringRepository();
      const tutoring = new Tutoring(repo, faq, mockLocalProvider, content);

      // Call ask with externalConsent: false
      const result = await tutoring.ask(learnerA, {
        courseId: 'course-1',
        requestId: 'req-local-mode-1',
        question: 'What routine tasks can AI tools help a Virtual Assistant with?',
        externalConsent: false,
      });

      expect(capturedRequest).not.toBeNull();
      expect(result).not.toBeNull();
      expect(result?.provider).toBe('local');
      expect(result?.kind).toBe('answered');
      expect(result?.answerText).toContain('Local on-device grounded answer');
      expect(result?.citations).toHaveLength(1);

      const record = repo.requests.find((r) => r.requestId === 'req-local-mode-1');
      expect(record?.state).toBe('completed');
    });

    it('returns provider: local in HTTP response from POST /api/tutoring/answers', async () => {
      const content = createRetrievalContentAccess();
      const faq = new FaqProvider(content);
      const mockLocalProvider: OnlineAnswerProvider = {
        name: 'local-ollama (qwen2.5:3b)',
        isLocal: true,
        isAvailable: () => true,
        // eslint-disable-next-line @typescript-eslint/require-await
        generateAnswer: async () => ({
          answer:
            'Fully private local model answer [artificial-intelligence-and-the-future-of-va-work].',
          outcome: 'grounded_answer',
          citedPassageIds: ['artificial-intelligence-and-the-future-of-va-work'],
        }),
      };
      const repo = new InMemoryTutoringRepository();
      const tutoring = new Tutoring(repo, faq, mockLocalProvider, content);
      const app = createTestApp(tutoring, content);

      const response = await app.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${learnerAToken}` },
        payload: {
          courseId: 'course-1',
          requestId: 'http-local-req-1',
          question: 'What routine tasks can AI tools help a Virtual Assistant with?',
          externalConsent: false,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        provider: string;
        answer: string;
        citations: Array<{ sectionId: string }>;
      }>();
      expect(body.provider).toBe('local');
      expect(body.answer).toContain('Fully private local model answer');
      expect(body.citations).toHaveLength(1);

      await app.close();
    });
  });
});

describe('Offline FAQ matching and verbatim quotes (T3-054)', () => {
  const futurePassage: Passage = {
    sourceId: 'savanna-va1-future-of-va-industry',
    sectionId: 'so-is-the-future-of-va-promising',
    sourceTitle: 'The Future of the VA Industry',
    heading: 'So, is the Future of VA Promising?',
    text: 'Yes, but not in a passive way. The profession appears to be moving toward a future where Virtual Assistants who are adaptable will continue to be valuable. The future VA is likely to be more than an administrative helper.',
    language: 'en',
    courseId: 'course-1',
    version: 'starter-9e83ac7',
  };

  /** Course search returns `passages`; citations resolve as in the shared mock. */
  function contentWith(passages: Passage[]): ContentAccess {
    const base = createMockContentAccess();
    return new ContentAccess(
      {
        search: () => Promise.resolve(passages),
        resolve: (courseIds, sourceId, sectionId) =>
          base.resolve({ ...learnerA, courseIds: [...courseIds] }, sourceId, sectionId),
      },
      [],
    );
  }

  it('matches an approved entry when the learner abbreviates and reorders words', async () => {
    const faq = new FaqProvider(contentWith([]));

    const res = await faq.answer(learnerA, 'course-1', 'What tasks can AI help a va with?');

    expect(res.kind).toBe('answered');
    expect(res.quoted).toBeUndefined();
    expect(res.citations[0]?.sectionId).toBe('artificial-intelligence-and-the-future-of-va-work');
  });

  it('does not answer a question with an extra topic using a narrower approved entry', async () => {
    const faq = new FaqProvider(contentWith([]));

    const res = await faq.answer(
      learnerA,
      'course-1',
      'What should aspiring virtual assistants do?',
    );

    // "What is a virtual assistant?" covers only two of its three key words.
    expect(res.citations.map((c) => c.sectionId)).not.toContain('introduction');
  });

  it('quotes the best-covered passage word for word when no approved entry matches', async () => {
    const faq = new FaqProvider(contentWith([futurePassage]));

    const res = await faq.answer(learnerA, 'course-1', 'What is the future of VA industry?');

    expect(res.kind).toBe('answered');
    expect(res.quoted).toBe(true);
    expect(futurePassage.text).toContain(res.answerText);
    expect(res.answerText).toContain('future');
    expect(res.citations).toEqual([
      expect.objectContaining({ sectionId: 'so-is-the-future-of-va-promising' }),
    ]);
  });

  it('refuses rather than quoting a passage that shares only one key word', async () => {
    const faq = new FaqProvider(contentWith([futurePassage]));

    const res = await faq.answer(
      learnerA,
      'course-1',
      'What is the future price of coffee in Paris?',
    );

    expect(res.kind).toBe('insufficient_evidence');
    expect(res.quoted).toBeUndefined();
    expect(res.citations).toEqual([]);
  });
});
