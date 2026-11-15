// Outbound HTTP Telegram client adapter using the official Telegram Bot API (T3-020-B).
// Maps HTTP and network responses into deterministic delivery statuses:
// 200 -> sent
// 400/403/404 -> permanent failure
// 429/5xx -> retryable
// timeout/fetch abort -> uncertain outcome

import type {
  TelegramAnswerCallbackParams,
  TelegramClient,
  TelegramSendMessageParams,
  TelegramSendResult,
} from '../application/ports/telegram-client.ts';

export interface HttpTelegramClientOptions {
  readonly botToken?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly fetchFn?: typeof fetch | undefined;
}

export class HttpTelegramClient implements TelegramClient {
  readonly #botToken?: string | undefined;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetchFn: typeof fetch;

  constructor(options: HttpTelegramClientOptions = {}) {
    this.#botToken = options.botToken;
    this.#baseUrl = (options.baseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs ?? 5000;
    this.#fetchFn = options.fetchFn ?? fetch;
  }

  async sendMessage(params: TelegramSendMessageParams): Promise<TelegramSendResult> {
    if (!this.#botToken) {
      return {
        ok: false,
        error: 'Telegram botToken not configured',
        permanent: true,
        retryable: false,
        uncertain: false,
      };
    }

    const url = `${this.#baseUrl}/bot${this.#botToken}/sendMessage`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    try {
      const response = await this.#fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: params.chatId,
          text: params.text,
          ...(params.replyMarkup ? { reply_markup: params.replyMarkup } : {}),
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        const body = (await response.json()) as { ok?: boolean; result?: { message_id?: number } };
        if (body.ok && typeof body.result?.message_id === 'number') {
          return { ok: true, messageId: body.result.message_id };
        }
        return {
          ok: false,
          error: 'Unexpected Telegram API response format',
          permanent: false,
          retryable: false,
          uncertain: true,
        };
      }

      const status = response.status;
      let description = `HTTP ${status}`;
      try {
        const errorBody = (await response.json()) as { description?: string };
        if (errorBody.description) description = errorBody.description;
      } catch {
        // Fallback to HTTP status if body is not JSON
      }

      if (status === 400 || status === 403 || status === 404) {
        return {
          ok: false,
          error: description,
          permanent: true,
          retryable: false,
          uncertain: false,
        };
      }

      if (status === 429 || (status >= 500 && status <= 599)) {
        return {
          ok: false,
          error: description,
          permanent: false,
          retryable: true,
          uncertain: false,
        };
      }

      return {
        ok: false,
        error: description,
        permanent: false,
        retryable: false,
        uncertain: true,
      };
    } catch (err) {
      clearTimeout(timer);
      const isAbort =
        err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
      return {
        ok: false,
        error: isAbort
          ? 'Telegram dispatch timed out'
          : err instanceof Error
            ? err.message
            : 'Unknown network error',
        permanent: false,
        retryable: false,
        uncertain: true,
      };
    }
  }

  async answerCallbackQuery(params: TelegramAnswerCallbackParams): Promise<boolean> {
    if (!this.#botToken) return false;
    const url = `${this.#baseUrl}/bot${this.#botToken}/answerCallbackQuery`;
    try {
      const response = await this.#fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: params.callbackQueryId,
          ...(params.text ? { text: params.text } : {}),
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
