// Comprehensive unit and integration test suite for SMS job subscriptions (T3-021-A).
// Asserts:
// 1. Pure domain rules: Ethiopian phone validation, masking, eligibility, and deterministic job matching.
// 2. Application service: Unverified numbers cannot subscribe directly, OTP challenge flow,
//    attempt limits/lockout, verified unlocking, re-subscribing without OTP, learner isolation,
//    immediate opt-out, intent cancellation, and contact pruning.
// 3. HTTP presentation routes (/api/delivery/sms/subscriptions and /api/careers/sms-subscriptions):
//    Authentication, authorization, challenge request, OTP verify, status query, and immediate opt-out.

import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../bootstrap/app.ts';
import { digestToken, ResolvePrincipal } from '../../identity/application/resolve-principal.ts';
import type { OwnedScope, Principal } from '../../identity/domain/principal.ts';
import type {
  CreateSubscriptionInput,
  JobSubscription,
} from '../../careers/domain/job-preferences.ts';
import type {
  JobPreferencesRepository,
  UnsubscribeResult,
} from '../../careers/application/ports/job-preferences-repository.ts';
import { JobPreferences } from '../../careers/application/job-preferences.ts';
import type { Job } from '../../careers/domain/job.ts';
import type { PhoneVerificationRepository } from '../application/ports/phone-verification-repository.ts';
import type { SmsAdapter } from '../application/ports/sms-adapter.ts';
import type { SendSmsRequest, SendSmsResult, SmsStatusResult } from './sms-contract.ts';
import { PhoneVerificationService } from '../application/phone-verification-service.ts';
import { SmsSubscriptionService } from '../application/sms-subscription-service.ts';
import type { PhoneVerificationCode } from './phone-verification.ts';
import {
  isSmsSubscriptionEligible,
  maskPhoneNumber,
  matchSmsJobSubscription,
  validateSmsDestination,
} from './sms-subscription.ts';

// ---------------------------------------------------------------------------
// Test In-Memory Fakes
// ---------------------------------------------------------------------------

class InMemoryPhoneVerificationRepository implements PhoneVerificationRepository {
  readonly #records = new Map<string, PhoneVerificationCode>();
  readonly #verified = new Set<string>();

  findLatestByPhoneNumber(phoneNumber: string): Promise<PhoneVerificationCode | null> {
    const matching = Array.from(this.#records.values())
      .filter((r) => r.phoneNumber === phoneNumber)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Promise.resolve(matching[0] ?? null);
  }

  findActiveByLearnerAndPhone(
    learnerId: string,
    phoneNumber: string,
  ): Promise<PhoneVerificationCode | null> {
    const matching = Array.from(this.#records.values())
      .filter(
        (r) =>
          r.learnerId === learnerId &&
          r.phoneNumber === phoneNumber &&
          !r.isExhausted() &&
          r.verifiedAt === null,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Promise.resolve(matching[0] ?? null);
  }

  save(record: PhoneVerificationCode): Promise<void> {
    this.#records.set(record.id, record);
    return Promise.resolve();
  }

  isPhoneVerifiedForLearner(learnerId: string, phoneNumber: string): Promise<boolean> {
    return Promise.resolve(this.#verified.has(`${learnerId}:${phoneNumber}`));
  }

  markPhoneVerified(learnerId: string, phoneNumber: string, _verifiedAt: Date): Promise<void> {
    void _verifiedAt;
    this.#verified.add(`${learnerId}:${phoneNumber}`);
    return Promise.resolve();
  }

  getRecord(id: string): PhoneVerificationCode | undefined {
    return this.#records.get(id);
  }
}

class InMemoryJobPreferencesRepository implements JobPreferencesRepository {
  readonly #subscriptions = new Map<string, JobSubscription>();
  readonly #contacts = new Map<
    string,
    { learnerId: string; channel: string; destination: string }
  >();
  public cancelledIntentsCount = 0;

  subscribe(
    scope: OwnedScope,
    input: CreateSubscriptionInput,
    now: Date = new Date(),
  ): Promise<JobSubscription> {
    const id = randomUUID();
    const contactKey = `${scope.ownerId}:${input.channel.toLowerCase()}`;
    this.#contacts.set(contactKey, {
      learnerId: scope.ownerId,
      channel: input.channel.toLowerCase(),
      destination: input.destination,
    });

    const subscription: JobSubscription = {
      id,
      learnerId: scope.ownerId,
      channel: input.channel.toLowerCase(),
      destination: input.destination,
      categories: input.categories ?? [],
      locations: input.locations ?? [],
      active: true,
      createdAt: now,
      updatedAt: now,
      unsubscribedAt: null,
    };

    this.#subscriptions.set(id, subscription);
    return Promise.resolve(subscription);
  }

  unsubscribe(
    scope: OwnedScope,
    subscriptionId: string,
    now: Date = new Date(),
  ): Promise<UnsubscribeResult | null> {
    const sub = this.#subscriptions.get(subscriptionId);
    if (!sub || sub.learnerId !== scope.ownerId || !sub.active) {
      return Promise.resolve(null);
    }

    const updated: JobSubscription = {
      ...sub,
      active: false,
      updatedAt: now,
      unsubscribedAt: now,
    };
    this.#subscriptions.set(subscriptionId, updated);

    // Mock cancelling 2 pending delivery intents
    this.cancelledIntentsCount += 2;

    const remainingActive = Array.from(this.#subscriptions.values()).some(
      (s) => s.learnerId === scope.ownerId && s.channel === sub.channel && s.active,
    );

    let contactRemoved = false;
    if (!remainingActive) {
      this.#contacts.delete(`${scope.ownerId}:${sub.channel}`);
      contactRemoved = true;
    }

    return Promise.resolve({
      subscription: updated,
      cancelledIntentsCount: 2,
      contactRemoved,
    });
  }

  unsubscribeAll(scope: OwnedScope, channel: string, now: Date = new Date()): Promise<number> {
    let count = 0;
    const targetChannel = channel.toLowerCase();
    for (const [id, sub] of this.#subscriptions.entries()) {
      if (sub.learnerId === scope.ownerId && sub.channel === targetChannel && sub.active) {
        this.#subscriptions.set(id, {
          ...sub,
          active: false,
          updatedAt: now,
          unsubscribedAt: now,
        });
        count++;
      }
    }
    this.#contacts.delete(`${scope.ownerId}:${targetChannel}`);
    return Promise.resolve(count);
  }

  listOwned(scope: OwnedScope): Promise<readonly JobSubscription[]> {
    const list = Array.from(this.#subscriptions.values())
      .filter((s) => s.learnerId === scope.ownerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Promise.resolve(list);
  }

  getOwned(scope: OwnedScope, subscriptionId: string): Promise<JobSubscription | null> {
    const sub = this.#subscriptions.get(subscriptionId);
    if (!sub || sub.learnerId !== scope.ownerId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(sub);
  }

  listActiveSubscriptions(): Promise<readonly JobSubscription[]> {
    return Promise.resolve(Array.from(this.#subscriptions.values()).filter((s) => s.active));
  }

  cancelPendingIntentsForJob(_jobId: string): Promise<number> {
    void _jobId;
    return Promise.resolve(0);
  }

  isContactRetained(learnerId: string, channel: string): boolean {
    return this.#contacts.has(`${learnerId}:${channel.toLowerCase()}`);
  }
}

class CapturingSmsAdapter implements SmsAdapter {
  readonly providerName = 'mock-afromessage';
  readonly sent: Array<{ readonly to: string; readonly message: string }> = [];

  send(request: SendSmsRequest): Promise<SendSmsResult> {
    this.sent.push({ to: request.to, message: request.message });
    return Promise.resolve({
      ok: true,
      messageId: `msg-${randomUUID()}`,
      status: 'queued',
      providerStatus: 'SUBMITTED',
      recipient: request.to,
      encoding: 'GSM-7',
      segments: 1,
    });
  }

  checkStatus(messageId: string): Promise<SmsStatusResult> {
    return Promise.resolve({
      messageId,
      status: 'delivered',
      providerStatus: 'DELIVRD',
    });
  }
}

// ---------------------------------------------------------------------------
// Test Principals
// ---------------------------------------------------------------------------

const learnerA: Principal = {
  id: 'learner-1111-1111',
  role: 'learner',
  label: 'Learner A',
  demo: true,
  courseIds: ['course-1'],
};

const learnerB: Principal = {
  id: 'learner-2222-2222',
  role: 'learner',
  label: 'Learner B',
  demo: true,
  courseIds: ['course-1'],
};

const supportStaff: Principal = {
  id: 'support-9999-9999',
  role: 'support',
  label: 'Support Coordinator',
  demo: true,
  courseIds: [],
};

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-101',
    version: '1.0',
    title: 'Junior Web Developer',
    organization: 'Addis Tech',
    category: 'Software Development',
    location: 'Addis Ababa',
    description: 'Entry-level position',
    sourceUrl: 'https://example.com/job/101',
    postedAt: new Date('2026-11-15T09:00:00Z'),
    expiresAt: new Date('2026-11-25T09:00:00Z'),
    withdrawn: false,
    provenance: { kind: 'demo', note: 'test job' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

describe('SMS Job Subscription Domain Model (T3-021-A)', () => {
  it('validates Ethiopian mobile phone destinations and rejects landline/foreign numbers', () => {
    // Ethio Telecom (+2519...)
    expect(validateSmsDestination('+251911223344')).toEqual({
      valid: true,
      normalized: '+251911223344',
      operator: 'ethio_telecom',
    });
    expect(validateSmsDestination('0911223344')).toEqual({
      valid: true,
      normalized: '+251911223344',
      operator: 'ethio_telecom',
    });

    // Safaricom Ethiopia (+2517...)
    expect(validateSmsDestination('+251711223344')).toEqual({
      valid: true,
      normalized: '+251711223344',
      operator: 'safaricom_ethiopia',
    });
    expect(validateSmsDestination('0711223344')).toEqual({
      valid: true,
      normalized: '+251711223344',
      operator: 'safaricom_ethiopia',
    });

    // Landline numbers are rejected
    expect(validateSmsDestination('+251111234567').valid).toBe(false);
    expect(validateSmsDestination('0111234567').valid).toBe(false);

    // International numbers outside Ethiopia are rejected
    expect(validateSmsDestination('+12025550199').valid).toBe(false);
    expect(validateSmsDestination('+447911123456').valid).toBe(false);

    // Garbage / malformed input
    expect(validateSmsDestination('').valid).toBe(false);
    expect(validateSmsDestination('invalid').valid).toBe(false);
  });

  it('safely masks phone numbers in logs and responses', () => {
    expect(maskPhoneNumber('+251911223344')).toBe('+2519****3344');
    expect(maskPhoneNumber('+251712345678')).toBe('+2517****5678');
    expect(maskPhoneNumber('0911223344')).toBe('+2519****3344');
  });

  it('enforces that unverified or unsubscribed subscriptions are not eligible for job matching', () => {
    const activeSub = { active: true, unsubscribedAt: null };
    const inactiveSub = { active: false, unsubscribedAt: null };
    const unsubscribedSub = { active: false, unsubscribedAt: new Date() };

    expect(isSmsSubscriptionEligible(activeSub, true)).toBe(true);
    expect(isSmsSubscriptionEligible(activeSub, false)).toBe(false); // Unverified phone
    expect(isSmsSubscriptionEligible(inactiveSub, true)).toBe(false);
    expect(isSmsSubscriptionEligible(unsubscribedSub, true)).toBe(false);
  });

  it('deterministically matches jobs against SMS subscriptions based on explicit filters', () => {
    const sub = {
      active: true,
      categories: ['Software Development'],
      locations: ['Addis Ababa'],
      unsubscribedAt: null,
    };
    const matchingJob = makeJob();
    const wrongCategoryJob = makeJob({ category: 'Health' });
    const wrongLocationJob = makeJob({ location: 'Hawassa' });
    const withdrawnJob = makeJob({ withdrawn: true });
    const expiredJob = makeJob({ expiresAt: new Date('2026-11-14T09:00:00Z') });

    const now = new Date('2026-11-15T10:00:00Z');

    expect(matchSmsJobSubscription(sub, true, matchingJob, now)).toBe(true);
    expect(matchSmsJobSubscription(sub, true, wrongCategoryJob, now)).toBe(false);
    expect(matchSmsJobSubscription(sub, true, wrongLocationJob, now)).toBe(false);
    expect(matchSmsJobSubscription(sub, true, withdrawnJob, now)).toBe(false);
    expect(matchSmsJobSubscription(sub, true, expiredJob, now)).toBe(false);
    expect(matchSmsJobSubscription(sub, false, matchingJob, now)).toBe(false); // unverified phone
  });

  it('supports open-ended filters when categories or locations are empty', () => {
    const openSub = {
      active: true,
      categories: [],
      locations: [],
      unsubscribedAt: null,
    };
    const job = makeJob({ category: 'Any Category', location: 'Any Location' });
    expect(matchSmsJobSubscription(openSub, true, job)).toBe(true);
  });
});

describe('SmsSubscriptionService Application Orchestration (T3-021-A)', () => {
  let phoneRepo: InMemoryPhoneVerificationRepository;
  let smsAdapter: CapturingSmsAdapter;
  let phoneVerification: PhoneVerificationService;
  let preferencesRepo: InMemoryJobPreferencesRepository;
  let jobPreferences: JobPreferences;
  let service: SmsSubscriptionService;

  beforeEach(() => {
    phoneRepo = new InMemoryPhoneVerificationRepository();
    smsAdapter = new CapturingSmsAdapter();
    phoneVerification = new PhoneVerificationService(phoneRepo, smsAdapter);
    preferencesRepo = new InMemoryJobPreferencesRepository();
    jobPreferences = new JobPreferences(preferencesRepo, phoneVerification);
    service = new SmsSubscriptionService(phoneVerification, jobPreferences);
  });

  it('rejects unauthorized principals (non-learners) from requesting SMS subscriptions', async () => {
    const res = await service.requestSubscription(supportStaff, {
      phoneNumber: '+251911223344',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('unauthorized');
  });

  it('rejects invalid or non-Ethiopian phone numbers', async () => {
    const res = await service.requestSubscription(learnerA, {
      phoneNumber: '+12025550199',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('invalid_phone');
  });

  it('initiates an OTP challenge for an unverified phone number', async () => {
    const res = await service.requestSubscription(learnerA, {
      phoneNumber: '+251911223344',
      categories: ['Software Development'],
      locations: ['Addis Ababa'],
    });

    expect(res.ok).toBe(true);
    if (!res.ok || res.status !== 'verification_required') return;
    expect(res.challengeId).toBeDefined();
    expect(res.maskedPhone).toBe('+2519****3344');
    expect(res.cooldownSeconds).toBe(60);
    expect(res.dispatchStatus).toBe('dispatched');
    expect(smsAdapter.sent).toHaveLength(1);
    expect(smsAdapter.sent[0]?.to).toBe('+251911223344');
    expect(smsAdapter.sent[0]?.message).toMatch(/verification code is \d{6}/);
  });

  it('enforces a 60-second cooldown on consecutive verification requests for the same number', async () => {
    const now = new Date('2026-11-15T10:00:00Z');
    const first = await service.requestSubscription(
      learnerA,
      { phoneNumber: '+251911223344' },
      now,
    );
    expect(first.ok).toBe(true);

    const after30s = new Date(now.getTime() + 30 * 1000);
    const second = await service.requestSubscription(
      learnerA,
      { phoneNumber: '+251911223344' },
      after30s,
    );
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('cooldown_active');
    expect(second.retryAfterSeconds).toBe(30);
  });

  it('rejects incorrect OTP codes and decrements remaining attempts', async () => {
    await service.requestSubscription(learnerA, { phoneNumber: '+251911223344' });

    const verifyRes = await service.verifyAndSubscribe(learnerA, {
      phoneNumber: '+251911223344',
      code: '000000', // Incorrect OTP
    });

    expect(verifyRes.ok).toBe(false);
    if (verifyRes.ok) return;
    expect(verifyRes.status).toBe('mismatch');
    expect(verifyRes.remainingAttempts).toBe(2);
  });

  it('permanently locks out (exhausts) code after 3 consecutive failed attempts', async () => {
    await service.requestSubscription(learnerA, { phoneNumber: '+251911223344' });

    // Attempt 1
    await service.verifyAndSubscribe(learnerA, {
      phoneNumber: '+251911223344',
      code: '111111',
    });
    // Attempt 2
    await service.verifyAndSubscribe(learnerA, {
      phoneNumber: '+251911223344',
      code: '222222',
    });
    // Attempt 3 -> lockout
    const attempt3 = await service.verifyAndSubscribe(learnerA, {
      phoneNumber: '+251911223344',
      code: '333333',
    });

    expect(attempt3.ok).toBe(false);
    if (attempt3.ok) return;
    expect(attempt3.status).toBe('exhausted');
    expect(attempt3.remainingAttempts).toBe(0);

    // Attempt 4 is permanently rejected even if candidate code were somehow correct
    const attempt4 = await service.verifyAndSubscribe(learnerA, {
      phoneNumber: '+251911223344',
      code: '123456',
    });
    expect(attempt4.ok).toBe(false);
    if (attempt4.ok) return;
    expect(['exhausted', 'not_found']).toContain(attempt4.status);
  });

  it('unlocks active SMS subscription upon successful OTP verification', async () => {
    await service.requestSubscription(learnerA, {
      phoneNumber: '+251911223344',
      categories: ['Software Development'],
      locations: ['Addis Ababa'],
    });

    // Extract the dispatched OTP code from the capturing SMS adapter
    const message = smsAdapter.sent[0]!.message;
    const match = /verification code is (\d{6})/.exec(message);
    expect(match).not.toBeNull();
    const otp = match![1]!;

    const verifyRes = await service.verifyAndSubscribe(learnerA, {
      phoneNumber: '+251911223344',
      code: otp,
      categories: ['Software Development'],
      locations: ['Addis Ababa'],
    });

    expect(verifyRes.ok).toBe(true);
    if (!verifyRes.ok) return;
    expect(verifyRes.status).toBe('active');
    expect(verifyRes.subscription.channel).toBe('sms');
    expect(verifyRes.subscription.destination).toBe('+251911223344');
    expect(verifyRes.subscription.active).toBe(true);
    expect(verifyRes.maskedPhone).toBe('+2519****3344');

    // Query status confirms active subscription
    const status = await service.getStatus(learnerA);
    expect(status.subscribed).toBe(true);
    expect(status.status).toBe('active');
    expect(status.maskedPhone).toBe('+2519****3344');
    expect(status.verified).toBe(true);
  });

  it('allows an already-verified phone number to subscribe immediately without a new OTP challenge', async () => {
    // 1. First subscription with OTP verification
    await service.requestSubscription(learnerA, { phoneNumber: '+251911223344' });
    const otp = /verification code is (\d{6})/.exec(smsAdapter.sent[0]!.message)![1]!;
    await service.verifyAndSubscribe(learnerA, { phoneNumber: '+251911223344', code: otp });

    // 2. Unsubscribe
    await service.unsubscribe(learnerA);
    expect((await service.getStatus(learnerA)).subscribed).toBe(false);

    // 3. Re-subscribe: phone is already verified, so subscription is activated directly
    const reSub = await service.requestSubscription(learnerA, {
      phoneNumber: '+251911223344',
      categories: ['Finance'],
      locations: ['Addis Ababa'],
    });

    expect(reSub.ok).toBe(true);
    if (!reSub.ok || reSub.status !== 'active') return;
    expect(reSub.subscription.categories).toEqual(['Finance']);
  });

  it('strictly isolates verification challenges and subscriptions between learners', async () => {
    // Learner A initiates challenge
    await service.requestSubscription(learnerA, { phoneNumber: '+251911223344' });
    const otp = /verification code is (\d{6})/.exec(smsAdapter.sent[0]!.message)![1]!;

    // Learner B cannot verify Learner A's challenge
    const bAttempt = await service.verifyAndSubscribe(learnerB, {
      phoneNumber: '+251911223344',
      code: otp,
    });
    expect(bAttempt.ok).toBe(false);
    if (bAttempt.ok) return;
    expect(bAttempt.status).toBe('not_found'); // No challenge for Learner B

    // Complete Learner A's verification
    await service.verifyAndSubscribe(learnerA, { phoneNumber: '+251911223344', code: otp });

    // Learner B queries status: does NOT see Learner A's subscription
    const bStatus = await service.getStatus(learnerB);
    expect(bStatus.subscribed).toBe(false);

    // Learner B cannot unsubscribe Learner A's subscription
    const aStatus = await service.getStatus(learnerA);
    expect(aStatus.subscribed).toBe(true);
    const bUnsub = await service.unsubscribe(learnerB, aStatus.subscription!.id);
    expect(bUnsub).toBeNull();
    // Learner A's subscription remains intact
    expect((await service.getStatus(learnerA)).subscribed).toBe(true);
  });

  it('immediately suppresses future delivery intents and prunes contact details on unsubscribe', async () => {
    // Setup verified active SMS subscription
    await service.requestSubscription(learnerA, { phoneNumber: '+251911223344' });
    const otp = /verification code is (\d{6})/.exec(smsAdapter.sent[0]!.message)![1]!;
    await service.verifyAndSubscribe(learnerA, { phoneNumber: '+251911223344', code: otp });

    expect(preferencesRepo.isContactRetained(learnerA.id, 'sms')).toBe(true);

    // Immediate opt-out
    const unsub = await service.unsubscribe(learnerA);
    expect(unsub).not.toBeNull();
    expect(unsub?.status).toBe('unsubscribed');
    expect(unsub?.cancelledIntentsCount).toBe(2); // Suppressed queued intents
    expect(unsub?.contactRemoved).toBe(true); // Contact destination pruned

    // Contact destination is no longer stored
    expect(preferencesRepo.isContactRetained(learnerA.id, 'sms')).toBe(false);

    // Status query confirms not subscribed
    const status = await service.getStatus(learnerA);
    expect(status.subscribed).toBe(false);
  });
});

describe('SMS Subscription HTTP API Routes (T3-021-A)', () => {
  let phoneRepo: InMemoryPhoneVerificationRepository;
  let smsAdapter: CapturingSmsAdapter;
  let phoneVerification: PhoneVerificationService;
  let preferencesRepo: InMemoryJobPreferencesRepository;
  let jobPreferences: JobPreferences;
  let smsSubscriptionService: SmsSubscriptionService;

  const learnerAToken = 'learner-a-token-1234567890';
  const learnerBToken = 'learner-b-token-1234567890';
  const supportToken = 'support-staff-token-1234567890';

  const resolvePrincipal = new ResolvePrincipal(
    {
      findDemoByTokenDigest(digest: string): Promise<Principal | null> {
        if (digest === digestToken(learnerAToken)) return Promise.resolve(learnerA);
        if (digest === digestToken(learnerBToken)) return Promise.resolve(learnerB);
        if (digest === digestToken(supportToken)) return Promise.resolve(supportStaff);
        return Promise.resolve(null);
      },
    },
    true,
  );

  function createTestApp() {
    const dummyStub = new Proxy({}, { get: () => () => Promise.resolve({}) });
    return buildApp({
      checkReadiness: () => Promise.resolve({ ready: true }),
      resolvePrincipal,
      demoRecords: dummyStub as never,
      demoSessions: dummyStub as never,
      demoAllowedOrigins: ['http://localhost:3000'],
      tutoring: dummyStub as never,
      content: dummyStub as never,
      jobPreferences,
      smsSubscriptionService,
    });
  }

  beforeEach(() => {
    phoneRepo = new InMemoryPhoneVerificationRepository();
    smsAdapter = new CapturingSmsAdapter();
    phoneVerification = new PhoneVerificationService(phoneRepo, smsAdapter);
    preferencesRepo = new InMemoryJobPreferencesRepository();
    jobPreferences = new JobPreferences(preferencesRepo, phoneVerification);
    smsSubscriptionService = new SmsSubscriptionService(phoneVerification, jobPreferences);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const app = createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/delivery/sms/subscriptions/request',
        payload: { phoneNumber: '+251911223344' },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('rejects non-learner roles with 403', async () => {
    const app = createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/delivery/sms/subscriptions/request',
        headers: { authorization: `Bearer ${supportToken}` },
        payload: { phoneNumber: '+251911223344' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns 400 for invalid Ethiopian mobile phone numbers', async () => {
    const app = createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/delivery/sms/subscriptions/request',
        headers: { authorization: `Bearer ${learnerAToken}` },
        payload: { phoneNumber: '+12025550199' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe('invalid_phone');
    } finally {
      await app.close();
    }
  });

  it('executes full end-to-end SMS subscription lifecycle over HTTP', async () => {
    const app = createTestApp();
    try {
      const auth = { authorization: `Bearer ${learnerAToken}` };

      // 1. Initial status is unsubscribed
      const initialStatusRes = await app.inject({
        method: 'GET',
        url: '/api/delivery/sms/subscriptions/status',
        headers: auth,
      });
      expect(initialStatusRes.statusCode).toBe(200);
      expect(initialStatusRes.json<{ subscribed: boolean }>().subscribed).toBe(false);

      // 2. Request subscription with unverified phone -> 200 verification_required
      const reqRes = await app.inject({
        method: 'POST',
        url: '/api/delivery/sms/subscriptions/request',
        headers: auth,
        payload: {
          phoneNumber: '0911223344',
          categories: ['Software Development'],
          locations: ['Addis Ababa'],
        },
      });
      expect(reqRes.statusCode).toBe(200);
      const reqBody = reqRes.json<{
        status: string;
        maskedPhone: string;
        cooldownSeconds: number;
      }>();
      expect(reqBody.status).toBe('verification_required');
      expect(reqBody.maskedPhone).toBe('+2519****3344');
      expect(reqBody.cooldownSeconds).toBe(60);

      // 3. Extract the dispatched OTP
      const msg = smsAdapter.sent[0]!.message;
      const otp = /verification code is (\d{6})/.exec(msg)![1]!;

      // 4. Verify with incorrect code -> 400 mismatch
      const wrongVerifyRes = await app.inject({
        method: 'POST',
        url: '/api/delivery/sms/subscriptions/verify',
        headers: auth,
        payload: {
          phoneNumber: '+251911223344',
          code: '999999',
        },
      });
      expect(wrongVerifyRes.statusCode).toBe(400);
      expect(wrongVerifyRes.json<{ error: string }>().error).toBe('mismatch');

      // 5. Verify with correct code -> 201 active
      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/delivery/sms/subscriptions/verify',
        headers: auth,
        payload: {
          phoneNumber: '+251911223344',
          code: otp,
          categories: ['Software Development'],
          locations: ['Addis Ababa'],
        },
      });
      expect(verifyRes.statusCode).toBe(201);
      const verifyBody = verifyRes.json<{
        status: string;
        subscription: { id: string; active: boolean; channel: string };
        maskedPhone: string;
      }>();
      expect(verifyBody.status).toBe('active');
      expect(verifyBody.subscription.active).toBe(true);
      expect(verifyBody.subscription.channel).toBe('sms');
      expect(verifyBody.maskedPhone).toBe('+2519****3344');

      // 6. Check status -> active
      const activeStatusRes = await app.inject({
        method: 'GET',
        url: '/api/delivery/sms/subscriptions/status',
        headers: auth,
      });
      expect(activeStatusRes.statusCode).toBe(200);
      const activeStatusBody = activeStatusRes.json<{
        subscribed: boolean;
        status: string;
        maskedPhone: string;
      }>();
      expect(activeStatusBody.subscribed).toBe(true);
      expect(activeStatusBody.status).toBe('active');
      expect(activeStatusBody.maskedPhone).toBe('+2519****3344');

      // 7. Unsubscribe (immediate opt-out) -> 200 unsubscribed
      const unsubRes = await app.inject({
        method: 'DELETE',
        url: '/api/delivery/sms/subscriptions',
        headers: auth,
      });
      expect(unsubRes.statusCode).toBe(200);
      const unsubBody = unsubRes.json<{
        status: string;
        cancelledIntentsCount: number;
        contactRemoved: boolean;
      }>();
      expect(unsubBody.status).toBe('unsubscribed');
      expect(unsubBody.cancelledIntentsCount).toBe(2);
      expect(unsubBody.contactRemoved).toBe(true);

      // 8. Subsequent status query shows unsubscribed
      const finalStatusRes = await app.inject({
        method: 'GET',
        url: '/api/delivery/sms/subscriptions/status',
        headers: auth,
      });
      expect(finalStatusRes.statusCode).toBe(200);
      expect(finalStatusRes.json<{ subscribed: boolean }>().subscribed).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('supports the /api/careers/sms-subscriptions aliases for full API interoperability', async () => {
    const app = createTestApp();
    try {
      const auth = { authorization: `Bearer ${learnerAToken}` };

      // Request challenge via alias
      const reqRes = await app.inject({
        method: 'POST',
        url: '/api/careers/sms-subscriptions/request',
        headers: auth,
        payload: { phoneNumber: '+251711223344' },
      });
      expect(reqRes.statusCode).toBe(200);
      expect(reqRes.json<{ status: string }>().status).toBe('verification_required');

      const otp = /verification code is (\d{6})/.exec(smsAdapter.sent[0]!.message)![1]!;

      // Verify OTP via alias
      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/careers/sms-subscriptions/verify',
        headers: auth,
        payload: { phoneNumber: '+251711223344', code: otp },
      });
      expect(verifyRes.statusCode).toBe(201);
      expect(verifyRes.json<{ status: string }>().status).toBe('active');

      // Status via alias
      const statusRes = await app.inject({
        method: 'GET',
        url: '/api/careers/sms-subscriptions/status',
        headers: auth,
      });
      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.json<{ subscribed: boolean }>().subscribed).toBe(true);

      // Delete via alias
      const delRes = await app.inject({
        method: 'DELETE',
        url: '/api/careers/sms-subscriptions',
        headers: auth,
      });
      expect(delRes.statusCode).toBe(200);
      expect(delRes.json<{ status: string }>().status).toBe('unsubscribed');
    } finally {
      await app.close();
    }
  });
});
