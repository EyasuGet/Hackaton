// Outbound Telegram messenger port (T3-012-B).
// Delivers formatted tutor answers and channel notifications to private Telegram chats.

import type { TelegramSendMessageParams } from './telegram-client.ts';

export interface TelegramOutboundMessage {
  readonly chatId: string | number;
  readonly text: string;
  readonly replyToMessageId?: number | undefined;
  readonly replyMarkup?: TelegramSendMessageParams['replyMarkup'];
}

export interface TelegramMessenger {
  sendMessage(message: TelegramOutboundMessage): Promise<{ messageId?: number }>;
}
