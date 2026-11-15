// Comprehensive unit test suite for phone-ownership verification (T3-003-E).
// Covers:
// 1. Cryptographically secure 6-digit OTP generation and salted SHA-256 digest creation.
// 2. Successful verification with matching code.
// 3. Mismatch tracking and permanent lockout after 3 failed attempts.
// 4. Expiration after 10-minute TTL.
// 5. Cooldown / rate-limit enforcement (60 seconds).
// 6. Safe phone number masking (+2519****1234).
// 7. Clean Architecture PhoneVerificationService orchestration and learner isolation.

import { describe, expect, it } from 'vitest';
import type { Principal } from '../../identity/domain/principal.ts';
import type { SendSmsRequest, SendSmsResult } from './sms-contract.ts';
import type { SmsAdapter } from '../application/ports/sms-adapter.ts';
import type { PhoneVerificationRepository } from '../application/ports/phone-verification-repository.ts';
import { PhoneVerificationService } from '../application/phone-verification-service.ts';
import {
  computeOtpDigest,
  createPhoneVerificationCode,
  generateRandomOtp,
  generateSalt,
  getRemainingCooldownSeconds,
  isOtpCooldownActive,
  maskPhoneNumber,
  MAX_VERIFICATION_ATTEMPTS,
  OTP_COOLDOWN_MS,
  OTP_LENGTH,
  OTP_TTL_MS,
  PhoneVerificationCode,
  verifyOtpDigest,
} from './phone-verification.ts';

const NOW = new Date('2026-11-15T10:00:00.000Z');

function createTestLearner(id: string = 'learner-1'): Principal {
  return {
    id,
    role: 'learner',
    label: `Learner ${id}`,
    demo: true,
    courseIds: ['course-1'],
  };
}

function createTestSupport(id: string = 'support-1'): Principal {
  return {
    id,
    role: 'support',
    label: 'Support Coordinator',
    demo: true,
    courseIds: [],
  };
}

/**
 * In-memory repository fake for testing the application service.
 */
class InMemoryPhoneVerificationRepository implements PhoneVerificationRepository {
  readonly #records = new Map<string, PhoneVerificationCode>();
  readonly #verified = new Set<string>(); // key: `${learnerId}:${phoneNumber}`

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

/**
 * Mock SMS adapter capturing outbound dispatches.
 */
class MockSmsAdapter implements SmsAdapter {
  readonly providerName = 'mock-afromessage';
  readonly dispatches: SendSmsRequest[] = [];
  shouldFail = false;

  send(request: SendSmsRequest): Promise<SendSmsResult> {
    this.dispatches.push(request);
    if (this.shouldFail) {
      return Promise.resolve({
        ok: false,
        error: 'Simulated gateway failure',
        permanent: false,
        status: 'failed',
      });
    }
    return Promise.resolve({
      ok: true,
      messageId: `msg-${Date.now()}`,
      status: 'queued',
      providerStatus: 'SUBMITTED',
      recipient: request.to,
      encoding: 'GSM-7',
      segments: 1,
    });
  }

  checkStatus(messageId: string) {
    return Promise.resolve({
      messageId,
      status: 'delivered' as const,
      providerStatus: 'DELIVRD',
    });
  }
}

describe('Cryptographically secure OTP generation and hashing', () => {
  it('generates a 6-digit numeric OTP padded with leading zeroes', () => {
    for (let i = 0; i < 25; i++) {
      const otp = generateRandomOtp();
      expect(otp).toHaveLength(OTP_LENGTH);
      expect(/^\d{6}$/.test(otp)).toBe(true);
      const val = Number.parseInt(otp, 10);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1000000);
    }
  });

  it('generates unique cryptographic salts', () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    expect(salt1).toHaveLength(32); // 16 bytes hex
    expect(salt2).toHaveLength(32);
    expect(salt1).not.toBe(salt2);
  });

  it('produces deterministic 64-character SHA-256 hex digests with per-record salt', () => {
    const salt = 'f3b2a1c0d4e5f6789012345678abcdef';
    const digest1 = computeOtpDigest('123456', salt);
    const digest2 = computeOtpDigest('123456', salt);
    const digest3 = computeOtpDigest('654321', salt);

    expect(digest1).toHaveLength(64);
    expect(digest1).toBe(digest2);
    expect(digest1).not.toBe(digest3);
    // Plaintext OTP must not appear in the digest
    expect(digest1).not.toContain('123456');
  });

  it('performs constant-time verification matching correct code and rejecting invalid', () => {
    const salt = generateSalt();
    const digest = computeOtpDigest('482910', salt);

    expect(verifyOtpDigest('482910', salt, digest)).toBe(true);
    expect(verifyOtpDigest(' 482910 ', salt, digest)).toBe(true); // Trimming whitespace
    expect(verifyOtpDigest('482911', salt, digest)).toBe(false);
    expect(verifyOtpDigest('000000', salt, digest)).toBe(false);
    expect(verifyOtpDigest('', salt, digest)).toBe(false);
    expect(verifyOtpDigest('invalid', salt, digest)).toBe(false);
  });
});

describe('Safe masking of phone numbers (+2519****1234)', () => {
  it('masks standard Ethio Telecom mobile numbers (+2519...)', () => {
    expect(maskPhoneNumber('+251912341234')).toBe('+2519****1234');
    expect(maskPhoneNumber('+251987654321')).toBe('+2519****4321');
  });

  it('masks standard Safaricom Ethiopia mobile numbers (+2517...)', () => {
    expect(maskPhoneNumber('+251712341234')).toBe('+2517****1234');
    expect(maskPhoneNumber('+251798765432')).toBe('+2517****5432');
  });

  it('masks national formatted numbers (09... and 07...)', () => {
    expect(maskPhoneNumber('0912341234')).toBe('+2519****1234');
    expect(maskPhoneNumber('0712341234')).toBe('+2517****1234');
  });

  it('masks unadorned mobile numbers (9... and 7...)', () => {
    expect(maskPhoneNumber('912341234')).toBe('+2519****1234');
  });

  it('masks numbers containing formatting spaces or dashes', () => {
    expect(maskPhoneNumber('+251 91 234 1234')).toBe('+2519****1234');
    expect(maskPhoneNumber('09-12-34-1234')).toBe('+2519****1234');
  });

  it('returns generic mask for invalid or malformed numbers without leaking input', () => {
    expect(maskPhoneNumber('')).toBe('****');
    expect(maskPhoneNumber('invalid')).toBe('****');
    expect(maskPhoneNumber('123')).toBe('****');
  });
});

describe('PhoneVerificationCode domain lifecycle', () => {
  it('verifies successfully with the correct OTP and records verifiedAt', () => {
    const { codeRecord, plaintextCode } = createPhoneVerificationCode({
      id: 'challenge-1',
      learnerId: 'learner-1',
      phoneNumber: '+251912345678',
      code: '839201',
      now: NOW,
    });

    expect(codeRecord.isVerified()).toBe(false);
    expect(codeRecord.getStatus(NOW)).toBe('pending');

    const result = codeRecord.attemptVerification(plaintextCode, NOW);
    expect(result.success).toBe(true);
    expect(result.status).toBe('verified');
    expect(result.remainingAttempts).toBe(MAX_VERIFICATION_ATTEMPTS);
    expect(result.record.isVerified()).toBe(true);
    expect(result.record.verifiedAt).toEqual(NOW);
    expect(result.record.getStatus(NOW)).toBe('verified');
  });

  it('tracks mismatches and enforces permanent lockout after 3 failed attempts', () => {
    const { codeRecord } = createPhoneVerificationCode({
      id: 'challenge-2',
      learnerId: 'learner-1',
      phoneNumber: '+251912345678',
      code: '123456',
      now: NOW,
    });

    // 1st failed attempt -> 2 remaining
    const attempt1 = codeRecord.attemptVerification('000000', NOW);
    expect(attempt1.success).toBe(false);
    expect(attempt1.status).toBe('mismatch');
    expect(attempt1.remainingAttempts).toBe(2);
    expect(attempt1.record.attempts).toBe(1);
    expect(attempt1.record.isExhausted()).toBe(false);
    expect(attempt1.reason).toContain('2 attempts remaining');

    // 2nd failed attempt -> 1 remaining
    const attempt2 = attempt1.record.attemptVerification('111111', NOW);
    expect(attempt2.success).toBe(false);
    expect(attempt2.status).toBe('mismatch');
    expect(attempt2.remainingAttempts).toBe(1);
    expect(attempt2.record.attempts).toBe(2);
    expect(attempt2.record.isExhausted()).toBe(false);
    expect(attempt2.reason).toContain('1 attempt remaining');

    // 3rd failed attempt -> 0 remaining, permanently exhausted
    const attempt3 = attempt2.record.attemptVerification('222222', NOW);
    expect(attempt3.success).toBe(false);
    expect(attempt3.status).toBe('exhausted');
    expect(attempt3.remainingAttempts).toBe(0);
    expect(attempt3.record.attempts).toBe(3);
    expect(attempt3.record.isExhausted()).toBe(true);
    expect(attempt3.record.getStatus(NOW)).toBe('exhausted');
    expect(attempt3.reason).toContain('Code permanently exhausted');

    // 4th attempt: even with the CORRECT code, must be permanently locked out!
    const attempt4 = attempt3.record.attemptVerification('123456', NOW);
    expect(attempt4.success).toBe(false);
    expect(attempt4.status).toBe('exhausted');
    expect(attempt4.remainingAttempts).toBe(0);
    expect(attempt4.reason).toContain('permanently exhausted');
  });

  it('allows successful verification on attempt 2 after 1 initial failed attempt', () => {
    const { codeRecord, plaintextCode } = createPhoneVerificationCode({
      id: 'challenge-recovery',
      learnerId: 'learner-1',
      phoneNumber: '+251912345678',
      code: '998877',
      now: NOW,
    });

    const attempt1 = codeRecord.attemptVerification('000000', NOW);
    expect(attempt1.success).toBe(false);
    expect(attempt1.remainingAttempts).toBe(2);

    const attempt2 = attempt1.record.attemptVerification(plaintextCode, NOW);
    expect(attempt2.success).toBe(true);
    expect(attempt2.status).toBe('verified');
    expect(attempt2.record.isVerified()).toBe(true);
  });

  it('rejects verification after 10-minute TTL has expired', () => {
    const { codeRecord, plaintextCode } = createPhoneVerificationCode({
      id: 'challenge-expiry',
      learnerId: 'learner-1',
      phoneNumber: '+251912345678',
      code: '554433',
      now: NOW,
    });

    // 9 minutes and 59 seconds: valid
    const almostExpired = new Date(NOW.getTime() + OTP_TTL_MS - 1000);
    expect(codeRecord.isExpired(almostExpired)).toBe(false);
    expect(codeRecord.getStatus(almostExpired)).toBe('pending');

    // 10 minutes exact: expired
    const exactlyExpired = new Date(NOW.getTime() + OTP_TTL_MS);
    expect(codeRecord.isExpired(exactlyExpired)).toBe(true);
    expect(codeRecord.getStatus(exactlyExpired)).toBe('expired');

    const result = codeRecord.attemptVerification(plaintextCode, exactlyExpired);
    expect(result.success).toBe(false);
    expect(result.status).toBe('expired');
    expect(result.reason).toContain('expired');

    // 15 minutes: also expired
    const wellPastExpired = new Date(NOW.getTime() + 15 * 60 * 1000);
    const result2 = codeRecord.attemptVerification(plaintextCode, wellPastExpired);
    expect(result2.success).toBe(false);
    expect(result2.status).toBe('expired');
  });

  it('rejects re-verification if already verified', () => {
    const { codeRecord, plaintextCode } = createPhoneVerificationCode({
      id: 'challenge-reverify',
      learnerId: 'learner-1',
      phoneNumber: '+251912345678',
      code: '112233',
      now: NOW,
    });

    const first = codeRecord.attemptVerification(plaintextCode, NOW);
    expect(first.success).toBe(true);

    const second = first.record.attemptVerification(plaintextCode, NOW);
    expect(second.success).toBe(false);
    expect(second.reason).toContain('already been verified');
  });
});

describe('Cooldown and rate-limiting rules', () => {
  it('enforces 60-second cooldown between code dispatches per phone number', () => {
    const t0 = NOW;
    expect(isOtpCooldownActive(t0, t0)).toBe(true);
    expect(getRemainingCooldownSeconds(t0, t0)).toBe(60);

    const t30 = new Date(t0.getTime() + 30 * 1000);
    expect(isOtpCooldownActive(t0, t30)).toBe(true);
    expect(getRemainingCooldownSeconds(t0, t30)).toBe(30);

    const t59 = new Date(t0.getTime() + 59 * 1000);
    expect(isOtpCooldownActive(t0, t59)).toBe(true);
    expect(getRemainingCooldownSeconds(t0, t59)).toBe(1);

    const t60 = new Date(t0.getTime() + OTP_COOLDOWN_MS);
    expect(isOtpCooldownActive(t0, t60)).toBe(false);
    expect(getRemainingCooldownSeconds(t0, t60)).toBe(0);

    const t90 = new Date(t0.getTime() + 90 * 1000);
    expect(isOtpCooldownActive(t0, t90)).toBe(false);
    expect(getRemainingCooldownSeconds(t0, t90)).toBe(0);
  });
});

describe('PhoneVerificationService application orchestration', () => {
  it('rejects requests from non-learner principals (strict authorization)', async () => {
    const repo = new InMemoryPhoneVerificationRepository();
    const service = new PhoneVerificationService(repo);
    const supportPrincipal = createTestSupport();

    const requestResult = await service.requestVerification(supportPrincipal, '+251912345678', NOW);
    expect(requestResult.ok).toBe(false);
    expect(requestResult.reason).toBe('unauthorized');

    const verifyResult = await service.verifyCode(
      supportPrincipal,
      { phoneNumber: '+251912345678', code: '123456' },
      NOW,
    );
    expect(verifyResult.ok).toBe(false);
    expect(verifyResult.status).toBe('unauthorized');
  });

  it('rejects invalid or non-Ethiopian phone numbers', async () => {
    const repo = new InMemoryPhoneVerificationRepository();
    const service = new PhoneVerificationService(repo);
    const learner = createTestLearner();

    // Landline
    const landlineResult = await service.requestVerification(learner, '+251111234567', NOW);
    expect(landlineResult.ok).toBe(false);
    expect(landlineResult.reason).toBe('invalid_phone');

    // Non-Ethiopian (+1...)
    const foreignResult = await service.requestVerification(learner, '+12025550199', NOW);
    expect(foreignResult.ok).toBe(false);
    expect(foreignResult.reason).toBe('invalid_phone');
  });

  it('orchestrates code request, SMS dispatch, and rate-limit cooldown', async () => {
    const repo = new InMemoryPhoneVerificationRepository();
    const sms = new MockSmsAdapter();
    const service = new PhoneVerificationService(repo, sms);
    const learner = createTestLearner();

    const result = await service.requestVerification(learner, '0912341234', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.maskedPhone).toBe('+2519****1234');
    expect(result.cooldownSeconds).toBe(60);
    expect(result.dispatchStatus).toBe('dispatched');

    // SMS message was sent with recipient and plaintext OTP
    expect(sms.dispatches).toHaveLength(1);
    const firstDispatch = sms.dispatches[0];
    expect(firstDispatch).toBeDefined();
    expect(firstDispatch?.to).toBe('+251912341234');
    expect(firstDispatch?.message).toMatch(/verification code is \d{6}/);

    // Immediate repeat request (< 60s) is rejected by cooldown
    const t30 = new Date(NOW.getTime() + 30 * 1000);
    const repeatResult = await service.requestVerification(learner, '0912341234', t30);
    expect(repeatResult.ok).toBe(false);
    expect(repeatResult.reason).toBe('cooldown_active');
    expect(repeatResult.retryAfterSeconds).toBe(30);

    // Request after 61s is permitted
    const t61 = new Date(NOW.getTime() + 61 * 1000);
    const laterResult = await service.requestVerification(learner, '0912341234', t61);
    expect(laterResult.ok).toBe(true);
    expect(sms.dispatches).toHaveLength(2);
  });

  it('completes verification and sets ownership when correct code is submitted', async () => {
    const repo = new InMemoryPhoneVerificationRepository();
    const sms = new MockSmsAdapter();
    const service = new PhoneVerificationService(repo, sms);
    const learner = createTestLearner();

    const req = await service.requestVerification(learner, '+251912345678', NOW);
    expect(req.ok).toBe(true);

    // Extract dispatched code from mock SMS
    const dispatch = sms.dispatches[0];
    expect(dispatch).toBeDefined();
    const match = /verification code is (\d{6})/.exec(dispatch?.message ?? '');
    expect(match).not.toBeNull();
    const otp = match?.[1] ?? '';

    // Verification succeeds
    const verifyResult = await service.verifyCode(
      learner,
      { phoneNumber: '+251912345678', code: otp },
      NOW,
    );
    expect(verifyResult.ok).toBe(true);
    expect(verifyResult.status).toBe('verified');

    // Phone is now recorded as verified
    const isVerified = await service.isPhoneVerified(learner, '+251912345678');
    expect(isVerified).toBe(true);
  });

  it('isolates learner phone ownership: other learners cannot verify or query phone', async () => {
    const repo = new InMemoryPhoneVerificationRepository();
    const sms = new MockSmsAdapter();
    const service = new PhoneVerificationService(repo, sms);
    const learnerA = createTestLearner('learner-a');
    const learnerB = createTestLearner('learner-b');

    // Learner A requests code
    await service.requestVerification(learnerA, '+251912345678', NOW);
    const dispatch = sms.dispatches[0];
    expect(dispatch).toBeDefined();
    const match = /verification code is (\d{6})/.exec(dispatch?.message ?? '');
    const otp = match?.[1] ?? '';

    // Learner B attempts to verify Learner A's challenge
    const bAttempt = await service.verifyCode(
      learnerB,
      { phoneNumber: '+251912345678', code: otp },
      NOW,
    );
    expect(bAttempt.ok).toBe(false);
    expect(bAttempt.status).toBe('not_found'); // Learner B has no active challenge

    // Learner A verifies their own challenge
    const aAttempt = await service.verifyCode(
      learnerA,
      { phoneNumber: '+251912345678', code: otp },
      NOW,
    );
    expect(aAttempt.ok).toBe(true);

    // Learner B cannot query Learner A's verified status
    expect(await service.isPhoneVerified(learnerB, '+251912345678')).toBe(false);
    // Learner A can query their verified status
    expect(await service.isPhoneVerified(learnerA, '+251912345678')).toBe(true);
  });
});
