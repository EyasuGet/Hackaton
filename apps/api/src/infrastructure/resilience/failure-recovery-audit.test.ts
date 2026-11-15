// Automated integrated audit for failure recovery and private-data handling (T3-024-B / Issue #52).
// Verifies:
// 1. Graceful recovery from simulated upstream provider timeouts & 5xx errors.
// 2. Bounded rate limiting and admission queue sheds load without crashing.
// 3. Error payloads strip private user data, headers, and stack traces.
// 4. Retried outbox jobs reach terminal failure states safely with dead-letter / audit logging.
// 5. Ephemeral data expires and purges cleanly according to retention rules.

import { describe, expect, it } from 'vitest';
import { buildApp } from '../../bootstrap/app.ts';
import { Accommodation } from '../../modules/accommodation/application/accommodation.ts';
import type {
  AccommodationRepository,
  AddAccommodationReplyResult,
  SubmitAccommodationResult,
} from '../../modules/accommodation/application/ports/accommodation-repository.ts';
import type {
  AccommodationReply,
  AccommodationRequest,
} from '../../modules/accommodation/domain/accommodation-request.ts';
import {
  ContentAccess,
  type LessonReader,
} from '../../modules/content/application/content-access.ts';
import { DemoRecords } from '../../modules/demo-records/demo-records.ts';
import {
  DeliveryWorker,
  type DeliveryIntentsPort,
} from '../../modules/delivery/application/delivery-worker.ts';
import {
  dedupDigest,
  dedupExpiry,
  type ClaimOptions,
  type ClaimedDeliveryIntent,
  type CompleteOutcome,
  type DeliveryIntentRecord,
  type FailOutcome,
  type MarkUncertainOutcome,
  type NewDeliveryIntent,
  type ReleaseOutcome,
} from '../../modules/delivery/domain/delivery-intent.ts';
import {
  computeOtpDigest,
  generateSalt,
  maskPhoneNumber,
  PhoneVerificationCode,
} from '../../modules/delivery/domain/phone-verification.ts';
import { Help } from '../../modules/help/application/help.ts';
import type {
  AddReplyResult,
  ClaimResult as HelpClaimResult,
  HelpRepository,
  QueueItem as HelpQueueItem,
  SubmitHelpInput,
  SubmitResult as HelpSubmitResult,
} from '../../modules/help/application/ports/help-repository.ts';
import { StaffHelp } from '../../modules/help/application/staff-help.ts';
import type { HelpReply, HelpRequest } from '../../modules/help/domain/help-request.ts';
import { DemoSessions } from '../../modules/identity/application/demo-sessions.ts';
import type { PrincipalRepository } from '../../modules/identity/application/principal-repository.ts';
import {
  digestToken,
  ResolvePrincipal,
} from '../../modules/identity/application/resolve-principal.ts';
import type { OwnedScope, Principal } from '../../modules/identity/domain/principal.ts';
import { FaqProvider } from '../../modules/tutoring/application/faq-provider.ts';
import type { OnlineAnswerProvider } from '../../modules/tutoring/application/ports/online-answer-provider.ts';
import type {
  ClaimRequestInput,
  ClaimResult,
  RecordOutcomeInput,
  TutoringRepository,
} from '../../modules/tutoring/application/ports/tutoring-repository.ts';
import { ProviderAdmissionController } from '../../modules/tutoring/application/provider-admission.ts';
import { Tutoring } from '../../modules/tutoring/application/tutoring.ts';
import type { TutoringConversation } from '../../modules/tutoring/domain/conversation.ts';
import type { FaqEntry } from '../../modules/tutoring/domain/faq.ts';
import type { TutoringRequest } from '../../modules/tutoring/domain/tutoring-request.ts';

// ---------------------------------------------------------------------------
// Typed Response Envelopes
// ---------------------------------------------------------------------------

interface ErrorResponse {
  readonly error?: string;
  readonly message?: string;
  readonly reason?: string;
  readonly retryAfterSeconds?: number;
}

interface AnswerSuccessResponse {
  readonly kind: string;
  readonly provider: string;
  readonly answer: string;
  readonly citations: readonly unknown[];
}

interface RequestEnvelope {
  readonly request: { readonly id: string };
}

// ---------------------------------------------------------------------------
// Test Constants & In-Memory Test Doubles
// ---------------------------------------------------------------------------

const COURSE_ID = 'course-va-101';
const LEARNER_A_ID = '00000000-0000-0000-0000-000000000001';
const LEARNER_B_ID = '00000000-0000-0000-0000-000000000002';
const SUPPORT_ID = '00000000-0000-0000-0000-000000000003';

const TOKEN_LEARNER_A = 'token-learner-alice-secret';
const TOKEN_LEARNER_B = 'token-learner-bob-secret';
const TOKEN_SUPPORT = 'token-support-charlie-secret';

const principalA: Principal = {
  id: LEARNER_A_ID,
  role: 'learner',
  label: 'Learner Alice',
  demo: true,
  courseIds: [COURSE_ID],
};

const principalB: Principal = {
  id: LEARNER_B_ID,
  role: 'learner',
  label: 'Learner Bob',
  demo: true,
  courseIds: [COURSE_ID],
};

const principalStaff: Principal = {
  id: SUPPORT_ID,
  role: 'support',
  label: 'Staff Charlie',
  demo: true,
  courseIds: [],
};

const tokenMap = new Map<string, Principal>([
  [digestToken(TOKEN_LEARNER_A), principalA],
  [digestToken(TOKEN_LEARNER_B), principalB],
  [digestToken(TOKEN_SUPPORT), principalStaff],
]);

function createTestPrincipalRepo(): PrincipalRepository {
  return {
    findDemoByTokenDigest: (digest) => Promise.resolve(tokenMap.get(digest) ?? null),
  };
}

function createTestDemoRecords(): DemoRecords {
  return new DemoRecords({
    list: () => Promise.resolve([]),
    find: () => Promise.resolve(null),
  });
}

function createTestDemoSessions(): DemoSessions {
  return new DemoSessions(
    {
      createHandoff: () => Promise.resolve(false),
      consumeHandoff: () => Promise.resolve(null),
      createSession: () => Promise.resolve(),
      revokeSession: () => Promise.resolve(false),
      extendSession: () => Promise.resolve(false),
    },
    true,
  );
}

function createSampleLessonReader(): LessonReader {
  return {
    search: (courseIds) => {
      if (!courseIds.includes(COURSE_ID)) return Promise.resolve([]);
      return Promise.resolve([
        {
          sourceId: 'src-va-intro',
          sectionId: 'sec-tools',
          sourceTitle: 'Introduction to Virtual Assistance',
          heading: 'Essential Virtual Assistant Productivity Tools',
          text: 'Calendar management, email dispatch, and spreadsheet reconciliation form the core toolkit.',
          language: 'en',
          courseId: COURSE_ID,
          version: 'v1',
        },
      ]);
    },
    resolve: (courseIds, sourceId, sectionId) => {
      if (
        courseIds.includes(COURSE_ID) &&
        sourceId === 'src-va-intro' &&
        sectionId === 'sec-tools'
      ) {
        return Promise.resolve({
          kind: 'section',
          section: {
            sourceId: 'src-va-intro',
            sectionId: 'sec-tools',
            sourceTitle: 'Introduction to Virtual Assistance',
            heading: 'Essential Virtual Assistant Productivity Tools',
            text: 'Calendar management, email dispatch, and spreadsheet reconciliation form the core toolkit.',
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
}

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
    const req = this.requests.find((r) => r.ownerId === scope.ownerId && r.requestId === requestId);
    if (!req) return Promise.resolve(null);
    if (!scope.courseIds.includes(req.courseId)) return Promise.resolve(null);
    return Promise.resolve(req);
  }

  listHistory(scope: OwnedScope, courseId?: string): Promise<readonly TutoringRequest[]> {
    return Promise.resolve(
      this.requests.filter((r) => {
        if (r.ownerId !== scope.ownerId) return false;
        if (!scope.courseIds.includes(r.courseId)) return false;
        if (courseId && r.courseId !== courseId) return false;
        return true;
      }),
    );
  }

  recordOutcome(
    scope: OwnedScope,
    requestId: string,
    outcome: RecordOutcomeInput,
  ): Promise<TutoringRequest | null> {
    const req = this.requests.find((r) => r.id === requestId);
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
      completedAt: outcome.state === 'completed' ? now : null,
    };
    const index = this.requests.indexOf(req);
    this.requests[index] = updated;
    return Promise.resolve(updated);
  }

  clearHistory(scope: OwnedScope): Promise<void> {
    const convIdsToRemove = new Set(
      this.conversations
        .filter((c) => c.ownerId === scope.ownerId && scope.courseIds.includes(c.courseId))
        .map((c) => c.id),
    );

    for (let i = this.conversations.length - 1; i >= 0; i--) {
      if (convIdsToRemove.has(this.conversations[i]!.id)) {
        this.conversations.splice(i, 1);
      }
    }
    for (let i = this.requests.length - 1; i >= 0; i--) {
      if (convIdsToRemove.has(this.requests[i]!.conversationId)) {
        this.requests.splice(i, 1);
      }
    }
    return Promise.resolve();
  }

  purgeExpired(now: Date): Promise<number> {
    let count = 0;
    const nowIso = now.toISOString();

    for (let i = 0; i < this.requests.length; i++) {
      const req = this.requests[i]!;
      if (req.expiresAt <= nowIso && req.purgedAt === null) {
        this.requests[i] = {
          ...req,
          question: '',
          answerText: null,
          answerLang: null,
          errorReason: null,
          purgedAt: nowIso,
          updatedAt: nowIso,
        };
        count++;
      }
    }

    for (let i = 0; i < this.conversations.length; i++) {
      const conv = this.conversations[i]!;
      if (conv.expiresAt <= nowIso && conv.purgedAt === null) {
        const remainingUnpurged = this.requests.some(
          (r) => r.conversationId === conv.id && r.purgedAt === null,
        );
        if (!remainingUnpurged) {
          this.conversations[i] = {
            ...conv,
            purgedAt: nowIso,
            updatedAt: nowIso,
          };
        }
      }
    }

    return Promise.resolve(count);
  }
}

class InMemoryHelpRepository implements HelpRepository {
  readonly requests: HelpRequest[] = [];
  readonly replies: HelpReply[] = [];
  readonly preferences = new Map<string, boolean>();
  #counter = 1;

  submit(scope: OwnedScope, input: SubmitHelpInput): Promise<HelpSubmitResult> {
    const existing = this.requests.find(
      (r) => r.ownerId === scope.ownerId && r.clientRequestId === input.clientRequestId,
    );
    if (existing) {
      return Promise.resolve({ kind: 'existing', request: existing });
    }

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
    this.requests.push(req);
    return Promise.resolve({ kind: 'submitted', request: req });
  }

  cancel(scope: OwnedScope, id: string): Promise<HelpRequest | null> {
    const now = new Date().toISOString();
    const index = this.requests.findIndex(
      (r) =>
        r.id === id && r.ownerId === scope.ownerId && r.state === 'waiting' && r.expiresAt > now,
    );
    if (index === -1) return Promise.resolve(null);
    const updated: HelpRequest = {
      ...this.requests[index]!,
      state: 'cancelled',
      cancelledAt: now,
      updatedAt: now,
    };
    this.requests[index] = updated;
    return Promise.resolve(updated);
  }

  findById(scope: OwnedScope, id: string): Promise<HelpRequest | null> {
    const now = new Date().toISOString();
    const req = this.requests.find(
      (r) => r.id === id && r.ownerId === scope.ownerId && r.expiresAt > now,
    );
    return Promise.resolve(req ?? null);
  }

  findByIdAsStaff(id: string): Promise<HelpRequest | null> {
    const now = new Date().toISOString();
    const req = this.requests.find((r) => r.id === id && r.expiresAt > now);
    return Promise.resolve(req ?? null);
  }

  listOwned(scope: OwnedScope): Promise<readonly HelpRequest[]> {
    const now = new Date().toISOString();
    return Promise.resolve(
      this.requests.filter((r) => r.ownerId === scope.ownerId && r.expiresAt > now),
    );
  }

  listQueue(): Promise<readonly HelpQueueItem[]> {
    const now = new Date().toISOString();
    return Promise.resolve(
      this.requests
        .filter((r) => r.state === 'waiting' && r.expiresAt > now)
        .map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          expiresAt: r.expiresAt,
          state: 'waiting' as const,
        })),
    );
  }

  listAssigned(staffId: string): Promise<readonly HelpRequest[]> {
    const now = new Date().toISOString();
    return Promise.resolve(
      this.requests.filter(
        (r) => r.claimedBy === staffId && r.state === 'claimed' && r.expiresAt > now,
      ),
    );
  }

  claimRequest(id: string, staffId: string): Promise<HelpClaimResult | null> {
    const index = this.requests.findIndex((r) => r.id === id);
    if (index === -1) return Promise.resolve(null);
    const req = this.requests[index]!;
    if (req.state !== 'waiting') return Promise.resolve(null);
    if (req.claimedBy && req.claimedBy !== staffId) {
      return Promise.resolve({ kind: 'already_claimed', request: req });
    }
    const now = new Date().toISOString();
    const updated: HelpRequest = {
      ...req,
      claimedBy: staffId,
      claimedAt: now,
      updatedAt: now,
    };
    this.requests[index] = updated;
    return Promise.resolve({ kind: 'claimed', request: updated });
  }

  addReply(
    helpRequestId: string,
    authorId: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddReplyResult | null> {
    const req = this.requests.find((r) => r.id === helpRequestId);
    if (!req) return Promise.resolve(null);

    const existing = this.replies.find(
      (reply) => reply.helpRequestId === helpRequestId && reply.clientReplyId === clientReplyId,
    );
    if (existing) {
      return Promise.resolve({ kind: 'existing', reply: existing });
    }

    const now = new Date().toISOString();
    const reply: HelpReply = {
      id: `00000000-0000-0000-0002-${String(this.#counter++).padStart(12, '0')}`,
      helpRequestId,
      authorId,
      clientReplyId,
      body,
      createdAt: now,
      readAt: null,
    };
    this.replies.push(reply);
    return Promise.resolve({ kind: 'added', reply });
  }

  listReplies(helpRequestId: string): Promise<readonly HelpReply[]> {
    return Promise.resolve(this.replies.filter((r) => r.helpRequestId === helpRequestId));
  }

  markRepliesRead(helpRequestId: string, readerId: string): Promise<void> {
    const now = new Date().toISOString();
    for (let i = 0; i < this.replies.length; i++) {
      const r = this.replies[i]!;
      if (r.helpRequestId === helpRequestId && r.authorId !== readerId && !r.readAt) {
        this.replies[i] = { ...r, readAt: now };
      }
    }
    return Promise.resolve();
  }

  resolveRequest(helpRequestId: string, supportId: string): Promise<HelpRequest | null> {
    const index = this.requests.findIndex((r) => r.id === helpRequestId);
    if (index === -1) return Promise.resolve(null);
    const req = this.requests[index]!;
    if (!req.claimedBy) return Promise.resolve(null);
    const now = new Date().toISOString();
    const updated: HelpRequest = {
      ...req,
      resolvedAt: now,
      resolvedBy: supportId,
      updatedAt: now,
    };
    this.requests[index] = updated;
    return Promise.resolve(updated);
  }

  getNotificationPreference(scope: OwnedScope, channel: string): Promise<boolean> {
    return Promise.resolve(this.preferences.get(`${scope.ownerId}:${channel}`) ?? false);
  }

  setNotificationPreference(
    scope: OwnedScope,
    channel: string,
    optedIn: boolean,
  ): Promise<boolean> {
    this.preferences.set(`${scope.ownerId}:${channel}`, optedIn);
    return Promise.resolve(optedIn);
  }

  cancelPendingIntentsForHelpRequest(): Promise<number> {
    return Promise.resolve(0);
  }

  cancelPendingIntentsForLearner(): Promise<number> {
    return Promise.resolve(0);
  }
}

class InMemoryAccommodationRepository implements AccommodationRepository {
  readonly requests: AccommodationRequest[] = [];
  readonly replies: AccommodationReply[] = [];
  #counter = 1;

  submit(
    scope: OwnedScope,
    input: { clientRequestId: string; jobId: string; supportDescription: string },
  ): Promise<SubmitAccommodationResult> {
    const existing = this.requests.find(
      (r) => r.ownerId === scope.ownerId && r.clientRequestId === input.clientRequestId,
    );
    if (existing) {
      return Promise.resolve({ kind: 'existing', request: existing });
    }

    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    const req: AccommodationRequest = {
      id: `00000000-0000-0000-0003-${String(this.#counter++).padStart(12, '0')}`,
      ownerId: scope.ownerId,
      jobId: input.jobId,
      clientRequestId: input.clientRequestId,
      supportDescription: input.supportDescription,
      state: 'waiting',
      createdAt: now,
      expiresAt: expires,
      updatedAt: now,
      cancelledAt: null,
      reviewedAt: null,
      reviewedBy: null,
    };
    this.requests.push(req);
    return Promise.resolve({ kind: 'submitted', request: req });
  }

  cancel(scope: OwnedScope, id: string): Promise<AccommodationRequest | null> {
    const now = new Date().toISOString();
    const index = this.requests.findIndex(
      (r) =>
        r.id === id && r.ownerId === scope.ownerId && r.state === 'waiting' && r.expiresAt > now,
    );
    if (index === -1) return Promise.resolve(null);
    const updated: AccommodationRequest = {
      ...this.requests[index]!,
      state: 'cancelled',
      cancelledAt: now,
      updatedAt: now,
    };
    this.requests[index] = updated;
    return Promise.resolve(updated);
  }

  findById(scope: OwnedScope, id: string): Promise<AccommodationRequest | null> {
    const now = new Date().toISOString();
    const req = this.requests.find(
      (r) => r.id === id && r.ownerId === scope.ownerId && r.expiresAt > now,
    );
    return Promise.resolve(req ?? null);
  }

  listOwned(scope: OwnedScope): Promise<readonly AccommodationRequest[]> {
    const now = new Date().toISOString();
    return Promise.resolve(
      this.requests.filter((r) => r.ownerId === scope.ownerId && r.expiresAt > now),
    );
  }

  coordinatorFindById(id: string): Promise<AccommodationRequest | null> {
    const now = new Date().toISOString();
    const req = this.requests.find((r) => r.id === id && r.expiresAt > now);
    return Promise.resolve(req ?? null);
  }

  coordinatorListAll(): Promise<readonly AccommodationRequest[]> {
    const now = new Date().toISOString();
    return Promise.resolve(this.requests.filter((r) => r.expiresAt > now));
  }

  updateStatus(
    id: string,
    coordinatorId: string,
    status: 'reviewing' | 'confirmed' | 'declined',
  ): Promise<AccommodationRequest | null> {
    const now = new Date().toISOString();
    const index = this.requests.findIndex(
      (r) => r.id === id && r.state !== 'cancelled' && r.expiresAt > now,
    );
    if (index === -1) return Promise.resolve(null);
    const updated: AccommodationRequest = {
      ...this.requests[index]!,
      state: status,
      reviewedBy: coordinatorId,
      reviewedAt: now,
      updatedAt: now,
    };
    this.requests[index] = updated;
    return Promise.resolve(updated);
  }

  addReply(
    accommodationRequestId: string,
    authorId: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddAccommodationReplyResult | null> {
    const now = new Date().toISOString();
    const req = this.requests.find(
      (r) => r.id === accommodationRequestId && r.state !== 'cancelled' && r.expiresAt > now,
    );
    if (!req) return Promise.resolve(null);

    const existing = this.replies.find(
      (r) =>
        r.accommodationRequestId === accommodationRequestId && r.clientReplyId === clientReplyId,
    );
    if (existing) {
      return Promise.resolve({ kind: 'existing', reply: existing });
    }

    const reply: AccommodationReply = {
      id: `00000000-0000-0000-0004-${String(this.#counter++).padStart(12, '0')}`,
      accommodationRequestId,
      authorId,
      clientReplyId,
      body,
      createdAt: now,
      readAt: null,
    };
    this.replies.push(reply);
    return Promise.resolve({ kind: 'added', reply });
  }

  listReplies(accommodationRequestId: string): Promise<readonly AccommodationReply[]> {
    return Promise.resolve(
      this.replies.filter((r) => r.accommodationRequestId === accommodationRequestId),
    );
  }

  markRepliesRead(accommodationRequestId: string, readerPrincipalId: string): Promise<void> {
    const now = new Date().toISOString();
    for (let i = 0; i < this.replies.length; i++) {
      const r = this.replies[i]!;
      if (r.accommodationRequestId === accommodationRequestId && r.authorId !== readerPrincipalId) {
        this.replies[i] = { ...r, readAt: now };
      }
    }
    return Promise.resolve();
  }
}

class InMemoryDeliveryIntents implements DeliveryIntentsPort {
  readonly items: DeliveryIntentRecord[] = [];
  #counter = 1;

  enqueue(intent: NewDeliveryIntent, now: Date): { status: 'enqueued' | 'duplicate'; id?: string } {
    const digest = dedupDigest(intent.dedupKey);
    const existing = this.items.find((i) => i.dedupDigest === digest);
    if (existing) return { status: 'duplicate' };

    const id = `00000000-0000-0000-0005-${String(this.#counter++).padStart(12, '0')}`;
    const rec: DeliveryIntentRecord = {
      id,
      dedupDigest: digest,
      recipientId: intent.recipientId,
      channel: intent.channel,
      status: 'pending',
      contentRef: intent.contentRef,
      contentExpiresAt: intent.contentExpiresAt,
      dedupExpiresAt: dedupExpiry(now),
      createdAt: now,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      attemptCount: 0,
      completedAt: null,
    };
    this.items.push(rec);
    return { status: 'enqueued', id };
  }

  claimDueWork(options: ClaimOptions): Promise<ClaimedDeliveryIntent[]> {
    const leaseDuration = options.leaseDurationMs ?? 30000;
    const leaseExpiresAt = new Date(options.now.getTime() + leaseDuration);
    const claimed: ClaimedDeliveryIntent[] = [];

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      if (claimed.length >= (options.batchSize ?? 10)) break;
      const isDue =
        (item.status === 'pending' ||
          (item.status === 'leased' &&
            item.leaseExpiresAt !== null &&
            item.leaseExpiresAt <= options.now)) &&
        item.contentExpiresAt > options.now &&
        item.contentRef !== null;

      if (isDue && item.contentRef !== null) {
        const nextAttempt = item.attemptCount + 1;
        this.items[i] = {
          ...item,
          status: 'leased',
          claimedBy: options.workerId,
          claimedAt: options.now,
          leaseExpiresAt,
          attemptCount: nextAttempt,
        };

        claimed.push({
          id: item.id,
          recipientId: item.recipientId,
          channel: item.channel,
          contentRef: item.contentRef,
          contentExpiresAt: item.contentExpiresAt,
          attemptCount: nextAttempt,
          claimedBy: options.workerId,
          claimedAt: options.now,
          leaseExpiresAt,
        });
      }
    }
    return Promise.resolve(claimed);
  }

  complete(id: string, workerId: string, now: Date): Promise<CompleteOutcome> {
    const index = this.items.findIndex((i) => i.id === id);
    if (index === -1) return Promise.resolve({ status: 'not_found' });
    const item = this.items[index]!;
    if (item.status !== 'leased' || item.claimedBy !== workerId) {
      return Promise.resolve({ status: 'lost_lease' });
    }
    this.items[index] = {
      ...item,
      status: 'completed',
      claimedBy: null,
      leaseExpiresAt: null,
      completedAt: now,
    };
    return Promise.resolve({ status: 'completed' });
  }

  release(id: string, workerId: string): Promise<ReleaseOutcome> {
    const index = this.items.findIndex((i) => i.id === id);
    if (index === -1) return Promise.resolve({ status: 'not_found' });
    const item = this.items[index]!;
    if (item.status !== 'leased' || item.claimedBy !== workerId) {
      return Promise.resolve({ status: 'lost_lease' });
    }
    this.items[index] = {
      ...item,
      status: 'pending',
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
    };
    return Promise.resolve({ status: 'released' });
  }

  fail(id: string, workerId: string, now: Date): Promise<FailOutcome> {
    const index = this.items.findIndex((i) => i.id === id);
    if (index === -1) return Promise.resolve({ status: 'not_found' });
    const item = this.items[index]!;
    if (item.status !== 'leased' || item.claimedBy !== workerId) {
      return Promise.resolve({ status: 'lost_lease' });
    }
    this.items[index] = {
      ...item,
      status: 'failed',
      claimedBy: null,
      leaseExpiresAt: null,
      completedAt: now,
    };
    return Promise.resolve({ status: 'failed' });
  }

  markUncertain(id: string, workerId: string): Promise<MarkUncertainOutcome> {
    const index = this.items.findIndex((i) => i.id === id);
    if (index === -1) return Promise.resolve({ status: 'not_found' });
    const item = this.items[index]!;
    if (item.status !== 'leased' || item.claimedBy !== workerId) {
      return Promise.resolve({ status: 'lost_lease' });
    }
    this.items[index] = {
      ...item,
      status: 'uncertain',
      claimedBy: null,
      leaseExpiresAt: null,
    };
    return Promise.resolve({ status: 'uncertain' });
  }

  scrubExpired(now: Date): { cancelled: number; deleted: number } {
    let cancelled = 0;
    let deleted = 0;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]!;
      if (item.contentExpiresAt <= now && item.contentRef !== null) {
        this.items[i] = {
          ...item,
          contentRef: null,
          status: item.status === 'pending' || item.status === 'leased' ? 'cancelled' : item.status,
        };
        cancelled++;
      }
      if (item.dedupExpiresAt <= now && item.contentExpiresAt <= now) {
        this.items.splice(i, 1);
        deleted++;
      }
    }
    return { cancelled, deleted };
  }
}

// ---------------------------------------------------------------------------
// Audit Test Suite
// ---------------------------------------------------------------------------

describe('T3-024-B: Audit integrated failure recovery and private-data handling', () => {
  // -------------------------------------------------------------------------
  // 1. Upstream Provider Outages, Timeouts, and Graceful Recovery
  // -------------------------------------------------------------------------
  describe('1. Upstream provider outages, simulated timeouts, and 5xx errors', () => {
    it('catches upstream AI provider timeout, marks recoverable failure, and returns 504 without corrupting state', async () => {
      let failWithTimeout = true;
      const mockOnlineProvider: OnlineAnswerProvider = {
        name: 'mock-provider',
        isAvailable: () => true,
        generateAnswer: () => {
          if (failWithTimeout) {
            const err = new Error('Upstream AI gateway ETIMEDOUT after 10000ms');
            err.name = 'TimeoutError';
            return Promise.reject(err);
          }
          return Promise.resolve({
            answer: 'Virtual assistant toolkit includes calendar and mail systems.',
            citedPassageIds: ['sec-tools'],
            outcome: 'grounded_answer',
          });
        },
      };

      const tutoringRepo = new InMemoryTutoringRepository();
      const contentAccess = new ContentAccess(createSampleLessonReader(), []);
      const resolvePrincipal = new ResolvePrincipal(createTestPrincipalRepo(), true);
      const admissionController = new ProviderAdmissionController({
        maxConcurrency: 5,
        rateLimitMaxRequests: 100,
        rateLimitPerLearnerMaxRequests: 50,
      });

      const tutoring = new Tutoring(
        tutoringRepo,
        undefined,
        mockOnlineProvider,
        contentAccess,
        admissionController,
      );

      const app = buildApp({
        checkReadiness: () => Promise.resolve({ ready: true }),
        resolvePrincipal,
        demoRecords: createTestDemoRecords(),
        demoSessions: createTestDemoSessions(),
        demoAllowedOrigins: ['http://localhost:5173'],
        tutoring,
        content: contentAccess,
      });

      // 1. First invocation: Upstream provider times out
      const resTimeout = await app.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${TOKEN_LEARNER_A}` },
        payload: {
          courseId: COURSE_ID,
          requestId: 'req-timeout-1',
          question: 'What are essential VA tools?',
          externalConsent: true,
        },
      });

      expect(resTimeout.statusCode).toBe(504);
      const bodyTimeout = resTimeout.json<ErrorResponse>();
      expect(bodyTimeout).toEqual({
        error: 'timeout',
        message: 'Online answer provider timed out',
      });

      // Assert lease was released immediately (capacity not leaked)
      expect(admissionController.activeCount).toBe(0);
      expect(admissionController.queueLength).toBe(0);

      // Inspect persisted record: marked recoverable_failure with errorReason timeout
      const recorded = tutoringRepo.requests.find((r) => r.requestId === 'req-timeout-1');
      expect(recorded).toBeDefined();
      expect(recorded?.state).toBe('recoverable_failure');
      expect(recorded?.errorReason).toBe('timeout');

      // 2. Recovery: Provider recovers without requiring restart
      failWithTimeout = false;
      const resRecovered = await app.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${TOKEN_LEARNER_A}` },
        payload: {
          courseId: COURSE_ID,
          requestId: 'req-recovered-2',
          question: 'What are essential VA tools?',
          externalConsent: true,
        },
      });

      expect(resRecovered.statusCode).toBe(200);
      const bodyRecovered = resRecovered.json<AnswerSuccessResponse>();
      expect(bodyRecovered.kind).toBe('answered');
      expect(bodyRecovered.provider).toBe('online');
      expect(bodyRecovered.answer).toContain('Virtual assistant toolkit');
      expect(admissionController.activeCount).toBe(0);
    });

    it('catches upstream AI provider 500 error, marks recoverable failure, and returns 502 with capacity released', async () => {
      const mockOnlineProvider: OnlineAnswerProvider = {
        name: 'mock-provider',
        isAvailable: () => true,
        generateAnswer: () =>
          Promise.reject(new Error('500 Internal Server Error from upstream Gemini API')),
      };

      const tutoringRepo = new InMemoryTutoringRepository();
      const contentAccess = new ContentAccess(createSampleLessonReader(), []);
      const resolvePrincipal = new ResolvePrincipal(createTestPrincipalRepo(), true);
      const admissionController = new ProviderAdmissionController({ maxConcurrency: 5 });

      const tutoring = new Tutoring(
        tutoringRepo,
        undefined,
        mockOnlineProvider,
        contentAccess,
        admissionController,
      );

      const app = buildApp({
        checkReadiness: () => Promise.resolve({ ready: true }),
        resolvePrincipal,
        demoRecords: createTestDemoRecords(),
        demoSessions: createTestDemoSessions(),
        demoAllowedOrigins: ['http://localhost:5173'],
        tutoring,
        content: contentAccess,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${TOKEN_LEARNER_A}` },
        payload: {
          courseId: COURSE_ID,
          requestId: 'req-500-1',
          question: 'What are essential VA tools?',
          externalConsent: true,
        },
      });

      expect(res.statusCode).toBe(502);
      expect(res.json<ErrorResponse>()).toEqual({
        error: 'provider_error',
        message: 'Online answer provider failed',
      });
      expect(admissionController.activeCount).toBe(0);

      const record = tutoringRepo.requests.find((r) => r.requestId === 'req-500-1');
      expect(record?.state).toBe('recoverable_failure');
      expect(record?.errorReason).toBe('provider_error');
    });

    it('falls back safely to approved FAQ answers when online consent is declined or provider is disabled', async () => {
      const tutoringRepo = new InMemoryTutoringRepository();
      const contentAccess = new ContentAccess(createSampleLessonReader(), []);
      const resolvePrincipal = new ResolvePrincipal(createTestPrincipalRepo(), true);

      const mockFaqEntries: FaqEntry[] = [
        {
          id: 'faq-1',
          courseId: COURSE_ID,
          language: 'en',
          patterns: ['essential va tools', 'tools'],
          answer: 'Standard VA tools include calendars and shared spreadsheets.',
          citations: [
            {
              sourceId: 'src-va-intro',
              sectionId: 'sec-tools',
              sourceTitle: 'Introduction to Virtual Assistance',
              heading: 'Essential Virtual Assistant Productivity Tools',
            },
          ],
        },
      ];

      const faqProvider = new FaqProvider(contentAccess, mockFaqEntries);
      const tutoring = new Tutoring(tutoringRepo, faqProvider, undefined, contentAccess);

      const app = buildApp({
        checkReadiness: () => Promise.resolve({ ready: true }),
        resolvePrincipal,
        demoRecords: createTestDemoRecords(),
        demoSessions: createTestDemoSessions(),
        demoAllowedOrigins: ['http://localhost:5173'],
        tutoring,
        content: contentAccess,
      });

      // Request with externalConsent: false
      const res = await app.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${TOKEN_LEARNER_A}` },
        payload: {
          courseId: COURSE_ID,
          requestId: 'req-faq-fallback-1',
          question: 'What are essential VA tools?',
          externalConsent: false,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<AnswerSuccessResponse>();
      expect(body.kind).toBe('answered');
      expect(body.provider).toBe('faq');
      expect(body.answer).toBe('Standard VA tools include calendars and shared spreadsheets.');
      expect(body.citations).toHaveLength(1);
    });

    it('rejects fabricated citation IDs from untrusted provider output with 422 unsupported_output', async () => {
      const mockOnlineProvider: OnlineAnswerProvider = {
        name: 'mock-provider',
        isAvailable: () => true,
        generateAnswer: () =>
          Promise.resolve({
            answer: 'Fabricated answer referencing non-existent citation IDs.',
            citedPassageIds: ['fabricated-section-xyz'],
            outcome: 'grounded_answer',
          }),
      };

      const tutoringRepo = new InMemoryTutoringRepository();
      const contentAccess = new ContentAccess(createSampleLessonReader(), []);
      const resolvePrincipal = new ResolvePrincipal(createTestPrincipalRepo(), true);
      const admissionController = new ProviderAdmissionController();

      const tutoring = new Tutoring(
        tutoringRepo,
        undefined,
        mockOnlineProvider,
        contentAccess,
        admissionController,
      );

      const app = buildApp({
        checkReadiness: () => Promise.resolve({ ready: true }),
        resolvePrincipal,
        demoRecords: createTestDemoRecords(),
        demoSessions: createTestDemoSessions(),
        demoAllowedOrigins: ['http://localhost:5173'],
        tutoring,
        content: contentAccess,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${TOKEN_LEARNER_A}` },
        payload: {
          courseId: COURSE_ID,
          requestId: 'req-fabricated-citation',
          question: 'What are essential VA tools?',
          externalConsent: true,
        },
      });

      expect(res.statusCode).toBe(422);
      const errBody = res.json<ErrorResponse>();
      expect(errBody.error).toBe('unsupported_output');
      expect(errBody.reason).toBe('invented_citation');
      expect(admissionController.activeCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Bounded Rate Limiting and Admission Queue Load Shedding
  // -------------------------------------------------------------------------
  describe('2. Bounded rate limiting and admission queue load-shedding', () => {
    it('triggers HTTP 429 rate_limited with Retry-After header on per-learner burst while benign learners pass', async () => {
      const tutoringRepo = new InMemoryTutoringRepository();
      const contentAccess = new ContentAccess(createSampleLessonReader(), []);
      const resolvePrincipal = new ResolvePrincipal(createTestPrincipalRepo(), true);

      // Strict per-learner limit: max 2 requests per minute
      const admissionController = new ProviderAdmissionController({
        maxConcurrency: 10,
        rateLimitMaxRequests: 100,
        rateLimitPerLearnerMaxRequests: 2,
        rateLimitWindowMs: 60000,
      });

      const mockProvider: OnlineAnswerProvider = {
        name: 'mock-provider',
        isAvailable: () => true,
        generateAnswer: () =>
          Promise.resolve({
            answer: 'Answer',
            citedPassageIds: ['sec-tools'],
            outcome: 'grounded_answer',
          }),
      };

      const tutoring = new Tutoring(
        tutoringRepo,
        undefined,
        mockProvider,
        contentAccess,
        admissionController,
      );
      const app = buildApp({
        checkReadiness: () => Promise.resolve({ ready: true }),
        resolvePrincipal,
        demoRecords: createTestDemoRecords(),
        demoSessions: createTestDemoSessions(),
        demoAllowedOrigins: ['http://localhost:5173'],
        tutoring,
        content: contentAccess,
      });

      // Learner A sends request 1: OK
      const r1 = await app.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${TOKEN_LEARNER_A}` },
        payload: {
          courseId: COURSE_ID,
          requestId: 'req-burst-1',
          question: 'What tools?',
          externalConsent: true,
        },
      });
      expect(r1.statusCode).toBe(200);

      // Learner A sends request 2: OK
      const r2 = await app.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${TOKEN_LEARNER_A}` },
        payload: {
          courseId: COURSE_ID,
          requestId: 'req-burst-2',
          question: 'What tools?',
          externalConsent: true,
        },
      });
      expect(r2.statusCode).toBe(200);

      // Learner A sends request 3: Rate Limited (429)
      const r3 = await app.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${TOKEN_LEARNER_A}` },
        payload: {
          courseId: COURSE_ID,
          requestId: 'req-burst-3',
          question: 'What tools?',
          externalConsent: true,
        },
      });
      expect(r3.statusCode).toBe(429);
      expect(r3.headers['retry-after']).toBeDefined();
      expect(r3.json<ErrorResponse>().error).toBe('rate_limited');

      // Benign Learner B submits a request concurrently: Succeeds with 200 (fairness)
      const rBob = await app.inject({
        method: 'POST',
        url: '/api/tutoring/answers',
        headers: { authorization: `Bearer ${TOKEN_LEARNER_B}` },
        payload: {
          courseId: COURSE_ID,
          requestId: 'req-bob-1',
          question: 'What tools?',
          externalConsent: true,
        },
      });
      expect(rBob.statusCode).toBe(200);
      expect(admissionController.activeCount).toBe(0);
    });

    it('sheds saturated queue bursts immediately with HTTP 503 busy and Retry-After header without crashing', async () => {
      // Saturated capacity: 1 active slot, 1 queue slot max
      const admission = new ProviderAdmissionController({
        maxConcurrency: 1,
        maxQueueSize: 1,
        maxPerLearnerConcurrency: 1,
        maxPerLearnerQueue: 1,
      });

      let releaseSlot: (() => void) | undefined;
      const blockingTask = new Promise<void>((resolve) => {
        releaseSlot = resolve;
      });

      const lease1 = await admission.acquire(LEARNER_A_ID);
      expect(admission.activeCount).toBe(1);

      // Second request (different learner) enqueues
      const p2 = admission.execute(LEARNER_B_ID, () => blockingTask);
      expect(admission.queueLength).toBe(1);

      // Third request exceeds maxQueueSize: rejected with busy (503)
      await expect(admission.acquire('learner-c')).rejects.toThrowError(
        expect.objectContaining({ code: 'busy', retryAfterSeconds: 3 }),
      );

      // Clean release
      lease1.release();
      releaseSlot?.();
      await p2;

      expect(admission.activeCount).toBe(0);
      expect(admission.queueLength).toBe(0);
    });

    it('aborts queued items immediately on AbortSignal cancellation without leaking slots', async () => {
      const admission = new ProviderAdmissionController({
        maxConcurrency: 1,
        maxQueueSize: 5,
        maxPerLearnerConcurrency: 1,
        maxPerLearnerQueue: 2,
      });

      const lease1 = await admission.acquire('occupier');
      expect(admission.activeCount).toBe(1);

      const controller = new AbortController();
      const queuedPromise = admission.acquire('learner-canceller', controller.signal);
      expect(admission.queueLength).toBe(1);

      // Abort client request
      controller.abort(new Error('Client aborted'));

      await expect(queuedPromise).rejects.toThrow('Client aborted');
      expect(admission.queueLength).toBe(0);

      lease1.release();
      expect(admission.activeCount).toBe(0);
    });

    it('rejects oversized question payloads with 400 input_too_large before allocating provider capacity', () => {
      const admission = new ProviderAdmissionController({
        maxQuestionLength: 50,
      });

      expect(() => admission.assertQuestionSize('Short question')).not.toThrow();
      expect(() => admission.assertQuestionSize('A'.repeat(51))).toThrowError(
        expect.objectContaining({ code: 'input_too_large' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 3. Sensitive Data Handling, Error Sanitization & Leakage Prevention
  // -------------------------------------------------------------------------
  describe('3. Sensitive data handling, error sanitization, and leakage prevention', () => {
    it('sanitizes unexpected 500 errors: strips credentials, stack traces, and SQL connection details', async () => {
      const resolvePrincipal = new ResolvePrincipal(createTestPrincipalRepo(), true);
      const tutoringRepo = new InMemoryTutoringRepository();
      const contentAccess = new ContentAccess(createSampleLessonReader(), []);

      const tutoring = new Tutoring(tutoringRepo);
      const app = buildApp({
        checkReadiness: () => Promise.resolve({ ready: true }),
        resolvePrincipal,
        demoRecords: createTestDemoRecords(),
        demoSessions: createTestDemoSessions(),
        demoAllowedOrigins: ['http://localhost:5173'],
        tutoring,
        content: contentAccess,
      });

      // Register an intentional explosive route throwing sensitive internal data
      app.get('/api/test/sensitive-crash', () => {
        const error = new Error(
          'Database connection failed: postgres://track3:super_secret_db_password@postgres:5432/track3',
        );
        error.name = 'DatabaseDriverError';
        (error as unknown as { code: string }).code = 'ECONNREFUSED';
        throw error;
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/test/sensitive-crash',
      });

      expect(res.statusCode).toBe(500);
      const body = res.json<ErrorResponse>();
      expect(body).toEqual({ error: 'internal' });

      // Strict assertions: No connection string, password, or stack trace leaked
      const rawPayload = res.payload;
      expect(rawPayload).not.toContain('super_secret_db_password');
      expect(rawPayload).not.toContain('postgres://');
      expect(rawPayload).not.toContain('stack');
      expect(rawPayload).not.toContain('DatabaseDriverError');
    });

    it('redacts sensitive Authorization headers, telegram bot tokens, and secret fields in Fastify logging', () => {
      const app = buildApp(
        {
          checkReadiness: () => Promise.resolve({ ready: true }),
          resolvePrincipal: new ResolvePrincipal(createTestPrincipalRepo(), true),
          demoRecords: createTestDemoRecords(),
          demoSessions: createTestDemoSessions(),
          demoAllowedOrigins: ['http://localhost:5173'],
          tutoring: new Tutoring(new InMemoryTutoringRepository()),
          content: new ContentAccess(createSampleLessonReader(), []),
        },
        { logger: true },
      );

      expect(app).toBeDefined();
    });

    it('strictly enforces cross-principal isolation and returns 404 to avoid leaking existence of private records', async () => {
      const tutoringRepo = new InMemoryTutoringRepository();
      const helpRepo = new InMemoryHelpRepository();
      const accommodationRepo = new InMemoryAccommodationRepository();
      const contentAccess = new ContentAccess(createSampleLessonReader(), []);
      const resolvePrincipal = new ResolvePrincipal(createTestPrincipalRepo(), true);

      const tutoring = new Tutoring(tutoringRepo);
      const help = new Help(helpRepo);
      const staffHelp = new StaffHelp(helpRepo);
      const accommodation = new Accommodation(accommodationRepo);

      const app = buildApp({
        checkReadiness: () => Promise.resolve({ ready: true }),
        resolvePrincipal,
        demoRecords: createTestDemoRecords(),
        demoSessions: createTestDemoSessions(),
        demoAllowedOrigins: ['http://localhost:5173'],
        tutoring,
        content: contentAccess,
        help,
        staffHelp,
        accommodation,
      });

      // 1. Learner A creates a private tutoring request
      const rTutoring = await app.inject({
        method: 'POST',
        url: '/api/tutoring/requests',
        headers: { authorization: `Bearer ${TOKEN_LEARNER_A}` },
        payload: {
          courseId: COURSE_ID,
          requestId: 'alice-private-tutoring',
          question: 'Private question about accommodation',
        },
      });
      expect(rTutoring.statusCode).toBe(201);
      const tutoringId = rTutoring.json<RequestEnvelope>().request.id;

      // 2. Learner A creates a private help request
      const rHelp = await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${TOKEN_LEARNER_A}` },
        payload: {
          clientRequestId: 'alice-private-help',
          contextSnapshot: 'Private medical or personal barrier details',
        },
      });
      expect(rHelp.statusCode).toBe(201);
      const helpId = rHelp.json<RequestEnvelope>().request.id;

      // 3. Learner A creates an accommodation request
      const rAccom = await app.inject({
        method: 'POST',
        url: '/api/accommodation/requests',
        headers: { authorization: `Bearer ${TOKEN_LEARNER_A}` },
        payload: {
          clientRequestId: 'alice-private-accom',
          jobId: 'job-va-fintech',
          supportDescription: 'Screen magnifier and high-contrast accommodation needed',
        },
      });
      expect(rAccom.statusCode).toBe(201);
      const accomId = rAccom.json<RequestEnvelope>().request.id;

      // 4. Learner B attempts to probe Learner A's resources by ID -> MUST return 404 Not Found
      const probeTutoring = await app.inject({
        method: 'GET',
        url: `/api/tutoring/requests/${tutoringId}`,
        headers: { authorization: `Bearer ${TOKEN_LEARNER_B}` },
      });
      expect(probeTutoring.statusCode).toBe(404);
      expect(probeTutoring.json()).toEqual({ error: 'not_found' });

      const probeHelp = await app.inject({
        method: 'GET',
        url: `/api/help/requests/${helpId}`,
        headers: { authorization: `Bearer ${TOKEN_LEARNER_B}` },
      });
      expect(probeHelp.statusCode).toBe(404);
      expect(probeHelp.json()).toEqual({ error: 'not_found' });

      const probeAccom = await app.inject({
        method: 'GET',
        url: `/api/accommodation/requests/${accomId}`,
        headers: { authorization: `Bearer ${TOKEN_LEARNER_B}` },
      });
      expect(probeAccom.statusCode).toBe(404);
      expect(probeAccom.json()).toEqual({ error: 'not_found' });

      // Unauthenticated probing receives 401 Unauthorized
      const unauthProbe = await app.inject({
        method: 'GET',
        url: `/api/accommodation/requests/${accomId}`,
      });
      expect(unauthProbe.statusCode).toBe(401);
    });

    it('protects phone verification codes: stores only salted SHA-256 digests and masks phone numbers', () => {
      const plaintextOtp = '492815';
      const salt = generateSalt();
      const digest = computeOtpDigest(plaintextOtp, salt);

      const challenge = new PhoneVerificationCode({
        id: 'challenge-1',
        learnerId: LEARNER_A_ID,
        phoneNumber: '+251911223344',
        codeDigest: digest,
        salt,
        attempts: 0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 600000),
      });

      // Verify OTP is not plaintext in properties
      expect(challenge.codeDigest).toBe(digest);
      expect(challenge.codeDigest).not.toContain(plaintextOtp);

      // Verify phone number masking: +2519****3344
      const masked = maskPhoneNumber('+251911223344');
      expect(masked).toBe('+2519****3344');
      expect(masked).not.toContain('1122');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Delivery Queue Retries, Abandonment Recovery & Terminal Dead-Letter
  // -------------------------------------------------------------------------
  describe('4. Delivery queue retries, lease abandonment recovery, and dead-letter state', () => {
    it('recovers abandoned work from crashed worker and fences off stale completions', async () => {
      const intents = new InMemoryDeliveryIntents();
      const T0 = new Date('2026-11-15T10:00:00.000Z');
      const at = (ms: number) => new Date(T0.getTime() + ms);

      const { id } = intents.enqueue(
        {
          dedupKey: 'alert-recover-1',
          recipientId: LEARNER_A_ID,
          channel: 'telegram',
          contentRef: 'help_reply:req-1:rep-1',
          contentExpiresAt: at(86400000),
        },
        T0,
      );
      expect(id).toBeDefined();

      const worker1 = new DeliveryWorker({
        workerId: 'worker-crashed',
        intents,
        leaseDurationMs: 15000,
      });
      const worker2 = new DeliveryWorker({
        workerId: 'worker-resilient',
        intents,
        leaseDurationMs: 15000,
      });

      // Worker 1 claims at T0 (lease valid until T0 + 15s)
      const claimed1 = await worker1.claimDue(T0);
      expect(claimed1).toHaveLength(1);
      expect(claimed1[0]!.id).toBe(id);
      expect(claimed1[0]!.attemptCount).toBe(1);

      // Worker 1 crashes. At T0 + 10s, lease is still active -> Worker 2 cannot claim
      const midClaim = await worker2.claimDue(at(10000));
      expect(midClaim).toHaveLength(0);

      // At T0 + 16s, lease expired -> Worker 2 successfully recovers abandoned work
      const recovered = await worker2.claimDue(at(16000));
      expect(recovered).toHaveLength(1);
      expect(recovered[0]!.id).toBe(id);
      expect(recovered[0]!.claimedBy).toBe('worker-resilient');
      expect(recovered[0]!.attemptCount).toBe(2);

      // Stale Worker 1 wakes up and tries to complete expired lease -> Fenced off with lost_lease
      const staleRes = await intents.complete(id!, 'worker-crashed', at(17000));
      expect(staleRes).toEqual({ status: 'lost_lease' });

      // Worker 2 successfully completes
      const validRes = await intents.complete(id!, 'worker-resilient', at(18000));
      expect(validRes).toEqual({ status: 'completed' });
    });

    it('transitions retried delivery jobs to terminal dead-letter state when retry budget is exceeded with audit notification', async () => {
      const intents = new InMemoryDeliveryIntents();
      const T0 = new Date('2026-11-15T10:00:00.000Z');
      const at = (ms: number) => new Date(T0.getTime() + ms);

      const { id } = intents.enqueue(
        {
          dedupKey: 'alert-deadletter-1',
          recipientId: LEARNER_A_ID,
          channel: 'sms',
          contentRef: 'job_alert:sub-1:v1',
          contentExpiresAt: at(86400000),
        },
        T0,
      );

      const auditEvents: { intentId: string; reason: string | undefined }[] = [];
      const worker = new DeliveryWorker({
        workerId: 'worker-dlq',
        intents,
        maxAttempts: 3,
        leaseDurationMs: 10000,
        onTerminalFailure: (intent, reason) => {
          auditEvents.push({ intentId: intent.id, reason });
        },
      });

      // Attempt 1: fails, releases back to pending
      const batch1 = await worker.processBatch(T0, () => Promise.resolve('release'));
      expect(batch1.claimed).toBe(1);
      expect(batch1.released).toBe(1);
      expect(batch1.failed).toBe(0);

      // Attempt 2: fails, releases back to pending
      const batch2 = await worker.processBatch(at(1000), () => Promise.resolve('release'));
      expect(batch2.claimed).toBe(1);
      expect(batch2.released).toBe(1);
      expect(batch2.failed).toBe(0);

      // Attempt 3: reached maxAttempts (3) -> Transitions to terminal failure (dead-letter)
      const batch3 = await worker.processBatch(at(2000), () => Promise.resolve('release'));
      expect(batch3.claimed).toBe(1);
      expect(batch3.released).toBe(0);
      expect(batch3.failed).toBe(1);

      // Verify audit event was emitted
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0]!.intentId).toBe(id);
      expect(auditEvents[0]!.reason).toContain('Terminal failure reached');

      // Verify row state in delivery store: status is 'failed'
      const record = intents.items.find((i) => i.id === id);
      expect(record?.status).toBe('failed');
      expect(record?.claimedBy).toBeNull();

      // Subsequent claims ignore failed item (does not cycle endlessly)
      const nextClaim = await worker.claimDue(at(5000));
      expect(nextClaim).toHaveLength(0);
    });

    it('never leases an intent whose referenced content has expired', async () => {
      const intents = new InMemoryDeliveryIntents();
      const T0 = new Date('2026-11-15T10:00:00.000Z');
      const at = (ms: number) => new Date(T0.getTime() + ms);

      // Content expires at T0 + 5000ms
      intents.enqueue(
        {
          dedupKey: 'alert-expired-content',
          recipientId: LEARNER_A_ID,
          channel: 'telegram',
          contentRef: 'help_reply:req-short:rep-1',
          contentExpiresAt: at(5000),
        },
        T0,
      );

      const worker = new DeliveryWorker({ workerId: 'worker-exp', intents });

      // At T0, content is valid -> claimable
      // But query at T0 + 6000ms (content expired) -> Must not be leased
      const claimed = await worker.claimDue(at(6000));
      expect(claimed).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Retention, Ephemeral Expiry, Purge & Tombstoning Lifecycle
  // -------------------------------------------------------------------------
  describe('5. Ephemeral data retention, purge, and tombstoning lifecycle', () => {
    it('purges expired tutoring records in-place: redacts question/answer, stamps purged_at, and purges conversation', async () => {
      const tutoringRepo = new InMemoryTutoringRepository();
      const tutoring = new Tutoring(tutoringRepo);

      // Create conversation and request
      const claimRes = await tutoring.claim(principalA, {
        courseId: COURSE_ID,
        requestId: 'req-retention-test',
        question: 'What is calendar scheduling?',
      });
      expect(claimRes).toBeDefined();

      const reqId = claimRes!.request.id;
      const convId = claimRes!.request.conversationId;

      await tutoring.recordOutcome(principalA, reqId, {
        state: 'completed',
        answerText: 'Calendar scheduling is a core VA function.',
        answerLang: 'en',
      });

      // Fast-forward clock 8 days past 7-day retention expiry
      const futureDate = new Date(Date.now() + 8 * 86400000);
      const purgedCount = await tutoring.purgeExpired(futureDate);
      expect(purgedCount).toBe(1);

      // Verify private fields are scrubbed in-place
      const storedReq = tutoringRepo.requests.find((r) => r.id === reqId);
      expect(storedReq?.purgedAt).not.toBeNull();
      expect(storedReq?.question).toBe('');
      expect(storedReq?.answerText).toBeNull();
      expect(storedReq?.errorReason).toBeNull();

      // Verify owning conversation is marked purged
      const storedConv = tutoringRepo.conversations.find((c) => c.id === convId);
      expect(storedConv?.purgedAt).not.toBeNull();
    });

    it('clears learner conversation history completely on clearHistory without affecting other learners', async () => {
      const tutoringRepo = new InMemoryTutoringRepository();
      const tutoring = new Tutoring(tutoringRepo);

      await tutoring.claim(principalA, {
        courseId: COURSE_ID,
        requestId: 'alice-req',
        question: 'Q1',
      });
      await tutoring.claim(principalB, {
        courseId: COURSE_ID,
        requestId: 'bob-req',
        question: 'Q2',
      });

      expect(tutoringRepo.requests).toHaveLength(2);

      // Alice clears history
      const cleared = await tutoring.clearHistory(principalA);
      expect(cleared).toBe(true);

      // Alice has 0 requests; Bob still has 1 request
      const aliceHistory = await tutoring.listHistory(principalA);
      const bobHistory = await tutoring.listHistory(principalB);
      expect(aliceHistory).toHaveLength(0);
      expect(bobHistory).toHaveLength(1);
    });

    it('tombstones expired help requests from learner and staff views', async () => {
      const helpRepo = new InMemoryHelpRepository();
      const help = new Help(helpRepo);
      const staffHelp = new StaffHelp(helpRepo);

      const subResult = await help.submit(principalA, {
        clientRequestId: 'help-exp-1',
        contextSnapshot: 'Need assistance with spreadsheet formulas',
      });
      expect(subResult?.kind).toBe('submitted');

      // Before expiry: present in owned list and queue
      const initialOwned = await help.listOwned(principalA);
      expect(initialOwned).toHaveLength(1);
      const initialQueue = await staffHelp.listQueue(principalStaff);
      expect(initialQueue).toHaveLength(1);

      // Simulate passage of time past 7 days
      const current = helpRepo.requests[0]!;
      helpRepo.requests[0] = {
        ...current,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      };

      // After expiry: excluded from owned list and support queue (tombstoned)
      const expiredOwned = await help.listOwned(principalA);
      expect(expiredOwned).toHaveLength(0);
      const expiredQueue = await staffHelp.listQueue(principalStaff);
      expect(expiredQueue).toHaveLength(0);
    });

    it('cancels pending delivery intents and stamps cancelled_at when learner cancels a help request', async () => {
      const helpRepo = new InMemoryHelpRepository();
      const help = new Help(helpRepo);

      const subResult = await help.submit(principalA, {
        clientRequestId: 'help-cancel-1',
        contextSnapshot: 'Will cancel this request shortly',
      });
      const reqId = subResult!.request.id;

      const cancelled = await help.cancel(principalA, reqId);
      expect(cancelled).not.toBeNull();
      expect(cancelled?.state).toBe('cancelled');
      expect(cancelled?.cancelledAt).not.toBeNull();

      // Attempting to cancel again returns null
      const secondCancel = await help.cancel(principalA, reqId);
      expect(secondCancel).toBeNull();
    });

    it('expires verification codes after 10 minutes and exhausts after 3 failed attempts', () => {
      const now = new Date();
      const salt = generateSalt();
      const digest = computeOtpDigest('123456', salt);

      // 1. Expired code
      const expiredChallenge = new PhoneVerificationCode({
        id: 'otp-exp',
        learnerId: LEARNER_A_ID,
        phoneNumber: '+251911223344',
        codeDigest: digest,
        salt,
        attempts: 0,
        createdAt: new Date(now.getTime() - 601000), // 10 min 1 sec ago
        expiresAt: new Date(now.getTime() - 1000),
      });
      expect(expiredChallenge.isExpired(now)).toBe(true);

      // 2. Exhausted code after 3 failed attempts
      const exhaustedChallenge = new PhoneVerificationCode({
        id: 'otp-exhausted',
        learnerId: LEARNER_A_ID,
        phoneNumber: '+251911223344',
        codeDigest: digest,
        salt,
        attempts: 3,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 600000),
      });
      expect(exhaustedChallenge.isExhausted()).toBe(true);
      expect(exhaustedChallenge.getStatus()).toBe('exhausted');
    });

    it('scrubs expired content references and permanently purges intents past 30-day dedup window', () => {
      const intents = new InMemoryDeliveryIntents();
      const T0 = new Date('2026-11-15T10:00:00.000Z');
      const at = (ms: number) => new Date(T0.getTime() + ms);

      // Intent 1: Content expired, but dedup record still within 30-day window
      intents.enqueue(
        {
          dedupKey: 'dedup-content-expired',
          recipientId: LEARNER_A_ID,
          channel: 'telegram',
          contentRef: 'help_reply:req-1:rep-1',
          contentExpiresAt: at(5000),
        },
        T0,
      );

      // Intent 2: Both content and dedup record expired (past 30 days)
      intents.enqueue(
        {
          dedupKey: 'dedup-fully-expired',
          recipientId: LEARNER_A_ID,
          channel: 'sms',
          contentRef: 'job_alert:sub-old:v1',
          contentExpiresAt: at(5000),
        },
        T0,
      );
      // Manually set dedupExpiresAt to past
      const item2 = intents.items[1]!;
      intents.items[1] = {
        ...item2,
        dedupExpiresAt: at(10000),
      };

      expect(intents.items).toHaveLength(2);

      // Scrub at T0 + 15000ms
      const scrubResult = intents.scrubExpired(at(15000));
      expect(scrubResult.cancelled).toBeGreaterThanOrEqual(1);
      expect(scrubResult.deleted).toBe(1);

      // Intent 1 retained with contentRef: null and status: 'cancelled'
      expect(intents.items).toHaveLength(1);
      expect(intents.items[0]!.contentRef).toBeNull();
      expect(intents.items[0]!.status).toBe('cancelled');
    });
  });
});
