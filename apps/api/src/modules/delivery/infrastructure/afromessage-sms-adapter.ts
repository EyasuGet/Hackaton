// Approved Ethiopian SMS adapter for AfroMessage (https://afromessage.com).
// Implements payload validation, E.164 normalization, GSM-7/UCS-2 segmentation checks,
// server-side authentication, provider status normalization, and safe failure handling.

import type { SmsAdapter } from '../application/ports/sms-adapter.ts';
import {
  type SendSmsRequest,
  type SendSmsResult,
  type SmsDeliveryStatus,
  type SmsStatusResult,
} from '../domain/sms-contract.ts';
import { validateEthiopianPhoneNumber } from '../domain/phone-number.ts';
import { analyzeSmsText, DEFAULT_MAX_SMS_SEGMENTS } from '../domain/sms-encoding.ts';

export interface AfroMessageConfig {
  /** Server-side API token for AfroMessage. Never returned or logged. */
  readonly apiToken: string;
  /** Base API URL. Defaults to 'https://api.afromessage.com'. */
  readonly baseUrl?: string;
  /** Approved sender identifier or name (e.g. 'Track3'). */
  readonly senderName?: string;
  /** System identifier / shortcode ID if subscribed. */
  readonly fromId?: string;
  /** Request timeout in milliseconds. Defaults to 5000ms. */
  readonly timeoutMs?: number;
  /** Maximum allowed segmentation parts. Defaults to 4. */
  readonly maxSegments?: number;
}

export type HttpFetch = typeof fetch;

/**
 * Normalizes raw AfroMessage status codes and text into domain delivery statuses.
 */
export function mapAfroMessageStatus(raw: string | undefined): SmsDeliveryStatus {
  if (!raw) return 'unknown';

  const normalized = raw.trim().toUpperCase();

  if (normalized === 'DELIVRD' || normalized === 'DELIVERED') {
    return 'delivered';
  }
  if (normalized === 'UNDELIV' || normalized === 'UNDELIVERED') {
    return 'undelivered';
  }
  if (normalized === 'EXPIRED') {
    return 'expired';
  }
  if (normalized === 'REJECTD' || normalized === 'REJECTED') {
    return 'rejected';
  }
  if (normalized === 'FAILED') {
    return 'failed';
  }
  if (
    normalized.startsWith('SEND IN PROGRESS') ||
    normalized === 'QUEUED' ||
    normalized === 'SENT' ||
    normalized === 'PROCESSING' ||
    normalized === 'ACCEPTED'
  ) {
    return 'queued';
  }

  return 'unknown';
}

export class AfroMessageSmsAdapter implements SmsAdapter {
  readonly providerName = 'AfroMessage';
  readonly #config: AfroMessageConfig;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: HttpFetch;

  constructor(config: AfroMessageConfig, customFetch?: HttpFetch) {
    if (!config.apiToken || !config.apiToken.trim()) {
      throw new Error('AfroMessage API token is required');
    }
    this.#config = config;
    this.#baseUrl = (config.baseUrl ?? 'https://api.afromessage.com').replace(/\/+$/, '');
    this.#timeoutMs = config.timeoutMs ?? 5000;
    this.#fetch = customFetch ?? fetch;
  }

  async send(request: SendSmsRequest): Promise<SendSmsResult> {
    // 1. Destination format and Ethiopian mobile range validation.
    const recipientCheck = validateEthiopianPhoneNumber(request.to);
    if (!recipientCheck.valid) {
      return {
        ok: false,
        permanent: true,
        status: 'rejected',
        error: recipientCheck.reason,
      };
    }

    // 2. Body length, encoding and segmentation bounds validation.
    const maxSegments = this.#config.maxSegments ?? DEFAULT_MAX_SMS_SEGMENTS;
    const textAnalysis = analyzeSmsText(request.message, maxSegments);
    if (textAnalysis.exceedsLimit) {
      return {
        ok: false,
        permanent: true,
        status: 'rejected',
        error: textAnalysis.rejectionReason ?? 'Message exceeds allowed size limits',
      };
    }

    // 3. Construct provider-specific payload without leaking internal state.
    const payload: Record<string, unknown> = {
      to: recipientCheck.normalized,
      message: request.message,
    };

    const sender = request.senderName ?? this.#config.senderName;
    if (sender) payload.sender = sender;
    if (this.#config.fromId) payload.from = this.#config.fromId;
    if (request.callbackUrl) payload.callback = request.callbackUrl;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    try {
      const response = await this.#fetch(`${this.#baseUrl}/api/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      // Handle gateway rate limiting (429) or temporary server errors (5xx) safely.
      if (response.status === 429) {
        return {
          ok: false,
          permanent: false,
          status: 'unknown',
          error: 'AfroMessage rate limit exceeded (HTTP 429)',
        };
      }

      if (response.status >= 500) {
        return {
          ok: false,
          permanent: false,
          status: 'unknown',
          error: `AfroMessage gateway error (HTTP ${response.status})`,
        };
      }

      // Handle client errors (400, 401, 403).
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          permanent: true,
          status: 'rejected',
          error: `AfroMessage authentication failed (HTTP ${response.status})`,
        };
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        return {
          ok: false,
          permanent: false,
          status: 'unknown',
          error: `Failed to parse AfroMessage JSON response (HTTP ${response.status})`,
        };
      }

      const body = data as {
        acknowledge?: string;
        response?: {
          status?: string;
          message_id?: string;
          errors?: string[];
        };
      };

      if (body.acknowledge === 'success' && body.response?.message_id) {
        const rawStatus = body.response.status ?? 'Send in progress...';
        return {
          ok: true,
          messageId: body.response.message_id,
          status: mapAfroMessageStatus(rawStatus),
          providerStatus: rawStatus,
          recipient: recipientCheck.normalized,
          encoding: textAnalysis.encoding,
          segments: textAnalysis.segmentCount,
        };
      }

      // Error response from provider
      const errors = Array.isArray(body.response?.errors) ? body.response.errors : [];
      const errorMessage =
        errors.length > 0 ? errors.join('; ') : 'AfroMessage rejected delivery request';

      return {
        ok: false,
        permanent: true,
        status: 'rejected',
        error: errorMessage,
        providerErrors: errors,
      };
    } catch (error) {
      // Network interruption, DNS failure, or client timeout.
      // Retain 'unknown' outcome so reconciliation / status check can inspect the provider.
      const isAbort =
        error instanceof Error &&
        (error.name === 'AbortError' || error.message.includes('aborted'));
      return {
        ok: false,
        permanent: false,
        status: 'unknown',
        error: isAbort ? 'AfroMessage dispatch timed out' : 'AfroMessage dispatch network error',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async checkStatus(messageId: string): Promise<SmsStatusResult> {
    if (!messageId || !messageId.trim()) {
      return {
        messageId: '',
        status: 'unknown',
        providerStatus: 'missing_id',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    try {
      const url = `${this.#baseUrl}/api/status?id=${encodeURIComponent(messageId.trim())}`;
      const response = await this.#fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.#config.apiToken}`,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          messageId,
          status: 'unknown',
          providerStatus: `http_error_${response.status}`,
        };
      }

      const body = (await response.json()) as {
        acknowledge?: string;
        response?: {
          status?: string;
          message_id?: string;
          errors?: string[];
        };
      };

      if (body.acknowledge === 'success' && body.response?.status) {
        const rawStatus = body.response.status;
        return {
          messageId,
          status: mapAfroMessageStatus(rawStatus),
          providerStatus: rawStatus,
          rawResponse: body,
        };
      }

      // If acknowledge is 'error' (e.g. message not found)
      const errorMsg = body.response?.errors?.[0] ?? 'status_query_error';
      return {
        messageId,
        status: 'unknown',
        providerStatus: errorMsg,
        rawResponse: body,
      };
    } catch {
      return {
        messageId,
        status: 'unknown',
        providerStatus: 'network_error',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
