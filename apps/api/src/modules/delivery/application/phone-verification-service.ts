// Application service for phone-ownership verification (T3-003-E).
// Orchestrates cryptographic challenge creation, rate-limited dispatch,
// attempt-limited verification, and learner isolation.
// Plaintext OTP is NEVER persisted, logged, or returned across API boundaries.

import { randomUUID } from 'node:crypto';
import { ownedScope, type Principal } from '../../identity/domain/principal.ts';
import {
  createPhoneVerificationCode,
  getRemainingCooldownSeconds,
  isOtpCooldownActive,
  maskPhoneNumber,
  OTP_COOLDOWN_MS,
} from '../domain/phone-verification.ts';
import { validateEthiopianPhoneNumber } from '../domain/phone-number.ts';
import type { PhoneVerificationRepository } from './ports/phone-verification-repository.ts';
import type { SmsAdapter } from './ports/sms-adapter.ts';

export type RequestVerificationOutcome =
  | {
      readonly ok: true;
      readonly id: string;
      readonly maskedPhone: string;
      readonly expiresAt: Date;
      readonly cooldownSeconds: number;
      readonly dispatchStatus: 'dispatched' | 'simulated';
      readonly reason?: undefined;
      readonly error?: undefined;
      readonly retryAfterSeconds?: undefined;
    }
  | {
      readonly ok: false;
      readonly reason: 'unauthorized' | 'invalid_phone' | 'cooldown_active' | 'dispatch_failed';
      readonly error: string;
      readonly retryAfterSeconds?: number;
      readonly id?: undefined;
      readonly maskedPhone?: undefined;
      readonly expiresAt?: undefined;
      readonly cooldownSeconds?: undefined;
      readonly dispatchStatus?: undefined;
    };

export type VerifyCodeOutcome =
  | {
      readonly ok: true;
      readonly status: 'verified';
      readonly phoneNumber: string;
      readonly verifiedAt: Date;
    }
  | {
      readonly ok: false;
      readonly status:
        'mismatch' | 'exhausted' | 'expired' | 'not_found' | 'unauthorized' | 'invalid_phone';
      readonly remainingAttempts: number;
      readonly reason: string;
    };

export class PhoneVerificationService {
  readonly #repository: PhoneVerificationRepository;
  readonly #smsAdapter: SmsAdapter | undefined;

  constructor(repository: PhoneVerificationRepository, smsAdapter?: SmsAdapter) {
    this.#repository = repository;
    this.#smsAdapter = smsAdapter;
  }

  /**
   * Requests a new phone-ownership verification challenge.
   * Enforces learner authentication, valid Ethiopian destination, and 60s cooldown.
   * Dispatches the 6-digit OTP via the approved SMS adapter if configured.
   */
  async requestVerification(
    principal: Principal,
    rawPhoneNumber: string,
    now: Date = new Date(),
  ): Promise<RequestVerificationOutcome> {
    // 1. Enforce learner authentication boundary.
    const scope = ownedScope(principal);
    if (!scope) {
      return {
        ok: false,
        reason: 'unauthorized',
        error: 'Only authenticated learners may request phone verification',
      };
    }

    // 2. Validate and normalize the Ethiopian mobile phone number.
    const validation = validateEthiopianPhoneNumber(rawPhoneNumber);
    if (!validation.valid) {
      return {
        ok: false,
        reason: 'invalid_phone',
        error: validation.reason,
      };
    }
    const normalizedPhone = validation.normalized;

    // 3. Enforce rate-limited dispatch: minimum 60 seconds cooldown per phone number.
    const latestRecord = await this.#repository.findLatestByPhoneNumber(normalizedPhone);
    if (latestRecord && isOtpCooldownActive(latestRecord.createdAt, now)) {
      const remainingSeconds = getRemainingCooldownSeconds(latestRecord.createdAt, now);
      return {
        ok: false,
        reason: 'cooldown_active',
        error: `Please wait ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'} before requesting another verification code`,
        retryAfterSeconds: remainingSeconds,
      };
    }

    // 4. Generate challenge with cryptographically secure 6-digit OTP and salted SHA-256 digest.
    const challengeId = randomUUID();
    const { codeRecord, plaintextCode } = createPhoneVerificationCode({
      id: challengeId,
      learnerId: scope.ownerId,
      phoneNumber: normalizedPhone,
      now,
    });

    // 5. Persist the challenge record (only the salted digest is stored).
    await this.#repository.save(codeRecord);

    // 6. Dispatch SMS through the approved provider route if configured.
    let dispatchStatus: 'dispatched' | 'simulated' = 'simulated';
    if (this.#smsAdapter) {
      const sendResult = await this.#smsAdapter.send({
        to: normalizedPhone,
        message: `Your verification code is ${plaintextCode}. Valid for 10 minutes. Do not share this code.`,
      });

      if (!sendResult.ok) {
        return {
          ok: false,
          reason: 'dispatch_failed',
          error: `Failed to deliver verification SMS: ${sendResult.error}`,
        };
      }
      dispatchStatus = 'dispatched';
    }

    return {
      ok: true,
      id: challengeId,
      maskedPhone: maskPhoneNumber(normalizedPhone),
      expiresAt: codeRecord.expiresAt,
      cooldownSeconds: OTP_COOLDOWN_MS / 1000,
      dispatchStatus,
    };
  }

  /**
   * Evaluates a candidate verification code against the stored challenge digest.
   * Enforces attempt limits (max 3), expiry (10 min), and binds verified ownership to the learner.
   */
  async verifyCode(
    principal: Principal,
    input: { readonly phoneNumber: string; readonly code: string },
    now: Date = new Date(),
  ): Promise<VerifyCodeOutcome> {
    // 1. Enforce learner authentication boundary.
    const scope = ownedScope(principal);
    if (!scope) {
      return {
        ok: false,
        status: 'unauthorized',
        remainingAttempts: 0,
        reason: 'Only authenticated learners may verify phone ownership',
      };
    }

    // 2. Validate and normalize the phone number.
    const validation = validateEthiopianPhoneNumber(input.phoneNumber);
    if (!validation.valid) {
      return {
        ok: false,
        status: 'invalid_phone',
        remainingAttempts: 0,
        reason: validation.reason,
      };
    }
    const normalizedPhone = validation.normalized;

    // 3. Find the active challenge for this learner and phone number.
    const record = await this.#repository.findActiveByLearnerAndPhone(
      scope.ownerId,
      normalizedPhone,
    );

    if (!record) {
      return {
        ok: false,
        status: 'not_found',
        remainingAttempts: 0,
        reason:
          'No active verification code found for this phone number. Please request a new code.',
      };
    }

    // 4. Delegate verification evaluation to the pure domain model.
    const attemptResult = record.attemptVerification(input.code, now);

    // 5. Persist the updated challenge record (updated attempts, status, or verifiedAt).
    await this.#repository.save(attemptResult.record);

    // 6. If verified, record verified ownership for this learner.
    if (attemptResult.success) {
      await this.#repository.markPhoneVerified(scope.ownerId, normalizedPhone, now);
      return {
        ok: true,
        status: 'verified',
        phoneNumber: normalizedPhone,
        verifiedAt: now,
      };
    }

    return {
      ok: false,
      status: attemptResult.status,
      remainingAttempts: attemptResult.remainingAttempts,
      reason: attemptResult.reason,
    };
  }

  /**
   * Checks whether a phone number is currently verified for the requesting learner.
   * Rejects cross-learner queries to preserve strict privacy and isolation.
   */
  async isPhoneVerified(principal: Principal, rawPhoneNumber: string): Promise<boolean> {
    const scope = ownedScope(principal);
    if (!scope) {
      return false;
    }

    const validation = validateEthiopianPhoneNumber(rawPhoneNumber);
    if (!validation.valid) {
      return false;
    }

    return this.#repository.isPhoneVerifiedForLearner(scope.ownerId, validation.normalized);
  }

  /**
   * Queries cooldown status for a destination phone number.
   */
  async getCooldownStatus(
    rawPhoneNumber: string,
    now: Date = new Date(),
  ): Promise<{ readonly cooldownActive: boolean; readonly remainingSeconds: number }> {
    const validation = validateEthiopianPhoneNumber(rawPhoneNumber);
    if (!validation.valid) {
      return { cooldownActive: false, remainingSeconds: 0 };
    }

    const latest = await this.#repository.findLatestByPhoneNumber(validation.normalized);
    if (!latest) {
      return { cooldownActive: false, remainingSeconds: 0 };
    }

    const active = isOtpCooldownActive(latest.createdAt, now);
    const remainingSeconds = getRemainingCooldownSeconds(latest.createdAt, now);
    return { cooldownActive: active, remainingSeconds };
  }
}
