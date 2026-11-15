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

export interface TelegramVoice {
  readonly file_id: string;
  readonly file_unique_id?: string | undefined;
  readonly duration: number;
  readonly mime_type?: string | undefined;
  readonly file_size?: number | undefined;
}

export interface TelegramMessage {
  readonly messageId: number;
  readonly from?: TelegramUser | undefined;
  readonly chat: TelegramChat;
  readonly date: number;
  readonly text?: string | undefined;
  readonly voice?: TelegramVoice | undefined;
}

export type VoiceReviewStatus = 'pending' | 'approved' | 'discarded' | 'awaiting_edit';

export interface PendingVoiceReview {
  readonly id: string;
  readonly learnerId: string;
  readonly telegramUserId: string;
  readonly telegramChatId: string;
  readonly courseId: string;
  readonly transcript: string;
  readonly status: VoiceReviewStatus;
  readonly expiresAt: Date;
  readonly resolvedAt?: Date | undefined;
  readonly createdAt: Date;
}

export interface TelegramCallbackQuery {
  readonly id: string;
  readonly from: TelegramUser;
  readonly message?: TelegramMessage | undefined;
  readonly data?: string | undefined;
}

export interface TelegramUpdate {
  readonly updateId: number;
  readonly message?: TelegramMessage | undefined;
  readonly callbackQuery?: TelegramCallbackQuery | undefined;
}

export interface TelegramIdentity {
  readonly id: string;
  readonly learnerId: string;
  readonly telegramUserId: string;
  readonly telegramChatId: string;
  readonly telegramUsername?: string | undefined;
  readonly linkedAt: Date;
  readonly revokedAt?: Date | undefined;
  readonly externalConsent?: boolean | undefined;
  readonly activeCourseId?: string | undefined;
}

export interface TelegramCitation {
  readonly sourceId: string;
  readonly sectionId: string;
  readonly sourceTitle?: string | undefined;
  readonly heading?: string | undefined;
}

/**
 * Formats citations cleanly for Telegram chat (source, section title, reference) (T3-012-B).
 * Supports English and Amharic labels matching web presentation.
 * Returns only the answer text if citations list is empty.
 */
export function formatTelegramTutorResponse(
  answerText: string,
  citations: readonly TelegramCitation[] = [],
  lang: 'en' | 'am' = 'en',
): string {
  const cleanAnswer = answerText.trim();
  if (!citations || citations.length === 0) {
    return cleanAnswer;
  }

  const isAmharic = lang === 'am' || /[\u1200-\u137F]/.test(cleanAnswer);
  const header = isAmharic ? 'ምንጮች እና ጥቅሶች፡' : 'Sources & Citations:';

  const items = citations.map((c) => {
    const source = c.sourceTitle?.trim() || c.sourceId;
    const section = c.heading?.trim() || c.sectionId;
    const ref = `${c.sourceId}#${c.sectionId}`;
    return `• ${source} — ${section} (${ref})`;
  });

  return `${cleanAnswer}\n\n${header}\n${items.join('\n')}`;
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
