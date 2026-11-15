// Domain model and cryptographic verification rules for phone ownership (T3-003-E).
// Authorizes the phone-ownership verification contract before SMS job subscriptions (T3-021-A).
// Plaintext OTP is NEVER stored, logged, or returned across public API boundaries.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { validateEthiopianPhoneNumber } from './phone-number.ts';

/** Numeric OTP length: 6 decimal digits. */
export const OTP_LENGTH = 6;

/** OTP validity window: 10 minutes (600,000 ms). */
export const OTP_TTL_MS = 10 * 60 * 1000;

/** Minimum cooldown between code requests per phone number: 60 seconds (60,000 ms). */
export const OTP_COOLDOWN_MS = 60 * 1000;

/** Maximum allowed failed attempts before code is permanently locked out (exhausted). */
export const MAX_VERIFICATION_ATTEMPTS = 3;

export type PhoneVerificationStatus = 'pending' | 'verified' | 'exhausted' | 'expired';

export interface PhoneVerificationProps {
  readonly id: string;
  readonly learnerId: string;
  /** Normalized Ethiopian destination phone in E.164 (+251...). */
  readonly phoneNumber: string;
  /** Salted SHA-256 digest of the 6-digit OTP code (never plaintext). */
  readonly codeDigest: string;
  /** Cryptographic per-record salt (hex string). */
  readonly salt: string;
  /** Count of failed verification attempts recorded. */
  readonly attempts: number;
  /** Maximum allowable failed attempts before permanent lockout (default 3). */
  readonly maxAttempts?: number | undefined;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly verifiedAt?: Date | null | undefined;
  readonly currentStatus?: PhoneVerificationStatus | undefined;
}

export type VerificationAttemptResult =
  | {
      readonly success: true;
      readonly status: 'verified';
      readonly remainingAttempts: number;
      readonly record: PhoneVerificationCode;
      readonly reason?: undefined;
    }
  | {
      readonly success: false;
      readonly status: 'mismatch' | 'exhausted' | 'expired';
      readonly remainingAttempts: number;
      readonly reason: string;
      readonly record: PhoneVerificationCode;
    };

/**
 * Generates a cryptographically random 6-digit numeric OTP string using CSPRNG.
 */
export function generateRandomOtp(length: number = OTP_LENGTH): string {
  const max = 10 ** length;
  return randomInt(0, max).toString().padStart(length, '0');
}

/**
 * Generates a cryptographically random salt string.
 */
export function generateSalt(bytes: number = 16): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Computes a salted SHA-256 digest for an OTP code.
 * Plaintext OTP is concatenated with the per-record salt before hashing.
 */
export function computeOtpDigest(code: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${code.trim()}`).digest('hex');
}

/**
 * Performs a constant-time comparison between a candidate OTP and the stored SHA-256 digest.
 * Mitigates timing side-channel attacks.
 */
export function verifyOtpDigest(
  candidateCode: string,
  salt: string,
  expectedDigest: string,
): boolean {
  if (!candidateCode || typeof candidateCode !== 'string') {
    return false;
  }
  const candidateDigest = computeOtpDigest(candidateCode, salt);
  const candidateBuf = Buffer.from(candidateDigest, 'hex');
  const expectedBuf = Buffer.from(expectedDigest, 'hex');

  if (candidateBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(candidateBuf, expectedBuf);
}

/**
 * Safely masks an Ethiopian phone number to prevent leaking sensitive digits in logs or UI.
 * Standard output format: `+2519****1234` or `+2517****1234`.
 */
export function maskPhoneNumber(rawOrNormalized: string): string {
  if (!rawOrNormalized || typeof rawOrNormalized !== 'string') {
    return '****';
  }

  const validation = validateEthiopianPhoneNumber(rawOrNormalized);
  const normalized = validation.valid
    ? validation.normalized
    : rawOrNormalized.trim().replace(/[\s\-().]/g, '');

  if (/^\+251(9|7)\d{8}$/.test(normalized)) {
    // Preserve '+251' and mobile operator digit (e.g. '+2519'), mask 4 digits, show last 4.
    return `${normalized.slice(0, 5)}****${normalized.slice(9)}`;
  }

  if (normalized.length >= 8) {
    const prefixLen = normalized.startsWith('+') ? 5 : 4;
    const suffixLen = 4;
    if (normalized.length > prefixLen + suffixLen) {
      return `${normalized.slice(0, prefixLen)}****${normalized.slice(-suffixLen)}`;
    }
  }

  return '****';
}

/**
 * Checks whether the dispatch cooldown is still active for a given timestamp.
 */
export function isOtpCooldownActive(lastCreatedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastCreatedAt.getTime() < OTP_COOLDOWN_MS;
}

/**
 * Computes the remaining cooldown seconds before a new code may be requested.
 */
export function getRemainingCooldownSeconds(lastCreatedAt: Date, now: Date = new Date()): number {
  const elapsed = now.getTime() - lastCreatedAt.getTime();
  if (elapsed >= OTP_COOLDOWN_MS) {
    return 0;
  }
  return Math.max(0, Math.ceil((OTP_COOLDOWN_MS - elapsed) / 1000));
}

/**
 * Pure domain model encapsulating the lifecycle, security, and verification
 * rules for a single phone-ownership verification challenge.
 */
export class PhoneVerificationCode {
  readonly id: string;
  readonly learnerId: string;
  readonly phoneNumber: string;
  readonly codeDigest: string;
  readonly salt: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly verifiedAt: Date | null;
  readonly currentStatus: PhoneVerificationStatus;

  constructor(props: PhoneVerificationProps) {
    this.id = props.id;
    this.learnerId = props.learnerId;
    this.phoneNumber = props.phoneNumber;
    this.codeDigest = props.codeDigest;
    this.salt = props.salt;
    this.attempts = props.attempts;
    this.maxAttempts = props.maxAttempts ?? MAX_VERIFICATION_ATTEMPTS;
    this.createdAt = props.createdAt;
    this.expiresAt = props.expiresAt;
    this.verifiedAt = props.verifiedAt ?? null;
    this.currentStatus = props.currentStatus ?? this.#computeInitialStatus();
  }

  #computeInitialStatus(): PhoneVerificationStatus {
    if (this.verifiedAt !== null) {
      return 'verified';
    }
    if (this.attempts >= this.maxAttempts) {
      return 'exhausted';
    }
    return 'pending';
  }

  /**
   * Returns true if the token's 10-minute validity window has elapsed.
   */
  isExpired(now: Date = new Date()): boolean {
    return now.getTime() >= this.expiresAt.getTime();
  }

  /**
   * Returns true if the maximum allowed failed attempts have been reached.
   */
  isExhausted(): boolean {
    return this.attempts >= this.maxAttempts;
  }

  /**
   * Returns true if the token was successfully verified.
   */
  isVerified(): boolean {
    return this.verifiedAt !== null;
  }

  /**
   * Returns the dynamic status taking current wall-clock time into account.
   */
  getStatus(now: Date = new Date()): PhoneVerificationStatus {
    if (this.verifiedAt !== null) {
      return 'verified';
    }
    if (this.isExhausted()) {
      return 'exhausted';
    }
    if (this.isExpired(now)) {
      return 'expired';
    }
    return 'pending';
  }

  /**
   * Evaluates a candidate verification code against the salted digest.
   * Enforces attempt limits, 10-minute expiry, and permanent lockout.
   */
  attemptVerification(candidateCode: string, now: Date = new Date()): VerificationAttemptResult {
    // 1. Guard against re-verifying an already completed token.
    if (this.isVerified()) {
      return {
        success: false,
        status: 'exhausted',
        remainingAttempts: 0,
        reason: 'Phone number has already been verified.',
        record: this,
      };
    }

    // 2. Guard against attempts on an already exhausted (locked out) code.
    if (this.isExhausted()) {
      return {
        success: false,
        status: 'exhausted',
        remainingAttempts: 0,
        reason: 'Verification code has been permanently exhausted. Please request a new code.',
        record: this,
      };
    }

    // 3. Guard against attempts on an expired token (past 10-minute TTL).
    if (this.isExpired(now)) {
      const expiredRecord = new PhoneVerificationCode({
        ...this,
        currentStatus: 'expired',
      });
      return {
        success: false,
        status: 'expired',
        remainingAttempts: 0,
        reason: 'Verification code has expired. Please request a new code.',
        record: expiredRecord,
      };
    }

    // 4. Verify candidate OTP using timing-safe cryptographic comparison.
    const isMatch = verifyOtpDigest(candidateCode, this.salt, this.codeDigest);

    if (isMatch) {
      const verifiedRecord = new PhoneVerificationCode({
        ...this,
        verifiedAt: now,
        currentStatus: 'verified',
      });
      return {
        success: true,
        status: 'verified',
        remainingAttempts: this.maxAttempts - this.attempts,
        record: verifiedRecord,
      };
    }

    // 5. Handle mismatch: increment failed attempts and check for lockout.
    const newAttempts = this.attempts + 1;
    const isNowExhausted = newAttempts >= this.maxAttempts;
    const remaining = Math.max(0, this.maxAttempts - newAttempts);

    const updatedRecord = new PhoneVerificationCode({
      ...this,
      attempts: newAttempts,
      currentStatus: isNowExhausted ? 'exhausted' : 'pending',
    });

    if (isNowExhausted) {
      return {
        success: false,
        status: 'exhausted',
        remainingAttempts: 0,
        reason: 'Maximum verification attempts exceeded (3). Code permanently exhausted.',
        record: updatedRecord,
      };
    }

    return {
      success: false,
      status: 'mismatch',
      remainingAttempts: remaining,
      reason: `Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      record: updatedRecord,
    };
  }
}

export interface CreatePhoneVerificationCodeParams {
  readonly id: string;
  readonly learnerId: string;
  readonly phoneNumber: string;
  readonly code?: string | undefined;
  readonly salt?: string | undefined;
  readonly now?: Date | undefined;
}

/**
 * Factory creating a fresh PhoneVerificationCode along with the plaintext OTP
 * for immediate dispatch. The plaintext OTP is returned once and must never be stored.
 */
export function createPhoneVerificationCode(params: CreatePhoneVerificationCodeParams): {
  readonly codeRecord: PhoneVerificationCode;
  readonly plaintextCode: string;
} {
  const now = params.now ?? new Date();
  const plaintextCode = params.code ?? generateRandomOtp(OTP_LENGTH);
  const salt = params.salt ?? generateSalt(16);
  const codeDigest = computeOtpDigest(plaintextCode, salt);
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

  const codeRecord = new PhoneVerificationCode({
    id: params.id,
    learnerId: params.learnerId,
    phoneNumber: params.phoneNumber,
    codeDigest,
    salt,
    attempts: 0,
    maxAttempts: MAX_VERIFICATION_ATTEMPTS,
    createdAt: now,
    expiresAt,
    verifiedAt: null,
    currentStatus: 'pending',
  });

  return { codeRecord, plaintextCode };
}
