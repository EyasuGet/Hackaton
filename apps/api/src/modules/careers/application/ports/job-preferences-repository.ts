// Repository port for learner job alert subscriptions and contacts (T3-020-A).
// Manages preferences, explicit subscriptions, and consent/destination lifecycle.
import type { OwnedScope } from '../../../identity/domain/principal.ts';
import type { CreateSubscriptionInput, JobSubscription } from '../../domain/job-preferences.ts';

export interface UnsubscribeResult {
  readonly subscription: JobSubscription;
  readonly cancelledIntentsCount: number;
  readonly contactRemoved: boolean;
}

export interface JobPreferencesRepository {
  /**
   * Creates or updates an explicit job alert subscription scoped to the learner.
   * Ensures the contact destination is durably stored and associated with the subscription.
   */
  subscribe(
    scope: OwnedScope,
    input: CreateSubscriptionInput,
    now?: Date,
  ): Promise<JobSubscription>;

  /**
   * Unsubscribes a learner from a subscription atomically:
   * 1. Marks subscription as inactive (active = false, unsubscribed_at = now).
   * 2. Cancels pending delivery intents for this learner and channel.
   * 3. Removes contact destination if no other active subscription exists for that channel.
   * 4. Preserves unrelated active subscriptions and bounded non-content dedup records.
   * Returns null if the subscription does not exist or is not owned by the learner.
   */
  unsubscribe(
    scope: OwnedScope,
    subscriptionId: string,
    now?: Date,
  ): Promise<UnsubscribeResult | null>;

  /**
   * Unsubscribes a learner from all active subscriptions on the specified channel,
   * cancels any queued pending delivery intents for this learner and channel,
   * and removes the contact destination.
   */
  unsubscribeAll(scope: OwnedScope, channel: string, now?: Date): Promise<number>;

  /**
   * Lists all subscriptions owned by the requesting learner, newest first.
   */
  listOwned(scope: OwnedScope): Promise<readonly JobSubscription[]>;

  /**
   * Retrieves a specific subscription owned by the requesting learner.
   */
  getOwned(scope: OwnedScope, subscriptionId: string): Promise<JobSubscription | null>;

  /**
   * Lists all active subscriptions across learners for matching against newly published jobs.
   */
  listActiveSubscriptions(): Promise<readonly JobSubscription[]>;

  /**
   * Cancels any pending delivery intents referencing a withdrawn or invalid job.
   */
  cancelPendingIntentsForJob(jobId: string): Promise<number>;
}
