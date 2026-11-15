// Provider-neutral SMS contract definitions and status semantics.
// Unifies provider-specific states (e.g. AfroMessage DELIVRD, UNDELIV, REJECTD)
// into deterministic delivery domain outcomes.

import type { SmsEncoding } from './sms-encoding.ts';

/**
 * Normalized SMS delivery states.
 * Distinguishes initial gateway acceptance ('queued') from confirmed handset delivery ('delivered').
 */
export type SmsDeliveryStatus =
  /** Provider gateway accepted the message; dispatch to mobile carrier is in progress. */
  | 'queued'
  /** Mobile carrier confirmed handset receipt. */
  | 'delivered'
  /** Mobile carrier confirmed failure to reach handset (e.g. inactive number). */
  | 'undelivered'
  /** Message validity expired at telecom gateway before delivery. */
  | 'expired'
  /** Gateway or operator rejected message (e.g. unverified sender, blocked recipient). */
  | 'rejected'
  /** Gateway internal error or terminal transmission failure. */
  | 'failed'
  /** In-flight, network timeout, rate limit, or unconfirmed outcome requiring reconciliation. */
  | 'unknown';

export interface SendSmsRequest {
  /** Recipient phone number in Ethiopian national or international format. */
  readonly to: string;
  /** SMS message content (English, Amharic Ge'ez, or mixed). */
  readonly message: string;
  /** Optional client idempotency key or correlation ID. */
  readonly idempotencyKey?: string | undefined;
  /** Optional approved sender name (defaults to provider configuration). */
  readonly senderName?: string | undefined;
  /** Optional callback URL for asynchronous delivery status webhooks. */
  readonly callbackUrl?: string | undefined;
}

export type SendSmsResult =
  | {
      readonly ok: true;
      /** Unique message ID issued by the SMS provider gateway. */
      readonly messageId: string;
      /** Normalized delivery status (typically 'queued' on dispatch). */
      readonly status: SmsDeliveryStatus;
      /** Raw provider status string for auditing and reconciliation. */
      readonly providerStatus: string;
      /** Normalized destination phone number in E.164 (+251...). */
      readonly recipient: string;
      /** Detected encoding format ('GSM-7' | 'UCS-2'). */
      readonly encoding: SmsEncoding;
      /** Number of SMS segments required. */
      readonly segments: number;
    }
  | {
      readonly ok: false;
      /** Actionable, sanitized error message (never leaks secrets or API tokens). */
      readonly error: string;
      /** True if resending with the same payload cannot succeed. */
      readonly permanent: boolean;
      /** Normalized status representing the failure. */
      readonly status: 'rejected' | 'failed' | 'unknown';
      /** Raw provider errors array if provided by the gateway. */
      readonly providerErrors?: readonly string[] | undefined;
    };

export interface SmsStatusResult {
  /** The message ID being checked. */
  readonly messageId: string;
  /** Normalized delivery status. */
  readonly status: SmsDeliveryStatus;
  /** Raw provider status string. */
  readonly providerStatus: string;
  /** Raw response body preserved for auditing. */
  readonly rawResponse?: unknown;
}

/**
 * Returns true if the status represents a final, immutable delivery outcome.
 */
export function isTerminalSmsStatus(status: SmsDeliveryStatus): boolean {
  return (
    status === 'delivered' ||
    status === 'undelivered' ||
    status === 'expired' ||
    status === 'rejected' ||
    status === 'failed'
  );
}
