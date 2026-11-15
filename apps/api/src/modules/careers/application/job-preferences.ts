// Application use case for learner job alert preferences (T3-020-A).
// Strictly enforces learner ownership: only learner principals may view,
// create, and unsubscribe their own alert subscriptions.
import { ownedScope, type Principal } from '../../identity/domain/principal.ts';
import type { CreateSubscriptionInput, JobSubscription } from '../domain/job-preferences.ts';
import type {
  JobPreferencesRepository,
  UnsubscribeResult,
} from './ports/job-preferences-repository.ts';

export class JobPreferences {
  readonly #repository: JobPreferencesRepository;

  constructor(repository: JobPreferencesRepository) {
    this.#repository = repository;
  }

  /**
   * Subscribes a learner to job alert notifications with category/location preferences.
   * Rejects non-learner principals or invalid input (empty destination/channel).
   */
  async subscribe(
    principal: Principal,
    input: CreateSubscriptionInput,
    now: Date = new Date(),
  ): Promise<JobSubscription | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    if (!input.channel.trim() || !input.destination.trim()) return null;

    return this.#repository.subscribe(scope, input, now);
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
