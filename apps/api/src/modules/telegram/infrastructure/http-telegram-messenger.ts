// Outbound Telegram Bot API HTTP messenger (T3-012-B).
// Posts formatted messages to Telegram chats via sendMessage.
// Tokens and credentials are kept strictly out of logs and error messages.
import type {
  TelegramMessenger,
  TelegramOutboundMessage,
} from '../application/ports/telegram-messenger.ts';

export class HttpTelegramMessenger implements TelegramMessenger {
  readonly #botToken?: string | undefined;

  constructor(botToken?: string) {
    this.#botToken = botToken;
  }

  async sendMessage(message: TelegramOutboundMessage): Promise<{ messageId?: number }> {
    if (!this.#botToken) {
      return {};
    }

    const url = `https://api.telegram.org/bot${this.#botToken}/sendMessage`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.chatId,
          text: message.text,
          ...(message.replyToMessageId !== undefined
            ? { reply_to_message_id: message.replyToMessageId }
            : {}),
        }),
      });

      if (!response.ok) {
        // Redact token from error
        throw new Error(`Telegram API responded with status ${response.status}`);
      }

      const data = (await response.json()) as { ok?: boolean; result?: { message_id?: number } };
      return data.result?.message_id !== undefined ? { messageId: data.result.message_id } : {};
    } catch (err: unknown) {
      // Safe error without leaking token
      const messageStr = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Failed to send Telegram message: ${messageStr}`);
      return {};
    }
  }
}
