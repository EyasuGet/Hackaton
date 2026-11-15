// Application use case for matching newly published jobs against active subscriptions (T3-020-A).
// Deterministically identifies eligible learner subscriptions and enqueues transactional
// delivery intents. Deduplication ensures repeated publications yield at most one intent.
import type pg from 'pg';
import type { EnqueueOutcome } from '../../delivery/domain/delivery-intent.ts';
import type { PostgresDeliveryIntents } from '../../delivery/infrastructure/postgres-delivery-intents.ts';
import { jobAlertDedupKey, matchJobSubscription } from '../domain/job-preferences.ts';
import type { Job } from '../domain/job.ts';
import type { JobPreferencesRepository } from './ports/job-preferences-repository.ts';

export interface JobMatchOutcomeDetail {
  readonly subscriptionId: string;
  readonly learnerId: string;
  readonly channel: string;
  readonly outcome: EnqueueOutcome;
}

export interface JobMatchOutcome {
  readonly matched: number;
  readonly enqueued: number;
  readonly duplicates: number;
  readonly skippedReason?: 'ineligible_job';
  readonly details: readonly JobMatchOutcomeDetail[];
}

export class JobMatching {
  readonly #repository: JobPreferencesRepository;
  readonly #deliveryIntents: PostgresDeliveryIntents;
  readonly #pool: pg.Pool;

  constructor(
    repository: JobPreferencesRepository,
    deliveryIntents: PostgresDeliveryIntents,
    pool: pg.Pool,
  ) {
    this.#repository = repository;
    this.#deliveryIntents = deliveryIntents;
    this.#pool = pool;
  }

  /**
   * Matches a job publication against active subscriptions and creates delivery intents.
   * Runs atomically inside a database transaction.
   * If the job is withdrawn or expired, no alerts are enqueued, and any pending
   * intents for a withdrawn job are cancelled.
   */
  async matchAndEnqueue(
    job: Job,
    now: Date = new Date(),
    clientOrPool?: pg.ClientBase,
  ): Promise<JobMatchOutcome> {
    if (job.withdrawn) {
      await this.#repository.cancelPendingIntentsForJob(job.id);
      return {
        matched: 0,
        enqueued: 0,
        duplicates: 0,
        skippedReason: 'ineligible_job',
        details: [],
      };
    }

    if (job.expiresAt.getTime() <= now.getTime()) {
      return {
        matched: 0,
        enqueued: 0,
        duplicates: 0,
        skippedReason: 'ineligible_job',
        details: [],
      };
    }

    const activeSubscriptions = await this.#repository.listActiveSubscriptions();
    const matchingSubscriptions = activeSubscriptions.filter((sub) =>
      matchJobSubscription(sub, job, now),
    );

    if (matchingSubscriptions.length === 0) {
      return {
        matched: 0,
        enqueued: 0,
        duplicates: 0,
        details: [],
      };
    }

    const runInTransaction = async (client: pg.ClientBase): Promise<JobMatchOutcome> => {
      let enqueuedCount = 0;
      let duplicateCount = 0;
      const details: JobMatchOutcomeDetail[] = [];

      for (const sub of matchingSubscriptions) {
        const dedupKey = jobAlertDedupKey(sub.learnerId, job.id, sub.channel);
        const outcome = await this.#deliveryIntents.enqueue(
          client,
          {
            dedupKey,
            recipientId: sub.learnerId,
            channel: sub.channel,
            contentRef: `job:${job.id}:${job.version}`,
            contentExpiresAt: job.expiresAt,
          },
          now,
        );

        if (outcome.status === 'enqueued') {
          enqueuedCount++;
        } else if (outcome.status === 'duplicate') {
          duplicateCount++;
        }

        details.push({
          subscriptionId: sub.id,
          learnerId: sub.learnerId,
          channel: sub.channel,
          outcome,
        });
      }

      return {
        matched: matchingSubscriptions.length,
        enqueued: enqueuedCount,
        duplicates: duplicateCount,
        details,
      };
    };

    if (clientOrPool) {
      return runInTransaction(clientOrPool);
    }

    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await runInTransaction(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
