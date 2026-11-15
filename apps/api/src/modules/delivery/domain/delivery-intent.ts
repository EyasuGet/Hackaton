// What a delivery intent records and how long each part of it may be kept.
// Retention follows docs/retention.md: the content reference lives no longer
// than the content itself, and the non-content dedup record is bounded.
// Worker claim/lease lifecycle follows T3-014-B.
import { createHash } from 'node:crypto';

/** Provisional 30-day bound for non-content dedup records (docs/retention.md, open decision 5). */
export const DEDUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Default lease duration for claiming delivery intents: 30 seconds. */
export const DEFAULT_LEASE_DURATION_MS = 30 * 1000;

/** After this many attempts an intent is permanently failed without further dispatch. */
export const MAX_ATTEMPT_COUNT = 3;

/** Default and max batch size for bounded worker claims. */
export const DEFAULT_CLAIM_BATCH_SIZE = 10;
export const MAX_CLAIM_BATCH_SIZE = 100;

export type DeliveryIntentStatus =
  | 'pending'
  | 'leased'
  | 'completed'
  | 'failed'
  | 'uncertain'
  | 'cancelled';

export interface NewDeliveryIntent {
  /**
   * Identifies one logical delivery, for example `job-alert:<subscription>:<job version>`.
   * Only its digest is stored, so it may name records but must not contain message text.
   */
  readonly dedupKey: string;
  readonly recipientId: string;
  readonly channel: string;
  /** Opaque reference to the content; the worker resolves it at send time. */
  readonly contentRef: string;
  /** The referenced content's own expiry; the reference is never kept past it. */
  readonly contentExpiresAt: Date;
}

export type EnqueueOutcome =
  | { readonly status: 'enqueued'; readonly id: string }
  /** An intent with the same logical key already exists; nothing new was stored. */
  | { readonly status: 'duplicate' }
  /** The content had already expired, so there is nothing that may be delivered. */
  | { readonly status: 'content_expired' };

export interface ClaimOptions {
  readonly workerId: string;
  readonly now: Date;
  readonly batchSize?: number;
  readonly leaseDurationMs?: number;
}

export interface ClaimedDeliveryIntent {
  readonly id: string;
  readonly recipientId: string;
  readonly channel: string;
  readonly contentRef: string;
  readonly contentExpiresAt: Date;
  readonly attemptCount: number;
  readonly claimedBy: string;
  readonly claimedAt: Date;
  readonly leaseExpiresAt: Date;
}

export interface DeliveryIntentRecord {
  readonly id: string;
  readonly dedupDigest: string;
  readonly recipientId: string;
  readonly channel: string;
  readonly status: DeliveryIntentStatus;
  readonly contentRef: string | null;
  readonly contentExpiresAt: Date;
  readonly dedupExpiresAt: Date;
  readonly createdAt: Date;
  readonly claimedBy: string | null;
  readonly claimedAt: Date | null;
  readonly leaseExpiresAt: Date | null;
  readonly attemptCount: number;
  readonly completedAt: Date | null;
}

export type CompleteOutcome =
  | { readonly status: 'completed' }
  | { readonly status: 'lost_lease' }
  | { readonly status: 'not_found' };

export type ReleaseOutcome =
  | { readonly status: 'released' }
  | { readonly status: 'lost_lease' }
  | { readonly status: 'not_found' };

/** What a channel adapter reports back after attempting to send. */
export type DispatchOutcome =
  | { readonly status: 'sent' }
  | { readonly status: 'failed'; readonly reason?: string | undefined }
  | { readonly status: 'uncertain'; readonly reason?: string | undefined }
  | { readonly status: 'retry'; readonly reason?: string | undefined }
  | { readonly status: 'cancelled'; readonly reason?: string | undefined };

export type FailOutcome =
  | { readonly status: 'failed' }
  | { readonly status: 'lost_lease' }
  | { readonly status: 'not_found' };

export type MarkUncertainOutcome =
  | { readonly status: 'uncertain' }
  | { readonly status: 'lost_lease' }
  | { readonly status: 'not_found' };

export type CancelLeasedOutcome =
  | { readonly status: 'cancelled' }
  | { readonly status: 'lost_lease' }
  | { readonly status: 'not_found' };

export function dedupDigest(dedupKey: string): string {
  return createHash('sha256').update(dedupKey).digest('hex');
}

export function dedupExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + DEDUP_RETENTION_MS);
}
