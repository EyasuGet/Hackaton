// Application service for SMS job alert subscriptions (T3-021-A).
// Orchestrates verification challenge dispatch, OTP confirmation, active subscription creation,
// and immediate opt-out / suppression of pending delivery intents.
// Requires verified Ethiopian mobile phone ownership (+2519... or +2517...) per Decision D24.

import { ownedScope, type Principal } from '../../identity/domain/principal.ts';
import type { JobSubscription } from '../../careers/domain/job-preferences.ts';
import type { JobPreferences } from '../../careers/application/job-preferences.ts';
import { maskPhoneNumber, validateSmsDestination } from '../domain/sms-subscription.ts';
import type { PhoneVerificationService } from './phone-verification-service.ts';

export type RequestSmsSubscriptionOutcome =
  | {
      readonly ok: true;
      readonly status: 'verification_required';
      readonly challengeId: string;
      readonly maskedPhone: string;
      readonly expiresAt: Date;
      readonly cooldownSeconds: number;
      readonly dispatchStatus: 'dispatched' | 'simulated';
      readonly reason?: undefined;
      readonly error?: undefined;
      readonly retryAfterSeconds?: undefined;
    }
  | {
      readonly ok: true;
      readonly status: 'active';
      readonly subscription: JobSubscription;
      readonly maskedPhone: string;
      readonly reason?: undefined;
      readonly error?: undefined;
      readonly retryAfterSeconds?: undefined;
    }
  | {
      readonly ok: false;
      readonly reason: 'unauthorized' | 'invalid_phone' | 'cooldown_active' | 'dispatch_failed';
      readonly error: string;
      readonly retryAfterSeconds?: number | undefined;
      readonly status?: undefined;
    };

export type VerifySmsSubscriptionOutcome =
  | {
      readonly ok: true;
      readonly status: 'active';
      readonly subscription: JobSubscription;
      readonly maskedPhone: string;
      readonly verifiedAt: Date;
    }
  | {
      readonly ok: false;
      readonly status:
        'mismatch' | 'exhausted' | 'expired' | 'not_found' | 'unauthorized' | 'invalid_phone';
      readonly remainingAttempts: number;
      readonly reason: string;
    };

export interface SmsSubscriptionStatusResult {
  readonly subscribed: boolean;
  readonly status: 'active' | 'none';
  readonly subscription?: JobSubscription | undefined;
  readonly maskedPhone?: string | undefined;
  readonly verified?: boolean | undefined;
}

export interface SmsUnsubscribeOutcome {
  readonly ok: boolean;
  readonly status: 'unsubscribed';
  readonly cancelledIntentsCount: number;
  readonly contactRemoved: boolean;
  readonly subscription?: JobSubscription | undefined;
}

export class SmsSubscriptionService {
  readonly #phoneVerificationService: PhoneVerificationService;
  readonly #jobPreferences: JobPreferences;

  constructor(phoneVerificationService: PhoneVerificationService, jobPreferences: JobPreferences) {
    this.#phoneVerificationService = phoneVerificationService;
    this.#jobPreferences = jobPreferences;
  }

  /**
   * Requests an SMS job alert subscription.
   * If the Ethiopian phone number is already verified for this learner, immediately activates the subscription.
   * Otherwise, issues a rate-limited cryptographic OTP challenge dispatched to the destination.
   */
  async requestSubscription(
    principal: Principal,
    input: {
      readonly phoneNumber: string;
      readonly categories?: readonly string[] | undefined;
      readonly locations?: readonly string[] | undefined;
    },
    now: Date = new Date(),
  ): Promise<RequestSmsSubscriptionOutcome> {
    const scope = ownedScope(principal);
    if (!scope) {
      return {
        ok: false,
        reason: 'unauthorized',
        error: 'Only authenticated learners may manage SMS subscriptions',
      };
    }

    const validation = validateSmsDestination(input.phoneNumber);
    if (!validation.valid || !validation.normalized) {
      return {
        ok: false,
        reason: 'invalid_phone',
        error: validation.reason ?? 'Invalid Ethiopian mobile phone number',
      };
    }
    const normalizedPhone = validation.normalized;

    // Check if phone number is already verified for this learner.
    const isVerified = await this.#phoneVerificationService.isPhoneVerified(
      principal,
      normalizedPhone,
    );

    if (isVerified) {
      const subscription = await this.#jobPreferences.subscribe(
        principal,
        {
          channel: 'sms',
          destination: normalizedPhone,
          categories: input.categories ?? [],
          locations: input.locations ?? [],
        },
        now,
      );

      if (!subscription) {
        return {
          ok: false,
          reason: 'unauthorized',
          error: 'Failed to create active SMS subscription',
        };
      }

      return {
        ok: true,
        status: 'active',
        subscription,
        maskedPhone: maskPhoneNumber(normalizedPhone),
      };
    }

    // Phone not verified: dispatch a new OTP verification challenge.
    const verificationOutcome = await this.#phoneVerificationService.requestVerification(
      principal,
      normalizedPhone,
      now,
    );

    if (!verificationOutcome.ok) {
      return {
        ok: false,
        reason: verificationOutcome.reason,
        error: verificationOutcome.error,
        ...(verificationOutcome.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: verificationOutcome.retryAfterSeconds }
          : {}),
      };
    }

    return {
      ok: true,
      status: 'verification_required',
      challengeId: verificationOutcome.id,
      maskedPhone: verificationOutcome.maskedPhone,
      expiresAt: verificationOutcome.expiresAt,
      cooldownSeconds: verificationOutcome.cooldownSeconds,
      dispatchStatus: verificationOutcome.dispatchStatus,
    };
  }

  /**
   * Submits a candidate OTP code to verify ownership and unlock an active SMS job subscription.
   */
  async verifyAndSubscribe(
    principal: Principal,
    input: {
      readonly phoneNumber: string;
      readonly code: string;
      readonly categories?: readonly string[] | undefined;
      readonly locations?: readonly string[] | undefined;
    },
    now: Date = new Date(),
  ): Promise<VerifySmsSubscriptionOutcome> {
    const scope = ownedScope(principal);
    if (!scope) {
      return {
        ok: false,
        status: 'unauthorized',
        remainingAttempts: 0,
        reason: 'Only authenticated learners may verify SMS subscriptions',
      };
    }

    const validation = validateSmsDestination(input.phoneNumber);
    if (!validation.valid || !validation.normalized) {
      return {
        ok: false,
        status: 'invalid_phone',
        remainingAttempts: 0,
        reason: validation.reason ?? 'Invalid Ethiopian mobile phone number',
      };
    }
    const normalizedPhone = validation.normalized;

    // Verify candidate OTP via PhoneVerificationService.
    const verifyResult = await this.#phoneVerificationService.verifyCode(
      principal,
      { phoneNumber: normalizedPhone, code: input.code },
      now,
    );

    if (!verifyResult.ok) {
      return {
        ok: false,
        status: verifyResult.status,
        remainingAttempts: verifyResult.remainingAttempts,
        reason: verifyResult.reason,
      };
    }

    // Phone verified: activate the SMS job subscription.
    const subscription = await this.#jobPreferences.subscribe(
      principal,
      {
        channel: 'sms',
        destination: normalizedPhone,
        categories: input.categories ?? [],
        locations: input.locations ?? [],
      },
      now,
    );

    if (!subscription) {
      return {
        ok: false,
        status: 'unauthorized',
        remainingAttempts: 0,
        reason: 'Failed to create active SMS subscription after verification',
      };
    }

    return {
      ok: true,
      status: 'active',
      subscription,
      maskedPhone: maskPhoneNumber(normalizedPhone),
      verifiedAt: verifyResult.verifiedAt,
    };
  }

  /**
   * Queries the active SMS job subscription status for the requesting learner.
   * Rejects cross-learner queries to maintain strict tenant isolation.
   */
  async getStatus(principal: Principal): Promise<SmsSubscriptionStatusResult> {
    const scope = ownedScope(principal);
    if (!scope) {
      return { subscribed: false, status: 'none' };
    }

    const subscriptions = await this.#jobPreferences.listOwned(principal);
    const activeSub = subscriptions.find((s) => s.channel === 'sms' && s.active);

    if (!activeSub) {
      return { subscribed: false, status: 'none' };
    }

    const isVerified = await this.#phoneVerificationService.isPhoneVerified(
      principal,
      activeSub.destination,
    );

    return {
      subscribed: true,
      status: 'active',
      subscription: activeSub,
      maskedPhone: maskPhoneNumber(activeSub.destination),
      verified: isVerified,
    };
  }

  /**
   * Unsubscribes the learner from SMS job alert subscriptions.
   * Immediately cancels eligibility and suppresses queued delivery intents.
   * If subscriptionId is omitted, unsubscribes all active SMS subscriptions for this learner.
   */
  async unsubscribe(
    principal: Principal,
    subscriptionId?: string,
    now: Date = new Date(),
  ): Promise<SmsUnsubscribeOutcome | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;

    if (subscriptionId) {
      const outcome = await this.#jobPreferences.unsubscribe(principal, subscriptionId, now);
      if (!outcome) return null;
      return {
        ok: true,
        status: 'unsubscribed',
        subscription: outcome.subscription,
        cancelledIntentsCount: outcome.cancelledIntentsCount,
        contactRemoved: outcome.contactRemoved,
      };
    }

    // Unsubscribe all active SMS subscriptions for the learner.
    const subscriptions = await this.#jobPreferences.listOwned(principal);
    const activeSmsSubs = subscriptions.filter((s) => s.channel === 'sms' && s.active);

    if (activeSmsSubs.length === 0) {
      return {
        ok: true,
        status: 'unsubscribed',
        cancelledIntentsCount: 0,
        contactRemoved: false,
      };
    }

    let totalCancelled = 0;
    let anyContactRemoved = false;
    let lastSub: JobSubscription | undefined;

    for (const sub of activeSmsSubs) {
      const outcome = await this.#jobPreferences.unsubscribe(principal, sub.id, now);
      if (outcome) {
        totalCancelled += outcome.cancelledIntentsCount;
        if (outcome.contactRemoved) anyContactRemoved = true;
        lastSub = outcome.subscription;
      }
    }

    return {
      ok: true,
      status: 'unsubscribed',
      subscription: lastSub,
      cancelledIntentsCount: totalCancelled,
      contactRemoved: anyContactRemoved,
    };
  }
}
