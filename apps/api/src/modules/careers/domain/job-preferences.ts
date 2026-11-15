// Learner-owned job alert preferences and deterministic matching domain logic (T3-020-A).
// Subscriptions match newly published active jobs based strictly on explicit category
// and location filters; no sensitive learner profile or disability inference is performed.
import type { Job } from './job.ts';

export interface JobAlertContact {
  readonly id: string;
  readonly learnerId: string;
  readonly channel: string;
  readonly destination: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface JobSubscription {
  readonly id: string;
  readonly learnerId: string;
  readonly channel: string;
  readonly destination: string;
  readonly categories: readonly string[];
  readonly locations: readonly string[];
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly unsubscribedAt: Date | null;
}

export interface CreateSubscriptionInput {
  readonly channel: string;
  readonly destination: string;
  readonly categories?: readonly string[];
  readonly locations?: readonly string[];
}

/**
 * Builds the canonical deduplication key for a job alert intent.
 * Follows the pattern: `job-alert:<learnerId>:<jobId>:<channel>`.
 * A repeated publication of the same job yields the same key, ensuring at most
 * one logical intent per learner/job/channel combination.
 */
export function jobAlertDedupKey(learnerId: string, jobId: string, channel: string): string {
  return `job-alert:${learnerId}:${jobId}:${channel.toLowerCase()}`;
}

/**
 * Determines whether a job matches an explicit active subscription deterministically.
 * Only active subscriptions match. Expired or withdrawn jobs never match.
 * Filters are evaluated strictly:
 * - Empty categories array means any category matches.
 * - Empty locations array means any location matches.
 * - Non-empty filters require an exact (case-insensitive) match.
 * No learner disability, accommodation, or sensitive profile inference is used.
 */
export function matchJobSubscription(
  subscription: Pick<JobSubscription, 'active' | 'categories' | 'locations'>,
  job: Pick<Job, 'category' | 'location' | 'withdrawn' | 'expiresAt'>,
  asOf: Date = new Date(),
): boolean {
  if (!subscription.active) return false;
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
