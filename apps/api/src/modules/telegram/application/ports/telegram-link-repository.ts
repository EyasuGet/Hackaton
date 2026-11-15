// Persistence port for Telegram identity links and single-use codes (T3-012-A).
import type { Principal } from '../../../identity/domain/principal.ts';
import type {
  PendingVoiceReview,
  TelegramIdentity,
  VoiceReviewStatus,
} from '../../domain/telegram-identity.ts';

export type LinkFailureReason =
  | 'invalid_code'
  | 'code_expired'
  | 'code_already_used'
  | 'telegram_user_already_linked'
  | 'learner_already_linked';

export type ConsumeLinkResult =
  | { readonly success: true; readonly identity: TelegramIdentity }
  | { readonly success: false; readonly reason: LinkFailureReason };

export interface ConsumeLinkParams {
  readonly codeDigest: string;
  readonly telegramUserId: string;
  readonly telegramChatId: string;
  readonly telegramUsername?: string | undefined;
  readonly now: Date;
}

export interface TelegramLinkRepository {
  /** Persists a single-use link code digest for a learner principal. */
  createLinkCode(learnerId: string, codeDigest: string, expiresAt: Date): Promise<void>;

  /**
   * Atomically consumes a link code and establishes an active Telegram identity link.
   * Enforces single-use, expiry, and ensures neither the learner nor the telegram user
   * is already linked to another active account.
   */
  consumeLinkCode(params: ConsumeLinkParams): Promise<ConsumeLinkResult>;

  /** Revokes the active Telegram link for a learner principal. Returns true if an active link was revoked. */
  unlinkByLearnerId(learnerId: string, now: Date): Promise<boolean>;

  /** Revokes the active Telegram link for a Telegram user ID. Returns true if an active link was revoked. */
  unlinkByTelegramUserId(telegramUserId: string, now: Date): Promise<boolean>;

  /** Finds active Telegram identity by Telegram user ID, or null if unlinked/revoked. */
  findIdentityByTelegramUserId(telegramUserId: string): Promise<TelegramIdentity | null>;

  /** Finds active Telegram identity by learner principal ID, or null if unlinked. */
  findIdentityByLearnerId(learnerId: string): Promise<TelegramIdentity | null>;

  /**
   * Updates learner preferences (external AI consent, active course choice) for an active link.
   * Returns the updated TelegramIdentity, or null if no active link exists.
   */
  setPreferences(
    learnerId: string,
    preferences: { readonly externalConsent?: boolean; readonly activeCourseId?: string },
  ): Promise<TelegramIdentity | null>;

  /**
   * Resolves the authenticated Principal (with course grants) for an actively linked
   * Telegram user. Returns null if unlinked, revoked, or non-existent.
   */
  findPrincipalByTelegramUserId(telegramUserId: string): Promise<Principal | null>;

  /** Finds a recorded processed update by its Telegram update ID for replay prevention (T3-019-C). */
  findProcessedUpdate(updateId: number): Promise<ProcessedTelegramUpdateRecord | null>;

  /** Records a processed update and its outcome atomically for replay prevention (T3-019-C). */
  recordProcessedUpdate(params: RecordProcessedUpdateParams): Promise<void>;

  /** Persists a pending Telegram voice review (T3-013-A). */
  createVoiceReview(review: PendingVoiceReview): Promise<void>;

  /** Finds a pending or active voice review by review ID (T3-013-A). */
  findVoiceReview(id: string): Promise<PendingVoiceReview | null>;

  /** Finds an active voice review in 'awaiting_edit' status for a Telegram user (T3-013-A). */
  findAwaitingEditReview(telegramUserId: string): Promise<PendingVoiceReview | null>;

  /**
   * Atomically transitions a voice review status (T3-013-A).
   * Returns true if status transitioned, or false if already resolved or expired.
   */
  resolveVoiceReview(
    id: string,
    status: VoiceReviewStatus,
    now: Date,
    transcript?: string,
  ): Promise<boolean>;
}

export interface ProcessedTelegramUpdateRecord {
  readonly updateId: number;
  readonly telegramUserId?: string | undefined;
  readonly responseStatus: string;
  readonly responsePayload: Record<string, unknown>;
  readonly processedAt: Date;
}

export interface RecordProcessedUpdateParams {
  readonly updateId: number;
  readonly telegramUserId?: string | undefined;
  readonly responseStatus: string;
  readonly responsePayload: Record<string, unknown>;
  readonly now: Date;
}
