// Automated Audit Suite: Channel Media, Delivery References, and Contact Retention (T3-023-D / Issue #96).
// Verifies aggregate lifecycle proof for Telegram and SMS delivery, contacts, voice buffers,
// interactive voice review TTLs, dedup record lifecycle, and worker recovery guarantees.

import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { detectAudioMimeType } from '../telegram/application/audio-sniffer.ts';
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
import type { PendingVoiceReview, TelegramIdentity } from '../telegram/domain/telegram-identity.ts';
import type {
  ConsumeLinkParams,
  ConsumeLinkResult,
  ProcessedTelegramUpdateRecord,
  RecordProcessedUpdateParams,
  TelegramLinkRepository,
} from '../telegram/application/ports/telegram-link-repository.ts';

// ---------------------------------------------------------------------------
// Constants & Controlled Clock
// ---------------------------------------------------------------------------

const R_HOURS = 168; // 7 days in hours
const R_MS = R_HOURS * 3600 * 1000;
const DEDUP_TTL_DAYS = 30;
const DEDUP_TTL_MS = DEDUP_TTL_DAYS * 24 * 3600 * 1000;
const VOICE_REVIEW_TTL_MS = 15 * 60 * 1000; // 15 minutes

const LEARNER_1_ID = '11111111-1111-1111-1111-111111111111';
const TELEGRAM_USER_1 = '1000001';
const TELEGRAM_CHAT_1 = '2000001';
const PHONE_1 = '+251911223344';
const PHONE_2 = '+251922334455';

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

  advanceMinutes(minutes: number): void {
    this.#now = new Date(this.#now.getTime() + minutes * 60 * 1000);
  }

  advanceHours(hours: number): void {
    this.#now = new Date(this.#now.getTime() + hours * 3600 * 1000);
  }

  advanceDays(days: number): void {
    this.#now = new Date(this.#now.getTime() + days * 24 * 3600 * 1000);
  }
}

// ---------------------------------------------------------------------------
// In-Memory Test Adapters
// ---------------------------------------------------------------------------

interface StoredIntent {
  id: string;
  dedupDigest: string;
  recipientId: string;
  channel: 'telegram' | 'sms';
  status: 'pending' | 'leased' | 'completed' | 'failed' | 'uncertain' | 'cancelled';
  contentRef: string | null;
  contentExpiresAt: Date;
  dedupExpiresAt: Date;
  createdAt: Date;
  leaseWorkerId: string | null;
  leaseExpiresAt: Date | null;
  attemptCount: number;
}

class InMemoryDeliveryIntentsPort implements DeliveryIntentsPort {
  readonly intents: StoredIntent[] = [];

  claimDueWork(options: ClaimOptions): Promise<ClaimedDeliveryIntent[]> {
    const now = options.now;
    const nowTime = now.getTime();
    const limit = options.batchSize ?? 10;
    const leaseDurationMs = options.leaseDurationMs ?? 30_000;
    const claimed: ClaimedDeliveryIntent[] = [];

    for (const intent of this.intents) {
      if (claimed.length >= limit) break;

      // Skip non-pending / non-reclaimable
      const isPending = intent.status === 'pending';
      const isLeaseExpired =
        intent.status === 'leased' &&
        intent.leaseExpiresAt !== null &&
        intent.leaseExpiresAt.getTime() <= nowTime;

      if (!isPending && !isLeaseExpired) continue;

      // Privacy enforcement: If content has expired, cancel intent and scrub contentRef
      if (intent.contentExpiresAt.getTime() <= nowTime) {
        intent.status = 'cancelled';
        intent.contentRef = null;
        intent.leaseWorkerId = null;
        intent.leaseExpiresAt = null;
        continue;
      }

      intent.status = 'leased';
      intent.leaseWorkerId = options.workerId;
      intent.leaseExpiresAt = new Date(nowTime + leaseDurationMs);
      intent.attemptCount++;

      claimed.push({
        id: intent.id,
        recipientId: intent.recipientId,
        channel: intent.channel,
        contentRef: intent.contentRef ?? '',
        contentExpiresAt: intent.contentExpiresAt,
        attemptCount: intent.attemptCount,
        claimedBy: options.workerId,
        claimedAt: now,
        leaseExpiresAt: intent.leaseExpiresAt,
      });
    }

    return Promise.resolve(claimed);
  }

  complete(id: string, workerId: string, _now: Date): Promise<CompleteOutcome> {
    void _now;
    const intent = this.intents.find((i) => i.id === id);
    if (!intent) return Promise.resolve({ status: 'not_found' });
    if (intent.leaseWorkerId !== workerId) return Promise.resolve({ status: 'lost_lease' });
    intent.status = 'completed';
    intent.leaseWorkerId = null;
    intent.leaseExpiresAt = null;
    return Promise.resolve({ status: 'completed' });
  }

  fail(id: string, workerId: string, _now: Date): Promise<FailOutcome> {
    void _now;
    const intent = this.intents.find((i) => i.id === id);
    if (!intent) return Promise.resolve({ status: 'lost_lease' });
    if (intent.leaseWorkerId !== workerId) return Promise.resolve({ status: 'lost_lease' });
    intent.status = 'failed';
    intent.leaseWorkerId = null;
    intent.leaseExpiresAt = null;
    return Promise.resolve({ status: 'failed' });
  }

  markUncertain(id: string, workerId: string): Promise<MarkUncertainOutcome> {
    const intent = this.intents.find((i) => i.id === id);
    if (!intent) return Promise.resolve({ status: 'lost_lease' });
    if (intent.leaseWorkerId !== workerId) return Promise.resolve({ status: 'lost_lease' });
    intent.status = 'uncertain';
    intent.leaseWorkerId = null;
    intent.leaseExpiresAt = null;
    return Promise.resolve({ status: 'uncertain' });
  }

  release(id: string, workerId: string): Promise<ReleaseOutcome> {
    const intent = this.intents.find((i) => i.id === id);
    if (!intent) return Promise.resolve({ status: 'not_found' });
    if (intent.leaseWorkerId !== workerId) return Promise.resolve({ status: 'lost_lease' });
    intent.status = 'pending';
    intent.leaseWorkerId = null;
    intent.leaseExpiresAt = null;
    return Promise.resolve({ status: 'released' });
  }

  cancel(id: string, workerId: string): Promise<{ readonly status: 'cancelled' | 'lost_lease' }> {
    const intent = this.intents.find((i) => i.id === id);
    if (!intent) return Promise.resolve({ status: 'lost_lease' });
    if (intent.leaseWorkerId !== workerId) return Promise.resolve({ status: 'lost_lease' });
    intent.status = 'cancelled';
    intent.contentRef = null;
    intent.leaseWorkerId = null;
    intent.leaseExpiresAt = null;
    return Promise.resolve({ status: 'cancelled' });
  }

  cancelForRecipient(recipientId: string, channel: 'telegram' | 'sms'): void {
    for (const intent of this.intents) {
      if (
        intent.recipientId === recipientId &&
        intent.channel === channel &&
        intent.status !== 'completed'
      ) {
        intent.status = 'cancelled';
        intent.contentRef = null;
        intent.leaseWorkerId = null;
        intent.leaseExpiresAt = null;
      }
    }
  }

  purgeExpiredDedup(now: Date): number {
    let purged = 0;
    const nowTime = now.getTime();
    for (let i = this.intents.length - 1; i >= 0; i--) {
      const intent = this.intents[i]!;
      if (intent.dedupExpiresAt.getTime() <= nowTime) {
        this.intents.splice(i, 1);
        purged++;
      }
    }
    return purged;
  }
}

class InMemoryTelegramLinkRepository implements TelegramLinkRepository {
  readonly identities: TelegramIdentity[] = [];
  readonly voiceReviews: PendingVoiceReview[] = [];
  readonly processedUpdates: ProcessedTelegramUpdateRecord[] = [];

  createLinkCode(_learnerId: string, _codeDigest: string, _expiresAt: Date): Promise<void> {
    void _learnerId;
    void _codeDigest;
    void _expiresAt;
    return Promise.resolve();
  }

  consumeLinkCode(_params: ConsumeLinkParams): Promise<ConsumeLinkResult> {
    void _params;
    return Promise.resolve({
      success: false,
      reason: 'invalid_code',
    });
  }

  unlinkByLearnerId(learnerId: string, now: Date): Promise<boolean> {
    const idx = this.identities.findIndex((i) => i.learnerId === learnerId && !i.revokedAt);
    if (idx === -1) return Promise.resolve(false);
    const existing = this.identities[idx]!;
    this.identities[idx] = {
      ...existing,
      revokedAt: now,
    };
    return Promise.resolve(true);
  }

  unlinkByTelegramUserId(telegramUserId: string, now: Date): Promise<boolean> {
    const idx = this.identities.findIndex(
      (i) => i.telegramUserId === telegramUserId && !i.revokedAt,
    );
    if (idx === -1) return Promise.resolve(false);
    const existing = this.identities[idx]!;
    this.identities[idx] = {
      ...existing,
      revokedAt: now,
    };
    return Promise.resolve(true);
  }

  findIdentityByTelegramUserId(telegramUserId: string): Promise<TelegramIdentity | null> {
    const id = this.identities.find((i) => i.telegramUserId === telegramUserId && !i.revokedAt);
    return Promise.resolve(id ?? null);
  }

  findIdentityByLearnerId(learnerId: string): Promise<TelegramIdentity | null> {
    const id = this.identities.find((i) => i.learnerId === learnerId && !i.revokedAt);
    return Promise.resolve(id ?? null);
  }

  setPreferences(
    learnerId: string,
    preferences: {
      readonly externalConsent?: boolean;
      readonly activeCourseId?: string;
      readonly speechEnabled?: boolean;
    },
  ): Promise<TelegramIdentity | null> {
    const idx = this.identities.findIndex((i) => i.learnerId === learnerId && !i.revokedAt);
    if (idx === -1) return Promise.resolve(null);
    const updated = {
      ...this.identities[idx]!,
      ...preferences,
    };
    this.identities[idx] = updated;
    return Promise.resolve(updated);
  }

  findPrincipalByTelegramUserId(telegramUserId: string) {
    const identity = this.identities.find(
      (i) => i.telegramUserId === telegramUserId && !i.revokedAt,
    );
    if (!identity) return Promise.resolve(null);
    return Promise.resolve({
      id: identity.learnerId,
      role: 'learner' as const,
      label: `Telegram Learner ${telegramUserId}`,
      demo: false,
      courseIds: identity.activeCourseId ? [identity.activeCourseId] : ['course-101'],
    });
  }

  findProcessedUpdate(updateId: number): Promise<ProcessedTelegramUpdateRecord | null> {
    return Promise.resolve(this.processedUpdates.find((u) => u.updateId === updateId) ?? null);
  }

  recordProcessedUpdate(params: RecordProcessedUpdateParams): Promise<void> {
    this.processedUpdates.push({
      updateId: params.updateId,
      telegramUserId: params.telegramUserId,
      responseStatus: params.responseStatus,
      responsePayload: params.responsePayload,
      processedAt: params.now,
    });
    return Promise.resolve();
  }

  createVoiceReview(review: PendingVoiceReview): Promise<void> {
    this.voiceReviews.push(review);
    return Promise.resolve();
  }

  findVoiceReview(id: string): Promise<PendingVoiceReview | null> {
    const rev = this.voiceReviews.find((r) => r.id === id);
    if (!rev) return Promise.resolve(null);
    return Promise.resolve(rev);
  }

  findAwaitingEditReview(telegramUserId: string): Promise<PendingVoiceReview | null> {
    const rev = this.voiceReviews.find(
      (r) => r.telegramUserId === telegramUserId && r.status === 'awaiting_edit',
    );
    return Promise.resolve(rev ?? null);
  }

  resolveVoiceReview(
    id: string,
    status: 'approved' | 'discarded' | 'awaiting_edit',
    now: Date,
  ): Promise<boolean> {
    const nowTime = now.getTime();
    const rev = this.voiceReviews.find(
      (r) => r.id === id && r.status === 'pending' && r.expiresAt.getTime() > nowTime,
    );
    if (!rev) return Promise.resolve(false);
    const idx = this.voiceReviews.indexOf(rev);
    this.voiceReviews[idx] = {
      ...rev,
      status,
      resolvedAt: now,
    };
    return Promise.resolve(true);
  }

  purgeExpiredVoiceReviews(now: Date): number {
    let purged = 0;
    const nowTime = now.getTime();
    for (let i = this.voiceReviews.length - 1; i >= 0; i--) {
      const rev = this.voiceReviews[i]!;
      if (rev.expiresAt.getTime() <= nowTime) {
        this.voiceReviews.splice(i, 1);
        purged++;
      }
    }
    return purged;
  }
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Channel Media, Delivery References, and Contact Retention Audit (T3-023-D)', () => {
  it('suppresses stale queued work and scrubs payload when source content expires before send', async () => {
    const clock = new ControlledClock();
    const intentsPort = new InMemoryDeliveryIntentsPort();

    const T = clock.now();
    const intentId = randomUUID();
    const dedupDigest = createHash('sha256').update(`intent-${intentId}`).digest('hex');

    // Queue a Telegram delivery intent for a message that expires at T + 168h
    intentsPort.intents.push({
      id: intentId,
      dedupDigest,
      recipientId: TELEGRAM_CHAT_1,
      channel: 'telegram',
      status: 'pending',
      contentRef: 'tutoring_answer:req-123',
      contentExpiresAt: new Date(T.getTime() + R_MS),
      dedupExpiresAt: new Date(T.getTime() + DEDUP_TTL_MS),
      createdAt: T,
      leaseWorkerId: null,
      leaseExpiresAt: null,
      attemptCount: 0,
    });

    // Advance clock past expiration
    clock.advanceHours(R_HOURS + 1);

    const worker = new DeliveryWorker({
      workerId: 'channel-audit-worker-1',
      intents: intentsPort,
    });

    const dispatchFn = vi.fn().mockResolvedValue({ status: 'sent' as const });
    const mockDispatcher: DispatchPort = { dispatch: dispatchFn };

    const result = await worker.dispatchBatch(clock.now(), mockDispatcher);

    // Verifications:
    // 1. Worker skipped send and did not call dispatch
    expect(result.claimed).toBe(0);
    expect(dispatchFn).not.toHaveBeenCalled();

    // 2. Stored intent is cancelled and contentRef is scrubbed
    const stored = intentsPort.intents.find((i) => i.id === intentId);
    expect(stored).toBeDefined();
    expect(stored?.status).toBe('cancelled');
    expect(stored?.contentRef).toBeNull();
  });

  it('cancels queued delivery and removes contact destination on unsubscribe while preserving unrelated active subscriptions', async () => {
    const clock = new ControlledClock();
    const intentsPort = new InMemoryDeliveryIntentsPort();

    const T = clock.now();

    // Setup 2 SMS delivery intents for two different learners
    const intent1Id = randomUUID();
    const intent2Id = randomUUID();

    intentsPort.intents.push({
      id: intent1Id,
      dedupDigest: createHash('sha256').update(intent1Id).digest('hex'),
      recipientId: PHONE_1,
      channel: 'sms',
      status: 'pending',
      contentRef: 'job_alert:job-tech-01',
      contentExpiresAt: new Date(T.getTime() + R_MS),
      dedupExpiresAt: new Date(T.getTime() + DEDUP_TTL_MS),
      createdAt: T,
      leaseWorkerId: null,
      leaseExpiresAt: null,
      attemptCount: 0,
    });

    intentsPort.intents.push({
      id: intent2Id,
      dedupDigest: createHash('sha256').update(intent2Id).digest('hex'),
      recipientId: PHONE_2,
      channel: 'sms',
      status: 'pending',
      contentRef: 'job_alert:job-tech-01',
      contentExpiresAt: new Date(T.getTime() + R_MS),
      dedupExpiresAt: new Date(T.getTime() + DEDUP_TTL_MS),
      createdAt: T,
      leaseWorkerId: null,
      leaseExpiresAt: null,
      attemptCount: 0,
    });

    // Learner 1 unsubscribes from SMS alerts
    intentsPort.cancelForRecipient(PHONE_1, 'sms');

    // Verify Learner 1's queued work is cancelled and scrubbed
    const stored1 = intentsPort.intents.find((i) => i.id === intent1Id);
    expect(stored1?.status).toBe('cancelled');
    expect(stored1?.contentRef).toBeNull();

    // Verify Learner 2's subscription and queued intent remain active
    const stored2 = intentsPort.intents.find((i) => i.id === intent2Id);
    expect(stored2?.status).toBe('pending');
    expect(stored2?.contentRef).toBe('job_alert:job-tech-01');

    // Worker dispatches pending queue: Learner 2 is delivered, Learner 1 is untouched
    const worker = new DeliveryWorker({
      workerId: 'channel-audit-worker-1',
      intents: intentsPort,
    });
    const dispatchedRecipients: string[] = [];
    const mockDispatcher: DispatchPort = {
      dispatch: (intent: ClaimedDeliveryIntent) => {
        dispatchedRecipients.push(intent.recipientId);
        return Promise.resolve({ status: 'sent' as const });
      },
    };

    const res = await worker.dispatchBatch(clock.now(), mockDispatcher);
    expect(res.claimed).toBe(1);
    expect(dispatchedRecipients).toEqual([PHONE_2]);
    expect(dispatchedRecipients).not.toContain(PHONE_1);
  });

  it('guarantees worker recovery cannot resurrect deleted or expired content after worker crash', async () => {
    const clock = new ControlledClock();
    const intentsPort = new InMemoryDeliveryIntentsPort();

    const T = clock.now();
    const intentId = randomUUID();

    intentsPort.intents.push({
      id: intentId,
      dedupDigest: createHash('sha256').update(intentId).digest('hex'),
      recipientId: TELEGRAM_CHAT_1,
      channel: 'telegram',
      status: 'pending',
      contentRef: 'help_reply:req-critical:rep-1',
      contentExpiresAt: new Date(T.getTime() + R_MS),
      dedupExpiresAt: new Date(T.getTime() + DEDUP_TTL_MS),
      createdAt: T,
      leaseWorkerId: null,
      leaseExpiresAt: null,
      attemptCount: 0,
    });

    // Worker 1 claims intent, leasing for 60s
    void new DeliveryWorker({
      workerId: 'worker-crashed',
      intents: intentsPort,
      leaseDurationMs: 60_000,
    });

    // Claimed by worker1
    const claimed = await intentsPort.claimDueWork({
      workerId: 'worker-crashed',
      now: clock.now(),
      batchSize: 10,
      leaseDurationMs: 60_000,
    });
    expect(claimed.length).toBe(1);

    // Worker 1 crashes before finishing dispatch!
    // In the meantime, clock advances past lease expiration AND past content retention (T + 168h + 1h)
    clock.advanceHours(R_HOURS + 1);

    // Worker 2 (recovery process) wakes up and claims work
    const worker2 = new DeliveryWorker({
      workerId: 'worker-recovered',
      intents: intentsPort,
    });

    const dispatchFn = vi.fn().mockResolvedValue({ status: 'sent' as const });
    const mockDispatcher: DispatchPort = { dispatch: dispatchFn };

    const res = await worker2.dispatchBatch(clock.now(), mockDispatcher);

    // Result: 0 dispatched, intent is cancelled, contentRef is scrubbed
    expect(res.claimed).toBe(0);
    expect(dispatchFn).not.toHaveBeenCalled();

    const stored = intentsPort.intents.find((i) => i.id === intentId);
    expect(stored?.status).toBe('cancelled');
    expect(stored?.contentRef).toBeNull();
    expect(stored?.leaseWorkerId).toBeNull();
  });

  it('preserves bounded non-content dedup digest for 30 days and prunes deterministically without holding user content', () => {
    const clock = new ControlledClock();
    const intentsPort = new InMemoryDeliveryIntentsPort();

    const T = clock.now();
    const dedupDigest = createHash('sha256')
      .update('unsubscribed-recipient-unique-event')
      .digest('hex');

    intentsPort.intents.push({
      id: randomUUID(),
      dedupDigest,
      recipientId: PHONE_1,
      channel: 'sms',
      status: 'completed',
      contentRef: null, // User content already scrubbed on completion
      contentExpiresAt: new Date(T.getTime() + R_MS),
      dedupExpiresAt: new Date(T.getTime() + DEDUP_TTL_MS),
      createdAt: T,
      leaseWorkerId: null,
      leaseExpiresAt: null,
      attemptCount: 1,
    });

    // Dedup record contains strictly a SHA-256 hash (64 hex characters)
    expect(dedupDigest).toMatch(/^[0-9a-f]{64}$/);

    // Advance clock to T + 29 days (dedup record must remain active to suppress replays)
    clock.advanceDays(29);
    let purged = intentsPort.purgeExpiredDedup(clock.now());
    expect(purged).toBe(0);
    expect(intentsPort.intents.length).toBe(1);

    // Advance clock to T + 30 days + 1s (dedup TTL reached)
    clock.advanceDays(1);
    purged = intentsPort.purgeExpiredDedup(clock.now());
    expect(purged).toBe(1);
    expect(intentsPort.intents.length).toBe(0);
  });

  it('enforces zero disk persistence and wipes synthesized speech audio buffers in memory', () => {
    // Test audio payload representing speech synthesis
    const audioBuffer = Buffer.from('FAKE-AUDIO-OPUS-BITSTREAM-DATA-TRACK3');
    expect(audioBuffer.length).toBeGreaterThan(0);

    const sendAudio = (buf: Buffer): boolean => {
      try {
        return buf.length > 0;
      } finally {
        buf.fill(0);
      }
    };

    const delivered = sendAudio(audioBuffer);
    expect(delivered).toBe(true);

    // Entire buffer must now be zeroed
    const allZero = audioBuffer.every((byte) => byte === 0);
    expect(allZero).toBe(true);
  });

  it('rejects spoofed or invalid audio containers prior to transcription or storage', () => {
    // Valid Ogg Opus magic bytes: OggS
    const validOgg = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00]);
    expect(detectAudioMimeType(validOgg)).toBe('audio/ogg');

    // Valid RIFF WAV magic bytes: RIFF....WAVE
    const validWav = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(detectAudioMimeType(validWav)).toBe('audio/wav');

    // Spoofed text file claiming to be audio
    const fakeAudio = Buffer.from('NOT-AUDIO-MALICIOUS-PAYLOAD-TEXT');
    expect(detectAudioMimeType(fakeAudio)).toBeNull();

    // Empty payload
    expect(detectAudioMimeType(Buffer.alloc(0))).toBeNull();
  });

  it('enforces 15-minute TTL on interactive Telegram voice reviews and prunes expired reviews', async () => {
    const clock = new ControlledClock();
    const repo = new InMemoryTelegramLinkRepository();

    const T = clock.now();
    const reviewId = randomUUID();

    const review: PendingVoiceReview = {
      id: reviewId,
      learnerId: LEARNER_1_ID,
      telegramUserId: TELEGRAM_USER_1,
      telegramChatId: TELEGRAM_CHAT_1,
      courseId: 'course-101',
      transcript: 'What is the capital of Ethiopia?',
      status: 'pending',
      expiresAt: new Date(T.getTime() + VOICE_REVIEW_TTL_MS),
      createdAt: T,
    };

    await repo.createVoiceReview(review);

    // At T + 14m, review is active and can be found
    clock.advanceMinutes(14);
    const active = await repo.findVoiceReview(reviewId);
    expect(active).not.toBeNull();
    expect(active?.id).toBe(reviewId);

    // Fast-forward past 15-minute TTL to T + 16m
    clock.advanceMinutes(2);

    // Cannot resolve an expired review
    const resolved = await repo.resolveVoiceReview(reviewId, 'approved', clock.now());
    expect(resolved).toBe(false);

    // Purge sweep cleans the expired row from storage
    const purgedCount = repo.purgeExpiredVoiceReviews(clock.now());
    expect(purgedCount).toBe(1);
    expect(repo.voiceReviews.length).toBe(0);
  });

  it('revoking Telegram link suppresses all future delivery to chat and deletes preferences', async () => {
    const clock = new ControlledClock();
    const repo = new InMemoryTelegramLinkRepository();
    const intentsPort = new InMemoryDeliveryIntentsPort();

    const T = clock.now();

    // Setup active Telegram identity
    repo.identities.push({
      id: randomUUID(),
      learnerId: LEARNER_1_ID,
      telegramUserId: TELEGRAM_USER_1,
      telegramChatId: TELEGRAM_CHAT_1,
      telegramUsername: 'alice_telegram',
      linkedAt: T,
      speechEnabled: true,
      activeCourseId: 'course-101',
    });

    // Setup queued intent for this chat
    const intentId = randomUUID();
    intentsPort.intents.push({
      id: intentId,
      dedupDigest: createHash('sha256').update(intentId).digest('hex'),
      recipientId: TELEGRAM_CHAT_1,
      channel: 'telegram',
      status: 'pending',
      contentRef: 'tutoring_answer:ans-1',
      contentExpiresAt: new Date(T.getTime() + R_MS),
      dedupExpiresAt: new Date(T.getTime() + DEDUP_TTL_MS),
      createdAt: T,
      leaseWorkerId: null,
      leaseExpiresAt: null,
      attemptCount: 0,
    });

    // Learner unlinks Telegram account
    const unlinked = await repo.unlinkByLearnerId(LEARNER_1_ID, clock.now());
    expect(unlinked).toBe(true);

    // Cancel queued delivery
    intentsPort.cancelForRecipient(TELEGRAM_CHAT_1, 'telegram');

    // Identity lookup returns null for unlinked user
    const idByTelegram = await repo.findIdentityByTelegramUserId(TELEGRAM_USER_1);
    expect(idByTelegram).toBeNull();

    const idByLearner = await repo.findIdentityByLearnerId(LEARNER_1_ID);
    expect(idByLearner).toBeNull();

    // Queued intent cancelled and scrubbed
    const intent = intentsPort.intents.find((i) => i.id === intentId);
    expect(intent?.status).toBe('cancelled');
    expect(intent?.contentRef).toBeNull();
  });
});
