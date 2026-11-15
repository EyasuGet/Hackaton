// Domain models and validation rules for Telegram identities (T3-012-A).
// Telegram identities are strictly bound to numeric Telegram user IDs and
// private chat types. Usernames and unapproved group chats never establish learner access.

export type TelegramChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface TelegramUser {
  readonly id: string;
  readonly isBot: boolean;
  readonly username?: string | undefined;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
}

export interface TelegramChat {
  readonly id: string;
  readonly type: TelegramChatType;
  readonly title?: string | undefined;
  readonly username?: string | undefined;
}

export interface TelegramMessage {
  readonly messageId: number;
  readonly from?: TelegramUser | undefined;
  readonly chat: TelegramChat;
  readonly date: number;
  readonly text?: string | undefined;
}

export interface TelegramUpdate {
  readonly updateId: number;
  readonly message?: TelegramMessage | undefined;
}

export interface TelegramIdentity {
  readonly id: string;
  readonly learnerId: string;
  readonly telegramUserId: string;
  readonly telegramChatId: string;
  readonly telegramUsername?: string | undefined;
  readonly linkedAt: Date;
  readonly revokedAt?: Date | undefined;
}

export interface TelegramLinkCode {
  readonly codeDigest: string;
  readonly learnerId: string;
  readonly expiresAt: Date;
  readonly usedAt?: Date | undefined;
  readonly createdAt: Date;
}

export class TelegramGroupChatNotAllowedError extends Error {
  constructor(chatType: string) {
    super(
      `Group chats of type '${chatType}' are not permitted. Only private chats establish learner access.`,
    );
    this.name = 'TelegramGroupChatNotAllowedError';
  }
}

export class TelegramBotNotAllowedError extends Error {
  constructor() {
    super('Bots cannot establish learner access.');
    this.name = 'TelegramBotNotAllowedError';
  }
}

/** Only private chats may establish or exercise learner access. */
export function isPrivateChat(chat: TelegramChat): boolean {
  return chat.type === 'private';
}

/** Enforces private chat constraint; throws TelegramGroupChatNotAllowedError otherwise. */
export function assertPrivateChat(chat: TelegramChat): void {
  if (!isPrivateChat(chat)) {
    throw new TelegramGroupChatNotAllowedError(chat.type);
  }
}

/** Enforces human sender constraint; throws TelegramBotNotAllowedError if bot or missing. */
export function assertNotBot(user?: TelegramUser): void {
  if (!user || user.isBot) {
    throw new TelegramBotNotAllowedError();
  }
}
