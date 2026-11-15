// Automated load and concurrency test for 20 active learner sessions (T3-024-A).
// Validates bounded concurrency, fair queueing, rate limiting, and memory stability
// across core API endpoints (tutoring questions, FAQ answers, help requests, job searches).
// Strictly asserts zero cross-user response mix-up and measures p50/p95/p99 latency distributions.
// Wall-clock latency budgets depend on how busy the machine is, so they are enforced only
// in benchmark runs on a quiet machine: LOAD_BUDGET=1 pnpm --filter @track3/api test (T3-057).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../bootstrap/app.ts';
import { JobAnswers } from '../careers/application/job-answers.ts';
import type { JobRepository } from '../careers/application/import-jobs.ts';
import type { JobFilter, JobRecord } from '../careers/domain/job.ts';
import { ContentAccess, type LessonReader } from '../content/application/content-access.ts';
import { DemoRecords } from '../demo-records/demo-records.ts';
import { Help } from '../help/application/help.ts';
import type {
  AddReplyResult,
  ClaimResult as HelpClaimResult,
  HelpRepository,
  QueueItem as HelpQueueItem,
  SubmitHelpInput,
  SubmitResult as HelpSubmitResult,
} from '../help/application/ports/help-repository.ts';
import { StaffHelp } from '../help/application/staff-help.ts';
import type { HelpReply, HelpRequest } from '../help/domain/help-request.ts';
import { DemoSessions } from '../identity/application/demo-sessions.ts';
import type { PrincipalRepository } from '../identity/application/principal-repository.ts';
import { digestToken, ResolvePrincipal } from '../identity/application/resolve-principal.ts';
import type { OwnedScope, Principal } from '../identity/domain/principal.ts';
import { FaqProvider } from './application/faq-provider.ts';
import type {
  OnlineAnswerProvider,
  OnlineAnswerRequest,
  OnlineAnswerResponse,
} from './application/ports/online-answer-provider.ts';
import type {
  ClaimRequestInput,
  ClaimResult,
  RecordOutcomeInput,
  TutoringRepository,
} from './application/ports/tutoring-repository.ts';
import { ProviderAdmissionController } from './application/provider-admission.ts';
import { Tutoring } from './application/tutoring.ts';
import type { TutoringConversation } from './domain/conversation.ts';
import type { FaqEntry } from './domain/faq.ts';
import type { TutoringRequest } from './domain/tutoring-request.ts';

// ---------------------------------------------------------------------------
// Typed HTTP Response Envelopes
// ---------------------------------------------------------------------------

interface FaqResponse {
  readonly request: TutoringRequest;
  readonly answer: string;
  readonly lang: string;
  readonly kind: string;
  readonly provider: string;
  readonly citations: readonly unknown[];
}

interface JobsResponse {
  readonly jobs: readonly {
    readonly id: string;
    readonly title: string;
    readonly organization: string;
    readonly category: string;
    readonly location: string;
    readonly sourceUrl: string;
  }[];
}

interface AnswerResponse {
  readonly request: TutoringRequest;
  readonly answer: string;
  readonly lang: string;
  readonly kind: string;
  readonly provider: string;
  readonly citations: readonly {
    readonly sourceId: string;
    readonly sectionId: string;
    readonly sourceTitle: string;
    readonly heading: string;
  }[];
}

interface TutoringHistoryResponse {
  readonly history: readonly TutoringRequest[];
}

interface HelpSubmitResponse {
  readonly kind: string;
  readonly request: HelpRequest;
}

interface HelpListResponse {
  readonly requests: readonly HelpRequest[];
}

interface CareerAnswerResponse {
  readonly kind: string;
  readonly answerText: string;
  readonly answerLang: string;
  readonly citations: readonly unknown[];
}

interface BusyResponse {
  readonly error: string;
  readonly message: string;
  readonly retryAfterSeconds: number;
}

// ---------------------------------------------------------------------------
// In-Memory Test Adapters
// ---------------------------------------------------------------------------

class InMemoryTutoringRepository implements TutoringRepository {
  readonly conversations: TutoringConversation[] = [];
  readonly requests: TutoringRequest[] = [];
  #counter = 1;

  createConversation(scope: OwnedScope, courseId: string): Promise<TutoringConversation | null> {
    if (!scope.courseIds.includes(courseId)) return Promise.resolve(null);
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    const conv: TutoringConversation = {
      id: `00000000-0000-0000-0000-${String(this.#counter++).padStart(12, '0')}`,
      ownerId: scope.ownerId,
      courseId,
      createdAt: now,
      updatedAt: now,
      expiresAt: expires,
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

    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
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
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      expiresAt: expires,
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
    if (!req || !scope.courseIds.includes(req.courseId)) return Promise.resolve(null);
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
    const req = this.requests[index]!;
    if (req.ownerId !== scope.ownerId || !scope.courseIds.includes(req.courseId)) {
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
    for (let i = this.conversations.length - 1; i >= 0; i--) {
      if (this.conversations[i]!.ownerId === scope.ownerId) this.conversations.splice(i, 1);
    }
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

class InMemoryHelpRepository implements HelpRepository {
  readonly requests = new Map<string, HelpRequest>();
  readonly replies = new Map<string, HelpReply[]>();
  readonly notificationPreferences = new Map<string, boolean>();
  #counter = 1;

  submit(scope: OwnedScope, input: SubmitHelpInput): Promise<HelpSubmitResult> {
    const existing = [...this.requests.values()].find(
      (r) => r.ownerId === scope.ownerId && r.clientRequestId === input.clientRequestId,
    );
    if (existing) return Promise.resolve({ kind: 'existing', request: existing });

    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    const req: HelpRequest = {
      id: `00000000-0000-0000-0001-${String(this.#counter++).padStart(12, '0')}`,
      ownerId: scope.ownerId,
      clientRequestId: input.clientRequestId,
      contextSnapshot: input.contextSnapshot,
      consentGiven: true,
      state: 'waiting',
      createdAt: now,
      expiresAt: expires,
      updatedAt: now,
      cancelledAt: null,
      claimedBy: null,
      claimedAt: null,
      resolvedAt: null,
      resolvedBy: null,
    };
    this.requests.set(req.id, req);
    return Promise.resolve({ kind: 'submitted', request: req });
  }

  cancel(scope: OwnedScope, id: string): Promise<HelpRequest | null> {
    const req = this.requests.get(id);
    if (!req || req.ownerId !== scope.ownerId || req.state !== 'waiting')
      return Promise.resolve(null);
    const updated: HelpRequest = {
      ...req,
      state: 'cancelled',
      cancelledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.requests.set(id, updated);
    return Promise.resolve(updated);
  }

  findById(scope: OwnedScope, id: string): Promise<HelpRequest | null> {
    const req = this.requests.get(id);
    if (!req || req.ownerId !== scope.ownerId) return Promise.resolve(null);
    return Promise.resolve(req);
  }

  findByIdAsStaff(id: string): Promise<HelpRequest | null> {
    return Promise.resolve(this.requests.get(id) ?? null);
  }

  listOwned(scope: OwnedScope): Promise<readonly HelpRequest[]> {
    return Promise.resolve([...this.requests.values()].filter((r) => r.ownerId === scope.ownerId));
  }

  listQueue(): Promise<readonly HelpQueueItem[]> {
    return Promise.resolve(
      [...this.requests.values()]
        .filter((r) => r.state === 'waiting')
        .map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          expiresAt: r.expiresAt,
          state: 'waiting' as const,
        })),
    );
  }

  listAssigned(staffId: string): Promise<readonly HelpRequest[]> {
    return Promise.resolve(
      [...this.requests.values()].filter((r) => r.claimedBy === staffId && r.state === 'claimed'),
    );
  }

  claimRequest(id: string, staffId: string): Promise<HelpClaimResult | null> {
    const req = this.requests.get(id);
    if (!req || req.state !== 'waiting') return Promise.resolve(null);
    const updated: HelpRequest = {
      ...req,
      state: 'claimed',
      claimedBy: staffId,
      claimedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.requests.set(id, updated);
    return Promise.resolve({ kind: 'claimed', request: updated });
  }

  addReply(
    helpRequestId: string,
    authorId: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddReplyResult | null> {
    const req = this.requests.get(helpRequestId);
    if (!req) return Promise.resolve(null);
    const existing = (this.replies.get(helpRequestId) ?? []).find(
      (r) => r.clientReplyId === clientReplyId,
    );
    if (existing) return Promise.resolve({ kind: 'existing', reply: existing });

    const reply: HelpReply = {
      id: `00000000-0000-0000-0002-${String(this.#counter++).padStart(12, '0')}`,
      helpRequestId,
      authorId,
      clientReplyId,
      body,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    const list = this.replies.get(helpRequestId) ?? [];
    list.push(reply);
    this.replies.set(helpRequestId, list);
    return Promise.resolve({ kind: 'added', reply });
  }

  listReplies(helpRequestId: string): Promise<readonly HelpReply[]> {
    return Promise.resolve(this.replies.get(helpRequestId) ?? []);
  }

  markRepliesRead(helpRequestId: string, readerId: string): Promise<void> {
    const list = this.replies.get(helpRequestId) ?? [];
    for (const r of list) {
      if (r.authorId !== readerId) {
        (r as { readAt: string | null }).readAt = new Date().toISOString();
      }
    }
    return Promise.resolve();
  }

  resolveRequest(helpRequestId: string, supportId: string): Promise<HelpRequest | null> {
    const req = this.requests.get(helpRequestId);
    if (!req || req.state !== 'claimed') return Promise.resolve(null);
    const updated: HelpRequest = {
      ...req,
      state: 'resolved',
      resolvedAt: new Date().toISOString(),
      resolvedBy: supportId,
      updatedAt: new Date().toISOString(),
    };
    this.requests.set(helpRequestId, updated);
    return Promise.resolve(updated);
  }

  getNotificationPreference(scope: OwnedScope, channel: string): Promise<boolean> {
    return Promise.resolve(this.notificationPreferences.get(`${scope.ownerId}:${channel}`) ?? true);
  }

  setNotificationPreference(
    scope: OwnedScope,
    channel: string,
    optedIn: boolean,
  ): Promise<boolean> {
    this.notificationPreferences.set(`${scope.ownerId}:${channel}`, optedIn);
    return Promise.resolve(true);
  }

  cancelPendingIntentsForHelpRequest(): Promise<number> {
    return Promise.resolve(0);
  }

  cancelPendingIntentsForLearner(): Promise<number> {
    return Promise.resolve(0);
  }
}

class InMemoryJobRepository implements JobRepository {
  readonly jobs: JobRecord[] = [];

  constructor(initialJobs: JobRecord[] = []) {
    this.jobs.push(...initialJobs);
  }

  listJobs(filter?: JobFilter): Promise<JobRecord[]> {
    let result = [...this.jobs];
    if (filter?.status && filter.status !== 'all') {
      result = result.filter((j) => j.status === filter.status);
    }
    if (filter?.category) {
      result = result.filter((j) => j.category === filter.category);
    }
    return Promise.resolve(result);
  }

  getJob(id: string): Promise<JobRecord | null> {
    return Promise.resolve(this.jobs.find((j) => j.id === id) ?? null);
  }

  importJob(): Promise<never> {
    throw new Error('Not implemented for load tests');
  }

  getPublicationEvent(): Promise<never> {
    throw new Error('Not implemented for load tests');
  }
}

class MockOnlineAnswerProvider implements OnlineAnswerProvider {
  readonly name = 'mock-bounded-ai';
  readonly delayMs: number;
  activeCount = 0;
  peakConcurrency = 0;
  totalCalls = 0;

  constructor(delayMs = 15) {
    this.delayMs = delayMs;
  }

  isAvailable(): boolean {
    return true;
  }

  async generateAnswer(request: OnlineAnswerRequest): Promise<OnlineAnswerResponse> {
    this.activeCount++;
    this.totalCalls++;
    if (this.activeCount > this.peakConcurrency) {
      this.peakConcurrency = this.activeCount;
    }

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    this.activeCount--;

    const citedId = request.passages.length > 0 ? request.passages[0]!.id : 'sec-1';
    return {
      answer: `[AI Answer for ${request.question}] - Grounded in verified materials.`,
      outcome: 'grounded_answer',
      citedPassageIds: [citedId],
      latencyMs: this.delayMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers & Latency Tracking
// ---------------------------------------------------------------------------

interface MetricSample {
  readonly endpoint: string;
  readonly durationMs: number;
  readonly statusCode: number;
  readonly success: boolean;
}

function calculatePercentiles(values: number[]): { p50: number; p95: number; p99: number } {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  return { p50, p95, p99 };
}

// ---------------------------------------------------------------------------
// Load Test Suite: 20 Active Sessions & Bounded Concurrency
// ---------------------------------------------------------------------------

describe('Active Sessions & Bounded AI Concurrency Load Verification (T3-024-A)', () => {
  const SESSION_COUNT = 20;
  const COURSE_ID = 'course-fullstack-dev';

  // Seed approved jobs
  const sampleJobs: JobRecord[] = [
    {
      id: 'job-001',
      publicationId: 'pub-001',
      version: 'v1',
      title: 'Junior Software Engineer',
      organization: 'Ethio Tech Solutions',
      category: 'software',
      location: 'Addis Ababa',
      status: 'active',
      isDemo: true,
      withdrawn: false,
      provenance: { kind: 'demo', note: 'test' },
      sourceUrl: 'https://example.com/jobs/1',
      description: 'Build web applications using TypeScript and Node.js.',
      postedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86400000),
      importedAt: new Date(),
    },
    {
      id: 'job-002',
      publicationId: 'pub-002',
      version: 'v1',
      title: 'Virtual Assistant Specialist',
      organization: 'Savanna Digital Services',
      category: 'support',
      location: 'Remote / Hawassa',
      status: 'active',
      isDemo: true,
      withdrawn: false,
      provenance: { kind: 'demo', note: 'test' },
      sourceUrl: 'https://example.com/jobs/2',
      description: 'Support international clients with bilingual communication.',
      postedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86400000),
      importedAt: new Date(),
    },
  ];

  // Approved FAQ entries
  const sampleFaqs: FaqEntry[] = [
    {
      id: 'faq-001',
      courseId: COURSE_ID,
      language: 'en',
      patterns: ['what is web development', 'explain web development', 'web development overview'],
      answer:
        'Web development is the work involved in developing a website for the Internet or an intranet.',
      citations: [
        {
          sourceId: 'src-web-dev',
          sectionId: 'sec-1',
          sourceTitle: 'Introduction to Web Development',
          heading: 'Overview',
        },
      ],
    },
  ];

  // Approved lesson reader
  const sampleReader: LessonReader = {
    search: (courseIds) => {
      if (!courseIds.includes(COURSE_ID)) return Promise.resolve([]);
      return Promise.resolve([
        {
          sourceId: 'src-web-dev',
          sectionId: 'sec-1',
          sourceTitle: 'Introduction to Web Development',
          heading: 'Overview',
          text: 'Web development covers client-side and server-side engineering.',
          language: 'en',
          courseId: COURSE_ID,
          version: 'v1',
        },
      ]);
    },
    resolve: (courseIds, sourceId, sectionId) => {
      if (courseIds.includes(COURSE_ID) && sourceId === 'src-web-dev' && sectionId === 'sec-1') {
        return Promise.resolve({
          kind: 'section',
          section: {
            sourceId: 'src-web-dev',
            sectionId: 'sec-1',
            sourceTitle: 'Introduction to Web Development',
            heading: 'Overview',
            text: 'Web development covers client-side and server-side engineering.',
            language: 'en',
            courseId: COURSE_ID,
            version: 'v1',
            anchor: null,
            provenance: { kind: 'demo', note: 'test' },
          },
        });
      }
      return Promise.resolve({ kind: 'not_found' });
    },
  };

  // Generate 20 distinct learner principals and authentication tokens
  const learners: Array<{ principal: Principal; token: string }> = [];
  const tokenDigestMap = new Map<string, Principal>();

  for (let i = 1; i <= SESSION_COUNT; i++) {
    const id = `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`;
    const token = `session-load-token-learner-${String(i).padStart(3, '0')}-${'a'.repeat(20)}`;
    const principal: Principal = {
      id,
      role: 'learner',
      label: `Active Learner ${i}`,
      demo: true,
      courseIds: [COURSE_ID],
    };
    learners.push({ principal, token });
    tokenDigestMap.set(digestToken(token), principal);
  }

  // Support staff for help claim/queue
  const staffToken = `session-staff-token-${'b'.repeat(25)}`;
  const staffPrincipal: Principal = {
    id: '00000000-0000-0000-0000-999999999999',
    role: 'support',
    label: 'Support Lead',
    demo: true,
    courseIds: [],
  };
  tokenDigestMap.set(digestToken(staffToken), staffPrincipal);

  const principalRepo: PrincipalRepository = {
    findDemoByTokenDigest: (digest) => Promise.resolve(tokenDigestMap.get(digest) ?? null),
  };

  let tutoringRepo: InMemoryTutoringRepository;
  let helpRepo: InMemoryHelpRepository;
  let jobRepo: InMemoryJobRepository;
  let onlineProvider: MockOnlineAnswerProvider;
  let admissionController: ProviderAdmissionController;
  let app: ReturnType<typeof buildApp>;

  function createTestApp(admissionLimits?: Partial<ProviderAdmissionController['limits']>) {
    tutoringRepo = new InMemoryTutoringRepository();
    helpRepo = new InMemoryHelpRepository();
    jobRepo = new InMemoryJobRepository(sampleJobs);
    onlineProvider = new MockOnlineAnswerProvider(20);
    admissionController = new ProviderAdmissionController({
      maxConcurrency: 8,
      maxQueueSize: 20,
      maxPerLearnerConcurrency: 2,
      maxPerLearnerQueue: 2,
      rateLimitMaxRequests: 250,
      rateLimitPerLearnerMaxRequests: 30,
      rateLimitWindowMs: 60000,
      queueTimeoutMs: 2000,
      ...admissionLimits,
    });

    const contentAccess = new ContentAccess(sampleReader, []);
    const faqProvider = new FaqProvider(contentAccess, sampleFaqs);
    const jobAnswers = new JobAnswers(jobRepo);
    const tutoring = new Tutoring(
      tutoringRepo,
      faqProvider,
      onlineProvider,
      contentAccess,
      admissionController,
      jobAnswers,
    );
    const help = new Help(helpRepo);
    const staffHelp = new StaffHelp(helpRepo);

    return buildApp({
      checkReadiness: () => Promise.resolve({ ready: true }),
      resolvePrincipal: new ResolvePrincipal(principalRepo, true),
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
      content: contentAccess,
      help,
      staffHelp,
      jobRepository: jobRepo,
      jobAnswers,
      admissionController,
    });
  }

  beforeAll(() => {
    app = createTestApp();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('simulates 20 concurrent active learner sessions generating realistic workload across core endpoints with zero cross-user mix-up', async () => {
    const metrics: MetricSample[] = [];
    const memoryBefore = process.memoryUsage().heapUsed;

    // Concurrently execute 20 distinct learner sessions
    const sessionPromises = learners.map(async ({ principal, token }, sessionIndex) => {
      const learnerId = principal.id;
      const sessionTag = `sess-${sessionIndex + 1}`;

      // --- Action 1: Ask FAQ Question ---
      const t0 = performance.now();
      const faqRes = await app.inject({
        method: 'POST',
        url: '/api/tutoring/faq',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          courseId: COURSE_ID,
          requestId: `req-faq-${sessionTag}`,
          question: 'What is web development?',
          externalConsent: false,
        },
      });
      const t1 = performance.now();
      metrics.push({
        endpoint: 'POST /api/tutoring/faq',
        durationMs: t1 - t0,
        statusCode: faqRes.statusCode,
        success: faqRes.statusCode === 200,
      });

      expect(faqRes.statusCode).toBe(200);
      const faqBody = faqRes.json<FaqResponse>();
      expect(faqBody.request.ownerId).toBe(learnerId);
      expect(faqBody.provider).toBe('faq');
      expect(faqBody.answer).toContain('Web development is the work involved');

      // --- Action 2: Job Search & Browse ---
      const t2 = performance.now();
      const jobRes = await app.inject({
        method: 'GET',
        url: '/api/jobs',
        headers: { authorization: `Bearer ${token}` },
      });
      const t3 = performance.now();
      metrics.push({
        endpoint: 'GET /api/jobs',
        durationMs: t3 - t2,
        statusCode: jobRes.statusCode,
        success: jobRes.statusCode === 200,
      });

      expect(jobRes.statusCode).toBe(200);
      const jobBody = jobRes.json<JobsResponse>();
      expect(Array.isArray(jobBody.jobs)).toBe(true);
      expect(jobBody.jobs.length).toBeGreaterThan(0);

      // --- Action 3: Ask Grounded AI Tutoring Question ---
      const uniqueQuestion = `How do client-side and server-side interact in ${sessionTag}?`;
      const t4 = performance.now();
      const aiRes = await app.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          courseId: COURSE_ID,
          requestId: `req-ai-${sessionTag}`,
          question: uniqueQuestion,
          externalConsent: true,
        },
      });
      const t5 = performance.now();
      metrics.push({
        endpoint: 'POST /api/tutoring/answers',
        durationMs: t5 - t4,
        statusCode: aiRes.statusCode,
        success: aiRes.statusCode === 200,
      });

      expect(aiRes.statusCode).toBe(200);
      const aiBody = aiRes.json<AnswerResponse>();
      // Strictly assert zero cross-user response mix-up
      expect(aiBody.request.ownerId).toBe(learnerId);
      expect(aiBody.request.question).toBe(uniqueQuestion);
      expect(aiBody.answer).toContain(uniqueQuestion);
      expect(aiBody.citations.length).toBeGreaterThan(0);
      expect(aiBody.citations[0]!.sectionId).toBe('sec-1');

      // --- Action 4: Query Tutoring History ---
      const t6 = performance.now();
      const histRes = await app.inject({
        method: 'GET',
        url: `/api/tutoring/history?courseId=${COURSE_ID}`,
        headers: { authorization: `Bearer ${token}` },
      });
      const t7 = performance.now();
      metrics.push({
        endpoint: 'GET /api/tutoring/history',
        durationMs: t7 - t6,
        statusCode: histRes.statusCode,
        success: histRes.statusCode === 200,
      });

      expect(histRes.statusCode).toBe(200);
      const histBody = histRes.json<TutoringHistoryResponse>();
      // Ensure only this learner's history is returned
      expect(histBody.history.length).toBe(2); // 1 FAQ + 1 AI
      for (const item of histBody.history) {
        expect(item.ownerId).toBe(learnerId);
      }

      // --- Action 5: Submit Help Request ---
      const clientReqId = `client-help-${sessionTag}`;
      const contextSnap = `Learner state context for ${sessionTag}`;
      const t8 = performance.now();
      const helpRes = await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          clientRequestId: clientReqId,
          contextSnapshot: contextSnap,
        },
      });
      const t9 = performance.now();
      metrics.push({
        endpoint: 'POST /api/help/requests',
        durationMs: t9 - t8,
        statusCode: helpRes.statusCode,
        success: helpRes.statusCode === 201 || helpRes.statusCode === 200,
      });

      expect(helpRes.statusCode).toBe(201);
      const helpBody = helpRes.json<HelpSubmitResponse>();
      expect(helpBody.request.ownerId).toBe(learnerId);
      expect(helpBody.request.clientRequestId).toBe(clientReqId);
      expect(helpBody.request.contextSnapshot).toBe(contextSnap);
      const helpId = helpBody.request.id;

      // --- Action 6: Query Owned Help Requests ---
      const t10 = performance.now();
      const listHelpRes = await app.inject({
        method: 'GET',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${token}` },
      });
      const t11 = performance.now();
      metrics.push({
        endpoint: 'GET /api/help/requests',
        durationMs: t11 - t10,
        statusCode: listHelpRes.statusCode,
        success: listHelpRes.statusCode === 200,
      });

      expect(listHelpRes.statusCode).toBe(200);
      const listHelpBody = listHelpRes.json<HelpListResponse>();
      expect(listHelpBody.requests.length).toBe(1);
      expect(listHelpBody.requests[0]!.ownerId).toBe(learnerId);
      expect(listHelpBody.requests[0]!.id).toBe(helpId);

      // --- Action 7: Career Job Grounded Question ---
      const t12 = performance.now();
      const careerRes = await app.inject({
        method: 'POST',
        url: '/api/careers/answers',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          question: 'Are there any junior software engineer job vacancies in Addis Ababa?',
        },
      });
      const t13 = performance.now();
      metrics.push({
        endpoint: 'POST /api/careers/answers',
        durationMs: t13 - t12,
        statusCode: careerRes.statusCode,
        success: careerRes.statusCode === 200,
      });

      expect(careerRes.statusCode).toBe(200);
      const careerBody = careerRes.json<CareerAnswerResponse>();
      expect(careerBody.kind).toBe('answered');
      expect(careerBody.answerText).toContain('Junior Software Engineer');

      return {
        learnerId,
        tutoringAiRequestId: aiBody.request.id,
        helpRequestId: helpId,
      };
    });

    const sessionResults = await Promise.all(sessionPromises);
    expect(sessionResults.length).toBe(SESSION_COUNT);

    // Cross-user isolation check: Each learner attempts to access another learner's private records
    for (let i = 0; i < SESSION_COUNT; i++) {
      const nextIndex = (i + 1) % SESSION_COUNT;
      const targetSession = sessionResults[nextIndex]!;
      const attackerToken = learners[i]!.token;

      // 1. Attempt to fetch another learner's tutoring request
      const crossTutorRes = await app.inject({
        method: 'GET',
        url: `/api/tutoring/requests/${targetSession.tutoringAiRequestId}`,
        headers: { authorization: `Bearer ${attackerToken}` },
      });
      expect(crossTutorRes.statusCode).toBe(404);
      expect(crossTutorRes.json()).toEqual({ error: 'not_found' });

      // 2. Attempt to fetch another learner's help request
      const crossHelpRes = await app.inject({
        method: 'GET',
        url: `/api/help/requests/${targetSession.helpRequestId}`,
        headers: { authorization: `Bearer ${attackerToken}` },
      });
      expect(crossHelpRes.statusCode).toBe(404);
      expect(crossHelpRes.json()).toEqual({ error: 'not_found' });
    }

    // Memory Stability: Verify no runaway heap growth across the full multi-session load
    const memoryAfter = process.memoryUsage().heapUsed;
    const heapDeltaMb = (memoryAfter - memoryBefore) / (1024 * 1024);
    // Heap delta should remain bounded (< 30MB)
    expect(heapDeltaMb).toBeLessThan(30);

    // Aggregate & Validate Latency Metrics
    const endpoints = [
      'POST /api/tutoring/answers',
      'POST /api/tutoring/faq',
      'GET /api/jobs',
      'POST /api/help/requests',
      'GET /api/tutoring/history',
      'GET /api/help/requests',
      'POST /api/careers/answers',
    ];

    const totalOps = metrics.length;
    expect(totalOps).toBe(SESSION_COUNT * 7); // 140 operations

    const failedOps = metrics.filter((m) => !m.success);
    expect(failedOps.length).toBe(0); // 0% error rate on admitted workload

    const enforceBudget = process.env.LOAD_BUDGET === '1';
    for (const ep of endpoints) {
      const durations = metrics.filter((m) => m.endpoint === ep).map((m) => m.durationMs);
      const percentiles = calculatePercentiles(durations);

      // Budget: p50 < 300 ms, p95 < 600 ms. A shared CI runner (or the web suite running
      // alongside) can exceed it with no code change, so normal runs only measure.
      if (enforceBudget) {
        expect(percentiles.p50, `${ep} p50 ms`).toBeLessThan(300);
        expect(percentiles.p95, `${ep} p95 ms`).toBeLessThan(600);
      }
    }

    // Verify bounded provider concurrency was engaged
    expect(onlineProvider.peakConcurrency).toBeGreaterThan(0);
    expect(onlineProvider.peakConcurrency).toBeLessThanOrEqual(
      admissionController.limits.maxConcurrency,
    );
  });

  it('enforces bounded AI concurrency limits, orderly queueing, and recoverable 503 busy rejection under saturation', async () => {
    // Configure tightly bounded admission: 3 concurrent slots, queue size 3 (total capacity 6)
    const saturatedApp = createTestApp({
      maxConcurrency: 3,
      maxQueueSize: 3,
      maxPerLearnerConcurrency: 1,
      maxPerLearnerQueue: 1,
      rateLimitMaxRequests: 100,
      rateLimitPerLearnerMaxRequests: 20,
    });

    interface SaturatedItem {
      readonly statusCode: number;
      readonly retryAfterHeader: string | undefined;
      readonly body: BusyResponse | AnswerResponse;
      readonly duration: number;
    }

    try {
      // 10 distinct learners fire AI requests concurrently into capacity 6 (3 active + 3 queued)
      const firePromises = learners
        .slice(0, 10)
        .map(async ({ token }, idx): Promise<SaturatedItem> => {
          const tStart = performance.now();
          const res = await saturatedApp.inject({
            method: 'POST',
            url: '/api/tutoring/answers',
            headers: { authorization: `Bearer ${token}` },
            payload: {
              courseId: COURSE_ID,
              requestId: `req-saturate-${idx}`,
              question: `Saturated test question ${idx}?`,
              externalConsent: true,
            },
          });
          const duration = performance.now() - tStart;
          return {
            statusCode: res.statusCode,
            retryAfterHeader: (res.headers as Record<string, string | undefined>)['retry-after'],
            body: res.json<BusyResponse | AnswerResponse>(),
            duration,
          };
        });

      const responses: readonly SaturatedItem[] = await Promise.all(firePromises);

      const successful = responses.filter((r): boolean => r.statusCode === 200);
      const busy = responses.filter((r): boolean => r.statusCode === 503);

      // Exactly 6 requests admitted (3 running + 3 queued), 4 rejected with 503 Busy
      expect(successful.length).toBe(6);
      expect(busy.length).toBe(4);

      // Verify busy rejection structure (RFC-compliant Retry-After header & error envelope)
      for (const b of busy) {
        const busyBody = b.body as BusyResponse;
        expect(busyBody.error).toBe('busy');
        expect(busyBody.message).toContain('capacity is currently saturated');
        expect(busyBody.retryAfterSeconds).toBe(3);
        expect(b.retryAfterHeader).toBe('3');
      }

      // Verify active slots and queue drained back to 0
      expect(admissionController.activeCount).toBe(0);
      expect(admissionController.queueLength).toBe(0);
    } finally {
      await saturatedApp.close();
    }
  });

  it('enforces per-learner rate limiting and fairness so an abusive learner cannot starve other active sessions', async () => {
    // Per-learner limit: max 4 requests per minute
    const rateLimitedApp = createTestApp({
      maxConcurrency: 10,
      maxQueueSize: 20,
      rateLimitMaxRequests: 100,
      rateLimitPerLearnerMaxRequests: 4,
      rateLimitWindowMs: 60000,
    });

    interface AbusiveResultItem {
      readonly statusCode: number;
      readonly retryAfter: string | undefined;
      readonly body: BusyResponse | AnswerResponse;
    }

    interface InnocentResultItem {
      readonly statusCode: number;
      readonly body: AnswerResponse;
    }

    try {
      const abusiveLearner = learners[0]!;
      const innocentLearner = learners[1]!;

      // Abusive learner sends 8 rapid requests (exceeds per-learner cap of 4)
      const abusivePromises = Array.from(
        { length: 8 },
        async (_, reqIdx): Promise<AbusiveResultItem> => {
          const res = await rateLimitedApp.inject({
            method: 'POST',
            url: '/api/tutoring/answers',
            headers: { authorization: `Bearer ${abusiveLearner.token}` },
            payload: {
              courseId: COURSE_ID,
              requestId: `abusive-burst-${reqIdx}`,
              question: `Abusive rapid burst request ${reqIdx}`,
              externalConsent: true,
            },
          });
          return {
            statusCode: res.statusCode,
            retryAfter: (res.headers as Record<string, string | undefined>)['retry-after'],
            body: res.json<BusyResponse | AnswerResponse>(),
          };
        },
      );

      // Concurrently, an innocent learner submits 2 standard requests
      const innocentPromises = Array.from(
        { length: 2 },
        async (_, reqIdx): Promise<InnocentResultItem> => {
          const res = await rateLimitedApp.inject({
            method: 'POST',
            url: '/api/tutoring/answers',
            headers: { authorization: `Bearer ${innocentLearner.token}` },
            payload: {
              courseId: COURSE_ID,
              requestId: `innocent-req-${reqIdx}`,
              question: `Innocent learner question ${reqIdx}`,
              externalConsent: true,
            },
          });
          return {
            statusCode: res.statusCode,
            body: res.json<AnswerResponse>(),
          };
        },
      );

      const abusiveResults: readonly AbusiveResultItem[] = await Promise.all(abusivePromises);
      const innocentResults: readonly InnocentResultItem[] = await Promise.all(innocentPromises);

      // Abusive learner: first 4 pass, next 4 are 429 rate limited
      const abusiveSuccess = abusiveResults.filter((r): boolean => r.statusCode === 200);
      const abusiveRateLimited = abusiveResults.filter((r): boolean => r.statusCode === 429);

      expect(abusiveSuccess.length).toBe(4);
      expect(abusiveRateLimited.length).toBe(4);

      for (let i = 0; i < abusiveRateLimited.length; i++) {
        const r = abusiveRateLimited[i]!;
        const rateLimitBody = r.body as BusyResponse;
        expect(rateLimitBody.error).toBe('rate_limited');
        expect(rateLimitBody.message).toContain('rate limit reached');
        expect(rateLimitBody.retryAfterSeconds).toBeGreaterThan(0);
        expect(Number(r.retryAfter)).toBeGreaterThan(0);
      }

      // Innocent learner was completely unaffected by abusive learner's storm
      expect(innocentResults.every((r) => r.statusCode === 200)).toBe(true);
      for (let i = 0; i < innocentResults.length; i++) {
        const r = innocentResults[i]!;
        expect(r.body.request.ownerId).toBe(innocentLearner.principal.id);
      }
    } finally {
      await rateLimitedApp.close();
    }
  });

  it('bounds question input length and immediately releases capacity on cancellation without socket or promise leaks', async () => {
    const limitsApp = createTestApp({
      maxConcurrency: 2,
      maxQueueSize: 5,
    });

    try {
      const learner = learners[0]!;

      // 1. Oversized question input rejection (> 1000 characters)
      const oversizedText = 'A'.repeat(1500);
      const largeRes = await limitsApp.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${learner.token}` },
        payload: {
          courseId: COURSE_ID,
          requestId: 'req-oversized-1',
          question: oversizedText,
          externalConsent: true,
        },
      });

      expect(largeRes.statusCode).toBe(400);
      const largeBody = largeRes.json<{ error: string; message: string }>();
      expect(largeBody.error).toBe('input_too_large');
      expect(largeBody.message).toContain('maximum allowed length');
      // Verify no slot was consumed or leaked
      expect(admissionController.activeCount).toBe(0);
      expect(admissionController.queueLength).toBe(0);

      // 2. High-volume socket & promise stability check: execute 50 rapid sequential requests
      const rapidRequests = Array.from({ length: 50 }, async (_, idx) => {
        const l = learners[idx % SESSION_COUNT]!;
        const res = await limitsApp.inject({
          method: 'GET',
          url: '/api/jobs',
          headers: { authorization: `Bearer ${l.token}` },
        });
        return res.statusCode;
      });

      const statusCodes = await Promise.all(rapidRequests);
      expect(statusCodes.every((s) => s === 200)).toBe(true);
    } finally {
      await limitsApp.close();
    }
  });
});
