// Domain model and validation rules for SMS job alert subscriptions (T3-021-A).
// An SMS job alert subscription strictly requires a verified Ethiopian mobile phone
// (+2519... or +2517...) verified via cryptographic OTP proof (Decision D24, T3-003-E).
// Unverified phone numbers are strictly prohibited from subscribing.
// Unsubscribing immediately suppresses future delivery intents and revokes eligibility.

import type { Job } from '../../careers/domain/job.ts';
import { maskPhoneNumber } from './phone-verification.ts';
import { type EthiopianMobileOperator, validateEthiopianPhoneNumber } from './phone-number.ts';

export type SmsSubscriptionStatus = 'active' | 'unsubscribed' | 'pending_verification';

export interface SmsSubscription {
  readonly id: string;
  readonly learnerId: string;
  readonly phoneNumber: string;
  readonly maskedPhone: string;
  readonly categories: readonly string[];
  readonly locations: readonly string[];
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly unsubscribedAt: Date | null;
}

export interface CreateSmsSubscriptionInput {
  readonly phoneNumber: string;
  readonly categories?: readonly string[] | undefined;
  readonly locations?: readonly string[] | undefined;
}

export { maskPhoneNumber };

/**
 * Validates whether a raw phone number meets Ethiopian mobile requirements
 * for SMS job alert delivery (+2519... or +2517...).
 */
export function validateSmsDestination(rawPhone: string): {
  readonly valid: boolean;
  readonly normalized?: string | undefined;
  readonly operator?: EthiopianMobileOperator | undefined;
  readonly reason?: string | undefined;
} {
  const result = validateEthiopianPhoneNumber(rawPhone);
  if (!result.valid) {
    return { valid: false, reason: result.reason };
  }
  return {
    valid: true,
    normalized: result.normalized,
    operator: result.operator,
  };
}

/**
 * Checks whether an SMS subscription is eligible for job alert matching.
 * Only verified, active subscriptions with unwithdrawn and unexpired jobs match.
 */
export function isSmsSubscriptionEligible(
  subscription: Pick<SmsSubscription, 'active' | 'unsubscribedAt'>,
  isPhoneVerified: boolean,
): boolean {
  if (!subscription.active) return false;
  if (subscription.unsubscribedAt !== null) return false;
  return isPhoneVerified;
}

/**
 * Deterministically checks whether a job matches an active SMS subscription's preferences.
 * Subscriptions with empty category/location lists match any category/location.
 * Non-empty filters require exact (case-insensitive) match.
 * Expired or withdrawn jobs never match.
 */
export function matchSmsJobSubscription(
  subscription: Pick<SmsSubscription, 'active' | 'categories' | 'locations' | 'unsubscribedAt'>,
  isPhoneVerified: boolean,
  job: Pick<Job, 'category' | 'location' | 'withdrawn' | 'expiresAt'>,
  asOf: Date = new Date(),
): boolean {
  if (!isSmsSubscriptionEligible(subscription, isPhoneVerified)) {
    return false;
  }
  if (job.withdrawn) return false;
  if (job.expiresAt.getTime() <= asOf.getTime()) return false;

  if (subscription.categories.length > 0) {
    const jobCat = job.category.trim().toLowerCase();
    const matchesCategory = subscription.categories.some(
      (cat) => cat.trim().toLowerCase() === jobCat,
    );
    if (!matchesCategory) return false;
  }

  if (subscription.locations.length > 0) {
    const jobLoc = job.location.trim().toLowerCase();
    const matchesLocation = subscription.locations.some(
      (loc) => loc.trim().toLowerCase() === jobLoc,
    );
    if (!matchesLocation) return false;
  }

  return true;
}
