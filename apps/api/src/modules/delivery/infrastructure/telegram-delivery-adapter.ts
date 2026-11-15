// Adapter for sending outbound messages via Telegram Bot API (T3-017-C).
// Implements payload structuring, response code normalization, error classification,
// and safe failure handling without leaking tokens.

export interface TelegramDeliveryAdapterConfig {
  /** Server-side Telegram Bot API token. Never logged or returned. */
  readonly botToken: string;
  /** Base Telegram API URL. Defaults to 'https://api.telegram.org'. */
  readonly apiBaseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 5000ms. */
  readonly timeoutMs?: number;
}

export interface SendTelegramMessageParams {
  readonly chatId: string | number;
  readonly text: string;
}

export type TelegramSendResult =
  | { readonly ok: true; readonly messageId: number }
  | { readonly ok: false; readonly permanent: boolean; readonly error: string };

export type HttpFetch = typeof fetch;

export class TelegramDeliveryAdapter {
  readonly #botToken: string;
  readonly #apiBaseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: HttpFetch;

  constructor(config: TelegramDeliveryAdapterConfig, customFetch?: HttpFetch) {
    if (!config.botToken || !config.botToken.trim()) {
      throw new Error('Telegram bot token is required');
    }
    this.#botToken = config.botToken.trim();
    this.#apiBaseUrl = (config.apiBaseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '');
    this.#timeoutMs = config.timeoutMs ?? 5000;
    this.#fetch = customFetch ?? fetch;
  }

  async sendMessage(params: SendTelegramMessageParams): Promise<TelegramSendResult> {
    const chatId = String(params.chatId).trim();
    if (!chatId) {
      return { ok: false, permanent: true, error: 'Recipient chat ID is required' };
    }

    if (!params.text || !params.text.trim()) {
      return { ok: false, permanent: true, error: 'Message text cannot be empty' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    try {
      const url = `${this.#apiBaseUrl}/bot${this.#botToken}/sendMessage`;
      const response = await this.#fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: params.text,
        }),
        signal: controller.signal,
      });

      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: { message_id?: number };
        description?: string;
        error_code?: number;
      };

      if (response.ok && body.ok) {
        return {
          ok: true,
          messageId: body.result?.message_id ?? 0,
        };
      }

      // HTTP 400 or 403 indicates permanent rejection (user blocked bot, chat not found, etc.)
      const isPermanent = response.status === 400 || response.status === 403;
      return {
        ok: false,
        permanent: isPermanent,
        error: body.description ?? `Telegram API error (HTTP ${response.status})`,
      };
    } catch (error: unknown) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      return {
        ok: false,
        permanent: false,
        error: isAbort
          ? 'Telegram API request timed out'
          : error instanceof Error
            ? error.message
            : 'Unknown error',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
