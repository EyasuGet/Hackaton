// Port interface for phone-ownership verification persistence (T3-003-E).
// Manages storage for verification tokens, challenge digests, attempt limits,
// and verified learner-to-phone bindings.
// Plaintext OTP is NEVER stored in repository storage.

import type { PhoneVerificationCode } from '../../domain/phone-verification.ts';
import type { Principal } from '../../../identity/domain/principal.ts';

export interface PhoneVerificationRepository {
  /**
   * Finds the most recently created verification record for a normalized phone number,
   * regardless of learner, to enforce the global 60-second dispatch cooldown per destination.
   */
  findLatestByPhoneNumber(phoneNumber: string): Promise<PhoneVerificationCode | null>;

  /**
   * Finds the active, non-exhausted verification record for a given learner and phone number.
   */
  findActiveByLearnerAndPhone(
    learnerId: string,
    phoneNumber: string,
  ): Promise<PhoneVerificationCode | null>;

  /**
   * Persists a newly created or updated verification challenge record.
   */
  save(record: PhoneVerificationCode): Promise<void>;

  /**
   * Checks whether a phone number is currently verified for a learner.
   */
  isPhoneVerifiedForLearner(learnerId: string, phoneNumber: string): Promise<boolean>;

  /**
   * Records a verified phone number mapping for a learner upon successful challenge verification.
   */
  markPhoneVerified(learnerId: string, phoneNumber: string, verifiedAt: Date): Promise<void>;

  /**
   * Finds the learner ID associated with a verified phone number.
   */
  findLearnerByPhoneNumber?(phoneNumber: string): Promise<string | null>;

  /**
   * Finds the principal (with course grants) associated with a verified phone number.
   */
  findPrincipalByPhoneNumber?(phoneNumber: string): Promise<Principal | null>;

  /**
   * Purges expired or exhausted verification challenges as of `now`.
   */
  purgeExpired?(now: Date): Promise<number>;
}
