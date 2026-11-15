// Service for delivering generic Telegram notices when a support reply is added (T3-017-C).
// Rechecks current consent, eligibility, and cancellation before sending.
// Notice contains strictly generic text and an authorized return path to view the reply.
// Suppressed when the learner is unlinked, opted out, or the request was cancelled.
import type pg from 'pg';
import type { ClaimedDeliveryIntent } from '../../delivery/domain/delivery-intent.ts';
import type { ProcessAction } from '../../delivery/application/delivery-worker.ts';
import type { TelegramDeliveryAdapter } from '../../delivery/infrastructure/telegram-delivery-adapter.ts';
import {
  buildGenericSupportReplyNotice,
  parseHelpReplyContentRef,
} from '../domain/help-notification.ts';

export interface SupportReplyNotifierOptions {
  readonly pool: pg.Pool;
  readonly telegramAdapter: TelegramDeliveryAdapter;
  /** Base URL for the return link in the notice (defaults to 'http://localhost:5173'). */
  readonly returnUrlBase?: string;
}

export interface DispatchResult {
  readonly status: 'delivered' | 'suppressed' | 'released' | 'ignored';
  readonly reason?: string;
}

export class SupportReplyNotifier {
  readonly #pool: pg.Pool;
  readonly #telegramAdapter: TelegramDeliveryAdapter;
  readonly #returnUrlBase: string;

  constructor(options: SupportReplyNotifierOptions) {
    this.#pool = options.pool;
    this.#telegramAdapter = options.telegramAdapter;
    this.#returnUrlBase = (options.returnUrlBase ?? 'http://localhost:5173').replace(/\/+$/, '');
  }

  /**
   * Dispatches a single claimed delivery intent for a delivery worker.
   * Rechecks current permission/consent/cancellation before sending; a revoked or
   * cancelled recipient is suppressed.
   * Returns ProcessAction ('complete' | 'release' | 'abandon').
   */
  async processClaimedIntent(
    intent: ClaimedDeliveryIntent,
    now: Date = new Date(),
  ): Promise<ProcessAction> {
    const outcome = await this.dispatch(intent, now);
    if (
      outcome.status === 'delivered' ||
      outcome.status === 'suppressed' ||
      outcome.status === 'ignored'
    ) {
      return 'complete';
    }
    return 'release';
  }

  /**
   * Detailed dispatch operation returning execution status and diagnostics.
   */
  async dispatch(intent: ClaimedDeliveryIntent, now: Date = new Date()): Promise<DispatchResult> {
    if (intent.channel !== 'telegram') {
      return { status: 'ignored', reason: 'unsupported_channel' };
    }

    const parsed = parseHelpReplyContentRef(intent.contentRef);
    if (!parsed) {
      return { status: 'ignored', reason: 'invalid_content_ref' };
    }

    // 1. Recheck current permission, consent, and cancellation before sending
    const checkResult = await this.#pool.query<{
      request_id: string | null;
      request_state: string | null;
      request_expires_at: Date | null;
      telegram_chat_id: string | null;
      opted_in: boolean | null;
    }>(
      `SELECT
         hr.id AS request_id,
         hr.state AS request_state,
         hr.expires_at AS request_expires_at,
         ti.telegram_chat_id,
         np.opted_in
       FROM help_requests hr
  LEFT JOIN telegram_identities ti
         ON ti.learner_id = hr.owner_id AND ti.revoked_at IS NULL
  LEFT JOIN help_notification_preferences np
         ON np.learner_id = hr.owner_id AND np.channel = 'telegram'
      WHERE hr.id = $1 AND hr.owner_id = $2`,
      [parsed.helpRequestId, intent.recipientId],
    );

    const row = checkResult.rows[0];
    if (!row) {
      return { status: 'suppressed', reason: 'request_or_owner_not_found' };
    }

    // Cancellation check
    if (row.request_state === 'cancelled') {
      return { status: 'suppressed', reason: 'request_cancelled' };
    }

    // Expiry check
    if (row.request_expires_at && row.request_expires_at.getTime() <= now.getTime()) {
      return { status: 'suppressed', reason: 'request_expired' };
    }

    // Explicit opt-in check
    if (row.opted_in !== true) {
      return { status: 'suppressed', reason: 'not_opted_in' };
    }

    // Active Telegram link check
    if (!row.telegram_chat_id) {
      return { status: 'suppressed', reason: 'telegram_not_linked' };
    }

    // 2. Construct strictly generic notice with authorized return path
    const returnUrl = `${this.#returnUrlBase}/#inbox`;
    const noticeText = buildGenericSupportReplyNotice(returnUrl);

    // 3. Send through Telegram delivery adapter outside database transaction
    const sendResult = await this.#telegramAdapter.sendMessage({
      chatId: row.telegram_chat_id,
      text: noticeText,
    });

    if (sendResult.ok) {
      return { status: 'delivered' };
    }

    if (sendResult.permanent) {
      return { status: 'suppressed', reason: sendResult.error };
    }

    return { status: 'released', reason: sendResult.error };
  }
}
