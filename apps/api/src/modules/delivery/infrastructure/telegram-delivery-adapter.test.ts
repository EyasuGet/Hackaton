import { describe, expect, it } from 'vitest';
import { TelegramDeliveryAdapter } from './telegram-delivery-adapter.ts';

function mockFetchResponse(data: unknown, status = 200): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
}

describe('TelegramDeliveryAdapter', () => {
  it('throws when initialized without bot token', () => {
    expect(() => new TelegramDeliveryAdapter({ botToken: '' })).toThrow(
      'Telegram bot token is required',
    );
  });

  it('sends message successfully when provider returns 200 ok', async () => {
    let capturedUrl = '';
    let capturedBody = '';

    const customFetch: typeof fetch = (input, init) => {
      capturedUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      capturedBody = typeof init?.body === 'string' ? init.body : '';
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: { message_id: 12345 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    };

    const adapter = new TelegramDeliveryAdapter({ botToken: 'mock-bot-token' }, customFetch);

    const result = await adapter.sendMessage({
      chatId: '987654321',
      text: 'Support reply notice',
    });

    expect(result).toEqual({ ok: true, messageId: 12345 });
    expect(capturedUrl).toBe('https://api.telegram.org/botmock-bot-token/sendMessage');
    expect(JSON.parse(capturedBody)).toEqual({
      chat_id: '987654321',
      text: 'Support reply notice',
    });
  });

  it('classifies 403 / 400 client error as permanent rejection', async () => {
    const customFetch = mockFetchResponse(
      {
        ok: false,
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      },
      403,
    );

    const adapter = new TelegramDeliveryAdapter({ botToken: 'mock-bot-token' }, customFetch);

    const result = await adapter.sendMessage({
      chatId: '987654321',
      text: 'Support reply notice',
    });

    expect(result).toEqual({
      ok: false,
      permanent: true,
      error: 'Forbidden: bot was blocked by the user',
    });
  });

  it('classifies 5xx server error as transient failure', async () => {
    const customFetch = mockFetchResponse(
      {
        ok: false,
        error_code: 502,
        description: 'Bad Gateway',
      },
      502,
    );

    const adapter = new TelegramDeliveryAdapter({ botToken: 'mock-bot-token' }, customFetch);

    const result = await adapter.sendMessage({
      chatId: '987654321',
      text: 'Support reply notice',
    });

    expect(result).toEqual({
      ok: false,
      permanent: false,
      error: 'Bad Gateway',
    });
  });

  it('handles timeout/abort as transient failure', async () => {
    const customFetch: typeof fetch = () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      return Promise.reject(abortError);
    };

    const adapter = new TelegramDeliveryAdapter({ botToken: 'mock-bot-token' }, customFetch);

    const result = await adapter.sendMessage({
      chatId: '987654321',
      text: 'Support reply notice',
    });

    expect(result).toEqual({
      ok: false,
      permanent: false,
      error: 'Telegram API request timed out',
    });
  });
});
