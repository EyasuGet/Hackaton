// Telegram identity linking and revocation use cases (T3-012-A).
// Manages short-lived single-use linking tokens and maps Telegram users to learner principals.
// Preserves learner privacy: no names, credentials, or course lists are leaked to Telegram.
// Enforces replay protection, single-use token lifecycle, group-chat restriction, and re-linking guards.
import {
  generateLinkingToken,
  hashLinkingToken,
  maskTelegramUserId,
  parseTelegramCommand,
  type LinkTelegramOutcome,
  type TelegramUpdate,
} from '../domain/telegram-identity.ts';
import type { TelegramIdentityRepository } from './ports/telegram-identity-repository.ts';

export interface TelegramIdentityServiceOptions {
  /** Clock source for deterministic testing. Defaults to system time. */
  readonly clock?: () => Date;
  /** Linking token time-to-live in seconds. Defaults to 600 (10 minutes). */
  readonly tokenTtlSeconds?: number;
}

export interface LinkTokenResult {
  readonly token: string;
  readonly expiresAt: Date;
  readonly expiresInSeconds: number;
}

export interface IdentityStatusResult {
  readonly linked: boolean;
  readonly linkedAt?: Date;
  readonly telegramUserIdMasked?: string;
}

export interface TelegramWebhookOutcome {
  readonly handled: boolean;
  readonly action?: string;
  readonly error?: string;
  readonly outcome?: LinkTelegramOutcome;
  readonly message?: string;
  readonly principalId?: string;
  readonly linked?: boolean;
  readonly success?: boolean;
}

export class TelegramIdentityService {
  readonly #repository: TelegramIdentityRepository;
  readonly #clock: () => Date;
  readonly #tokenTtlSeconds: number;

  constructor(
    repository: TelegramIdentityRepository,
    options: TelegramIdentityServiceOptions = {},
  ) {
    this.#repository = repository;
    this.#clock = options.clock ?? (() => new Date());
    this.#tokenTtlSeconds = options.tokenTtlSeconds ?? 600;
  }

  /**
   * Generates a short-lived single-use linking token for an authenticated learner.
   * Only the SHA-256 digest is stored in the database.
   */
  async createLinkingToken(principalId: string): Promise<LinkTokenResult> {
    const rawToken = generateLinkingToken();
    const tokenDigest = hashLinkingToken(rawToken);
    const now = this.#clock();
    const expiresAt = new Date(now.getTime() + this.#tokenTtlSeconds * 1000);

    await this.#repository.createLinkingToken({
      tokenDigest,
      principalId,
      expiresAt,
      createdAt: now,
    });

    return {
      token: rawToken,
      expiresAt,
      expiresInSeconds: this.#tokenTtlSeconds,
    };
  }

  /** Checks whether the given learner principal currently has an active Telegram link. */
  async getIdentityStatus(principalId: string): Promise<IdentityStatusResult> {
    const active = await this.#repository.findActiveByPrincipalId(principalId);
    if (!active) return { linked: false };

    return {
      linked: true,
      linkedAt: active.createdAt,
      telegramUserIdMasked: maskTelegramUserId(active.telegramUserId),
    };
  }

  /**
   * Revokes the learner's active Telegram link from the web assistant.
   * Immediately stops all Telegram access for that user.
   */
  async revokeIdentity(principalId: string): Promise<{ revoked: boolean }> {
    const now = this.#clock();
    const revoked = await this.#repository.revokeByPrincipalId(principalId, now);
    return { revoked };
  }

  /**
   * Links a Telegram user to a learner principal using a single-use token.
   * Validates token validity, expiration, replay, chat type, and cross-account guards.
   */
  async linkFromTelegram(params: {
    readonly token: string;
    readonly telegramUserId: string;
    readonly chatId: string;
    readonly chatType: string;
  }): Promise<LinkTelegramOutcome> {
    // 1. Group chats are strictly forbidden from establishing learner access
    if (params.chatType !== 'private') {
      return {
        success: false,
        reason: 'group_chat_forbidden',
        message: 'Account linking is only permitted in a private 1-on-1 chat with the bot.',
      };
    }

    const tokenDigest = hashLinkingToken(params.token);
    const tokenRecord = await this.#repository.findLinkingToken(tokenDigest);

    // 2. Reject non-existent token
    if (!tokenRecord) {
      return {
        success: false,
        reason: 'invalid_token',
        message:
          'Invalid or expired linking token. Please generate a new code from the web assistant.',
      };
    }

    // 3. Reject already used token (replay guard)
    if (tokenRecord.usedAt !== null) {
      return {
        success: false,
        reason: 'token_already_used',
        message:
          'This linking token has already been used. Please generate a new code from the web assistant.',
      };
    }

    const now = this.#clock();

    // 4. Reject expired token
    if (tokenRecord.expiresAt.getTime() <= now.getTime()) {
      return {
        success: false,
        reason: 'expired_token',
        message:
          'This linking token has expired. Please generate a new code from the web assistant.',
      };
    }

    // 5. Cross-user linking guard: check if Telegram user is already linked to another principal
    const existingForTelegram = await this.#repository.findActiveByTelegramUserId(
      params.telegramUserId,
    );
    if (existingForTelegram) {
      if (existingForTelegram.principalId !== tokenRecord.principalId) {
        return {
          success: false,
          reason: 'already_linked_to_other_account',
          message:
            'This Telegram account is already linked to another learner. Please unlink it first.',
        };
      }
      // If already linked to the same principal, idempotently mark token used and confirm
      await this.#repository.markTokenUsed(tokenDigest, now);
      return {
        success: true,
        identity: existingForTelegram,
        message: 'Your Telegram account is already linked to this learning account.',
      };
    }

    // 6. Re-linking guard: check if this principal is already linked to a different Telegram user
    const existingForPrincipal = await this.#repository.findActiveByPrincipalId(
      tokenRecord.principalId,
    );
    if (existingForPrincipal && existingForPrincipal.telegramUserId !== params.telegramUserId) {
      return {
        success: false,
        reason: 'account_already_linked',
        message:
          'Your learning account is already linked to a different Telegram account. Please revoke that link from the web assistant before linking a new account.',
      };
    }

    // 7. Atomically commit use of token and upsert active identity
    await this.#repository.markTokenUsed(tokenDigest, now);
    const identity = await this.#repository.upsertActiveIdentity({
      principalId: tokenRecord.principalId,
      telegramUserId: params.telegramUserId,
      chatId: params.chatId,
      now,
    });

    return {
      success: true,
      identity,
      message:
        'Account linked successfully! You can now ask course questions directly through Telegram.',
    };
  }

  /**
   * Resolves the active learner principal for a Telegram user ID.
   * Returns null if unlinked or revoked.
   */
  async resolveActivePrincipalByTelegramUser(telegramUserId: string): Promise<string | null> {
    const active = await this.#repository.findActiveByTelegramUserId(telegramUserId);
    return active?.principalId ?? null;
  }

  /**
   * Processes an incoming Telegram webhook update.
   * Handles secret token verification, command parsing, linking, unlinking, and status.
   */
  async handleTelegramUpdate(
    update: TelegramUpdate,
    secretTokenHeader?: string,
    configuredSecret?: string,
  ): Promise<TelegramWebhookOutcome> {
    // Authenticity check: if a secret token is configured, enforce exact header match
    if (configuredSecret) {
      if (!secretTokenHeader || secretTokenHeader !== configuredSecret) {
        return { handled: false, error: 'unauthorized' };
      }
    }

    if (!update || typeof update.update_id !== 'number') {
      return { handled: false, error: 'invalid_payload' };
    }

    const message = update.message;
    if (!message || typeof message.text !== 'string') {
      return { handled: false };
    }

    if (message.from?.is_bot) {
      return { handled: false };
    }

    const telegramUserId = String(message.from?.id ?? '');
    const chatId = String(message.chat.id);
    const chatType = message.chat.type;

    if (!telegramUserId) {
      return { handled: false, error: 'missing_sender' };
    }

    const parsed = parseTelegramCommand(message.text);
    if (!parsed) {
      const activePrincipal = await this.resolveActivePrincipalByTelegramUser(telegramUserId);
      if (!activePrincipal) {
        return {
          handled: true,
          action: 'unlinked_notice',
          message:
            'Please link your account first using /link <token> generated from the web assistant.',
        };
      }
      return {
        handled: true,
        action: 'message',
        principalId: activePrincipal,
      };
    }

    if (parsed.command === 'link' || parsed.command === 'start') {
      if (!parsed.argument) {
        return {
          handled: true,
          action: 'usage',
          message:
            'To link your account, type /link <token> using the token generated in the web assistant.',
        };
      }

      const outcome = await this.linkFromTelegram({
        token: parsed.argument,
        telegramUserId,
        chatId,
        chatType,
      });

      return {
        handled: true,
        action: 'link',
        outcome,
        message: outcome.message,
        success: outcome.success,
      };
    }

    if (parsed.command === 'unlink' || parsed.command === 'revoke') {
      const now = this.#clock();
      const revoked = await this.#repository.revokeByTelegramUserId(telegramUserId, now);
      return {
        handled: true,
        action: 'unlink',
        success: revoked,
        message: revoked
          ? 'Your Telegram account has been unlinked from your learning assistant.'
          : 'This Telegram account is not currently linked to any learning account.',
      };
    }

    if (parsed.command === 'status') {
      const active = await this.#repository.findActiveByTelegramUserId(telegramUserId);
      return {
        handled: true,
        action: 'status',
        linked: active !== null,
        message: active
          ? 'Your Telegram account is actively linked.'
          : 'Your Telegram account is not linked. Type /link <token> to link.',
      };
    }

    const activePrincipal = await this.resolveActivePrincipalByTelegramUser(telegramUserId);
    if (!activePrincipal) {
      return {
        handled: true,
        action: 'unlinked_notice',
        message:
          'Please link your account first using /link <token> generated from the web assistant.',
      };
    }

    return {
      handled: true,
      action: 'message',
      principalId: activePrincipal,
    };
  }
}
