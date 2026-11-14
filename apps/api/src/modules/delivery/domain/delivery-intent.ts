// What a delivery intent records and how long each part of it may be kept.
// Retention follows docs/retention.md: the content reference lives no longer
// than the content itself, and the non-content dedup record is bounded.
import { createHash } from 'node:crypto';

/** Provisional 30-day bound for non-content dedup records (docs/retention.md, open decision 5). */
export const DEDUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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

export function dedupDigest(dedupKey: string): string {
  return createHash('sha256').update(dedupKey).digest('hex');
}

export function dedupExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + DEDUP_RETENTION_MS);
}
