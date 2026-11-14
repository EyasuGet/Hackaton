// Unit tests for tutoring use cases and routes.
// Verifies ownership boundaries, course scope, atomic claims, idempotency and input validation.
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
import type { TutoringConversation } from './domain/conversation.ts';
import type { TutoringRequest } from './domain/tutoring-request.ts';

class InMemoryTutoringRepository implements TutoringRepository {
  readonly conversations: TutoringConversation[] = [];
  readonly requests: TutoringRequest[] = [];
  #counter = 1;

  createConversation(scope: OwnedScope, courseId: string): Promise<TutoringConversation | null> {
    if (!scope.courseIds.includes(courseId)) return Promise.resolve(null);
    const conv: TutoringConversation = {
      id: `00000000-0000-0000-0000-${String(this.#counter++).padStart(12, '0')}`,
      ownerId: scope.ownerId,
      courseId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
const supportToken = 'c'.repeat(43);

const tokenMap: Record<string, Principal> = {
  [digestToken(learnerAToken)]: learnerA,
  [digestToken(supportToken)]: supportUser,
};

function createTestApp(repo: TutoringRepository) {
  const readiness: Readiness = { ready: true };
  const resolvePrincipal = new ResolvePrincipal(
    {
      findDemoByTokenDigest: (digest) => Promise.resolve(tokenMap[digest] ?? null),
    },
    true,
  );

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
    tutoring: new Tutoring(repo),
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

describe('Tutoring HTTP Routes', () => {
  it('validates required request fields and enforces learner role', async () => {
    const repo = new InMemoryTutoringRepository();
    const app = createTestApp(repo);

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
});
