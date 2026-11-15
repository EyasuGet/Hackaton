// Application service for delivering SMS job alerts (T3-021-B).
// Coordinates worker claims, pre-send eligibility rechecks (subscription, phone verification,
// job status, and suppression registry), bounded alert formatting, and provider dispatch.
// Dispatches occur strictly outside database transactions.

import type pg from 'pg';
import type { ClaimedDeliveryIntent } from '../domain/delivery-intent.ts';
import type { ProcessAction } from './delivery-worker.ts';
import type { SmsAdapter } from './ports/sms-adapter.ts';
import { formatSmsJobAlert, parseJobAlertContentRef } from '../domain/sms-job-alert.ts';
import type { SmsEncoding } from '../domain/sms-encoding.ts';
import type { InMemorySmsSuppressionRegistry } from '../infrastructure/afromessage-sms-adapter.ts';

export interface SmsJobAlertNotifierOptions {
  readonly pool: pg.Pool;
  readonly smsAdapter: SmsAdapter;
  /** Base URL for job links in alerts (defaults to 'https://digitalbridge.et'). */
  readonly baseUrl?: string | undefined;
  /** Maximum number of retry attempts for transient errors before exhaustion (defaults to 3). */
  readonly maxAttempts?: number | undefined;
  /** Preferred or forced language override ('en' | 'am'). When omitted, auto-detects from job title. */
  readonly language?: 'en' | 'am' | undefined;
}

export type SmsJobAlertDispatchOutcome =
  | {
      readonly status: 'delivered';
      readonly messageId: string;
      readonly recipient: string;
      readonly encoding: SmsEncoding;
      readonly segments: number;
    }
  | {
      readonly status: 'suppressed';
      readonly reason: string;
    }
  | {
      readonly status: 'released';
      readonly reason: string;
      readonly attemptCount: number;
    }
  | {
      readonly status: 'exhausted';
      readonly reason: string;
      readonly attemptCount: number;
    }
  | {
      readonly status: 'ignored';
      readonly reason: string;
    };

export class SmsJobAlertNotifier {
  readonly #pool: pg.Pool;
  readonly #smsAdapter: SmsAdapter;
  readonly #baseUrl: string;
  readonly #maxAttempts: number;
  readonly #language: 'en' | 'am' | undefined;

  constructor(options: SmsJobAlertNotifierOptions) {
    this.#pool = options.pool;
    this.#smsAdapter = options.smsAdapter;
    this.#baseUrl = (options.baseUrl ?? 'https://digitalbridge.et').replace(/\/+$/, '');
    this.#maxAttempts = options.maxAttempts ?? 3;
    this.#language = options.language;
  }

  /**
   * Processes a single claimed delivery intent from the DeliveryWorker.
   * Maps detailed dispatch outcomes to the worker's ProcessAction:
   * - 'delivered', 'suppressed', 'ignored', or 'exhausted' -> 'complete'
   * - 'released' (retryable transient error within retry budget) -> 'release'
   */
  async processClaimedIntent(
    intent: ClaimedDeliveryIntent,
    now: Date = new Date(),
  ): Promise<ProcessAction> {
    const outcome = await this.dispatch(intent, now);
    if (
      outcome.status === 'delivered' ||
      outcome.status === 'suppressed' ||
      outcome.status === 'ignored' ||
      outcome.status === 'exhausted'
    ) {
      return 'complete';
    }
    return 'release';
  }

  /**
   * Executes full dispatch lifecycle with pre-send eligibility and consent checks.
   * Dispatches network calls completely outside database transactions.
   */
  async dispatch(
    intent: ClaimedDeliveryIntent,
    now: Date = new Date(),
  ): Promise<SmsJobAlertDispatchOutcome> {
    // 1. Channel guard: only handle 'sms' channel intents.
    if (intent.channel.toLowerCase() !== 'sms') {
      return { status: 'ignored', reason: 'unsupported_channel' };
    }

    // 2. Content reference validation: parse job ID and version.
    const parsedRef = parseJobAlertContentRef(intent.contentRef);
    if (!parsedRef) {
      return { status: 'ignored', reason: 'invalid_content_ref' };
    }

    // 3. Outbox expiry check: never dispatch expired content references.
    if (intent.contentExpiresAt.getTime() <= now.getTime()) {
      return { status: 'suppressed', reason: 'content_expired' };
    }

    // 4. Pre-send database eligibility rechecks:
    // a) Verify active SMS subscription and verified phone number.
    const subResult = await this.#pool.query<{
      subscription_id: string;
      subscription_active: boolean;
      unsubscribed_at: Date | null;
      destination: string | null;
      verified_phone: string | null;
    }>(
      `SELECT
         js.id AS subscription_id,
         js.active AS subscription_active,
         js.unsubscribed_at,
         jac.destination,
         vp.phone_number AS verified_phone
       FROM job_subscriptions js
       LEFT JOIN job_alert_contacts jac
         ON jac.id = js.contact_id AND jac.channel = 'sms'
       LEFT JOIN learner_verified_phones vp
         ON vp.learner_id = js.learner_id AND vp.phone_number = jac.destination
      WHERE js.learner_id = $1 AND js.channel = 'sms' AND js.active = true
      ORDER BY js.created_at DESC
      LIMIT 1`,
      [intent.recipientId],
    );

    const subRow = subResult.rows[0];
    if (!subRow || !subRow.subscription_active || subRow.unsubscribed_at !== null) {
      return { status: 'suppressed', reason: 'unsubscribed_or_inactive' };
    }

    const destination = subRow.destination;
    if (!destination || !subRow.verified_phone) {
      return { status: 'suppressed', reason: 'phone_unverified' };
    }

    // b) Verify job validity: must exist, not be withdrawn, and not be expired.
    const jobResult = await this.#pool.query<{
      id: string;
      withdrawn: boolean;
      expires_at: Date;
      title: string;
      organization: string;
      category: string;
      location: string;
      description: string;
      source_url: string;
    }>(
      `SELECT
         j.id,
         jv.withdrawn,
         jv.expires_at,
         jv.title,
         jv.organization,
         jv.category,
         jv.location,
         jv.description,
         jv.source_url
       FROM jobs j
       JOIN job_versions jv
         ON jv.job_id = j.id AND jv.version = $2
      WHERE j.id = $1
      LIMIT 1`,
      [parsedRef.jobId, parsedRef.version],
    );

    const jobRow = jobResult.rows[0];
    if (!jobRow || jobRow.withdrawn || new Date(jobRow.expires_at).getTime() <= now.getTime()) {
      return { status: 'suppressed', reason: 'job_withdrawn_or_expired' };
    }

    // 5. Pre-network opt-out suppression check.
    const suppressionRegistry = (
      this.#smsAdapter as unknown as { suppressionRegistry?: InMemorySmsSuppressionRegistry }
    ).suppressionRegistry;

    if (suppressionRegistry) {
      const isSuppressed = await Promise.resolve(suppressionRegistry.isSuppressed(destination));
      if (isSuppressed) {
        return { status: 'suppressed', reason: 'opted_out' };
      }
    }

    // 6. Format SMS job alert payload with bounded Unicode and opt-out instructions.
    const formatted = formatSmsJobAlert(
      {
        id: jobRow.id,
        title: jobRow.title,
        organization: jobRow.organization,
        location: jobRow.location,
        sourceUrl: jobRow.source_url,
      },
      {
        baseUrl: this.#baseUrl,
        language: this.#language,
        maxSegments: 2,
      },
    );

    // 7. Dispatch through approved SMS adapter outside database transactions.
    const sendResult = await this.#smsAdapter.send({
      to: destination,
      message: formatted.message,
      idempotencyKey: intent.id,
    });

    // 8. Map provider outcome to delivery state.
    if (sendResult.ok) {
      return {
        status: 'delivered',
        messageId: sendResult.messageId,
        recipient: sendResult.recipient,
        encoding: sendResult.encoding,
        segments: sendResult.segments,
      };
    }

    // Permanent provider rejection (e.g. invalid phone, operator block, suppression):
    if (sendResult.permanent) {
      return { status: 'suppressed', reason: sendResult.error };
    }

    // Transient failure (network error, timeout, HTTP 429 rate limit):
    if (intent.attemptCount >= this.#maxAttempts) {
      return {
        status: 'exhausted',
        reason: sendResult.error,
        attemptCount: intent.attemptCount,
      };
    }

    return {
      status: 'released',
      reason: sendResult.error,
      attemptCount: intent.attemptCount,
    };
  }
}
