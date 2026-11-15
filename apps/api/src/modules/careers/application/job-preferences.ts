// Application use case for learner job alert preferences (T3-020-A).
// Strictly enforces learner ownership: only learner principals may view,
// create, and unsubscribe their own alert subscriptions.
// When PhoneVerificationService is configured, SMS subscriptions require
// verified Ethiopian phone ownership proof (Decision D24, T3-021-A).
import { ownedScope, type Principal } from '../../identity/domain/principal.ts';
import type { TelegramLinkRepository } from '../../telegram/application/ports/telegram-link-repository.ts';
import type { PhoneVerificationService } from '../../delivery/application/phone-verification-service.ts';
import type { CreateSubscriptionInput, JobSubscription } from '../domain/job-preferences.ts';
import type {
  JobPreferencesRepository,
  UnsubscribeResult,
} from './ports/job-preferences-repository.ts';

export class JobPreferences {
  readonly #repository: JobPreferencesRepository;
  readonly #telegramLinkRepo?: TelegramLinkRepository | undefined;
  readonly #phoneVerificationService?: PhoneVerificationService | undefined;

  constructor(
    repository: JobPreferencesRepository,
    secondArg?: TelegramLinkRepository | PhoneVerificationService,
    thirdArg?: PhoneVerificationService | TelegramLinkRepository,
  ) {
    this.#repository = repository;
    if (secondArg && 'isPhoneVerified' in secondArg) {
      this.#phoneVerificationService = secondArg as PhoneVerificationService;
    } else if (secondArg && 'findIdentityByLearnerId' in secondArg) {
      this.#telegramLinkRepo = secondArg as TelegramLinkRepository;
    }
    if (thirdArg && 'isPhoneVerified' in thirdArg) {
      this.#phoneVerificationService = thirdArg as PhoneVerificationService;
    } else if (thirdArg && 'findIdentityByLearnerId' in thirdArg) {
      this.#telegramLinkRepo = thirdArg as TelegramLinkRepository;
    }
  }

  /**
   * Subscribes a learner to job alert notifications with category/location preferences.
   * If channel is telegram and telegramLinkRepo is present, binds to verified linked account.
   * Rejects non-learner principals or invalid input (empty destination/channel).
   * If channel is 'sms' and phone verification is configured, rejects unverified destinations.
   */
  async subscribe(
    principal: Principal,
    input: CreateSubscriptionInput,
    now: Date = new Date(),
  ): Promise<JobSubscription | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    if (!input.channel.trim()) return null;

    let destination = input.destination?.trim() ?? '';
    const channel = input.channel.trim().toLowerCase();

    if (channel === 'telegram' && this.#telegramLinkRepo) {
      const identity = await this.#telegramLinkRepo.findIdentityByLearnerId(principal.id);
      if (!identity || identity.revokedAt) {
        return null; // Not linked to Telegram
      }
      if (destination) {
        const valid = [
          identity.telegramChatId,
          identity.telegramUserId,
          `tg:${identity.telegramChatId}`,
          `tg:${identity.telegramUserId}`,
        ];
        if (!valid.includes(destination)) {
          return null; // Destination mismatch with verified linked Telegram identity
        }
      }
      destination = identity.telegramChatId;
    } else if (channel === 'sms' && this.#phoneVerificationService) {
      if (!destination) return null;
      const isVerified = await this.#phoneVerificationService.isPhoneVerified(
        principal,
        destination,
      );
      if (!isVerified) {
        return null;
      }
    }

    if (!destination) return null;

    return this.#repository.subscribe(scope, { ...input, destination }, now);
  }

  /**
   * Unsubscribes a learner from an owned alert subscription.
   * Cancels queued delivery intents and prunes contact details if no active
   * subscriptions remain for this channel.
   * Rejects non-learner principals or subscriptions owned by other learners.
   */
  async unsubscribe(
    principal: Principal,
    subscriptionId: string,
    now: Date = new Date(),
  ): Promise<UnsubscribeResult | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;

    return this.#repository.unsubscribe(scope, subscriptionId, now);
  }

  /**
   * Unsubscribes all active subscriptions for the specified channel, immediately
   * cancelling queued intents and pruning contact details.
   */
  async unsubscribeAll(
    principal: Principal,
    channel: string,
    now: Date = new Date(),
  ): Promise<number> {
    const scope = ownedScope(principal);
    if (!scope) return 0;

    return this.#repository.unsubscribeAll(scope, channel, now);
  }

  /**
   * Lists subscriptions owned by the requesting learner.
   */
  async listOwned(principal: Principal): Promise<readonly JobSubscription[]> {
    const scope = ownedScope(principal);
    if (!scope) return [];

    return this.#repository.listOwned(scope);
  }

  /**
   * Retrieves an owned subscription by ID.
   */
  async getOwned(principal: Principal, subscriptionId: string): Promise<JobSubscription | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;

    return this.#repository.getOwned(scope, subscriptionId);
  }
}
