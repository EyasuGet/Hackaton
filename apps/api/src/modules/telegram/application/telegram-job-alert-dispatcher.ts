// Telegram job alert dispatcher implementing Delivery DispatchPort (T3-020-B).
// Rechecks opt-in subscription, account linking, and job validity before send.
// Provides accessible inline button and plain-text unsubscribe command paths.
// Retains shared delivery semantics for retries and unknown outcomes.

import type { JobRepository } from '../../careers/application/import-jobs.ts';
import type { JobPreferencesRepository } from '../../careers/application/ports/job-preferences-repository.ts';
import { matchJobSubscription } from '../../careers/domain/job-preferences.ts';
import type { DispatchPort } from '../../delivery/application/delivery-worker.ts';
import type {
  ClaimedDeliveryIntent,
  DispatchOutcome,
} from '../../delivery/domain/delivery-intent.ts';
import type { TelegramClient } from './ports/telegram-client.ts';
import type { TelegramLinkRepository } from './ports/telegram-link-repository.ts';

export const TELEGRAM_JOB_UNSUBSCRIBE_CALLBACK_DATA = 'unsubscribe_job_alerts';

export interface TelegramJobAlertDispatcherOptions {
  readonly jobRepository: JobRepository;
  readonly jobPreferencesRepository: JobPreferencesRepository;
  readonly telegramLinkRepository: TelegramLinkRepository;
  readonly telegramClient: TelegramClient;
}

export class TelegramJobAlertDispatcher implements DispatchPort {
  readonly #jobRepository: JobRepository;
  readonly #jobPreferencesRepository: JobPreferencesRepository;
  readonly #telegramLinkRepository: TelegramLinkRepository;
  readonly #telegramClient: TelegramClient;

  constructor(options: TelegramJobAlertDispatcherOptions) {
    this.#jobRepository = options.jobRepository;
    this.#jobPreferencesRepository = options.jobPreferencesRepository;
    this.#telegramLinkRepository = options.telegramLinkRepository;
    this.#telegramClient = options.telegramClient;
  }

  async dispatch(intent: ClaimedDeliveryIntent, now: Date = new Date()): Promise<DispatchOutcome> {
    if (intent.channel.toLowerCase() !== 'telegram') {
      return { status: 'failed', reason: `Unsupported channel: ${intent.channel}` };
    }

    // 1. Recheck content reference & job validity/expiry
    const contentRef = intent.contentRef;
    if (!contentRef || !contentRef.startsWith('job:')) {
      return { status: 'failed', reason: 'invalid_content_ref' };
    }

    const parts = contentRef.split(':');
    const jobId = parts[1];
    if (!jobId) {
      return { status: 'failed', reason: 'missing_job_id' };
    }

    const job = await this.#jobRepository.getJob(jobId, now);
    if (!job || job.withdrawn || job.expiresAt.getTime() <= now.getTime() || job.status !== 'active') {
      // Content has expired or job was withdrawn: suppress delivery immediately.
      return { status: 'cancelled', reason: 'job_expired_or_withdrawn' };
    }

    // 2. Recheck learner opt-in / active matching subscription
    const learnerSubscriptions = await this.#jobPreferencesRepository.listOwned({
      ownerId: intent.recipientId,
      courseIds: [],
    });

    const activeMatchingSub = learnerSubscriptions.find(
      (sub) =>
        sub.active &&
        sub.channel.toLowerCase() === 'telegram' &&
        matchJobSubscription(sub, job, now),
    );

    if (!activeMatchingSub) {
      // Learner unsubscribed or preferences no longer match: suppress delivery.
      return { status: 'cancelled', reason: 'unsubscribed_or_ineligible' };
    }

    // 3. Recheck Telegram identity link
    const identity = await this.#telegramLinkRepository.findIdentityByLearnerId(intent.recipientId);
    if (!identity || identity.revokedAt) {
      // Learner unlinked their Telegram identity: suppress delivery.
      return { status: 'cancelled', reason: 'telegram_unlinked' };
    }

    const chatId = identity.telegramChatId;
    if (!chatId) {
      return { status: 'cancelled', reason: 'missing_chat_id' };
    }

    // 4. Construct accessible message with plain-text unsubscribe notice and inline button
    const messageText = [
      `💼 Job Alert: ${job.title}`,
      `🏢 Organization: ${job.organization}`,
      `📍 Location: ${job.location}`,
      `🏷️ Category: ${job.category}`,
      `🔗 Source: ${job.sourceUrl}`,
      '',
      'To stop receiving alerts, tap the button below or reply /unsubscribe.',
    ].join('\n');

    const replyMarkup = {
      inline_keyboard: [
        [
          {
            text: 'Unsubscribe from job alerts',
            callback_data: TELEGRAM_JOB_UNSUBSCRIBE_CALLBACK_DATA,
          },
        ],
      ],
    };

    // 5. Send message via Telegram Client
    const sendResult = await this.#telegramClient.sendMessage({
      chatId,
      text: messageText,
      replyMarkup,
    });

    if (sendResult.ok) {
      return { status: 'sent' };
    }

    if (sendResult.uncertain) {
      return {
        status: 'uncertain',
        ...(sendResult.error ? { reason: sendResult.error } : {}),
      };
    }

    if (sendResult.retryable) {
      return {
        status: 'retry',
        ...(sendResult.error ? { reason: sendResult.error } : {}),
      };
    }

    return {
      status: 'failed',
      ...(sendResult.error ? { reason: sendResult.error } : {}),
    };
  }
}
