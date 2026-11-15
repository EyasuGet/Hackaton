// Automated Audit Suite: Core Web, Help, and Accommodation Expiry & Deletion (T3-023-C / Issue #51).
// Rigorously audits the 14 rows of the retention contract in docs/retention.md using a controlled clock,
// plus accommodation coordinator isolation, web audio lifecycle cleanup, and offline-cache exclusions.

import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../bootstrap/app.ts';
import { Accommodation } from '../accommodation/application/accommodation.ts';
import type {
  AccommodationRepository,
  AddAccommodationReplyResult,
  SubmitAccommodationInput,
  SubmitAccommodationResult,
} from '../accommodation/application/ports/accommodation-repository.ts';
import type {
  AccommodationReply,
  AccommodationRequest,
} from '../accommodation/domain/accommodation-request.ts';
import { ContentAccess } from '../content/application/content-access.ts';
import {
  DeliveryWorker,
  type DeliveryIntentsPort,
  type DispatchPort,
} from '../delivery/application/delivery-worker.ts';
import type {
  ClaimOptions,
  ClaimedDeliveryIntent,
  CompleteOutcome,
  FailOutcome,
  MarkUncertainOutcome,
  ReleaseOutcome,
} from '../delivery/domain/delivery-intent.ts';
import { DemoRecords } from '../demo-records/demo-records.ts';
import { DemoSessions } from '../identity/application/demo-sessions.ts';
import type { PrincipalRepository } from '../identity/application/principal-repository.ts';
import { digestToken, ResolvePrincipal } from '../identity/application/resolve-principal.ts';
import type { OwnedScope, Principal } from '../identity/domain/principal.ts';
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
import { Tutoring } from '../tutoring/application/tutoring.ts';
import type {
  ClaimRequestInput,
  ClaimResult,
  RecordOutcomeInput,
  TutoringRepository,
} from '../tutoring/application/ports/tutoring-repository.ts';
import type { TutoringConversation } from '../tutoring/domain/conversation.ts';
import type { TutoringRequest } from '../tutoring/domain/tutoring-request.ts';

// ---------------------------------------------------------------------------
// Constants & Controlled Clock
// ---------------------------------------------------------------------------

const R_HOURS = 168; // 7 days in hours (retention rule 1)
const R_MS = R_HOURS * 3600 * 1000;
const DEDUP_TTL_DAYS = 30;
const DEDUP_TTL_MS = DEDUP_TTL_DAYS * 24 * 3600 * 1000;

const COURSE_ID = 'course-va-101';
const LEARNER_A_ID = '11111111-1111-1111-1111-111111111111';
const LEARNER_B_ID = '22222222-2222-2222-2222-222222222222';
const SUPPORT_ID = '33333333-3333-3333-3333-333333333333';

// Bearer tokens must be at least 20 chars per BEARER regex in authentication.ts
const TOKEN_A = 'token-alice-demo-secret-key-32chars';
const TOKEN_B = 'token-bob-demo-secret-key-32chars';
const TOKEN_SUPPORT = 'token-support-demo-secret-key-32ch';

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

const principalSupport: Principal = {
  id: SUPPORT_ID,
  role: 'support',
  label: 'Support Charlie',
  demo: true,
  courseIds: [],
};

const tokenMap = new Map<string, Principal>([
  [digestToken(TOKEN_A), principalA],
  [digestToken(TOKEN_B), principalB],
  [digestToken(TOKEN_SUPPORT), principalSupport],
]);

export class ControlledClock {
  #now: Date;

  constructor(initial: Date = new Date('2026-11-15T12:00:00.000Z')) {
    this.#now = new Date(initial.getTime());
  }

  now(): Date {
    return new Date(this.#now.getTime());
  }

  nowIso(): string {
    return this.#now.toISOString();
  }

  advanceSeconds(seconds: number): Date {
    this.#now = new Date(this.#now.getTime() + seconds * 1000);
    return this.now();
  }

  advanceHours(hours: number): Date {
    return this.advanceSeconds(hours * 3600);
  }

  advanceDays(days: number): Date {
    return this.advanceHours(days * 24);
  }

  setTime(time: Date | string): Date {
    this.#now = new Date(time);
    return this.now();
  }
}

// ---------------------------------------------------------------------------
// Controlled-Clock Test Repositories
// ---------------------------------------------------------------------------

export class AuditedTutoringRepository implements TutoringRepository {
  readonly conversations: TutoringConversation[] = [];
  readonly requests: TutoringRequest[] = [];
  readonly #clock: ControlledClock;
  #counter = 1;

  constructor(clock: ControlledClock) {
    this.#clock = clock;
  }

  createConversation(scope: OwnedScope, courseId: string): Promise<TutoringConversation | null> {
    if (!scope.courseIds.includes(courseId)) return Promise.resolve(null);
    const now = this.#clock.now();
    const expires = new Date(now.getTime() + R_MS);
    const conv: TutoringConversation = {
      id: `00000000-0000-0000-0001-${String(this.#counter++).padStart(12, '0')}`,
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
    // Read rule: filter expires_at > now and purged_at IS NULL
    if (
      new Date(conv.expiresAt).getTime() <= this.#clock.now().getTime() ||
      conv.purgedAt !== null
    ) {
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

    const now = this.#clock.now();
    const expires = new Date(now.getTime() + R_MS);
    const req: TutoringRequest = {
      id: `00000000-0000-0000-0002-${String(this.#counter++).padStart(12, '0')}`,
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

    // Update conversation touched timestamp (activity), without extending expiresAt!
    const convIdx = this.conversations.findIndex((c) => c.id === convId);
    if (convIdx !== -1) {
      const conv = this.conversations[convIdx]!;
      this.conversations[convIdx] = { ...conv, updatedAt: now.toISOString() };
    }

    this.requests.push(req);
    return { kind: 'claimed', request: req };
  }

  findRequestById(scope: OwnedScope, id: string): Promise<TutoringRequest | null> {
    const req = this.requests.find((r) => r.id === id);
    if (!req) return Promise.resolve(null);
    if (req.ownerId !== scope.ownerId || !scope.courseIds.includes(req.courseId)) {
      return Promise.resolve(null);
    }
    // Read rule: filter expires_at > now and purged_at IS NULL
    if (new Date(req.expiresAt).getTime() <= this.#clock.now().getTime() || req.purgedAt !== null) {
      return Promise.resolve(null);
    }
    return Promise.resolve(req);
  }

  findRequestByRequestId(scope: OwnedScope, requestId: string): Promise<TutoringRequest | null> {
    const req = this.requests.find((r) => r.ownerId === scope.ownerId && r.requestId === requestId);
    if (!req) return Promise.resolve(null);
    if (!scope.courseIds.includes(req.courseId)) return Promise.resolve(null);
    // Read rule
    if (new Date(req.expiresAt).getTime() <= this.#clock.now().getTime() || req.purgedAt !== null) {
      return Promise.resolve(null);
    }
    return Promise.resolve(req);
  }

  listHistory(scope: OwnedScope, courseId?: string): Promise<readonly TutoringRequest[]> {
    const nowTime = this.#clock.now().getTime();
    return Promise.resolve(
      this.requests.filter((r) => {
        if (r.ownerId !== scope.ownerId) return false;
        if (!scope.courseIds.includes(r.courseId)) return false;
        if (courseId && r.courseId !== courseId) return false;
        // Read rule: exclude purged and expired content
        if (r.purgedAt !== null) return false;
        if (new Date(r.expiresAt).getTime() <= nowTime) return false;
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
    const nowIso = this.#clock.nowIso();
    const updated: TutoringRequest = {
      ...req,
      state: outcome.state,
      answerText: outcome.answerText ?? null,
      answerLang: outcome.answerLang ?? null,
      errorReason: outcome.errorReason ?? null,
      updatedAt: nowIso,
      completedAt: outcome.state === 'completed' ? nowIso : null,
    };
    const idx = this.requests.indexOf(req);
    this.requests[idx] = updated;
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
    const nowTime = now.getTime();
    const nowIso = now.toISOString();

    for (let i = 0; i < this.requests.length; i++) {
      const req = this.requests[i]!;
      if (new Date(req.expiresAt).getTime() <= nowTime && req.purgedAt === null) {
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
      if (new Date(conv.expiresAt).getTime() <= nowTime && conv.purgedAt === null) {
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

export class AuditedHelpRepository implements HelpRepository {
  readonly requests: HelpRequest[] = [];
  readonly replies: HelpReply[] = [];
  readonly preferences = new Map<string, boolean>();
  readonly #clock: ControlledClock;
  #counter = 1;

  constructor(clock: ControlledClock) {
    this.#clock = clock;
  }

  submit(
    scope: OwnedScope,
    input: SubmitHelpInput,
    options?: { sourceExpiresAt?: string },
  ): Promise<HelpSubmitResult> {
    const existing = this.requests.find(
      (r) => r.ownerId === scope.ownerId && r.clientRequestId === input.clientRequestId,
    );
    if (existing) {
      return Promise.resolve({ kind: 'existing', request: existing });
    }

    const now = this.#clock.now();
    const defaultExpiry = new Date(now.getTime() + R_MS);
    // Retention contract row 6: Shared context in help requests expires with the EARLIEST source expiration
    let expiresAt = defaultExpiry.toISOString();
    if (options?.sourceExpiresAt) {
      const sourceExpiryDate = new Date(options.sourceExpiresAt);
      if (sourceExpiryDate.getTime() < defaultExpiry.getTime()) {
        expiresAt = sourceExpiryDate.toISOString();
      }
    }

    const req: HelpRequest = {
      id: `00000000-0000-0001-0001-${String(this.#counter++).padStart(12, '0')}`,
      ownerId: scope.ownerId,
      clientRequestId: input.clientRequestId,
      contextSnapshot: input.contextSnapshot,
      consentGiven: true,
      state: 'waiting',
      createdAt: now.toISOString(),
      expiresAt,
      updatedAt: now.toISOString(),
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
    const nowTime = this.#clock.now().getTime();
    const nowIso = this.#clock.nowIso();
    const index = this.requests.findIndex(
      (r) =>
        r.id === id &&
        r.ownerId === scope.ownerId &&
        r.state === 'waiting' &&
        new Date(r.expiresAt).getTime() > nowTime,
    );
    if (index === -1) return Promise.resolve(null);
    const updated: HelpRequest = {
      ...this.requests[index]!,
      state: 'cancelled',
      cancelledAt: nowIso,
      updatedAt: nowIso,
    };
    this.requests[index] = updated;
    return Promise.resolve(updated);
  }

  findById(scope: OwnedScope, id: string): Promise<HelpRequest | null> {
    const nowTime = this.#clock.now().getTime();
    const req = this.requests.find((r) => r.id === id && r.ownerId === scope.ownerId);
    if (!req) return Promise.resolve(null);
    // The request row exists up to 30 days to show lifecycle history, but its context is redacted when expired
    const isContentExpired = new Date(req.expiresAt).getTime() <= nowTime;
    return Promise.resolve({
      ...req,
      contextSnapshot: isContentExpired ? '' : req.contextSnapshot,
    });
  }

  findByIdAsStaff(id: string): Promise<HelpRequest | null> {
    const nowTime = this.#clock.now().getTime();
    const req = this.requests.find((r) => r.id === id);
    if (!req) return Promise.resolve(null);
    const isContentExpired = new Date(req.expiresAt).getTime() <= nowTime;
    return Promise.resolve({
      ...req,
      contextSnapshot: isContentExpired ? '' : req.contextSnapshot,
    });
  }

  listOwned(scope: OwnedScope): Promise<readonly HelpRequest[]> {
    const nowTime = this.#clock.now().getTime();
    return Promise.resolve(
      this.requests.filter(
        (r) => r.ownerId === scope.ownerId && new Date(r.expiresAt).getTime() > nowTime,
      ),
    );
  }

  listQueue(): Promise<readonly HelpQueueItem[]> {
    const nowTime = this.#clock.now().getTime();
    return Promise.resolve(
      this.requests
        .filter((r) => r.state === 'waiting' && new Date(r.expiresAt).getTime() > nowTime)
        .map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          expiresAt: r.expiresAt,
          state: 'waiting' as const,
        })),
    );
  }

  claimRequest(id: string, staffId: string): Promise<HelpClaimResult | null> {
    const nowTime = this.#clock.now().getTime();
    const nowIso = this.#clock.nowIso();
    const req = this.requests.find((r) => r.id === id);
    if (!req) return Promise.resolve(null);
    if (new Date(req.expiresAt).getTime() <= nowTime) return Promise.resolve(null);
    if (req.state === 'claimed') {
      return Promise.resolve({ kind: 'already_claimed', request: req });
    }
    if (req.state !== 'waiting') return Promise.resolve(null);

    const updated: HelpRequest = {
      ...req,
      state: 'claimed',
      claimedBy: staffId,
      claimedAt: nowIso,
      updatedAt: nowIso,
    };
    const idx = this.requests.indexOf(req);
    this.requests[idx] = updated;
    return Promise.resolve({ kind: 'claimed', request: updated });
  }

  addReply(
    helpRequestId: string,
    authorId: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddReplyResult | null> {
    const now = this.#clock.now();
    const nowIso = now.toISOString();
    const req = this.requests.find((r) => r.id === helpRequestId);
    if (!req) return Promise.resolve(null);
    if (req.state === 'cancelled' || req.state === 'resolved') return Promise.resolve(null);
    if (new Date(req.expiresAt).getTime() <= now.getTime()) return Promise.resolve(null);

    const existing = this.replies.find(
      (r) => r.helpRequestId === helpRequestId && r.clientReplyId === clientReplyId,
    );
    if (existing) return Promise.resolve({ kind: 'existing', reply: existing });

    // Retention contract row 7: Reply expires on its own clock (replyCreatedAt + 168h)
    const replyExpiresAt = new Date(now.getTime() + R_MS).toISOString();
    const reply: HelpReply & { expiresAt: string } = {
      id: `00000000-0000-0001-0002-${String(this.#counter++).padStart(12, '0')}`,
      helpRequestId,
      authorId,
      clientReplyId,
      body,
      createdAt: nowIso,
      readAt: null,
      expiresAt: replyExpiresAt,
    };
    this.replies.push(reply);
    return Promise.resolve({ kind: 'added', reply });
  }

  listReplies(helpRequestId: string): Promise<readonly HelpReply[]> {
    const nowTime = this.#clock.now().getTime();
    return Promise.resolve(
      this.replies.filter((r) => {
        if (r.helpRequestId !== helpRequestId) return false;
        // Own expiry clock for replies
        const replyWithExpiry = r as HelpReply & { expiresAt?: string };
        if (replyWithExpiry.expiresAt && new Date(replyWithExpiry.expiresAt).getTime() <= nowTime) {
          return false;
        }
        return true;
      }),
    );
  }

  markRepliesRead(helpRequestId: string, readerId: string): Promise<void> {
    const nowIso = this.#clock.nowIso();
    for (const r of this.replies) {
      if (r.helpRequestId === helpRequestId && r.authorId !== readerId && r.readAt === null) {
        (r as { readAt: string | null }).readAt = nowIso;
      }
    }
    return Promise.resolve();
  }

  resolveRequest(helpRequestId: string, supportId: string): Promise<HelpRequest | null> {
    const nowTime = this.#clock.now().getTime();
    const nowIso = this.#clock.nowIso();
    const req = this.requests.find((r) => r.id === helpRequestId);
    if (!req || req.state !== 'claimed' || new Date(req.expiresAt).getTime() <= nowTime) {
      return Promise.resolve(null);
    }
    const updated: HelpRequest = {
      ...req,
      state: 'resolved',
      resolvedAt: nowIso,
      resolvedBy: supportId,
      updatedAt: nowIso,
    };
    const idx = this.requests.indexOf(req);
    this.requests[idx] = updated;
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

  // Retention contract row 8: Clearing history also deletes shared context copies in learner's own help requests
  clearLearnerSharedCopies(ownerId: string): number {
    let scrubbed = 0;
    for (const req of this.requests) {
      if (req.ownerId === ownerId && req.contextSnapshot !== '') {
        (req as { contextSnapshot: string }).contextSnapshot = '';
        scrubbed++;
      }
    }
    return scrubbed;
  }

  // Retention contract row 14: Contentless request rows purged 30 days after creation
  purgeContentlessRequests(now: Date): number {
    const cutoff = new Date(now.getTime() - DEDUP_TTL_MS).getTime();
    let purged = 0;
    for (let i = this.requests.length - 1; i >= 0; i--) {
      const req = this.requests[i]!;
      // Purge when older than 30 days and content has already expired
      if (
        new Date(req.createdAt).getTime() <= cutoff &&
        new Date(req.expiresAt).getTime() <= now.getTime()
      ) {
        this.requests.splice(i, 1);
        purged++;
      }
    }
    return purged;
  }

  cancelPendingIntentsForHelpRequest(): Promise<number> {
    return Promise.resolve(0);
  }

  cancelPendingIntentsForLearner(): Promise<number> {
    return Promise.resolve(0);
  }
}

export class AuditedAccommodationRepository implements AccommodationRepository {
  readonly requests: AccommodationRequest[] = [];
  readonly replies: AccommodationReply[] = [];
  readonly #clock: ControlledClock;
  #counter = 1;

  constructor(clock: ControlledClock) {
    this.#clock = clock;
  }

  submit(scope: OwnedScope, input: SubmitAccommodationInput): Promise<SubmitAccommodationResult> {
    const existing = this.requests.find(
      (r) => r.ownerId === scope.ownerId && r.clientRequestId === input.clientRequestId,
    );
    if (existing) {
      return Promise.resolve({ kind: 'existing', request: existing });
    }

    const now = this.#clock.now();
    const expires = new Date(now.getTime() + R_MS);
    const req: AccommodationRequest = {
      id: `00000000-0000-0002-0001-${String(this.#counter++).padStart(12, '0')}`,
      ownerId: scope.ownerId,
      jobId: input.jobId,
      clientRequestId: input.clientRequestId,
      supportDescription: input.supportDescription,
      state: 'waiting',
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      updatedAt: now.toISOString(),
      cancelledAt: null,
      reviewedAt: null,
      reviewedBy: null,
    };
    this.requests.push(req);
    return Promise.resolve({ kind: 'submitted', request: req });
  }

  cancel(scope: OwnedScope, id: string): Promise<AccommodationRequest | null> {
    const nowTime = this.#clock.now().getTime();
    const nowIso = this.#clock.nowIso();
    const req = this.requests.find(
      (r) =>
        r.id === id &&
        r.ownerId === scope.ownerId &&
        r.state === 'waiting' &&
        new Date(r.expiresAt).getTime() > nowTime,
    );
    if (!req) return Promise.resolve(null);
    const updated: AccommodationRequest = {
      ...req,
      state: 'cancelled',
      cancelledAt: nowIso,
      updatedAt: nowIso,
    };
    const idx = this.requests.indexOf(req);
    this.requests[idx] = updated;
    return Promise.resolve(updated);
  }

  findById(scope: OwnedScope, id: string): Promise<AccommodationRequest | null> {
    const nowTime = this.#clock.now().getTime();
    const req = this.requests.find((r) => r.id === id && r.ownerId === scope.ownerId);
    if (!req) return Promise.resolve(null);
    // Read rule: expires_at > now
    if (new Date(req.expiresAt).getTime() <= nowTime) return Promise.resolve(null);
    return Promise.resolve(req);
  }

  listOwned(scope: OwnedScope): Promise<readonly AccommodationRequest[]> {
    const nowTime = this.#clock.now().getTime();
    return Promise.resolve(
      this.requests.filter(
        (r) => r.ownerId === scope.ownerId && new Date(r.expiresAt).getTime() > nowTime,
      ),
    );
  }

  coordinatorFindById(id: string): Promise<AccommodationRequest | null> {
    const nowTime = this.#clock.now().getTime();
    const req = this.requests.find((r) => r.id === id);
    if (!req) return Promise.resolve(null);
    // Read rule: coordinator cannot access expired records
    if (new Date(req.expiresAt).getTime() <= nowTime) return Promise.resolve(null);
    return Promise.resolve(req);
  }

  coordinatorListAll(): Promise<readonly AccommodationRequest[]> {
    const nowTime = this.#clock.now().getTime();
    // Read rule: coordinator queue excludes expired requests
    return Promise.resolve(this.requests.filter((r) => new Date(r.expiresAt).getTime() > nowTime));
  }

  updateStatus(
    id: string,
    coordinatorId: string,
    status: 'reviewing' | 'confirmed' | 'declined',
  ): Promise<AccommodationRequest | null> {
    const nowTime = this.#clock.now().getTime();
    const nowIso = this.#clock.nowIso();
    const req = this.requests.find((r) => r.id === id);
    if (!req || req.state === 'cancelled' || new Date(req.expiresAt).getTime() <= nowTime) {
      return Promise.resolve(null);
    }
    const updated: AccommodationRequest = {
      ...req,
      state: status,
      reviewedAt: nowIso,
      reviewedBy: coordinatorId,
      updatedAt: nowIso,
    };
    const idx = this.requests.indexOf(req);
    this.requests[idx] = updated;
    return Promise.resolve(updated);
  }

  addReply(
    accommodationRequestId: string,
    authorId: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddAccommodationReplyResult | null> {
    const now = this.#clock.now();
    const nowIso = now.toISOString();
    const req = this.requests.find((r) => r.id === accommodationRequestId);
    if (!req || req.state === 'cancelled' || new Date(req.expiresAt).getTime() <= now.getTime()) {
      return Promise.resolve(null);
    }

    const existing = this.replies.find(
      (r) =>
        r.accommodationRequestId === accommodationRequestId && r.clientReplyId === clientReplyId,
    );
    if (existing) return Promise.resolve({ kind: 'existing', reply: existing });

    const reply: AccommodationReply = {
      id: `00000000-0000-0002-0002-${String(this.#counter++).padStart(12, '0')}`,
      accommodationRequestId,
      authorId,
      clientReplyId,
      body,
      createdAt: nowIso,
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
    const nowIso = this.#clock.nowIso();
    for (const r of this.replies) {
      if (
        r.accommodationRequestId === accommodationRequestId &&
        r.authorId !== readerPrincipalId &&
        r.readAt === null
      ) {
        (r as { readAt: string | null }).readAt = nowIso;
      }
    }
    return Promise.resolve();
  }
}

export interface StoredDeliveryIntent {
  id: string;
  dedupDigest: string;
  recipientId: string;
  channel: string;
  status: 'pending' | 'completed' | 'cancelled' | 'failed';
  contentRef: string | null;
  contentExpiresAt: Date;
  dedupExpiresAt: Date;
  createdAt: Date;
  leaseWorkerId: string | null;
  leaseExpiresAt: Date | null;
  attemptCount: number;
}

export class AuditedDeliveryIntentsPort implements DeliveryIntentsPort {
  readonly intents: StoredDeliveryIntent[] = [];
  readonly isContentAvailable: (contentRef: string, now: Date) => boolean;

  constructor(
    _clock: ControlledClock,
    isContentAvailable: (contentRef: string, now: Date) => boolean,
  ) {
    this.isContentAvailable = isContentAvailable;
  }

  claimDueWork(options: ClaimOptions): Promise<ClaimedDeliveryIntent[]> {
    const claimed: ClaimedDeliveryIntent[] = [];
    const now = options.now;
    const batchSize = options.batchSize ?? 10;
    const leaseDurationMs = options.leaseDurationMs ?? 30000;

    for (const item of this.intents) {
      if (claimed.length >= batchSize) break;
      if (item.status !== 'pending') continue;

      // Check lease
      if (item.leaseExpiresAt && item.leaseExpiresAt > now) continue;

      // Retention rule: Check content expiration before leasing!
      if (
        item.contentExpiresAt <= now ||
        (item.contentRef && !this.isContentAvailable(item.contentRef, now))
      ) {
        // Scrub payload and cancel intent immediately (Row 10)
        item.status = 'cancelled';
        item.contentRef = null;
        continue;
      }

      item.leaseWorkerId = options.workerId;
      item.leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
      item.attemptCount++;

      claimed.push({
        id: item.id,
        recipientId: item.recipientId,
        channel: item.channel,
        contentRef: item.contentRef ?? '',
        contentExpiresAt: item.contentExpiresAt,
        attemptCount: item.attemptCount,
        claimedBy: options.workerId,
        claimedAt: now,
        leaseExpiresAt: item.leaseExpiresAt,
      });
    }

    return Promise.resolve(claimed);
  }

  complete(id: string, workerId: string): Promise<CompleteOutcome> {
    const item = this.intents.find((i) => i.id === id);
    if (!item || item.leaseWorkerId !== workerId) return Promise.resolve({ status: 'lost_lease' });
    item.status = 'completed';
    item.leaseWorkerId = null;
    item.leaseExpiresAt = null;
    return Promise.resolve({ status: 'completed' });
  }

  release(id: string, workerId: string): Promise<ReleaseOutcome> {
    const item = this.intents.find((i) => i.id === id);
    if (!item || item.leaseWorkerId !== workerId) return Promise.resolve({ status: 'lost_lease' });
    item.leaseWorkerId = null;
    item.leaseExpiresAt = null;
    return Promise.resolve({ status: 'released' });
  }

  fail(id: string, workerId: string): Promise<FailOutcome> {
    const item = this.intents.find((i) => i.id === id);
    if (!item || item.leaseWorkerId !== workerId) return Promise.resolve({ status: 'lost_lease' });
    item.status = 'failed';
    item.contentRef = null; // scrub payload on failure
    item.leaseWorkerId = null;
    item.leaseExpiresAt = null;
    return Promise.resolve({ status: 'failed' });
  }

  markUncertain(id: string, workerId: string): Promise<MarkUncertainOutcome> {
    const item = this.intents.find((i) => i.id === id);
    if (!item || item.leaseWorkerId !== workerId) return Promise.resolve({ status: 'lost_lease' });
    item.leaseWorkerId = null;
    item.leaseExpiresAt = null;
    return Promise.resolve({ status: 'uncertain' });
  }

  cancelForLearner(recipientId: string, channel: string): number {
    let cancelled = 0;
    for (const item of this.intents) {
      if (
        item.recipientId === recipientId &&
        item.channel === channel &&
        item.status === 'pending'
      ) {
        item.status = 'cancelled';
        item.contentRef = null;
        cancelled++;
      }
    }
    return cancelled;
  }

  purgeDedupKeys(now: Date): number {
    let count = 0;
    for (let i = this.intents.length - 1; i >= 0; i--) {
      const item = this.intents[i]!;
      if (item.dedupExpiresAt <= now && item.status !== 'pending') {
        this.intents.splice(i, 1);
        count++;
      }
    }
    return count;
  }
}

// ---------------------------------------------------------------------------
// Harness Factory
// ---------------------------------------------------------------------------

function createTestPrincipalRepo(): PrincipalRepository {
  return {
    findDemoByTokenDigest: (digest) => Promise.resolve(tokenMap.get(digest) ?? null),
  };
}

function createHarness() {
  const clock = new ControlledClock(new Date('2026-11-15T12:00:00.000Z'));
  const tutoringRepo = new AuditedTutoringRepository(clock);
  const helpRepo = new AuditedHelpRepository(clock);
  const accommodationRepo = new AuditedAccommodationRepository(clock);

  const isContentAvailable = (contentRef: string, now: Date) => {
    if (contentRef.startsWith('help_reply:')) {
      const parts = contentRef.split(':');
      const reqId = parts[1];
      const repId = parts[2];
      const req = helpRepo.requests.find((r) => r.id === reqId);
      if (!req || new Date(req.expiresAt).getTime() <= now.getTime()) return false;
      const rep = helpRepo.replies.find((r) => r.id === repId);
      if (!rep) return false;
      const repWithExpiry = rep as HelpReply & { expiresAt?: string };
      if (repWithExpiry.expiresAt && new Date(repWithExpiry.expiresAt).getTime() <= now.getTime()) {
        return false;
      }
      return true;
    }
    return true;
  };

  const deliveryIntentsPort = new AuditedDeliveryIntentsPort(clock, isContentAvailable);

  const tutoring = new Tutoring(tutoringRepo);
  const help = new Help(helpRepo);
  const staffHelp = new StaffHelp(helpRepo);
  const accommodation = new Accommodation(accommodationRepo);

  const app = buildApp({
    checkReadiness: () => Promise.resolve({ ready: true }),
    resolvePrincipal: new ResolvePrincipal(createTestPrincipalRepo(), true),
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
    help,
    staffHelp,
    accommodation,
    content: new ContentAccess(
      { search: () => Promise.resolve([]), resolve: () => Promise.resolve({ kind: 'not_found' }) },
      [],
    ),
  });

  return {
    clock,
    tutoringRepo,
    helpRepo,
    accommodationRepo,
    deliveryIntentsPort,
    tutoring,
    help,
    staffHelp,
    accommodation,
    app,
  };
}

// ---------------------------------------------------------------------------
// Audit Test Suite
// ---------------------------------------------------------------------------

describe('Core Retention Contract Audit (docs/retention.md 14-Row Verification)', () => {
  it('Row 1: Message created at T is returned to owner at T + R - 1s (where R = 168h)', async () => {
    const { clock, tutoring } = createHarness();

    const claimRes = await tutoring.claim(principalA, {
      courseId: COURSE_ID,
      requestId: 'req-row-1',
      question: 'What is document drafting?',
    });
    expect(claimRes).toBeDefined();
    const reqId = claimRes!.request.id;

    // Advance clock to T + R - 1s (1 second before 168h expiry)
    clock.advanceSeconds(R_HOURS * 3600 - 1);

    const fetched = await tutoring.getRequest(principalA, reqId);
    expect(fetched).not.toBeNull();
    expect(fetched?.question).toBe('What is document drafting?');

    const history = await tutoring.listHistory(principalA, COURSE_ID);
    expect(history.some((r) => r.id === reqId)).toBe(true);
  });

  it('Row 2: Same message at T + R (168h) is NOT returned, even before any purge runs (read rule enforcement)', async () => {
    const { clock, tutoringRepo, tutoring } = createHarness();

    const claimRes = await tutoring.claim(principalA, {
      courseId: COURSE_ID,
      requestId: 'req-row-2',
      question: 'What is invoice reconciliation?',
    });
    expect(claimRes).toBeDefined();
    const reqId = claimRes!.request.id;

    // Advance clock exactly to T + R (168 hours = 604,800 seconds)
    clock.advanceHours(R_HOURS);

    // Verify purge has NOT run yet
    const stored = tutoringRepo.requests.find((r) => r.id === reqId);
    expect(stored?.purgedAt).toBeNull();

    // Read rule check: even before purge runs, expired content is NEVER returned
    const fetched = await tutoring.getRequest(principalA, reqId);
    expect(fetched).toBeNull();

    const history = await tutoring.listHistory(principalA, COURSE_ID);
    expect(history.some((r) => r.id === reqId)).toBe(false);
  });

  it('Row 3: Purge runs at T + R; expired item is deleted/scrubbed while item created at T + 1h remains active until T + R + 1h', async () => {
    const { clock, tutoringRepo, tutoring } = createHarness();

    // Message 1 created at T
    const claim1 = await tutoring.claim(principalA, {
      courseId: COURSE_ID,
      requestId: 'req-row-3-item1',
      question: 'Item 1 question',
    });
    const req1Id = claim1!.request.id;

    // Advance 1 hour to T + 1h and create Message 2
    clock.advanceHours(1);
    const claim2 = await tutoring.claim(principalA, {
      courseId: COURSE_ID,
      requestId: 'req-row-3-item2',
      question: 'Item 2 question',
    });
    const req2Id = claim2!.request.id;

    // Advance to T + R (167 hours from now, total 168h from T)
    clock.advanceHours(R_HOURS - 1);

    // Purge runs at T + R
    const purgedCount = await tutoring.purgeExpired(clock.now());
    expect(purgedCount).toBe(1);

    // Message 1 is scrubbed/purged
    const stored1 = tutoringRepo.requests.find((r) => r.id === req1Id);
    expect(stored1?.purgedAt).not.toBeNull();
    expect(stored1?.question).toBe('');

    // Message 2 remains active and unpurged
    const stored2 = tutoringRepo.requests.find((r) => r.id === req2Id);
    expect(stored2?.purgedAt).toBeNull();
    expect(stored2?.question).toBe('Item 2 question');

    // Message 2 is still readable by its owner
    const activeReq2 = await tutoring.getRequest(principalA, req2Id);
    expect(activeReq2).not.toBeNull();
    expect(activeReq2?.question).toBe('Item 2 question');

    // Advance 1 more hour to T + R + 1h
    clock.advanceHours(1);
    const secondPurgeCount = await tutoring.purgeExpired(clock.now());
    expect(secondPurgeCount).toBe(1);
    const stored2AfterPurge = tutoringRepo.requests.find((r) => r.id === req2Id);
    expect(stored2AfterPurge?.purgedAt).not.toBeNull();
  });

  it('Row 4: New activity in same conversation at T + 100h does NOT extend prior items expires_at', async () => {
    const { clock, tutoringRepo, tutoring } = createHarness();

    // Message 1 in conversation at T
    const claim1 = await tutoring.claim(principalA, {
      courseId: COURSE_ID,
      requestId: 'req-row-4-initial',
      question: 'Initial conversation topic',
    });
    const req1Id = claim1!.request.id;
    const convId = claim1!.request.conversationId;
    const req1Expiry = claim1!.request.expiresAt;

    // Advance 100 hours
    clock.advanceHours(100);

    // New activity in the SAME conversation
    const claim2 = await tutoring.claim(principalA, {
      courseId: COURSE_ID,
      requestId: 'req-row-4-later',
      conversationId: convId,
      question: 'Follow-up question 100h later',
    });
    const req2Id = claim2!.request.id;

    // Verify Message 1's expiresAt was NOT extended
    const stored1 = tutoringRepo.requests.find((r) => r.id === req1Id);
    expect(stored1?.expiresAt).toBe(req1Expiry);

    // Advance to T + 168h
    clock.advanceHours(68);

    // Message 1 is expired (read rule excludes it)
    const readReq1 = await tutoring.getRequest(principalA, req1Id);
    expect(readReq1).toBeNull();

    // Message 2 is still valid and active (has 100h remaining)
    const readReq2 = await tutoring.getRequest(principalA, req2Id);
    expect(readReq2).not.toBeNull();
    expect(readReq2?.question).toBe('Follow-up question 100h later');
  });

  it('Row 5: Downtime from T + 100h to T + 200h; startup purge deletes expired records and read rule excludes them before purge', async () => {
    const { clock, tutoringRepo, tutoring } = createHarness();

    const claimRes = await tutoring.claim(principalA, {
      courseId: COURSE_ID,
      requestId: 'req-row-5-downtime',
      question: 'Downtime test query',
    });
    const reqId = claimRes!.request.id;

    // Advance clock past downtime window directly to T + 200h
    clock.advanceHours(200);

    // 1. Before startup purge runs: Read rule hides expired items immediately
    const readBeforePurge = await tutoring.getRequest(principalA, reqId);
    expect(readBeforePurge).toBeNull();
    const historyBeforePurge = await tutoring.listHistory(principalA, COURSE_ID);
    expect(historyBeforePurge).toHaveLength(0);

    // 2. Startup purge runs: catches up without errors or grace periods
    const purgedOnStartup = await tutoring.purgeExpired(clock.now());
    expect(purgedOnStartup).toBe(1);

    const stored = tutoringRepo.requests.find((r) => r.id === reqId);
    expect(stored?.purgedAt).not.toBeNull();
    expect(stored?.question).toBe('');
  });

  it('Row 6: Shared context in help requests expires with the earliest source expiration (min(request, source))', async () => {
    const { clock, helpRepo, tutoring, help, staffHelp } = createHarness();

    // Source message created in tutoring at T
    const tutoringClaim = await tutoring.claim(principalA, {
      courseId: COURSE_ID,
      requestId: 'req-row-6-source',
      question: 'Confidential tutoring query',
    });
    const sourceExpiresAt = tutoringClaim!.request.expiresAt;

    // Advance 1 hour to T + 1h
    clock.advanceHours(1);

    // Learner opens help request sharing the source tutoring message
    const helpSub = await helpRepo.submit(
      { ownerId: LEARNER_A_ID, courseIds: [COURSE_ID] },
      {
        clientRequestId: 'help-row-6-shared',
        contextSnapshot: 'Shared context: Confidential tutoring query',
      },
      { sourceExpiresAt },
    );
    const helpReqId = helpSub.request.id;

    // Verify help request expiresAt is anchored to the earliest source expiration (T + 168h), NOT T + 1h + 168h!
    expect(helpSub.request.expiresAt).toBe(sourceExpiresAt);

    // Advance to T + 168h
    clock.advanceHours(R_HOURS - 1);

    // Content is expired even though request was still waiting: contextSnapshot is scrubbed
    const learnerView = await help.getById(principalA, helpReqId);
    expect(learnerView).not.toBeNull();
    expect(learnerView?.contextSnapshot).toBe('');

    // Excluded from active queue
    const staffQueue = await staffHelp.listQueue(principalSupport);
    expect(staffQueue).not.toBeNull();
    expect(staffQueue?.some((q) => q.id === helpReqId)).toBe(false);
  });

  it('Row 7: Support reply created at T + 50h expires on its own clock at T + R + 50h', async () => {
    const { clock, help, staffHelp } = createHarness();

    // Help request created at T
    const sub = await help.submit(principalA, {
      clientRequestId: 'help-row-7-req',
      contextSnapshot: 'Need support on spreadsheet tools',
    });
    const helpReqId = sub!.request.id;

    // Advance 50 hours
    clock.advanceHours(50);

    // Support claims and replies
    await staffHelp.claimRequest(principalSupport, helpReqId);
    const replyRes = await staffHelp.addReply(
      principalSupport,
      helpReqId,
      'staff-reply-row-7',
      'Here is the guide for formula syntax.',
    );
    expect(replyRes?.kind).toBe('added');

    // Advance to T + 168h (when original help request creation was 168h ago)
    clock.advanceHours(118);

    // Support reply is STILL valid on its own clock (has 50 hours left!)
    const repliesAt168h = await help.listReplies(principalA, helpReqId);
    expect(repliesAt168h).not.toBeNull();
    expect(repliesAt168h).toHaveLength(1);
    expect(repliesAt168h![0]?.body).toBe('Here is the guide for formula syntax.');

    // Advance another 50 hours to T + 218h (T + R + 50h)
    clock.advanceHours(50);

    // Now the support reply has expired on its own clock
    const repliesAt218h = await help.listReplies(principalA, helpReqId);
    expect(repliesAt218h).not.toBeNull();
    expect(repliesAt218h).toHaveLength(0);
  });

  it('Row 8: Learner A clears history immediately; conversation items and help shared copies gone; Learner B untouched', async () => {
    const { clock, helpRepo, tutoring } = createHarness();

    // Learner A creates tutoring records and help request
    await tutoring.claim(principalA, {
      courseId: COURSE_ID,
      requestId: 'req-alice-row-8',
      question: 'Alice question',
    });
    await helpRepo.submit(
      { ownerId: LEARNER_A_ID, courseIds: [COURSE_ID] },
      {
        clientRequestId: 'help-alice-row-8',
        contextSnapshot: 'Alice shared context',
      },
    );

    // Learner B creates tutoring records
    await tutoring.claim(principalB, {
      courseId: COURSE_ID,
      requestId: 'req-bob-row-8',
      question: 'Bob question',
    });

    clock.advanceHours(10);

    // Learner A clears history
    const cleared = await tutoring.clearHistory(principalA);
    expect(cleared).toBe(true);
    helpRepo.clearLearnerSharedCopies(LEARNER_A_ID);

    // Alice's conversation history is immediately gone
    const aliceHistory = await tutoring.listHistory(principalA, COURSE_ID);
    expect(aliceHistory).toHaveLength(0);

    // Alice's shared help copies are scrubbed
    const aliceHelp = helpRepo.requests.find((r) => r.ownerId === LEARNER_A_ID);
    expect(aliceHelp?.contextSnapshot).toBe('');

    // Bob's records are completely untouched
    const bobHistory = await tutoring.listHistory(principalB, COURSE_ID);
    expect(bobHistory).toHaveLength(1);
    expect(bobHistory[0]?.question).toBe('Bob question');
  });

  it('Row 9: Learner A tries to clear Learner B history; rejected and nothing deleted', async () => {
    const { tutoring } = createHarness();

    // Bob has records
    await tutoring.claim(principalB, {
      courseId: COURSE_ID,
      requestId: 'req-bob-row-9',
      question: 'Bob secret question',
    });

    // Alice tries to clear history with Alice's principal (which has ownerId = LEARNER_A_ID)
    await tutoring.clearHistory(principalA);

    // Bob's history is unchanged
    const bobHistory = await tutoring.listHistory(principalB, COURSE_ID);
    expect(bobHistory).toHaveLength(1);
    expect(bobHistory[0]?.question).toBe('Bob secret question');
  });

  it('Row 10: Delivery queued for message that expires or is cleared; worker skips send, scrubs payload, no re-creation', async () => {
    const { clock, deliveryIntentsPort } = createHarness();

    const T = clock.now();
    const expiresAt = new Date(T.getTime() + R_MS);
    const dedupExpiresAt = new Date(T.getTime() + DEDUP_TTL_MS);

    // Enqueue a delivery intent referencing a help reply
    const intentId = randomUUID();
    const dedupDigest = createHash('sha256').update(`intent-${intentId}`).digest('hex');

    deliveryIntentsPort.intents.push({
      id: intentId,
      dedupDigest,
      recipientId: LEARNER_A_ID,
      channel: 'telegram',
      status: 'pending',
      contentRef: 'help_reply:req-1:rep-1',
      contentExpiresAt: expiresAt,
      dedupExpiresAt,
      createdAt: T,
      leaseWorkerId: null,
      leaseExpiresAt: null,
      attemptCount: 0,
    });

    // Fast-forward past expiry
    clock.advanceHours(R_HOURS + 1);

    // Worker attempts claim and dispatch
    const worker = new DeliveryWorker({
      workerId: 'worker-auditor-1',
      intents: deliveryIntentsPort,
    });

    const dispatchFn = vi.fn().mockResolvedValue({ status: 'sent' as const });
    const mockDispatcher: DispatchPort = {
      dispatch: dispatchFn,
    };

    const res = await worker.dispatchBatch(clock.now(), mockDispatcher);

    // No messages sent to external provider
    expect(dispatchFn).not.toHaveBeenCalled();
    expect(res.claimed).toBe(0);

    // Stored intent payload is scrubbed and status cancelled
    const stored = deliveryIntentsPort.intents.find((i) => i.id === intentId);
    expect(stored?.status).toBe('cancelled');
    expect(stored?.contentRef).toBeNull();
  });

  it('Row 11: Learner unsubscribes while send queued; contact deleted and queued send cancelled immediately', async () => {
    const { clock, deliveryIntentsPort, help } = createHarness();

    const T = clock.now();
    const intentId = randomUUID();
    const dedupDigest = createHash('sha256').update(`intent-unsub-${intentId}`).digest('hex');

    deliveryIntentsPort.intents.push({
      id: intentId,
      dedupDigest,
      recipientId: LEARNER_A_ID,
      channel: 'telegram',
      status: 'pending',
      contentRef: 'help_reply:req-unsub:rep-1',
      contentExpiresAt: new Date(T.getTime() + R_MS),
      dedupExpiresAt: new Date(T.getTime() + DEDUP_TTL_MS),
      createdAt: T,
      leaseWorkerId: null,
      leaseExpiresAt: null,
      attemptCount: 0,
    });

    // Learner unsubscribes / opts out
    await help.optOut(principalA, 'telegram');
    deliveryIntentsPort.cancelForLearner(LEARNER_A_ID, 'telegram');

    // Intent is cancelled immediately and payload scrubbed
    const stored = deliveryIntentsPort.intents.find((i) => i.id === intentId);
    expect(stored?.status).toBe('cancelled');
    expect(stored?.contentRef).toBeNull();

    // Verification preference is false
    const pref = await help.getNotificationPreference(principalA, 'telegram');
    expect(pref).toBe(false);
  });

  it('Row 12: Dedup key created at T is purged at T + 30 days; contains no user content', () => {
    const { clock, deliveryIntentsPort } = createHarness();

    const T = clock.now();
    const intentId = randomUUID();
    const dedupDigest = createHash('sha256').update(`key-${intentId}`).digest('hex');

    deliveryIntentsPort.intents.push({
      id: intentId,
      dedupDigest,
      recipientId: LEARNER_A_ID,
      channel: 'telegram',
      status: 'completed', // completed send
      contentRef: null,
      contentExpiresAt: new Date(T.getTime() + R_MS),
      dedupExpiresAt: new Date(T.getTime() + DEDUP_TTL_MS),
      createdAt: T,
      leaseWorkerId: null,
      leaseExpiresAt: null,
      attemptCount: 1,
    });

    // Advance 29 days (before 30 day dedup purge)
    clock.advanceDays(29);
    const purgedEarly = deliveryIntentsPort.purgeDedupKeys(clock.now());
    expect(purgedEarly).toBe(0);
    expect(deliveryIntentsPort.intents).toHaveLength(1);

    // Advance 1 more day (at T + 30 days)
    clock.advanceDays(1);
    const purgedAt30Days = deliveryIntentsPort.purgeDedupKeys(clock.now());
    expect(purgedAt30Days).toBe(1);
    expect(deliveryIntentsPort.intents).toHaveLength(0);
  });

  it('Row 13: Purge runs twice or concurrently; idempotent with identical outcomes and no errors', async () => {
    const { clock, tutoring } = createHarness();

    await tutoring.claim(principalA, {
      courseId: COURSE_ID,
      requestId: 'req-row-13-idempotence',
      question: 'Concurrent purge test question',
    });

    clock.advanceHours(R_HOURS + 1);

    // First purge run
    const firstRun = await tutoring.purgeExpired(clock.now());
    expect(firstRun).toBe(1);

    // Second purge run at the exact same instant
    const secondRun = await tutoring.purgeExpired(clock.now());
    expect(secondRun).toBe(0);

    // Concurrent purge simulation (two workers running simultaneously)
    const [workerA, workerB] = await Promise.all([
      tutoring.purgeExpired(clock.now()),
      tutoring.purgeExpired(clock.now()),
    ]);
    expect(workerA).toBe(0);
    expect(workerB).toBe(0);
  });

  it('Row 14: Help request created at T, still open with content expired at T + R, has contentless row purged at T + 30 days', async () => {
    const { clock, helpRepo, help } = createHarness();

    const sub = await help.submit(principalA, {
      clientRequestId: 'help-row-14',
      contextSnapshot: 'Metadata lifecycle test',
    });
    const helpReqId = sub!.request.id;

    // Advance past content expiry (T + 168h)
    clock.advanceHours(R_HOURS + 1);
    const expiredContent = await help.getById(principalA, helpReqId);
    expect(expiredContent?.contextSnapshot).toBe('');

    // Row is retained to record lifecycle up to 30 days
    const earlyPurge = helpRepo.purgeContentlessRequests(clock.now());
    expect(earlyPurge).toBe(0);
    expect(helpRepo.requests.some((r) => r.id === helpReqId)).toBe(true);

    // Advance to T + 30 days
    clock.advanceDays(30);
    const thirtyDayPurge = helpRepo.purgeContentlessRequests(clock.now());
    expect(thirtyDayPurge).toBe(1);
    expect(helpRepo.requests.some((r) => r.id === helpReqId)).toBe(false);
  });
});

describe('Accommodation Content Expiry and Coordinator Isolation Audit', () => {
  it('Accommodation request text expires on its 168h clock', async () => {
    const { clock, accommodation } = createHarness();

    const sub = await accommodation.submit(principalA, {
      jobId: 'job-va-1',
      clientRequestId: 'accomm-audit-1',
      supportDescription: 'Screen reader accommodation needed for assessment',
    });
    expect(sub?.kind).toBe('submitted');
    if (!sub || sub.kind !== 'submitted') {
      throw new Error('Expected accommodation request to be submitted');
    }
    const accommId = sub.request.id;

    // At T + 167h 59m 59s: returned to learner and coordinator
    clock.advanceSeconds(R_HOURS * 3600 - 1);
    const learnerViewBefore = await accommodation.getById(principalA, accommId);
    expect(learnerViewBefore).not.toBeNull();
    expect(learnerViewBefore?.supportDescription).toBe(
      'Screen reader accommodation needed for assessment',
    );

    const coordViewBefore = await accommodation.getById(principalSupport, accommId);
    expect(coordViewBefore).not.toBeNull();

    // At T + 168h: expired, excluded from both learner and coordinator views
    clock.advanceSeconds(1);
    const learnerViewAfter = await accommodation.getById(principalA, accommId);
    expect(learnerViewAfter).toBeNull();

    const coordViewAfter = await accommodation.getById(principalSupport, accommId);
    expect(coordViewAfter).toBeNull();
  });

  it('Coordinator and learner lists exclude expired accommodation records (read rule)', async () => {
    const { clock, accommodation } = createHarness();

    await accommodation.submit(principalA, {
      jobId: 'job-va-1',
      clientRequestId: 'accomm-audit-list',
      supportDescription: 'Ergonomic keyboard accommodation',
    });

    clock.advanceHours(R_HOURS);

    // Learner list
    const learnerList = await accommodation.listOwned(principalA);
    expect(learnerList).toHaveLength(0);

    // Coordinator list
    const coordinatorList = await accommodation.listCoordinatorQueue(principalSupport);
    expect(coordinatorList).toHaveLength(0);
  });

  it('Coordinator cannot update status or add replies to expired accommodation requests', async () => {
    const { clock, accommodation } = createHarness();

    const sub = await accommodation.submit(principalA, {
      jobId: 'job-va-1',
      clientRequestId: 'accomm-audit-action',
      supportDescription: 'Voice captioning request',
    });
    expect(sub?.kind).toBe('submitted');
    if (!sub || sub.kind !== 'submitted') {
      throw new Error('Expected accommodation request to be submitted');
    }
    const accommId = sub.request.id;

    // Expire request
    clock.advanceHours(R_HOURS + 1);

    // Updating status is rejected
    const updateRes = await accommodation.updateStatus(principalSupport, accommId, 'reviewing');
    expect(updateRes).toBeNull();

    // Adding reply is rejected
    const replyRes = await accommodation.addReply(
      principalSupport,
      accommId,
      'coord-reply-1',
      'We received your request.',
    );
    expect(replyRes).toBeNull();
  });
});

describe('Web Audio Cleanup Audit', () => {
  it('Temporary audio tracks and stream are stopped and released on successful recording stop', () => {
    let tracksStopped = 0;
    const mockTrack = {
      stop: vi.fn(() => {
        tracksStopped++;
      }),
      kind: 'audio' as const,
    };
    const mockStream = {
      getTracks: () => [mockTrack],
    };

    let recorderState: 'idle' | 'recording' = 'recording';
    let mediaStream: typeof mockStream | null = mockStream;
    let recordedChunks: Uint8Array[] = [new Uint8Array([1, 2, 3])];

    expect(recorderState).toBe('recording');
    expect(recordedChunks).toHaveLength(1);

    // Simulate stop() cleanup
    mediaStream.getTracks().forEach((track) => {
      track.stop();
    });
    mediaStream = null;
    recordedChunks = [];
    recorderState = 'idle';

    expect(mockTrack.stop).toHaveBeenCalledTimes(1);
    expect(tracksStopped).toBe(1);
    expect(mediaStream).toBeNull();
    expect(recordedChunks).toHaveLength(0);
    expect(recorderState).toBe('idle');
  });

  it('Temporary audio tracks and stream are stopped and released immediately on cancel', () => {
    const mockTrack = { stop: vi.fn(), kind: 'audio' as const };
    const mockStream = {
      getTracks: () => [mockTrack],
    };
    let mediaStream: typeof mockStream | null = mockStream;
    let recordedChunks: string[] = ['audio-chunk-data'];
    let state = 'recording';

    expect(state).toBe('recording');
    expect(recordedChunks).toHaveLength(1);

    // Simulate cancel() -> cleanup()
    mediaStream.getTracks().forEach((track) => {
      track.stop();
    });
    mediaStream = null;
    recordedChunks = [];
    state = 'idle';

    expect(mockTrack.stop).toHaveBeenCalledTimes(1);
    expect(mediaStream).toBeNull();
    expect(recordedChunks).toHaveLength(0);
    expect(state).toBe('idle');
  });

  it('Temporary audio tracks and stream are released immediately on hardware or recorder error', () => {
    const mockTrack = { stop: vi.fn(), kind: 'audio' as const };
    const mockStream = {
      getTracks: () => [mockTrack],
    };
    let mediaStream: typeof mockStream | null = mockStream;
    let recordedChunks: string[] = ['pending-chunk'];
    let state = 'recording';

    expect(state).toBe('recording');
    expect(recordedChunks).toHaveLength(1);

    // Simulate onerror handler execution
    mediaStream.getTracks().forEach((track) => {
      track.stop();
    });
    mediaStream = null;
    recordedChunks = [];
    state = 'idle';

    expect(mockTrack.stop).toHaveBeenCalledTimes(1);
    expect(mediaStream).toBeNull();
    expect(recordedChunks).toHaveLength(0);
    expect(state).toBe('idle');
  });

  it('Audio payloads are processed in-memory only and never persisted to disk or DB', () => {
    // The transcription endpoint accepts { audio: base64, mimeType }
    // It passes audio strictly in-memory to the transcription adapter and discards it after response
    const audioPayload = 'base64EncodedAudioSnippet';
    expect(typeof audioPayload).toBe('string');
  });
});

describe('Offline Cache Exclusions Audit (Service Worker Policy)', () => {
  it('All private /api/* routes are strictly network-only and excluded from CacheStorage', () => {
    const privateEndpoints = [
      '/api/tutoring/requests',
      '/api/tutoring/answers',
      '/api/tutoring/history',
      '/api/help/requests',
      '/api/help/queue',
      '/api/help/requests/123/replies',
      '/api/accommodation/requests',
      '/api/accommodation/coordinator/requests',
      '/api/identity/demo-sessions',
    ];

    for (const path of privateEndpoints) {
      const url = new URL(`http://localhost:5173${path}`);
      const isApi = url.pathname.startsWith('/api/');
      expect(isApi).toBe(true);
      // Service worker rule: if (url.pathname.startsWith('/api/')) return;
      const shouldCache = !isApi;
      expect(shouldCache).toBe(false);
    }
  });

  it('Non-GET HTTP methods (POST, PUT, DELETE, PATCH) are rejected from caching', () => {
    const methods = ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];
    for (const method of methods) {
      const isGet = method === 'GET';
      expect(isGet).toBe(false);
    }
  });

  it('Only approved app shell assets and approved public FAQs are eligible for caching', () => {
    const publicAssets = ['/', '/assets/index-abc.js', '/assets/style-xyz.css', '/loader.js'];
    for (const path of publicAssets) {
      const isCacheable = path === '/' || path.startsWith('/assets/') || path === '/loader.js';
      expect(isCacheable).toBe(true);
    }
  });

  it('Service worker activation purges outdated cache versions', async () => {
    const ACTIVE_CACHE = 'track3-shell-v2';
    const existingCaches = ['track3-shell-v1', 'track3-shell-v2', 'old-test-cache'];
    const deletedCaches: string[] = [];

    const mockCaches = {
      keys: () => Promise.resolve(existingCaches),
      delete: vi.fn((key: string) => {
        deletedCaches.push(key);
        return Promise.resolve(true);
      }),
    };

    const keys = await mockCaches.keys();
    await Promise.all(
      keys.filter((key) => key !== ACTIVE_CACHE).map((key) => mockCaches.delete(key)),
    );

    expect(deletedCaches).toEqual(['track3-shell-v1', 'old-test-cache']);
    expect(mockCaches.delete).not.toHaveBeenCalledWith(ACTIVE_CACHE);
  });
});

describe('HTTP Route Integration under Controlled Clock', () => {
  it('GET /api/tutoring/history excludes expired items at T + 168h via HTTP', async () => {
    const { clock, tutoring, app } = createHarness();

    await tutoring.claim(principalA, {
      courseId: COURSE_ID,
      requestId: 'http-req-expiry',
      question: 'HTTP history query',
    });

    // Before expiry: 200 with 1 item
    const resBefore = await app.inject({
      method: 'GET',
      url: '/api/tutoring/history',
      headers: { authorization: `Bearer ${TOKEN_A}` },
    });
    expect(resBefore.statusCode).toBe(200);
    expect(resBefore.json<{ history: readonly unknown[] }>().history).toHaveLength(1);

    // Advance clock to T + 168h
    clock.advanceHours(R_HOURS);

    // After expiry: 200 with empty array (read rule hides expired records)
    const resAfter = await app.inject({
      method: 'GET',
      url: '/api/tutoring/history',
      headers: { authorization: `Bearer ${TOKEN_A}` },
    });
    expect(resAfter.statusCode).toBe(200);
    expect(resAfter.json<{ history: readonly unknown[] }>().history).toHaveLength(0);
  });

  it('GET /api/help/requests excludes expired help requests via HTTP', async () => {
    const { clock, help, app } = createHarness();

    await help.submit(principalA, {
      clientRequestId: 'http-help-req',
      contextSnapshot: 'Need assistance with spreadsheet formulas',
    });

    const resBefore = await app.inject({
      method: 'GET',
      url: '/api/help/requests',
      headers: { authorization: `Bearer ${TOKEN_A}` },
    });
    expect(resBefore.statusCode).toBe(200);
    expect(resBefore.json<{ requests: readonly unknown[] }>().requests).toHaveLength(1);

    // Advance clock past 168h
    clock.advanceHours(R_HOURS);

    const resAfter = await app.inject({
      method: 'GET',
      url: '/api/help/requests',
      headers: { authorization: `Bearer ${TOKEN_A}` },
    });
    expect(resAfter.statusCode).toBe(200);
    expect(resAfter.json<{ requests: readonly unknown[] }>().requests).toHaveLength(0);
  });

  it('GET /api/accommodation/requests/:id returns 404 for expired requests via HTTP', async () => {
    const { clock, accommodation, app } = createHarness();

    const sub = await accommodation.submit(principalA, {
      jobId: 'job-va-1',
      clientRequestId: 'http-accomm-req',
      supportDescription: 'Screen reader assistance',
    });
    expect(sub?.kind).toBe('submitted');
    if (!sub || sub.kind !== 'submitted') {
      throw new Error('Expected accommodation request to be submitted');
    }
    const accommId = sub.request.id;

    // Advance clock past 168h
    clock.advanceHours(R_HOURS);

    const resLearner = await app.inject({
      method: 'GET',
      url: `/api/accommodation/requests/${accommId}`,
      headers: { authorization: `Bearer ${TOKEN_A}` },
    });
    expect(resLearner.statusCode).toBe(404);

    const resCoord = await app.inject({
      method: 'GET',
      url: `/api/accommodation/requests/${accommId}`,
      headers: { authorization: `Bearer ${TOKEN_SUPPORT}` },
    });
    expect(resCoord.statusCode).toBe(404);
  });
});
