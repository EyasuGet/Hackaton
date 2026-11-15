// Port interface for outbound Telegram client interactions (T3-020-B).
// Distinguishes successful dispatch, permanent rejections, retryable states,
// and uncertain/network timeout outcomes according to shared delivery semantics.

export interface TelegramSendMessageParams {
  readonly chatId: string;
  readonly text: string;
  readonly replyMarkup?: {
    readonly inline_keyboard?: ReadonlyArray<
      ReadonlyArray<{
        readonly text: string;
        readonly callback_data?: string | undefined;
        readonly url?: string | undefined;
      }>
    >;
  };
}

export interface TelegramSendResult {
  readonly ok: boolean;
  readonly messageId?: number | undefined;
  readonly error?: string | undefined;
  /** True if error is permanent (e.g. 400 Bad Request, 403 Forbidden / bot blocked). */
  readonly permanent?: boolean | undefined;
  /** True if error is transient (e.g. 429 Too Many Requests, 5xx server errors). */
  readonly retryable?: boolean | undefined;
  /** True if delivery outcome is unknown (e.g. network timeout or unparsed response). */
  readonly uncertain?: boolean | undefined;
}

export interface TelegramAnswerCallbackParams {
  readonly callbackQueryId: string;
  readonly text?: string | undefined;
}

export interface TelegramGetFileResult {
  readonly ok: boolean;
  readonly filePath?: string | undefined;
  readonly fileSize?: number | undefined;
  readonly error?: string | undefined;
}

export interface TelegramClient {
  sendMessage(params: TelegramSendMessageParams): Promise<TelegramSendResult>;
  answerCallbackQuery?(params: TelegramAnswerCallbackParams): Promise<boolean>;
  getFile?(fileId: string): Promise<TelegramGetFileResult>;
  downloadFile?(filePath: string): Promise<Uint8Array | null>;
}
