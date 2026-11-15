// Approved Ethiopian SMS adapter for AfroMessage (https://afromessage.com).
// Implements payload validation, E.164 normalization, GSM-7/UCS-2 segmentation checks,
// server-side authentication, provider status normalization, and safe failure handling.

import type { SmsAdapter } from '../application/ports/sms-adapter.ts';
import {
  isTerminalSmsStatus,
  type SendSmsRequest,
  type SendSmsResult,
  type SmsDeliveryStatus,
  type SmsStatusResult,
} from '../domain/sms-contract.ts';
import { validateEthiopianPhoneNumber } from '../domain/phone-number.ts';
import { analyzeSmsText, DEFAULT_MAX_SMS_SEGMENTS } from '../domain/sms-encoding.ts';

/** Standard opt-out keywords recognized across English and Amharic Ge'ez. */
export const AFROMESSAGE_OPT_OUT_KEYWORDS = Object.freeze([
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
  'አቁም',
  'ተው',
] as const);

export type SmsOptOutKeyword = (typeof AFROMESSAGE_OPT_OUT_KEYWORDS)[number];

/**
 * Checks whether an incoming message text contains a recognized opt-out keyword.
 * Handles whitespace, newlines, and case-insensitivity.
 */
export function checkSmsOptOut(message: string | undefined): {
  readonly isOptOut: boolean;
  readonly keyword?: string;
} {
  if (!message || typeof message !== 'string') {
    return { isOptOut: false };
  }

  const cleaned = message.trim().toUpperCase();
  for (const kw of AFROMESSAGE_OPT_OUT_KEYWORDS) {
    if (cleaned === kw || cleaned.startsWith(`${kw} `) || cleaned.startsWith(`${kw}\n`)) {
      return { isOptOut: true, keyword: kw };
    }
  }

  return { isOptOut: false };
}

export function isSmsOptOutKeyword(message: string | undefined): boolean {
  return checkSmsOptOut(message).isOptOut;
}

export interface AfroMessageDlrResult {
  readonly messageId: string | undefined;
  readonly status: SmsDeliveryStatus;
  readonly providerStatus: string;
  readonly recipient?: string;
  readonly timestamp?: Date;
  readonly errors?: readonly string[];
  readonly isTerminal: boolean;
}

export function parseAfroMessageDlrWebhook(payload: unknown): AfroMessageDlrResult {
  if (!payload || typeof payload !== 'object') {
    return {
      messageId: undefined,
      status: 'unknown',
      providerStatus: 'invalid_payload',
      isTerminal: false,
    };
  }

  const record = payload as Record<string, unknown>;
  const responseObj =
    record.response && typeof record.response === 'object'
      ? (record.response as Record<string, unknown>)
      : record;

  const rawStatus =
    typeof responseObj.status === 'string'
      ? responseObj.status
      : typeof record.status === 'string'
        ? record.status
        : undefined;

  const messageId =
    typeof responseObj.message_id === 'string'
      ? responseObj.message_id
      : typeof responseObj.messageId === 'string'
        ? responseObj.messageId
        : typeof record.message_id === 'string'
          ? record.message_id
          : typeof record.messageId === 'string'
            ? record.messageId
            : undefined;

  const to =
    typeof responseObj.to === 'string'
      ? responseObj.to
      : typeof record.to === 'string'
        ? record.to
        : undefined;

  const timestampStr =
    typeof responseObj.timestamp === 'string'
      ? responseObj.timestamp
      : typeof record.timestamp === 'string'
        ? record.timestamp
        : undefined;

  let timestamp: Date | undefined;
  if (timestampStr) {
    const parsed = new Date(timestampStr);
    if (!isNaN(parsed.getTime())) {
      timestamp = parsed;
    }
  }

  const rawErrors = Array.isArray(responseObj.errors)
    ? responseObj.errors
    : Array.isArray(record.errors)
      ? record.errors
      : undefined;
  const errors = rawErrors?.filter((e): e is string => typeof e === 'string');

  const status = mapAfroMessageStatus(rawStatus);

  return {
    messageId,
    status,
    providerStatus: rawStatus ?? 'unknown',
    ...(to ? { recipient: to } : {}),
    ...(timestamp ? { timestamp } : {}),
    ...(errors && errors.length > 0 ? { errors } : {}),
    isTerminal: isTerminalSmsStatus(status),
  };
}

export interface AfroMessageInboundResult {
  readonly sender: string | undefined;
  readonly recipient?: string;
  readonly message: string;
  readonly isOptOut: boolean;
  readonly optOutKeyword?: string;
  readonly messageId?: string;
  readonly timestamp?: Date;
}

export function parseAfroMessageInboundWebhook(payload: unknown): AfroMessageInboundResult {
  if (!payload || typeof payload !== 'object') {
    return {
      sender: undefined,
      message: '',
      isOptOut: false,
    };
  }

  const record = payload as Record<string, unknown>;
  const responseObj =
    record.response && typeof record.response === 'object'
      ? (record.response as Record<string, unknown>)
      : record;

  const sender =
    typeof responseObj.from === 'string'
      ? responseObj.from
      : typeof responseObj.phone === 'string'
        ? responseObj.phone
        : typeof record.from === 'string'
          ? record.from
          : typeof record.phone === 'string'
            ? record.phone
            : undefined;

  const recipient =
    typeof responseObj.to === 'string'
      ? responseObj.to
      : typeof record.to === 'string'
        ? record.to
        : undefined;

  const rawMessage =
    typeof responseObj.message === 'string'
      ? responseObj.message
      : typeof responseObj.text === 'string'
        ? responseObj.text
        : typeof record.message === 'string'
          ? record.message
          : typeof record.keyword === 'string'
            ? record.keyword
            : '';

  const messageId =
    typeof responseObj.message_id === 'string'
      ? responseObj.message_id
      : typeof record.message_id === 'string'
        ? record.message_id
        : undefined;

  const timestampStr =
    typeof responseObj.timestamp === 'string'
      ? responseObj.timestamp
      : typeof record.timestamp === 'string'
        ? record.timestamp
        : undefined;

  let timestamp: Date | undefined;
  if (timestampStr) {
    const parsed = new Date(timestampStr);
    if (!isNaN(parsed.getTime())) {
      timestamp = parsed;
    }
  }

  const { isOptOut, keyword } = checkSmsOptOut(rawMessage);

  return {
    sender,
    ...(recipient ? { recipient } : {}),
    message: rawMessage,
    isOptOut,
    ...(keyword ? { optOutKeyword: keyword } : {}),
    ...(messageId ? { messageId } : {}),
    ...(timestamp ? { timestamp } : {}),
  };
}

export interface SuppressionRecord {
  readonly phone: string;
  readonly reason: string;
  readonly suppressedAt: Date;
}

export interface SmsSuppressionRegistry {
  isSuppressed(phoneNumber: string): boolean | Promise<boolean>;
  suppress(phoneNumber: string, reason?: string): void | Promise<void>;
  unsuppress(phoneNumber: string): void | Promise<void>;
  getRecord(
    phoneNumber: string,
  ): SuppressionRecord | undefined | Promise<SuppressionRecord | undefined>;
}

export class InMemorySmsSuppressionRegistry implements SmsSuppressionRegistry {
  readonly #suppressed = new Map<string, SuppressionRecord>();

  #normalize(phone: string): string {
    const validated = validateEthiopianPhoneNumber(phone);
    return validated.valid ? validated.normalized : phone.trim();
  }

  isSuppressed(phoneNumber: string): boolean {
    return this.#suppressed.has(this.#normalize(phoneNumber));
  }

  suppress(phoneNumber: string, reason = 'Opt-out request'): void {
    const normalized = this.#normalize(phoneNumber);
    this.#suppressed.set(normalized, {
      phone: normalized,
      reason,
      suppressedAt: new Date(),
    });
  }

  unsuppress(phoneNumber: string): void {
    this.#suppressed.delete(this.#normalize(phoneNumber));
  }

  getRecord(phoneNumber: string): SuppressionRecord | undefined {
    return this.#suppressed.get(this.#normalize(phoneNumber));
  }

  clear(): void {
    this.#suppressed.clear();
  }
}

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
  /** Optional registry to check and record opted-out numbers for pre-network suppression. */
  readonly suppressionRegistry?: SmsSuppressionRegistry;
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
  readonly #suppressionRegistry: SmsSuppressionRegistry | undefined;

  constructor(config: AfroMessageConfig, customFetch?: HttpFetch) {
    if (!config.apiToken || !config.apiToken.trim()) {
      throw new Error('AfroMessage API token is required');
    }
    this.#config = config;
    this.#baseUrl = (config.baseUrl ?? 'https://api.afromessage.com').replace(/\/+$/, '');
    this.#timeoutMs = config.timeoutMs ?? 5000;
    this.#fetch = customFetch ?? fetch;
    this.#suppressionRegistry = config.suppressionRegistry;
  }

  get suppressionRegistry(): SmsSuppressionRegistry | undefined {
    return this.#suppressionRegistry;
  }

  handleDlrWebhook(payload: unknown): AfroMessageDlrResult {
    return parseAfroMessageDlrWebhook(payload);
  }

  async handleInboundWebhook(payload: unknown): Promise<AfroMessageInboundResult> {
    const parsed = parseAfroMessageInboundWebhook(payload);
    if (parsed.isOptOut && parsed.sender && this.#suppressionRegistry) {
      await this.#suppressionRegistry.suppress(
        parsed.sender,
        parsed.optOutKeyword ? `Opt-out keyword: ${parsed.optOutKeyword}` : 'Inbound opt-out',
      );
    }
    return parsed;
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

    // 2. Opt-out suppression check (pre-network protection).
    if (this.#suppressionRegistry) {
      const suppressed = await this.#suppressionRegistry.isSuppressed(recipientCheck.normalized);
      if (suppressed) {
        return {
          ok: false,
          permanent: true,
          status: 'rejected',
          error: 'Recipient has opted out of SMS alerts (message suppressed)',
        };
      }
    }

    // 3. Body length, encoding and segmentation bounds validation.
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

    // 4. Construct provider-specific payload without leaking internal state.
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
