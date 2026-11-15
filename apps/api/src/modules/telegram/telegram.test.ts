import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { JobRepository } from '../careers/application/import-jobs.ts';
import { JobAnswers } from '../careers/application/job-answers.ts';
import type { JobRecord } from '../careers/domain/job.ts';
import type { OwnedScope, Principal } from '../identity/domain/principal.ts';
import type { ResolvePrincipal } from '../identity/application/resolve-principal.ts';
import { ContentAccess } from '../content/application/content-access.ts';
import type { CitationResult, CitedSection } from '../content/domain/retrieval.ts';
import { Tutoring } from '../tutoring/application/tutoring.ts';
import { FaqProvider } from '../tutoring/application/faq-provider.ts';
import { Help } from '../help/application/help.ts';
import type {
  HelpRepository,
  SubmitHelpInput,
  SubmitResult,
  QueueItem,
  AddReplyResult,
  ClaimResult as HelpClaimResult,
} from '../help/application/ports/help-repository.ts';
import type { HelpRequest, HelpReply } from '../help/domain/help-request.ts';
import type {
  ClaimRequestInput,
  ClaimResult as TutorClaimResult,
  RecordOutcomeInput,
  TutoringRepository,
} from '../tutoring/application/ports/tutoring-repository.ts';
import type { TutoringConversation } from '../tutoring/domain/conversation.ts';
import type { TutoringRequest } from '../tutoring/domain/tutoring-request.ts';
import type {
  SpeechSynthesisRequest,
  SpeechSynthesizerProvider,
} from '../tutoring/application/ports/speech-synthesizer-provider.ts';
import { ProviderAdmissionController } from '../tutoring/application/provider-admission.ts';
import type {
  TranscriptionInput,
  TranscriptionOutcome,
  TranscriptionPort,
} from '../tutoring/application/ports/transcription-port.ts';
import type {
  TelegramAnswerCallbackParams,
  TelegramClient,
  TelegramGetFileResult,
  TelegramSendMessageParams,
  TelegramSendResult,
  TelegramSendVoiceParams,
} from './application/ports/telegram-client.ts';
import type {
  ConsumeLinkParams,
  ConsumeLinkResult,
  ProcessedTelegramUpdateRecord,
  RecordProcessedUpdateParams,
  TelegramLinkRepository,
} from './application/ports/telegram-link-repository.ts';
import type {
  TelegramMessenger,
  TelegramOutboundMessage,
} from './application/ports/telegram-messenger.ts';
import { SlidingWindowRateLimiter } from './application/rate-limiter.ts';
import {
  verifyTelegramInitData,
  verifyWebhookSecret,
} from './application/telegram-authenticity.ts';
import {
  digestLinkCode,
  TelegramLinkService,
  TELEGRAM_LINK_CODE_TTL_MS,
  type TelegramSender,
} from './application/telegram-link-service.ts';
import {
  formatTelegramTutorResponse,
  type PendingVoiceReview,
  type TelegramIdentity,
  type TelegramUpdate,
  type VoiceReviewStatus,
} from './domain/telegram-identity.ts';
import { registerTelegramRoutes } from './presentation/http/telegram-routes.ts';

const learnerA: Principal = {
  id: '11111111-1111-1111-1111-111111111111',
  role: 'learner',
  label: 'Learner A',
  demo: true,
  courseIds: ['course-1'],
};

const learnerB: Principal = {
  id: '22222222-2222-2222-2222-222222222222',
  role: 'learner',
  label: 'Learner B',
  demo: true,
  courseIds: ['course-2'],
};

const supportStaff: Principal = {
  id: '33333333-3333-3333-3333-333333333333',
  role: 'support',
  label: 'Support User',
  demo: true,
  courseIds: [],
};

class InMemoryTelegramLinkRepository implements TelegramLinkRepository {
  readonly linkCodes = new Map<string, { learnerId: string; expiresAt: Date; usedAt?: Date }>();
  readonly identities = new Map<string, TelegramIdentity>();

  createLinkCode(learnerId: string, codeDigest: string, expiresAt: Date): Promise<void> {
    this.linkCodes.set(codeDigest, { learnerId, expiresAt });
    return Promise.resolve();
  }

  consumeLinkCode(params: ConsumeLinkParams): Promise<ConsumeLinkResult> {
    const record = this.linkCodes.get(params.codeDigest);
    if (!record) return Promise.resolve({ success: false, reason: 'invalid_code' });
    if (record.usedAt) return Promise.resolve({ success: false, reason: 'code_already_used' });
    if (record.expiresAt <= params.now)
      return Promise.resolve({ success: false, reason: 'code_expired' });

    // Check if telegram user is already linked
    for (const id of this.identities.values()) {
      if (id.telegramUserId === params.telegramUserId && !id.revokedAt) {
        return Promise.resolve({ success: false, reason: 'telegram_user_already_linked' });
      }
    }

    // Check if learner is already linked
    for (const id of this.identities.values()) {
      if (id.learnerId === record.learnerId && !id.revokedAt) {
        return Promise.resolve({ success: false, reason: 'learner_already_linked' });
      }
    }

    record.usedAt = params.now;
    const identity: TelegramIdentity = {
      id: `id-${this.identities.size + 1}`,
      learnerId: record.learnerId,
      telegramUserId: params.telegramUserId,
      telegramChatId: params.telegramChatId,
      telegramUsername: params.telegramUsername,
      linkedAt: params.now,
    };
    this.identities.set(identity.id, identity);
    return Promise.resolve({ success: true, identity });
  }

  unlinkByLearnerId(learnerId: string, now: Date): Promise<boolean> {
    for (const id of this.identities.values()) {
      if (id.learnerId === learnerId && !id.revokedAt) {
        this.identities.set(id.id, { ...id, revokedAt: now });
        return Promise.resolve(true);
      }
    }
    return Promise.resolve(false);
  }

  unlinkByTelegramUserId(telegramUserId: string, now: Date): Promise<boolean> {
    for (const id of this.identities.values()) {
      if (id.telegramUserId === telegramUserId && !id.revokedAt) {
        this.identities.set(id.id, { ...id, revokedAt: now });
        return Promise.resolve(true);
      }
    }
    return Promise.resolve(false);
  }

  findIdentityByTelegramUserId(telegramUserId: string): Promise<TelegramIdentity | null> {
    for (const id of this.identities.values()) {
      if (id.telegramUserId === telegramUserId && !id.revokedAt) return Promise.resolve(id);
    }
    return Promise.resolve(null);
  }

  findIdentityByLearnerId(learnerId: string): Promise<TelegramIdentity | null> {
    for (const id of this.identities.values()) {
      if (id.learnerId === learnerId && !id.revokedAt) return Promise.resolve(id);
    }
    return Promise.resolve(null);
  }

  setPreferences(
    learnerId: string,
    preferences: {
      readonly externalConsent?: boolean;
      readonly activeCourseId?: string;
      readonly speechEnabled?: boolean;
    },
  ): Promise<TelegramIdentity | null> {
    for (const [idKey, id] of this.identities.entries()) {
      if (id.learnerId === learnerId && !id.revokedAt) {
        const updated: TelegramIdentity = {
          ...id,
          ...(preferences.externalConsent !== undefined
            ? { externalConsent: preferences.externalConsent }
            : {}),
          ...(preferences.activeCourseId !== undefined
            ? { activeCourseId: preferences.activeCourseId }
            : {}),
          ...(preferences.speechEnabled !== undefined
            ? { speechEnabled: preferences.speechEnabled }
            : {}),
        };
        this.identities.set(idKey, updated);
        return Promise.resolve(updated);
      }
    }
    return Promise.resolve(null);
  }

  async findPrincipalByTelegramUserId(telegramUserId: string): Promise<Principal | null> {
    const identity = await this.findIdentityByTelegramUserId(telegramUserId);
    if (!identity) return null;
    if (identity.learnerId === learnerA.id) return learnerA;
    if (identity.learnerId === learnerB.id) return learnerB;
    return null;
  }

  readonly processedUpdates = new Map<number, ProcessedTelegramUpdateRecord>();

  findProcessedUpdate(updateId: number): Promise<ProcessedTelegramUpdateRecord | null> {
    return Promise.resolve(this.processedUpdates.get(updateId) ?? null);
  }

  recordProcessedUpdate(params: RecordProcessedUpdateParams): Promise<void> {
    this.processedUpdates.set(params.updateId, {
      updateId: params.updateId,
      telegramUserId: params.telegramUserId,
      responseStatus: params.responseStatus,
      responsePayload: params.responsePayload,
      processedAt: params.now,
    });
    return Promise.resolve();
  }

  readonly voiceReviews = new Map<string, PendingVoiceReview>();

  createVoiceReview(review: PendingVoiceReview): Promise<void> {
    this.voiceReviews.set(review.id, { ...review });
    return Promise.resolve();
  }

  findVoiceReview(id: string): Promise<PendingVoiceReview | null> {
    const r = this.voiceReviews.get(id);
    return Promise.resolve(r ? { ...r } : null);
  }

  findAwaitingEditReview(telegramUserId: string): Promise<PendingVoiceReview | null> {
    for (const r of this.voiceReviews.values()) {
      if (r.telegramUserId === telegramUserId && r.status === 'awaiting_edit') {
        return Promise.resolve({ ...r });
      }
    }
    return Promise.resolve(null);
  }

  resolveVoiceReview(
    id: string,
    status: VoiceReviewStatus,
    now: Date,
    transcript?: string,
  ): Promise<boolean> {
    const r = this.voiceReviews.get(id);
    if (!r) return Promise.resolve(false);
    if (r.expiresAt <= now) return Promise.resolve(false);
    if (r.status !== 'pending' && r.status !== 'awaiting_edit') return Promise.resolve(false);
    this.voiceReviews.set(id, {
      ...r,
      status,
      resolvedAt: now,
      ...(transcript !== undefined ? { transcript } : {}),
    });
    return Promise.resolve(true);
  }
}

describe('TelegramLinkService Unit Tests (T3-012-A)', () => {
  let repository: InMemoryTelegramLinkRepository;
  let service: TelegramLinkService;
  let currentTime: Date;
  const now = () => currentTime;
  const webhookSecret = 'test-webhook-secret-token-123456';
  const botToken = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';

  beforeEach(() => {
    repository = new InMemoryTelegramLinkRepository();
    currentTime = new Date('2026-11-15T10:00:00Z');
    service = new TelegramLinkService(repository, {
      webhookSecret,
      botToken,
      now,
    });
  });

  describe('Link code generation & constraints', () => {
    it('issues a single-use expiring link code for a learner', async () => {
      const issued = await service.issueLinkCode(learnerA);
      expect(issued.code).toBeDefined();
      expect(issued.code.length).toBeGreaterThanOrEqual(30);
      expect(issued.expiresAt.getTime()).toBe(currentTime.getTime() + TELEGRAM_LINK_CODE_TTL_MS);

      // Verify code digest is stored, never raw code
      const digest = digestLinkCode(issued.code);
      const stored = repository.linkCodes.get(digest);
      expect(stored).toBeDefined();
      expect(stored?.learnerId).toBe(learnerA.id);
      expect(repository.linkCodes.has(issued.code)).toBe(false);
    });

    it('rejects link code issuance for non-learner principals', async () => {
      await expect(service.issueLinkCode(supportStaff)).rejects.toThrow(
        'Only learner principals may link a Telegram identity',
      );
    });
  });

  describe('Account linking & replay/cross-user prevention', () => {
    it('successfully links a private Telegram chat to a learner', async () => {
      const { code } = await service.issueLinkCode(learnerA);

      const linkResult = await service.linkAccount({
        code,
        telegramUserId: '987654321',
        telegramChatId: '987654321',
        chatType: 'private',
        telegramUsername: 'alice_telegram',
      });

      expect(linkResult.success).toBe(true);
      if (linkResult.success) {
        expect(linkResult.identity.learnerId).toBe(learnerA.id);
        expect(linkResult.identity.telegramUserId).toBe('987654321');
        expect(linkResult.identity.telegramUsername).toBe('alice_telegram');
      }

      // Resolves to authenticated learner
      const principal = await service.resolveLearner('987654321');
      expect(principal).toEqual(learnerA);
    });

    it('rejects replay attempts using the same link code', async () => {
      const { code } = await service.issueLinkCode(learnerA);

      const firstLink = await service.linkAccount({
        code,
        telegramUserId: '987654321',
        telegramChatId: '987654321',
        chatType: 'private',
      });
      expect(firstLink.success).toBe(true);

      // Second attempt with the exact same code
      const replay = await service.linkAccount({
        code,
        telegramUserId: '555555555',
        telegramChatId: '555555555',
        chatType: 'private',
      });
      expect(replay.success).toBe(false);
      if (!replay.success) {
        expect(replay.reason).toBe('code_already_used');
      }
    });

    it('rejects expired link codes', async () => {
      const { code } = await service.issueLinkCode(learnerA);

      // Advance clock past 15-minute TTL
      currentTime = new Date(currentTime.getTime() + TELEGRAM_LINK_CODE_TTL_MS + 1000);

      const result = await service.linkAccount({
        code,
        telegramUserId: '987654321',
        telegramChatId: '987654321',
        chatType: 'private',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('code_expired');
      }
    });

    it('rejects unapproved group chats and channels (only private allowed)', async () => {
      const { code } = await service.issueLinkCode(learnerA);

      for (const chatType of ['group', 'supergroup', 'channel']) {
        const result = await service.linkAccount({
          code,
          telegramUserId: '987654321',
          telegramChatId: '-100123456789',
          chatType,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.reason).toBe('group_chats_not_allowed');
        }
      }
    });

    it('rejects bots from linking', async () => {
      const { code } = await service.issueLinkCode(learnerA);

      const result = await service.linkAccount({
        code,
        telegramUserId: '987654321',
        telegramChatId: '987654321',
        chatType: 'private',
        isBot: true,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('bots_not_allowed');
      }
    });

    it('rejects cross-user link attempts when Telegram account is already linked', async () => {
      // Learner A links Telegram account T1
      const codeA = (await service.issueLinkCode(learnerA)).code;
      await service.linkAccount({
        code: codeA,
        telegramUserId: '987654321',
        telegramChatId: '987654321',
        chatType: 'private',
      });

      // Learner B generates code and Telegram account T1 tries to link to Learner B
      const codeB = (await service.issueLinkCode(learnerB)).code;
      const crossLink = await service.linkAccount({
        code: codeB,
        telegramUserId: '987654321', // Same Telegram account!
        telegramChatId: '987654321',
        chatType: 'private',
      });
      expect(crossLink.success).toBe(false);
      if (!crossLink.success) {
        expect(crossLink.reason).toBe('telegram_user_already_linked');
      }
    });

    it('rejects linking when learner already has an active linked Telegram account', async () => {
      // Learner A links Telegram account T1
      const codeA1 = (await service.issueLinkCode(learnerA)).code;
      await service.linkAccount({
        code: codeA1,
        telegramUserId: '987654321',
        telegramChatId: '987654321',
        chatType: 'private',
      });

      // Learner A generates a new code and tries to link Telegram account T2 without unlinking T1
      const codeA2 = (await service.issueLinkCode(learnerA)).code;
      const secondLink = await service.linkAccount({
        code: codeA2,
        telegramUserId: '123456789', // Different Telegram account
        telegramChatId: '123456789',
        chatType: 'private',
      });
      expect(secondLink.success).toBe(false);
      if (!secondLink.success) {
        expect(secondLink.reason).toBe('learner_already_linked');
      }
    });

    it('ensures usernames never establish learner access; only numeric ID authenticates', async () => {
      const { code } = await service.issueLinkCode(learnerA);
      await service.linkAccount({
        code,
        telegramUserId: '987654321',
        telegramChatId: '987654321',
        chatType: 'private',
        telegramUsername: 'alice_real',
      });

      // An attacker claiming username "alice_real" with a different numeric user ID gets null
      const attackerPrincipal = await service.resolveLearner('999999999');
      expect(attackerPrincipal).toBeNull();

      // Even if legitimate user changes username, numeric user ID resolves the learner
      const realPrincipal = await service.resolveLearner('987654321');
      expect(realPrincipal).toEqual(learnerA);
    });
  });

  describe('Unlinking & revocation', () => {
    it('revokes protected access when learner unlinks via web/API', async () => {
      const { code } = await service.issueLinkCode(learnerA);
      await service.linkAccount({
        code,
        telegramUserId: '987654321',
        telegramChatId: '987654321',
        chatType: 'private',
      });

      // Verify access before unlink
      expect(await service.resolveLearner('987654321')).toEqual(learnerA);

      // Learner unlinks
      const unlinked = await service.unlinkByLearner(learnerA);
      expect(unlinked).toBe(true);

      // Subsequent access is revoked immediately
      expect(await service.resolveLearner('987654321')).toBeNull();

      // Status shows not linked
      const status = await service.getStatus(learnerA);
      expect(status.linked).toBe(false);
    });

    it('revokes protected access when unlinked from Telegram (/unlink)', async () => {
      const { code } = await service.issueLinkCode(learnerA);
      await service.linkAccount({
        code,
        telegramUserId: '987654321',
        telegramChatId: '987654321',
        chatType: 'private',
      });

      // User sends /unlink in private chat
      const unlinked = await service.unlinkByTelegram({
        telegramUserId: '987654321',
        chatType: 'private',
      });
      expect(unlinked).toBe(true);

      // Subsequent protected access is revoked
      expect(await service.resolveLearner('987654321')).toBeNull();
    });

    it('refuses unlinking from unapproved group chats', async () => {
      const { code } = await service.issueLinkCode(learnerA);
      await service.linkAccount({
        code,
        telegramUserId: '987654321',
        telegramChatId: '987654321',
        chatType: 'private',
      });

      const unlinked = await service.unlinkByTelegram({
        telegramUserId: '987654321',
        chatType: 'group',
      });
      expect(unlinked).toBe(false);

      // Access is NOT revoked from group chat command
      expect(await service.resolveLearner('987654321')).toEqual(learnerA);
    });
  });

  describe('Incoming update authenticity verification', () => {
    describe('verifyWebhookSecret', () => {
      it('accepts exact matching secret token header', () => {
        expect(verifyWebhookSecret('my-secret-123', 'my-secret-123')).toBe(true);
      });

      it('rejects mismatched secret token header', () => {
        expect(verifyWebhookSecret('wrong-secret', 'my-secret-123')).toBe(false);
      });

      it('rejects missing or empty secret token header', () => {
        expect(verifyWebhookSecret(undefined, 'my-secret-123')).toBe(false);
        expect(verifyWebhookSecret('', 'my-secret-123')).toBe(false);
      });
    });

    describe('verifyTelegramInitData', () => {
      function generateValidInitData(user: object, authDateSec: number, token: string): string {
        const userStr = JSON.stringify(user);
        const dataCheckString = `auth_date=${authDateSec}\nquery_id=AAHdF6IQAAAAAN0XohDhrOrc\nuser=${userStr}`;
        const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
        const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        return `query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=${encodeURIComponent(userStr)}&auth_date=${authDateSec}&hash=${hash}`;
      }

      it('validates authentic Telegram initData and extracts user', () => {
        const userObj = { id: 987654321, first_name: 'Alice', username: 'alice' };
        const authDateSec = Math.floor(currentTime.getTime() / 1000) - 300; // 5 min ago
        const initData = generateValidInitData(userObj, authDateSec, botToken);

        const result = verifyTelegramInitData(initData, botToken, 24 * 3600 * 1000, currentTime);
        expect(result.valid).toBe(true);
        expect(result.user?.id).toBe('987654321');
        expect(result.user?.username).toBe('alice');
      });

      it('rejects tampered initData hash', () => {
        const userObj = { id: 987654321, first_name: 'Alice' };
        const authDateSec = Math.floor(currentTime.getTime() / 1000) - 300;
        const initData = generateValidInitData(userObj, authDateSec, botToken);
        const tampered = initData.replace('hash=', 'hash=tampered');

        const result = verifyTelegramInitData(tampered, botToken, 24 * 3600 * 1000, currentTime);
        expect(result.valid).toBe(false);
      });

      it('rejects expired initData older than maxAgeMs', () => {
        const userObj = { id: 987654321, first_name: 'Alice' };
        // 25 hours ago
        const authDateSec = Math.floor(currentTime.getTime() / 1000) - 25 * 3600;
        const initData = generateValidInitData(userObj, authDateSec, botToken);

        const result = verifyTelegramInitData(
          initData,
          botToken,
          24 * 3600 * 1000, // 24 hour max age
          currentTime,
        );
        expect(result.valid).toBe(false);
      });
    });
  });

  describe('Webhook update handling', () => {
    it('rejects incoming webhook when secret token header is invalid or missing', async () => {
      const update: TelegramUpdate = {
        updateId: 100,
        message: {
          messageId: 1,
          chat: { id: '987654321', type: 'private' },
          from: { id: '987654321', isBot: false },
          date: Math.floor(currentTime.getTime() / 1000),
          text: '/start some_code',
        },
      };

      // Missing secret header
      const missing = await service.handleWebhookUpdate(update, undefined);
      expect(missing.status).toBe('unauthorized');

      // Invalid secret header
      const invalid = await service.handleWebhookUpdate(update, 'wrong-token');
      expect(invalid.status).toBe('unauthorized');
    });

    it('links learner upon receiving /start <code> with valid secret token', async () => {
      const { code } = await service.issueLinkCode(learnerA);
      const update: TelegramUpdate = {
        updateId: 101,
        message: {
          messageId: 2,
          chat: { id: '987654321', type: 'private' },
          from: { id: '987654321', isBot: false, username: 'alice' },
          date: Math.floor(currentTime.getTime() / 1000),
          text: `/start ${code}`,
        },
      };

      const result = await service.handleWebhookUpdate(update, webhookSecret);
      expect(result.status).toBe('linked');
      if (result.status === 'linked') {
        expect(result.identity.learnerId).toBe(learnerA.id);
      }

      // Replay fails
      const replay = await service.handleWebhookUpdate(update, webhookSecret);
      expect(replay.status).toBe('link_failed');
    });

    it('rejects updates from group chats', async () => {
      const { code } = await service.issueLinkCode(learnerA);
      const groupUpdate: TelegramUpdate = {
        updateId: 102,
        message: {
          messageId: 3,
          chat: { id: '-100123456789', type: 'supergroup', title: 'Public Group' },
          from: { id: '987654321', isBot: false },
          date: Math.floor(currentTime.getTime() / 1000),
          text: `/start ${code}`,
        },
      };

      const result = await service.handleWebhookUpdate(groupUpdate, webhookSecret);
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toBe('group_chats_not_allowed');
      }
    });

    it('unlinks account upon receiving /unlink in private chat', async () => {
      const { code } = await service.issueLinkCode(learnerA);
      await service.linkAccount({
        code,
        telegramUserId: '987654321',
        telegramChatId: '987654321',
        chatType: 'private',
      });

      const unlinkUpdate: TelegramUpdate = {
        updateId: 103,
        message: {
          messageId: 4,
          chat: { id: '987654321', type: 'private' },
          from: { id: '987654321', isBot: false },
          date: Math.floor(currentTime.getTime() / 1000),
          text: '/unlink',
        },
      };

      const result = await service.handleWebhookUpdate(unlinkUpdate, webhookSecret);
      expect(result.status).toBe('unlinked');
      if (result.status === 'unlinked') {
        expect(result.unlinked).toBe(true);
      }

      // Verified unlinked
      expect(await service.resolveLearner('987654321')).toBeNull();
    });
  });

  describe('Reusing approved job answers in Telegram (T3-019-C)', () => {
    let mockJobRepo: JobRepository;
    let jobAnswers: JobAnswers;
    let mockSendMessage: Mock<
      (params: { chatId: string | number; text: string }) => Promise<boolean>
    >;
    let mockSender: TelegramSender;
    let activeJob: JobRecord;
    let expiredJob: JobRecord;

    beforeEach(async () => {
      activeJob = {
        id: 'job-data-clerk-01',
        title: 'Data Entry and Records Clerk',
        organization: 'Ethio Tech Solutions',
        category: 'administrative',
        location: 'Bole, Addis Ababa',
        description: 'Transcribe bilingual forms and verify records. 40+ WPM required.',
        sourceUrl: 'https://digitalbridge.et/jobs/data-entry-clerk',
        postedAt: new Date('2026-11-01T08:00:00Z'),
        expiresAt: new Date('2026-12-31T23:59:59Z'),
        status: 'active',
        version: 'starter-1.0',
        publicationId: 'pub-data-01',
        withdrawn: false,
        isDemo: true,
        provenance: { kind: 'demo', note: 'test' },
        importedAt: currentTime,
      };

      expiredJob = {
        id: 'job-va-specialist-02',
        title: 'Virtual Assistant Specialist',
        organization: 'Savanna Digital Services',
        category: 'administrative',
        location: 'Addis Ababa (Bole / Remote)',
        description: 'Executive calendar management and client correspondence.',
        sourceUrl: 'https://digitalbridge.et/jobs/va-specialist',
        postedAt: new Date('2026-09-01T08:00:00Z'),
        expiresAt: new Date('2026-11-01T00:00:00Z'),
        status: 'expired',
        version: 'starter-1.0',
        publicationId: 'pub-va-02',
        withdrawn: false,
        isDemo: true,
        provenance: { kind: 'demo', note: 'test' },
        importedAt: currentTime,
      };

      mockJobRepo = {
        importJob: () => Promise.reject(new Error('not implemented')),
        getJob: (id: string) => {
          if (id === activeJob.id) return Promise.resolve(activeJob);
          if (id === expiredJob.id) return Promise.resolve(expiredJob);
          return Promise.resolve(null);
        },
        listJobs: () => Promise.resolve([activeJob, expiredJob]),
        getPublicationEvent: () => Promise.resolve(null),
      };

      jobAnswers = new JobAnswers(mockJobRepo);
      mockSendMessage = vi.fn(() => Promise.resolve(true));
      mockSender = {
        sendMessage: (params) => mockSendMessage(params),
      };

      service = new TelegramLinkService(repository, {
        webhookSecret,
        botToken,
        jobAnswers,
        sender: mockSender,
        now,
      });

      // Link learnerA to Telegram user 987654321
      const { code } = await service.issueLinkCode(learnerA);
      await service.linkAccount({
        code,
        telegramUserId: '987654321',
        telegramChatId: '987654321',
        chatType: 'private',
        telegramUsername: 'alice_telegram',
      });
    });

    it('answers active job inquiries with approved citations and outbound Telegram delivery', async () => {
      const update: TelegramUpdate = {
        updateId: 201,
        message: {
          messageId: 10,
          chat: { id: '987654321', type: 'private' },
          from: { id: '987654321', isBot: false },
          date: Math.floor(currentTime.getTime() / 1000),
          text: 'Tell me about the Data Entry Clerk opening',
        },
      };

      const result = await service.handleWebhookUpdate(update, webhookSecret);
      expect(result.status).toBe('answered');
      if (result.status === 'answered') {
        expect(result.kind).toBe('answered');
        expect(result.matchedJobId).toBe(activeJob.id);
        expect(result.answer).toContain('Ethio Tech Solutions');
        expect(result.answer).toContain(activeJob.sourceUrl);
        expect(result.citations).toHaveLength(1);
        expect(result.citations[0]?.sourceId).toBe(activeJob.id);
        expect(result.citations[0]?.url).toBe(activeJob.sourceUrl);
      }

      // Outbound delivery via sender
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const sentParams = mockSendMessage.mock.calls[0]?.[0];
      expect(sentParams?.chatId).toBe('987654321');
      expect(sentParams?.text).toContain('Ethio Tech Solutions');
    });

    it('answers expired job questions by explicitly stating the position is closed', async () => {
      const update: TelegramUpdate = {
        updateId: 202,
        message: {
          messageId: 11,
          chat: { id: '987654321', type: 'private' },
          from: { id: '987654321', isBot: false },
          date: Math.floor(currentTime.getTime() / 1000),
          text: 'Is the Virtual Assistant position open?',
        },
      };

      const result = await service.handleWebhookUpdate(update, webhookSecret);
      expect(result.status).toBe('answered');
      if (result.status === 'answered') {
        expect(result.kind).toBe('answered');
        expect(result.matchedJobId).toBe(expiredJob.id);
        expect(result.answer).toContain('expired');
        expect(result.answer).toContain('no longer open for applications');
        expect(result.citations).toHaveLength(1);
        expect(result.citations[0]?.sourceId).toBe(expiredJob.id);
      }
    });

    it('provides honest limitations without web search for unknown job questions', async () => {
      const update: TelegramUpdate = {
        updateId: 203,
        message: {
          messageId: 12,
          chat: { id: '987654321', type: 'private' },
          from: { id: '987654321', isBot: false },
          date: Math.floor(currentTime.getTime() / 1000),
          text: 'Does Google have open software engineer jobs in Addis Ababa?',
        },
      };

      const result = await service.handleWebhookUpdate(update, webhookSecret);
      expect(result.status).toBe('answered');
      if (result.status === 'answered') {
        expect(result.kind).toBe('insufficient_evidence');
        expect(result.answer).toContain('do not have an approved job record');
        expect(result.citations).toEqual([]);
      }
    });

    it('identifies missing facts (salary) in approved job records truthfully', async () => {
      const update: TelegramUpdate = {
        updateId: 204,
        message: {
          messageId: 13,
          chat: { id: '987654321', type: 'private' },
          from: { id: '987654321', isBot: false },
          date: Math.floor(currentTime.getTime() / 1000),
          text: 'What is the salary for the Data Entry Clerk job?',
        },
      };

      const result = await service.handleWebhookUpdate(update, webhookSecret);
      expect(result.status).toBe('answered');
      if (result.status === 'answered') {
        expect(result.kind).toBe('insufficient_evidence');
        expect(result.answer).toContain('does not specify salary information');
        expect(result.answer).toContain(activeJob.sourceUrl);
        expect(result.citations).toHaveLength(1);
      }
    });

    it('answers career questions in Amharic with Amharic citations', async () => {
      const update: TelegramUpdate = {
        updateId: 205,
        message: {
          messageId: 14,
          chat: { id: '987654321', type: 'private' },
          from: { id: '987654321', isBot: false },
          date: Math.floor(currentTime.getTime() / 1000),
          text: 'ክፍት የሥራ መደቦች አሉ?',
        },
      };

      const result = await service.handleWebhookUpdate(update, webhookSecret);
      expect(result.status).toBe('answered');
      if (result.status === 'answered') {
        expect(result.answerLang).toBe('am');
        expect(result.answer).toContain('በአሁኑ ወቅት ክፍት የሆኑ የተረጋገጡ የሥራ መደቦች');
        expect(result.citations.length).toBeGreaterThan(0);
      }
    });

    it('enforces channel identity and rejects unlinked Telegram users from accessing job records', async () => {
      const unlinkedUpdate: TelegramUpdate = {
        updateId: 206,
        message: {
          messageId: 15,
          chat: { id: '444444444', type: 'private' },
          from: { id: '444444444', isBot: false },
          date: Math.floor(currentTime.getTime() / 1000),
          text: 'What jobs are available?',
        },
      };

      const result = await service.handleWebhookUpdate(unlinkedUpdate, webhookSecret);
      expect(result.status).toBe('unauthenticated');
    });

    it('rejects job questions sent to unapproved group chats or from bots', async () => {
      const groupUpdate: TelegramUpdate = {
        updateId: 207,
        message: {
          messageId: 16,
          chat: { id: '-100888888', type: 'supergroup', title: 'Open Jobs Group' },
          from: { id: '987654321', isBot: false },
          date: Math.floor(currentTime.getTime() / 1000),
          text: 'What jobs are available?',
        },
      };

      const groupResult = await service.handleWebhookUpdate(groupUpdate, webhookSecret);
      expect(groupResult.status).toBe('rejected');
      if (groupResult.status === 'rejected') {
        expect(groupResult.reason).toBe('group_chats_not_allowed');
      }

      const botUpdate: TelegramUpdate = {
        updateId: 208,
        message: {
          messageId: 17,
          chat: { id: '987654321', type: 'private' },
          from: { id: '987654321', isBot: true },
          date: Math.floor(currentTime.getTime() / 1000),
          text: 'What jobs are available?',
        },
      };

      const botResult = await service.handleWebhookUpdate(botUpdate, webhookSecret);
      expect(botResult.status).toBe('rejected');
      if (botResult.status === 'rejected') {
        expect(botResult.reason).toBe('bots_not_allowed');
      }
    });

    it('enforces replay prevention: duplicate update_id returns identical result without re-evaluating use case', async () => {
      const answerSpy = vi.spyOn(jobAnswers, 'answer');

      const update: TelegramUpdate = {
        updateId: 301,
        message: {
          messageId: 20,
          chat: { id: '987654321', type: 'private' },
          from: { id: '987654321', isBot: false },
          date: Math.floor(currentTime.getTime() / 1000),
          text: 'What jobs are available?',
        },
      };

      // First delivery
      const first = await service.handleWebhookUpdate(update, webhookSecret);
      expect(first.status).toBe('answered');
      expect(answerSpy).toHaveBeenCalledTimes(1);

      // Replayed delivery with exact same updateId
      const second = await service.handleWebhookUpdate(update, webhookSecret);
      expect(second.status).toBe('answered');
      if (second.status === 'answered') {
        expect(second.replayed).toBe(true);
        expect(second.answer).toBe((first as { answer: string }).answer);
      }
      // jobAnswers.answer must NOT have been called again!
      expect(answerSpy).toHaveBeenCalledTimes(1);
    });

    it('enforces shared rate limits across channel requests', async () => {
      // Configure rate limiter with small limit of 2 requests
      const testLimiter = new SlidingWindowRateLimiter(2, 60_000, now);
      service = new TelegramLinkService(repository, {
        webhookSecret,
        botToken,
        jobAnswers,
        sender: mockSender,
        rateLimiter: testLimiter,
        now,
      });

      const makeUpdate = (id: number): TelegramUpdate => ({
        updateId: id,
        message: {
          messageId: id,
          chat: { id: '987654321', type: 'private' },
          from: { id: '987654321', isBot: false },
          date: Math.floor(currentTime.getTime() / 1000),
          text: 'What jobs are available?',
        },
      });

      // Request 1 -> allowed
      const res1 = await service.handleWebhookUpdate(makeUpdate(401), webhookSecret);
      expect(res1.status).toBe('answered');

      // Request 2 -> allowed
      const res2 = await service.handleWebhookUpdate(makeUpdate(402), webhookSecret);
      expect(res2.status).toBe('answered');

      // Request 3 -> rate limited!
      const res3 = await service.handleWebhookUpdate(makeUpdate(403), webhookSecret);
      expect(res3.status).toBe('rate_limited');
      if (res3.status === 'rate_limited') {
        expect(res3.message).toContain('Too many requests');
        expect(res3.retryAfterSec).toBeGreaterThan(0);
      }
    }, 15_000);

    it('revoking identity (/unlink) immediately cuts off job answer access', async () => {
      const askUpdate: TelegramUpdate = {
        updateId: 501,
        message: {
          messageId: 30,
          chat: { id: '987654321', type: 'private' },
          from: { id: '987654321', isBot: false },
          date: Math.floor(currentTime.getTime() / 1000),
          text: 'What jobs are available?',
        },
      };

      const before = await service.handleWebhookUpdate(askUpdate, webhookSecret);
      expect(before.status).toBe('answered');

      // User revokes link via /unlink
      const unlinkUpdate: TelegramUpdate = {
        updateId: 502,
        message: {
          messageId: 31,
          chat: { id: '987654321', type: 'private' },
          from: { id: '987654321', isBot: false },
          date: Math.floor(currentTime.getTime() / 1000),
          text: '/unlink',
        },
      };
      await service.handleWebhookUpdate(unlinkUpdate, webhookSecret);

      // Subsequent job question is unauthenticated
      const after = await service.handleWebhookUpdate(
        {
          updateId: 503,
          message: {
            messageId: 32,
            chat: { id: '987654321', type: 'private' },
            from: { id: '987654321', isBot: false },
            date: Math.floor(currentTime.getTime() / 1000),
            text: 'What jobs are available?',
          },
        },
        webhookSecret,
      );
      expect(after.status).toBe('unauthenticated');
    });
  });
});

class MockTelegramMessenger implements TelegramMessenger {
  readonly sentMessages: TelegramOutboundMessage[] = [];

  sendMessage(message: TelegramOutboundMessage): Promise<{ messageId?: number }> {
    this.sentMessages.push(message);
    return Promise.resolve({ messageId: this.sentMessages.length });
  }
}

class TestTutoringRepository implements TutoringRepository {
  readonly conversations: TutoringConversation[] = [];
  readonly requests: TutoringRequest[] = [];
  #counter = 1;

  createConversation(scope: OwnedScope, courseId: string): Promise<TutoringConversation | null> {
    if (!scope.courseIds.includes(courseId)) return Promise.resolve(null);
    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const conv: TutoringConversation = {
      id: `00000000-0000-0000-0000-${String(this.#counter++).padStart(12, '0')}`,
      ownerId: scope.ownerId,
      courseId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      purgedAt: null,
    };
    this.conversations.push(conv);
    return Promise.resolve(conv);
  }

  findConversation(
    scope: OwnedScope,
    conversationId: string,
  ): Promise<TutoringConversation | null> {
    const conv = this.conversations.find((c) => c.id === conversationId);
    if (!conv || conv.ownerId !== scope.ownerId || !scope.courseIds.includes(conv.courseId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(conv);
  }

  async claimRequest(
    scope: OwnedScope,
    input: ClaimRequestInput,
  ): Promise<TutorClaimResult | null> {
    if (!scope.courseIds.includes(input.courseId)) return null;

    const existing = this.requests.find(
      (r) => r.ownerId === scope.ownerId && r.requestId === input.requestId,
    );
    if (existing) {
      return { kind: 'existing', request: existing };
    }

    let convId = input.conversationId;
    if (!convId) {
      const conv = await this.createConversation(scope, input.courseId);
      if (!conv) return null;
      convId = conv.id;
    }

    const now = new Date();
    const req: TutoringRequest = {
      id: `00000000-0000-0000-0000-${String(this.#counter++).padStart(12, '0')}`,
      conversationId: convId,
      ownerId: scope.ownerId,
      courseId: input.courseId,
      requestId: input.requestId,
      question: input.question,
      state: 'pending',
      answerText: null,
      answerLang: null,
      errorReason: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: null,
      expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
      purgedAt: null,
    };
    this.requests.push(req);
    return { kind: 'claimed', request: req };
  }

  findRequestById(scope: OwnedScope, id: string): Promise<TutoringRequest | null> {
    const req = this.requests.find((r) => r.id === id);
    if (!req || req.ownerId !== scope.ownerId || !scope.courseIds.includes(req.courseId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(req);
  }

  findRequestByRequestId(scope: OwnedScope, requestId: string): Promise<TutoringRequest | null> {
    const req = this.requests.find((r) => r.requestId === requestId);
    if (!req || req.ownerId !== scope.ownerId || !scope.courseIds.includes(req.courseId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(req);
  }

  listHistory(scope: OwnedScope, courseId?: string): Promise<readonly TutoringRequest[]> {
    return Promise.resolve(
      this.requests.filter(
        (r) => r.ownerId === scope.ownerId && (!courseId || r.courseId === courseId),
      ),
    );
  }

  recordOutcome(
    scope: OwnedScope,
    requestId: string,
    outcome: RecordOutcomeInput,
  ): Promise<TutoringRequest | null> {
    const req = this.requests.find((r) => r.id === requestId);
    if (!req || req.ownerId !== scope.ownerId || !scope.courseIds.includes(req.courseId)) {
      return Promise.resolve(null);
    }
    const updated: TutoringRequest = {
      ...req,
      state: outcome.state,
      answerText: outcome.answerText ?? req.answerText,
      answerLang: outcome.answerLang ?? req.answerLang,
      errorReason: outcome.errorReason ?? req.errorReason,
      completedAt: outcome.state === 'completed' ? new Date().toISOString() : req.completedAt,
      updatedAt: new Date().toISOString(),
    };
    const index = this.requests.indexOf(req);
    this.requests[index] = updated;
    return Promise.resolve(updated);
  }

  clearHistory(scope: OwnedScope): Promise<void> {
    for (let i = this.requests.length - 1; i >= 0; i--) {
      if (this.requests[i]?.ownerId === scope.ownerId) {
        this.requests.splice(i, 1);
      }
    }
    return Promise.resolve();
  }

  purgeExpired(): Promise<number> {
    return Promise.resolve(0);
  }
}

function createTestContentAccess(): ContentAccess {
  return new ContentAccess(
    {
      search: () => Promise.resolve([]),
      resolve: (courseIds, sourceId, sectionId): Promise<CitationResult> => {
        if (sourceId === 'savanna-va1-future-of-va-industry' && courseIds.includes('course-1')) {
          const sec: CitedSection = {
            sourceId,
            sectionId,
            sourceTitle: 'The Future of the VA Industry',
            heading:
              sectionId === 'introduction'
                ? 'Introduction'
                : 'Artificial Intelligence and the Future of VA Work',
            text: 'Virtual assistants support businesses with routine tasks and customer support.',
            language: 'en',
            courseId: 'course-1',
            version: 'starter-9e83ac7',
            anchor: sectionId,
            provenance: {
              kind: 'organiser',
              repository: 'alx-africa/Savanna-static-pages',
              commit: '9e83ac7',
              path: 'pages/concept-with-navigation.html',
            },
          };
          return Promise.resolve({ kind: 'section', section: sec });
        }
        if (sourceId === 'demo-time-management-am' && courseIds.includes('course-2')) {
          const sec: CitedSection = {
            sourceId,
            sectionId,
            sourceTitle: 'የጊዜ አጠቃቀም መመሪያ',
            heading: sectionId === 'planning' ? 'እቅድ ማውጣት' : 'እረፍት መውሰድ',
            text: 'እቅድ ማውጣት የቀን ስራዎችን በቅደም ተከተል ለማከናወን ይረዳል።',
            language: 'am',
            courseId: 'course-2',
            version: 'demo-1',
            anchor: null,
            provenance: { kind: 'demo', note: 'test' },
          };
          return Promise.resolve({ kind: 'section', section: sec });
        }
        return Promise.resolve({ kind: 'not_found' });
      },
    },
    [],
  );
}

describe('formatTelegramTutorResponse (T3-012-B)', () => {
  it('returns raw answer text when citations array is empty', () => {
    const raw = 'I do not have an approved course answer for that question in the materials.';
    expect(formatTelegramTutorResponse(raw, [], 'en')).toBe(raw);
  });

  it('formats English citations with source, section title, and reference', () => {
    const answer = 'In some reports, a "virtual assistant" refers to AI software assistants.';
    const citations = [
      {
        sourceId: 'savanna-va1-future-of-va-industry',
        sectionId: 'introduction',
        sourceTitle: 'The Future of the VA Industry',
        heading: 'Introduction',
      },
    ];

    const formatted = formatTelegramTutorResponse(answer, citations, 'en');
    expect(formatted).toContain(answer);
    expect(formatted).toContain('Sources & Citations:');
    expect(formatted).toContain(
      '• The Future of the VA Industry — Introduction (savanna-va1-future-of-va-industry#introduction)',
    );
  });

  it('formats Amharic citations with Amharic header and reference', () => {
    const answer = 'እቅድ ማውጣት የቀን ስራዎችን በቅደም ተከተል ለማከናወን ይረዳል።';
    const citations = [
      {
        sourceId: 'demo-time-management-am',
        sectionId: 'planning',
        sourceTitle: 'የጊዜ አጠቃቀም መመሪያ',
        heading: 'እቅድ ማውጣት',
      },
    ];

    const formatted = formatTelegramTutorResponse(answer, citations, 'am');
    expect(formatted).toContain(answer);
    expect(formatted).toContain('ምንጮች እና ጥቅሶች፡');
    expect(formatted).toContain('• የጊዜ አጠቃቀም መመሪያ — እቅድ ማውጣት (demo-time-management-am#planning)');
  });
});

describe('Telegram Tutoring Answers Use Case (T3-012-B)', () => {
  let linkRepo: InMemoryTelegramLinkRepository;
  let tutoringRepo: TestTutoringRepository;
  let messenger: MockTelegramMessenger;
  let content: ContentAccess;
  let faq: FaqProvider;
  let tutoring: Tutoring;
  let service: TelegramLinkService;
  const webhookSecret = 'test-webhook-secret-token-123456';
  let clock: Date;

  beforeEach(async () => {
    clock = new Date('2026-11-15T10:00:00Z');
    linkRepo = new InMemoryTelegramLinkRepository();
    tutoringRepo = new TestTutoringRepository();
    messenger = new MockTelegramMessenger();
    content = createTestContentAccess();
    faq = new FaqProvider(content);
    tutoring = new Tutoring(tutoringRepo, faq, undefined, content);

    service = new TelegramLinkService(linkRepo, {
      webhookSecret,
      botToken: '123456:fake-token',
      now: () => clock,
      tutoring,
      content,
      messenger,
    });

    // Link learnerA to Telegram user 987654321
    const { code } = await service.issueLinkCode(learnerA);
    await service.linkAccount({
      code,
      telegramUserId: '987654321',
      telegramChatId: '987654321',
      chatType: 'private',
      telegramUsername: 'learner_alice',
    });
  });

  it('translates authenticated Telegram question into tutoring answer with citations', async () => {
    const update: TelegramUpdate = {
      updateId: 201,
      message: {
        messageId: 10,
        chat: { id: '987654321', type: 'private' },
        from: { id: '987654321', isBot: false, username: 'learner_alice' },
        date: Math.floor(clock.getTime() / 1000),
        text: 'What is a virtual assistant?',
      },
    };

    const result = await service.handleWebhookUpdate(update, webhookSecret);
    expect(result.status).toBe('answered');
    if (result.status === 'answered') {
      expect(result.kind).toBe('answered');
      expect(result.lang).toBe('en');
      expect(result.answer).toContain('Sources & Citations:');
      expect(result.answer).toContain('savanna-va1-future-of-va-industry#introduction');
      expect(result.citations).toHaveLength(1);
      expect(result.requestId).toBe('telegram-update-201');
    }

    // Verify outbound message was delivered to chat
    expect(messenger.sentMessages).toHaveLength(1);
    expect(messenger.sentMessages[0]?.chatId).toBe('987654321');
    expect(messenger.sentMessages[0]?.text).toContain(
      'savanna-va1-future-of-va-industry#introduction',
    );
    expect(tutoringRepo.requests).toHaveLength(1);
  });

  it('handles duplicate updates idempotently causing only one logical question', async () => {
    const update: TelegramUpdate = {
      updateId: 202,
      message: {
        messageId: 11,
        chat: { id: '987654321', type: 'private' },
        from: { id: '987654321', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'What is a virtual assistant?',
      },
    };

    // First arrival
    const first = await service.handleWebhookUpdate(update, webhookSecret);
    expect(first.status).toBe('answered');
    expect(tutoringRepo.requests).toHaveLength(1);
    const initialRequestId = tutoringRepo.requests[0]?.id;

    // Second arrival (replay of same update_id)
    const second = await service.handleWebhookUpdate(update, webhookSecret);
    expect(second.status).toBe('answered');
    if (first.status === 'answered' && second.status === 'answered') {
      expect(second.rawAnswer).toBe(first.rawAnswer);
      expect(second.requestId).toBe(first.requestId);
    }

    // Still exactly 1 row in tutoring repository - no duplicate logical question!
    expect(tutoringRepo.requests).toHaveLength(1);
    expect(tutoringRepo.requests[0]?.id).toBe(initialRequestId);
  });

  it('returns honest refusal without citations for unsupported question matching web flow', async () => {
    const update: TelegramUpdate = {
      updateId: 203,
      message: {
        messageId: 12,
        chat: { id: '987654321', type: 'private' },
        from: { id: '987654321', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'What is the capital of France?',
      },
    };

    const result = await service.handleWebhookUpdate(update, webhookSecret);
    expect(result.status).toBe('answered');
    if (result.status === 'answered') {
      expect(result.kind).toBe('insufficient_evidence');
      expect(result.citations).toHaveLength(0);
      expect(result.answer).toBe(
        'I do not have an approved course answer for that question in the materials.',
      );
    }

    const lastMsg = messenger.sentMessages[messenger.sentMessages.length - 1];
    expect(lastMsg?.text).toBe(
      'I do not have an approved course answer for that question in the materials.',
    );
  });

  it('matches web flow for Amharic question and refusal', async () => {
    // Unsupported Amharic question
    const update: TelegramUpdate = {
      updateId: 204,
      message: {
        messageId: 13,
        chat: { id: '987654321', type: 'private' },
        from: { id: '987654321', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'የኢትዮጵያ ዋና ከተማ ማን ናት?',
      },
    };

    const result = await service.handleWebhookUpdate(update, webhookSecret);
    expect(result.status).toBe('answered');
    if (result.status === 'answered') {
      expect(result.kind).toBe('insufficient_evidence');
      expect(result.lang).toBe('am');
      expect(result.citations).toHaveLength(0);
      expect(result.answer).toBe('በተሰጠው የትምህርት መረጃ ውስጥ ለቀረበው ጥያቄ የተረጋገጠ መልስ አልተገኘም።');
    }
  });

  it('allows learner to follow an authorised citation via /cite', async () => {
    const update: TelegramUpdate = {
      updateId: 205,
      message: {
        messageId: 14,
        chat: { id: '987654321', type: 'private' },
        from: { id: '987654321', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: '/cite savanna-va1-future-of-va-industry introduction',
      },
    };

    const result = await service.handleWebhookUpdate(update, webhookSecret);
    expect(result.status).toBe('citation');
    if (result.status === 'citation') {
      expect(result.sourceId).toBe('savanna-va1-future-of-va-industry');
      expect(result.sectionId).toBe('introduction');
      expect(result.heading).toBe('Introduction');
      expect(result.text).toContain('Virtual assistants support businesses');
    }

    const lastMsg = messenger.sentMessages[messenger.sentMessages.length - 1];
    expect(lastMsg?.text).toContain('The Future of the VA Industry');
    expect(lastMsg?.text).toContain('Introduction');
  });

  it('rejects /cite for citations outside learner course grants', async () => {
    // learnerA only has course-1, not course-2
    const update: TelegramUpdate = {
      updateId: 206,
      message: {
        messageId: 15,
        chat: { id: '987654321', type: 'private' },
        from: { id: '987654321', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: '/cite demo-time-management-am planning',
      },
    };

    const result = await service.handleWebhookUpdate(update, webhookSecret);
    expect(result.status).toBe('citation');
    if (result.status === 'citation') {
      expect(result.text).toContain('not accessible');
    }
  });

  it('supports /consent on and /consent off matching web consent flow', async () => {
    // 1. Toggle consent on
    const updateOn: TelegramUpdate = {
      updateId: 207,
      message: {
        messageId: 16,
        chat: { id: '987654321', type: 'private' },
        from: { id: '987654321', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: '/consent on',
      },
    };

    const resOn = await service.handleWebhookUpdate(updateOn, webhookSecret);
    expect(resOn.status).toBe('preference_updated');
    if (resOn.status === 'preference_updated') {
      expect(resOn.externalConsent).toBe(true);
    }

    const statusAfterOn = await service.getStatus(learnerA);
    expect(statusAfterOn.externalConsent).toBe(true);

    // 2. Toggle consent off
    const updateOff: TelegramUpdate = {
      updateId: 208,
      message: {
        messageId: 17,
        chat: { id: '987654321', type: 'private' },
        from: { id: '987654321', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: '/consent off',
      },
    };

    const resOff = await service.handleWebhookUpdate(updateOff, webhookSecret);
    expect(resOff.status).toBe('preference_updated');
    if (resOff.status === 'preference_updated') {
      expect(resOff.externalConsent).toBe(false);
    }
  });

  it('rejects /course when switching to an ungranted course', async () => {
    const update: TelegramUpdate = {
      updateId: 209,
      message: {
        messageId: 18,
        chat: { id: '987654321', type: 'private' },
        from: { id: '987654321', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: '/course course-3', // Learner A only has course-1
      },
    };

    const result = await service.handleWebhookUpdate(update, webhookSecret);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('course_not_granted');
    }
  });

  it('sends unlinked guidance notice when unlinked Telegram user asks a question', async () => {
    const unlinkedUpdate: TelegramUpdate = {
      updateId: 210,
      message: {
        messageId: 19,
        chat: { id: '999999999', type: 'private' },
        from: { id: '999999999', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'What is a virtual assistant?',
      },
    };

    const result = await service.handleWebhookUpdate(unlinkedUpdate, webhookSecret);
    expect(result.status).toBe('unauthenticated');

    const lastMsg = messenger.sentMessages[messenger.sentMessages.length - 1];
    expect(lastMsg?.chatId).toBe('999999999');
    expect(lastMsg?.text).toContain('/start <code>');
  });

  it('keeps tokens and secrets out of messages and results', async () => {
    const update: TelegramUpdate = {
      updateId: 211,
      message: {
        messageId: 20,
        chat: { id: '987654321', type: 'private' },
        from: { id: '987654321', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'What is a virtual assistant?',
      },
    };

    const result = await service.handleWebhookUpdate(update, webhookSecret);
    expect(result.status).toBe('answered');
    if (result.status === 'answered') {
      expect(result.answer).not.toContain(webhookSecret);
      expect(result.answer).not.toContain('fake-token');
    }

    for (const msg of messenger.sentMessages) {
      expect(msg.text).not.toContain(webhookSecret);
      expect(msg.text).not.toContain('fake-token');
    }
  });
});

describe('Telegram Routes HTTP Integration (T3-012-B)', () => {
  let linkRepo: InMemoryTelegramLinkRepository;
  let tutoringRepo: TestTutoringRepository;
  let messenger: MockTelegramMessenger;
  let content: ContentAccess;
  let faq: FaqProvider;
  let tutoring: Tutoring;
  let service: TelegramLinkService;
  const webhookSecret = 'route-test-secret-456';
  const clock = new Date('2026-11-15T10:00:00Z');

  const tokenA = 'bearer-token-a-1234567890123456';
  const tokenB = 'bearer-token-b-1234567890123456';
  const tokenSupport = 'bearer-token-support-1234567890';

  function buildRouteApp() {
    const app = Fastify();
    const resolvePrincipal = {
      execute: (token: string) => {
        if (token === tokenA) return Promise.resolve(learnerA);
        if (token === tokenB) return Promise.resolve(learnerB);
        if (token === tokenSupport) return Promise.resolve(supportStaff);
        return Promise.resolve(null);
      },
    } as unknown as ResolvePrincipal;

    registerTelegramRoutes(app, resolvePrincipal, service);
    return app;
  }

  beforeEach(async () => {
    linkRepo = new InMemoryTelegramLinkRepository();
    tutoringRepo = new TestTutoringRepository();
    messenger = new MockTelegramMessenger();
    content = createTestContentAccess();
    faq = new FaqProvider(content);
    tutoring = new Tutoring(tutoringRepo, faq, undefined, content);

    service = new TelegramLinkService(linkRepo, {
      webhookSecret,
      botToken: '123456:route-token',
      now: () => clock,
      tutoring,
      content,
      messenger,
    });

    // Link learnerA
    const { code } = await service.issueLinkCode(learnerA);
    await service.linkAccount({
      code,
      telegramUserId: '12345678',
      telegramChatId: '12345678',
      chatType: 'private',
    });
  });

  it('POST /api/telegram/webhook answers question with 200 and citations', async () => {
    const app = buildRouteApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
        payload: {
          update_id: 301,
          message: {
            message_id: 1,
            from: { id: 12345678, is_bot: false },
            chat: { id: 12345678, type: 'private' },
            date: Math.floor(clock.getTime() / 1000),
            text: 'What is a virtual assistant?',
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        ok: boolean;
        status: string;
        answer: string;
        citations: Array<{ sourceId: string; sectionId: string }>;
        requestId: string;
      }>();
      expect(body.ok).toBe(true);
      expect(body.status).toBe('answered');
      expect(body.answer).toContain('Sources & Citations:');
      expect(body.citations.length).toBeGreaterThan(0);
      expect(body.requestId).toBe('telegram-update-301');
    } finally {
      await app.close();
    }
  });

  it('POST /api/telegram/webhook returns honest refusal on unsupported question', async () => {
    const app = buildRouteApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
        payload: {
          update_id: 302,
          message: {
            message_id: 2,
            from: { id: 12345678, is_bot: false },
            chat: { id: 12345678, type: 'private' },
            date: Math.floor(clock.getTime() / 1000),
            text: 'What is the capital of France?',
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        ok: boolean;
        status: string;
        answer: string;
        citations: unknown[];
      }>();
      expect(body.ok).toBe(true);
      expect(body.status).toBe('answered');
      expect(body.citations).toHaveLength(0);
      expect(body.answer).toBe(
        'I do not have an approved course answer for that question in the materials.',
      );
    } finally {
      await app.close();
    }
  });

  it('PATCH /api/telegram/preferences updates externalConsent and activeCourseId', async () => {
    const app = buildRouteApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/telegram/preferences',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { externalConsent: true, activeCourseId: 'course-1' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ externalConsent: true, activeCourseId: 'course-1' });

      // Reject course not granted
      const reject = await app.inject({
        method: 'PATCH',
        url: '/api/telegram/preferences',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { activeCourseId: 'ungranted-course' },
      });
      expect(reject.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('Telegram Voice Transcript Review Flow (T3-013-A)', () => {
  let linkRepo: InMemoryTelegramLinkRepository;
  let tutoringRepo: TestTutoringRepository;
  let content: ContentAccess;
  let faq: FaqProvider;
  let tutoring: Tutoring;
  let service: TelegramLinkService;
  let clock: Date;
  const webhookSecret = 'voice-webhook-secret';

  class MockVoiceTelegramClient implements TelegramClient {
    readonly sentMessages: TelegramSendMessageParams[] = [];
    readonly callbackAnswers: TelegramAnswerCallbackParams[] = [];
    getFileResult: TelegramGetFileResult = {
      ok: true,
      filePath: 'voice/voice_0.oga',
      fileSize: 1024,
    };
    filePayload: Uint8Array = Buffer.from(
      'OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00valid-ogg-opus-payload',
    );

    sendMessage(params: TelegramSendMessageParams): Promise<TelegramSendResult> {
      this.sentMessages.push(params);
      return Promise.resolve({ ok: true, messageId: this.sentMessages.length });
    }

    readonly sentVoices: TelegramSendVoiceParams[] = [];
    sendVoiceResult: TelegramSendResult = { ok: true, messageId: 888 };
    sendVoice(params: TelegramSendVoiceParams): Promise<TelegramSendResult> {
      this.sentVoices.push(params);
      return Promise.resolve(this.sendVoiceResult);
    }

    answerCallbackQuery(params: TelegramAnswerCallbackParams): Promise<boolean> {
      this.callbackAnswers.push(params);
      return Promise.resolve(true);
    }

    getFile(): Promise<TelegramGetFileResult> {
      return Promise.resolve(this.getFileResult);
    }

    downloadFile(): Promise<Uint8Array | null> {
      return Promise.resolve(new Uint8Array(this.filePayload));
    }
  }

  class MockTranscriptionAdapter implements TranscriptionPort {
    readonly calls: TranscriptionInput[] = [];
    outcome: TranscriptionOutcome = {
      status: 'transcribed',
      transcript: 'What is a virtual assistant?',
      detectedLang: 'en',
    };

    transcribe(input: TranscriptionInput): Promise<TranscriptionOutcome> {
      this.calls.push(input);
      return Promise.resolve(this.outcome);
    }

    isAvailable(): boolean {
      return true;
    }
  }

  let mockClient: MockVoiceTelegramClient;
  let transcription: MockTranscriptionAdapter;

  beforeEach(async () => {
    linkRepo = new InMemoryTelegramLinkRepository();
    tutoringRepo = new TestTutoringRepository();
    content = createTestContentAccess();
    faq = new FaqProvider(content);
    tutoring = new Tutoring(tutoringRepo, faq, undefined, content);
    clock = new Date('2026-11-15T12:00:00Z');
    mockClient = new MockVoiceTelegramClient();
    transcription = new MockTranscriptionAdapter();

    service = new TelegramLinkService(linkRepo, {
      webhookSecret,
      botToken: '123456:voice-bot-token',
      now: () => clock,
      telegramClient: mockClient,
      transcription,
      tutoring,
      content,
    });

    // Link Learner A
    const { code } = await service.issueLinkCode(learnerA);
    await service.linkAccount({
      code,
      telegramUserId: '12345678',
      telegramChatId: '12345678',
      chatType: 'private',
    });
  });

  it('transcribes valid voice message and prompts learner with transcript and inline review buttons', async () => {
    const voiceUpdate: TelegramUpdate = {
      updateId: 401,
      message: {
        messageId: 101,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        voice: {
          file_id: 'voice-file-id-101',
          duration: 15,
          file_size: 2048,
        },
      },
    };

    const result = await service.handleWebhookUpdate(voiceUpdate, webhookSecret);
    expect(result.status).toBe('voice_prompt');
    if (result.status === 'voice_prompt') {
      expect(result.transcript).toBe('What is a virtual assistant?');
      expect(result.reviewId).toBeDefined();

      // Check review was persisted in pending state
      const review = await linkRepo.findVoiceReview(result.reviewId);
      expect(review).not.toBeNull();
      expect(review?.status).toBe('pending');
      expect(review?.transcript).toBe('What is a virtual assistant?');
      expect(review?.telegramUserId).toBe('12345678');
    }

    // Check inline keyboard buttons dispatched to TelegramClient
    expect(mockClient.sentMessages.length).toBe(1);
    const sent = mockClient.sentMessages[0]!;
    expect(sent.chatId).toBe('12345678');
    expect(sent.text).toContain('What is a virtual assistant?');
    const buttons = sent.replyMarkup?.inline_keyboard?.[0];
    expect(buttons).toBeDefined();
    expect(buttons).toHaveLength(3);
    expect(buttons![0]?.text).toBe('Ask this question');
    expect(buttons![0]?.callback_data).toContain('vt:a:');
    expect(buttons![1]?.text).toBe('Edit');
    expect(buttons![1]?.callback_data).toContain('vt:e:');
    expect(buttons![2]?.text).toBe('Discard');
    expect(buttons![2]?.callback_data).toContain('vt:d:');
  });

  it('learner approves transcript via callback query -> answers query and asks tutor', async () => {
    // 1. Send voice message
    const voiceUpdate: TelegramUpdate = {
      updateId: 402,
      message: {
        messageId: 102,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        voice: {
          file_id: 'voice-file-102',
          duration: 10,
        },
      },
    };
    const voiceResult = await service.handleWebhookUpdate(voiceUpdate, webhookSecret);
    expect(voiceResult.status).toBe('voice_prompt');
    const reviewId = (voiceResult as { reviewId: string }).reviewId;

    // 2. Click "Ask this question" (Approve)
    const approveCallback: TelegramUpdate = {
      updateId: 403,
      callbackQuery: {
        id: 'cb-approve-1',
        from: { id: '12345678', isBot: false },
        data: `vt:a:${reviewId}`,
      },
    };

    const approveResult = await service.handleWebhookUpdate(approveCallback, webhookSecret);
    expect(approveResult.status).toBe('answered');
    if (approveResult.status === 'answered') {
      expect(approveResult.answer).toContain('Sources & Citations:');
      expect(approveResult.citations.length).toBeGreaterThan(0);
    }

    // Check callback query answer
    expect(mockClient.callbackAnswers.some((a) => a.text === 'Question submitted.')).toBe(true);

    // Check review transitioned to approved
    const review = await linkRepo.findVoiceReview(reviewId);
    expect(review?.status).toBe('approved');
  });

  it('learner discards transcript via callback query -> cancels and acknowledges without asking tutor', async () => {
    // 1. Send voice message
    const voiceUpdate: TelegramUpdate = {
      updateId: 404,
      message: {
        messageId: 103,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        voice: { file_id: 'voice-file-103', duration: 10 },
      },
    };
    const voiceResult = await service.handleWebhookUpdate(voiceUpdate, webhookSecret);
    const reviewId = (voiceResult as { reviewId: string }).reviewId;

    // 2. Click "Discard"
    const discardCallback: TelegramUpdate = {
      updateId: 405,
      callbackQuery: {
        id: 'cb-discard-1',
        from: { id: '12345678', isBot: false },
        data: `vt:d:${reviewId}`,
      },
    };

    const discardResult = await service.handleWebhookUpdate(discardCallback, webhookSecret);
    expect(discardResult.status).toBe('voice_reviewed');
    if (discardResult.status === 'voice_reviewed') {
      expect(discardResult.action).toBe('discarded');
    }

    // Check callback query answer
    expect(mockClient.callbackAnswers.some((a) => a.text === 'Transcript discarded.')).toBe(true);

    // Review transitioned to discarded
    const review = await linkRepo.findVoiceReview(reviewId);
    expect(review?.status).toBe('discarded');
  });

  it('learner edits transcript -> sets awaiting_edit and next typed message answers question', async () => {
    // 1. Send voice message
    const voiceUpdate: TelegramUpdate = {
      updateId: 406,
      message: {
        messageId: 104,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        voice: { file_id: 'voice-file-104', duration: 10 },
      },
    };
    const voiceResult = await service.handleWebhookUpdate(voiceUpdate, webhookSecret);
    const reviewId = (voiceResult as { reviewId: string }).reviewId;

    // 2. Click "Edit"
    const editCallback: TelegramUpdate = {
      updateId: 407,
      callbackQuery: {
        id: 'cb-edit-1',
        from: { id: '12345678', isBot: false },
        data: `vt:e:${reviewId}`,
      },
    };

    const editResult = await service.handleWebhookUpdate(editCallback, webhookSecret);
    expect(editResult.status).toBe('voice_reviewed');
    if (editResult.status === 'voice_reviewed') {
      expect(editResult.action).toBe('awaiting_edit');
    }

    const review = await linkRepo.findVoiceReview(reviewId);
    expect(review?.status).toBe('awaiting_edit');

    // 3. Learner sends typed replacement question
    const textUpdate: TelegramUpdate = {
      updateId: 408,
      message: {
        messageId: 105,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'What is a virtual assistant?',
      },
    };

    const answerResult = await service.handleWebhookUpdate(textUpdate, webhookSecret);
    expect(answerResult.status).toBe('answered');

    // Review was resolved with edited text
    const updatedReview = await linkRepo.findVoiceReview(reviewId);
    expect(updatedReview?.status).toBe('approved');
  });

  it('rejects callback query from another Telegram user (cross-user callback forgery prevention)', async () => {
    // 1. Learner A sends voice message
    const voiceUpdate: TelegramUpdate = {
      updateId: 409,
      message: {
        messageId: 106,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        voice: { file_id: 'voice-file-106', duration: 10 },
      },
    };
    const voiceResult = await service.handleWebhookUpdate(voiceUpdate, webhookSecret);
    const reviewId = (voiceResult as { reviewId: string }).reviewId;

    // 2. Another user (e.g. 99999999) attempts to approve it
    const forgerCallback: TelegramUpdate = {
      updateId: 410,
      callbackQuery: {
        id: 'cb-forgery-1',
        from: { id: '99999999', isBot: false },
        data: `vt:a:${reviewId}`,
      },
    };

    const result = await service.handleWebhookUpdate(forgerCallback, webhookSecret);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('unauthorized_callback');
    }

    // Verify callback was answered with unauthorized notice
    expect(mockClient.callbackAnswers.some((a) => a.text?.includes('Unauthorized'))).toBe(true);

    // Verify review remained pending
    const review = await linkRepo.findVoiceReview(reviewId);
    expect(review?.status).toBe('pending');
  });

  it('rejects duplicate or replayed callback query on already resolved review', async () => {
    const voiceUpdate: TelegramUpdate = {
      updateId: 411,
      message: {
        messageId: 107,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        voice: { file_id: 'voice-file-107', duration: 10 },
      },
    };
    const voiceResult = await service.handleWebhookUpdate(voiceUpdate, webhookSecret);
    const reviewId = (voiceResult as { reviewId: string }).reviewId;

    // First approve click
    const firstClick: TelegramUpdate = {
      updateId: 412,
      callbackQuery: {
        id: 'cb-click-1',
        from: { id: '12345678', isBot: false },
        data: `vt:a:${reviewId}`,
      },
    };
    const firstResult = await service.handleWebhookUpdate(firstClick, webhookSecret);
    expect(firstResult.status).toBe('answered');

    // Second click (replay)
    const secondClick: TelegramUpdate = {
      updateId: 413,
      callbackQuery: {
        id: 'cb-click-2',
        from: { id: '12345678', isBot: false },
        data: `vt:a:${reviewId}`,
      },
    };
    const secondResult = await service.handleWebhookUpdate(secondClick, webhookSecret);
    expect(secondResult.status).toBe('rejected');
    if (secondResult.status === 'rejected') {
      expect(secondResult.reason).toBe('review_expired_or_processed');
    }
  });

  it('rejects expired voice review callback query', async () => {
    const voiceUpdate: TelegramUpdate = {
      updateId: 414,
      message: {
        messageId: 108,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        voice: { file_id: 'voice-file-108', duration: 10 },
      },
    };
    const voiceResult = await service.handleWebhookUpdate(voiceUpdate, webhookSecret);
    const reviewId = (voiceResult as { reviewId: string }).reviewId;

    // Advance clock past 15-minute TTL
    clock = new Date(clock.getTime() + 16 * 60 * 1000);

    const expiredClick: TelegramUpdate = {
      updateId: 415,
      callbackQuery: {
        id: 'cb-expired-1',
        from: { id: '12345678', isBot: false },
        data: `vt:a:${reviewId}`,
      },
    };
    const result = await service.handleWebhookUpdate(expiredClick, webhookSecret);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('review_expired_or_processed');
    }
  });

  it('anti-DoS: rejects voice message exceeding duration cap (> 120s)', async () => {
    const longVoiceUpdate: TelegramUpdate = {
      updateId: 416,
      message: {
        messageId: 109,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        voice: {
          file_id: 'voice-long',
          duration: 125, // > 120 seconds cap
        },
      },
    };

    const result = await service.handleWebhookUpdate(longVoiceUpdate, webhookSecret);
    expect(result.status).toBe('voice_error');
    if (result.status === 'voice_error') {
      expect(result.reason).toBe('voice_too_long');
    }

    // Transcription was never called
    expect(transcription.calls).toHaveLength(0);
  });

  it('anti-DoS: rejects voice message exceeding size cap (> 10MB)', async () => {
    const largeVoiceUpdate: TelegramUpdate = {
      updateId: 417,
      message: {
        messageId: 110,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        voice: {
          file_id: 'voice-large',
          duration: 30,
          file_size: 11 * 1024 * 1024, // > 10 MB cap
        },
      },
    };

    const result = await service.handleWebhookUpdate(largeVoiceUpdate, webhookSecret);
    expect(result.status).toBe('voice_error');
    if (result.status === 'voice_error') {
      expect(result.reason).toBe('voice_too_large');
    }

    // Transcription was never called
    expect(transcription.calls).toHaveLength(0);
  });

  it('content validation: rejects non-audio payload disguised as audio (magic byte mismatch)', async () => {
    // Return HTML instead of audio
    mockClient.filePayload = Buffer.from('<html><body><script>alert(1)</script></body></html>');

    const fakeVoiceUpdate: TelegramUpdate = {
      updateId: 418,
      message: {
        messageId: 111,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        voice: {
          file_id: 'fake-voice',
          duration: 10,
        },
      },
    };

    const result = await service.handleWebhookUpdate(fakeVoiceUpdate, webhookSecret);
    expect(result.status).toBe('voice_error');
    if (result.status === 'voice_error') {
      expect(result.reason).toBe('voice_unsupported_format');
    }

    // Transcription was never called
    expect(transcription.calls).toHaveLength(0);
  });

  it('handles transcription failure gracefully and preserves typed path', async () => {
    transcription.outcome = { status: 'provider_error' };

    const failingVoiceUpdate: TelegramUpdate = {
      updateId: 419,
      message: {
        messageId: 112,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        voice: {
          file_id: 'voice-fail',
          duration: 10,
        },
      },
    };

    const result = await service.handleWebhookUpdate(failingVoiceUpdate, webhookSecret);
    expect(result.status).toBe('voice_error');
    if (result.status === 'voice_error') {
      expect(result.reason).toBe('voice_transcription_failed');
    }

    // Learner can immediately type their question instead
    const typedUpdate: TelegramUpdate = {
      updateId: 420,
      message: {
        messageId: 113,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'What is a virtual assistant?',
      },
    };

    const typedResult = await service.handleWebhookUpdate(typedUpdate, webhookSecret);
    expect(typedResult.status).toBe('answered');
  });
});

describe('Telegram Speech Output Flow (T3-013-B)', () => {
  let linkRepo: InMemoryTelegramLinkRepository;
  let tutoringRepo: TestTutoringRepository;
  let content: ContentAccess;
  let faq: FaqProvider;
  let tutoring: Tutoring;
  let service: TelegramLinkService;
  let clock: Date;
  const webhookSecret = 'speech-webhook-secret';

  class MockSpeechSynthesizer implements SpeechSynthesizerProvider {
    readonly name = 'mock-speech';
    readonly calls: SpeechSynthesisRequest[] = [];
    available = true;
    shouldFail = false;
    allocatedBuffers: Buffer[] = [];

    isAvailable(): boolean {
      return this.available;
    }

    synthesize(request: SpeechSynthesisRequest): Promise<Buffer> {
      this.calls.push(request);
      if (this.shouldFail) {
        return Promise.reject(new Error('Synthetic provider failure'));
      }
      // Valid WAV 44-byte header + 10 bytes payload
      const buf = Buffer.alloc(54);
      buf.write('RIFF', 0);
      buf.write('WAVE', 8);
      buf.fill(128, 44);
      this.allocatedBuffers.push(buf);
      return Promise.resolve(buf);
    }
  }

  class MockSpeechTelegramClient implements TelegramClient {
    readonly sentMessages: TelegramSendMessageParams[] = [];
    readonly sentVoices: TelegramSendVoiceParams[] = [];
    readonly callbackAnswers: TelegramAnswerCallbackParams[] = [];
    sendVoiceResult: TelegramSendResult = { ok: true, messageId: 888 };

    sendMessage(params: TelegramSendMessageParams): Promise<TelegramSendResult> {
      this.sentMessages.push(params);
      return Promise.resolve({ ok: true, messageId: this.sentMessages.length });
    }

    sendVoice(params: TelegramSendVoiceParams): Promise<TelegramSendResult> {
      this.sentVoices.push(params);
      return Promise.resolve(this.sendVoiceResult);
    }

    answerCallbackQuery(params: TelegramAnswerCallbackParams): Promise<boolean> {
      this.callbackAnswers.push(params);
      return Promise.resolve(true);
    }
  }

  let mockClient: MockSpeechTelegramClient;
  let speechProvider: MockSpeechSynthesizer;
  let admissionController: ProviderAdmissionController;

  beforeEach(async () => {
    linkRepo = new InMemoryTelegramLinkRepository();
    tutoringRepo = new TestTutoringRepository();
    content = createTestContentAccess();
    faq = new FaqProvider(content);
    tutoring = new Tutoring(tutoringRepo, faq, undefined, content);
    clock = new Date('2026-11-15T12:00:00Z');
    mockClient = new MockSpeechTelegramClient();
    speechProvider = new MockSpeechSynthesizer();
    admissionController = new ProviderAdmissionController({ maxSpeechTextLength: 2000 });

    service = new TelegramLinkService(linkRepo, {
      webhookSecret,
      botToken: '123456:speech-bot-token',
      now: () => clock,
      telegramClient: mockClient,
      speechProvider,
      admissionController,
      tutoring,
      content,
    });

    // Link Learner A
    const { code } = await service.issueLinkCode(learnerA);
    await service.linkAccount({
      code,
      telegramUserId: '12345678',
      telegramChatId: '12345678',
      chatType: 'private',
    });
  });

  it('manages voice preference toggle with /voice on, /voice off, and query', async () => {
    // 1. /voice on
    const onUpdate: TelegramUpdate = {
      updateId: 501,
      message: {
        messageId: 201,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: '/voice on',
      },
    };
    const onResult = await service.handleWebhookUpdate(onUpdate, webhookSecret);
    expect(onResult.status).toBe('preference_updated');
    if (onResult.status === 'preference_updated') {
      expect(onResult.speechEnabled).toBe(true);
    }

    const statusAfterOn = await service.getStatus(learnerA);
    expect(statusAfterOn.speechEnabled).toBe(true);

    // 2. /voice query
    const queryUpdate: TelegramUpdate = {
      updateId: 502,
      message: {
        messageId: 202,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: '/voice',
      },
    };
    const queryResult = await service.handleWebhookUpdate(queryUpdate, webhookSecret);
    expect(queryResult.status).toBe('preference_updated');
    if (queryResult.status === 'preference_updated') {
      expect(queryResult.speechEnabled).toBe(true);
    }

    // 3. /voice off
    const offUpdate: TelegramUpdate = {
      updateId: 503,
      message: {
        messageId: 203,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: '/voice off',
      },
    };
    const offResult = await service.handleWebhookUpdate(offUpdate, webhookSecret);
    expect(offResult.status).toBe('preference_updated');
    if (offResult.status === 'preference_updated') {
      expect(offResult.speechEnabled).toBe(false);
    }

    const statusAfterOff = await service.getStatus(learnerA);
    expect(statusAfterOff.speechEnabled).toBe(false);
  });

  it('audio/text association: automatic speech delivers complete text and citations accompanied by voice note', async () => {
    // Enable speech answers
    await service.setPreferences(learnerA, { speechEnabled: true });

    const questionUpdate: TelegramUpdate = {
      updateId: 504,
      message: {
        messageId: 204,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'What is a virtual assistant?',
      },
    };

    const result = await service.handleWebhookUpdate(questionUpdate, webhookSecret);
    expect(result.status).toBe('answered');
    if (result.status === 'answered') {
      expect(result.answer).toContain('virtual assistant');
      expect(result.citations.length).toBeGreaterThan(0);
    }

    // 1. Text message was sent with complete answer and citations
    expect(mockClient.sentMessages).toHaveLength(1);
    expect(mockClient.sentMessages[0]?.text).toContain('virtual assistant');
    expect(mockClient.sentMessages[0]?.text).toContain('Sources & Citations:');

    // 2. Voice message was sent accompanying the text
    expect(mockClient.sentVoices).toHaveLength(1);
    expect(mockClient.sentVoices[0]?.chatId).toBe('12345678');
    expect(mockClient.sentVoices[0]?.replyToMessageId).toBe(1);

    // 3. Speech provider received text to synthesize
    expect(speechProvider.calls).toHaveLength(1);
    expect(speechProvider.calls[0]?.language).toBe('en');
  });

  it('on-demand speech: attaches 🔊 Listen inline button and responds to callback query with audio', async () => {
    // By default speech is not auto-sent
    const questionUpdate: TelegramUpdate = {
      updateId: 505,
      message: {
        messageId: 205,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'What is a virtual assistant?',
      },
    };

    const result = await service.handleWebhookUpdate(questionUpdate, webhookSecret);
    expect(result.status).toBe('answered');

    // Text sent with inline button
    expect(mockClient.sentMessages).toHaveLength(1);
    const inlineButtons = mockClient.sentMessages[0]?.replyMarkup?.inline_keyboard;
    expect(inlineButtons).toBeDefined();
    expect(inlineButtons?.[0]?.[0]?.text).toBe('🔊 Listen');
    expect(inlineButtons?.[0]?.[0]?.callback_data).toBe('ts:505');

    // Auto-voice was not dispatched
    expect(mockClient.sentVoices).toHaveLength(0);

    // Learner taps 🔊 Listen button
    const callbackUpdate: TelegramUpdate = {
      updateId: 506,
      callbackQuery: {
        id: 'cb-listen-1',
        from: { id: '12345678', isBot: false },
        data: 'ts:505',
        message: {
          messageId: 301,
          chat: { id: '12345678', type: 'private' },
          date: Math.floor(clock.getTime() / 1000),
        },
      },
    };

    const cbResult = await service.handleWebhookUpdate(callbackUpdate, webhookSecret);
    expect(cbResult.status).toBe('speech_sent');
    if (cbResult.status === 'speech_sent') {
      expect(cbResult.updateId).toBe(505);
    }

    // Voice was now dispatched
    expect(mockClient.sentVoices).toHaveLength(1);
    expect(mockClient.sentVoices[0]?.replyToMessageId).toBe(301);

    // Callback query answered
    expect(mockClient.callbackAnswers.some((a) => a.text === 'Audio sent')).toBe(true);
  });

  it('bilingual support: renders 🔊 አዳምጥ and requests Amharic speech for Amharic question', async () => {
    const amharicUpdate: TelegramUpdate = {
      updateId: 507,
      message: {
        messageId: 206,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'ቨርቹዋል ረዳት ምንድን ነው?',
      },
    };

    const result = await service.handleWebhookUpdate(amharicUpdate, webhookSecret);
    expect(result.status).toBe('answered');

    // Check Amharic button
    const inlineButtons = mockClient.sentMessages[0]?.replyMarkup?.inline_keyboard;
    expect(inlineButtons?.[0]?.[0]?.text).toBe('🔊 አዳምጥ');
    expect(inlineButtons?.[0]?.[0]?.callback_data).toBe('ts:507');

    // Click button
    const amCallback: TelegramUpdate = {
      updateId: 508,
      callbackQuery: {
        id: 'cb-amharic-listen',
        from: { id: '12345678', isBot: false },
        data: 'ts:507',
        message: {
          messageId: 302,
          chat: { id: '12345678', type: 'private' },
          date: Math.floor(clock.getTime() / 1000),
        },
      },
    };

    const cbResult = await service.handleWebhookUpdate(amCallback, webhookSecret);
    expect(cbResult.status).toBe('speech_sent');
    expect(speechProvider.calls.some((c) => c.language === 'am')).toBe(true);
    expect(mockClient.callbackAnswers.some((a) => a.text === 'ድምፅ ተልኳል')).toBe(true);
  });

  it('resource destruction / ephemeral memory: audio buffer is filled with 0 immediately after delivery', async () => {
    await service.setPreferences(learnerA, { speechEnabled: true });

    const questionUpdate: TelegramUpdate = {
      updateId: 509,
      message: {
        messageId: 207,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'What is a virtual assistant?',
      },
    };

    await service.handleWebhookUpdate(questionUpdate, webhookSecret);

    expect(speechProvider.allocatedBuffers).toHaveLength(1);
    const buffer = speechProvider.allocatedBuffers[0]!;

    // Every byte in the buffer must be 0 after cleanup
    const allZero = buffer.every((byte) => byte === 0);
    expect(allZero).toBe(true);
  });

  it('failure resilience: speech synthesis error preserves full readable answer and citations', async () => {
    await service.setPreferences(learnerA, { speechEnabled: true });
    speechProvider.shouldFail = true;

    const questionUpdate: TelegramUpdate = {
      updateId: 510,
      message: {
        messageId: 208,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'What is a virtual assistant?',
      },
    };

    // Does not crash or throw
    const result = await service.handleWebhookUpdate(questionUpdate, webhookSecret);
    expect(result.status).toBe('answered');
    if (result.status === 'answered') {
      expect(result.answer).toContain('virtual assistant');
      expect(result.citations.length).toBeGreaterThan(0);
    }

    // Text message was still delivered with complete content
    expect(mockClient.sentMessages).toHaveLength(1);
    expect(mockClient.sentMessages[0]?.text).toContain('virtual assistant');

    // Voice message was skipped due to error
    expect(mockClient.sentVoices).toHaveLength(0);
  });

  it('bounds verification: text exceeding maxSpeechTextLength skips synthesis but preserves text', async () => {
    // Configure tiny speech limit
    const tightController = new ProviderAdmissionController({ maxSpeechTextLength: 10 });
    const tightService = new TelegramLinkService(linkRepo, {
      webhookSecret,
      botToken: '123456:speech-bot-token',
      now: () => clock,
      telegramClient: mockClient,
      speechProvider,
      admissionController: tightController,
      tutoring,
      content,
    });

    await tightService.setPreferences(learnerA, { speechEnabled: true });

    const questionUpdate: TelegramUpdate = {
      updateId: 511,
      message: {
        messageId: 209,
        chat: { id: '12345678', type: 'private' },
        from: { id: '12345678', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'What is a virtual assistant?',
      },
    };

    const result = await tightService.handleWebhookUpdate(questionUpdate, webhookSecret);
    expect(result.status).toBe('answered');
    // Readable text was still delivered
    expect(mockClient.sentMessages).toHaveLength(1);
    // Voice synthesis was aborted due to size bound
    expect(mockClient.sentVoices).toHaveLength(0);
  });
});

describe('Telegram One-Tap Human Help (T3-041)', () => {
  class MockHelpTelegramClient implements TelegramClient {
    readonly sentMessages: TelegramSendMessageParams[] = [];
    readonly sentVoices: TelegramSendVoiceParams[] = [];
    readonly callbackAnswers: TelegramAnswerCallbackParams[] = [];

    sendMessage(params: TelegramSendMessageParams): Promise<TelegramSendResult> {
      this.sentMessages.push(params);
      return Promise.resolve({ ok: true, messageId: this.sentMessages.length });
    }

    sendVoice(params: TelegramSendVoiceParams): Promise<TelegramSendResult> {
      this.sentVoices.push(params);
      return Promise.resolve({ ok: true, messageId: 888 });
    }

    answerCallbackQuery(params: TelegramAnswerCallbackParams): Promise<boolean> {
      this.callbackAnswers.push(params);
      return Promise.resolve(true);
    }
  }

  let linkRepo: InMemoryTelegramLinkRepository;
  let mockClient: MockHelpTelegramClient;
  let tutoringRepo: TestTutoringRepository;
  let content: ContentAccess;
  let faq: FaqProvider;
  let tutoring: Tutoring;
  let helpRepo: InMemoryHelpRepository;
  let help: Help;
  let service: TelegramLinkService;
  let clock: Date;
  const webhookSecret = 'help-webhook-secret';

  class InMemoryHelpRepository implements HelpRepository {
    readonly requests = new Map<string, HelpRequest>();
    readonly preferences = new Map<string, boolean>();
    #counter = 1;

    submit(scope: OwnedScope, input: SubmitHelpInput): Promise<SubmitResult> {
      const now = new Date().toISOString();
      const req: HelpRequest = {
        id: `help-req-${this.#counter++}`,
        ownerId: scope.ownerId,
        clientRequestId: input.clientRequestId,
        contextSnapshot: input.contextSnapshot,
        consentGiven: true,
        state: 'waiting',
        createdAt: now,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        updatedAt: now,
        cancelledAt: null,
        claimedBy: null,
        claimedAt: null,
        resolvedAt: null,
        resolvedBy: null,
      };
      this.requests.set(req.id, req);
      return Promise.resolve({ kind: 'submitted', request: req });
    }

    cancel(): Promise<HelpRequest | null> {
      return Promise.resolve(null);
    }

    findById(): Promise<HelpRequest | null> {
      return Promise.resolve(null);
    }

    findByIdAsStaff(): Promise<HelpRequest | null> {
      return Promise.resolve(null);
    }

    listOwned(): Promise<readonly HelpRequest[]> {
      return Promise.resolve([]);
    }

    listQueue(): Promise<readonly QueueItem[]> {
      return Promise.resolve([]);
    }

    claimRequest(): Promise<HelpClaimResult | null> {
      return Promise.resolve(null);
    }

    resolveRequest(): Promise<HelpRequest | null> {
      return Promise.resolve(null);
    }

    addReply(): Promise<AddReplyResult | null> {
      return Promise.resolve(null);
    }

    listReplies(): Promise<readonly HelpReply[]> {
      return Promise.resolve([]);
    }

    markRepliesRead(): Promise<void> {
      return Promise.resolve();
    }

    cancelPendingIntentsForHelpRequest(): Promise<number> {
      return Promise.resolve(0);
    }

    cancelPendingIntentsForLearner(): Promise<number> {
      return Promise.resolve(0);
    }

    getNotificationPreference(scope: OwnedScope, channel: string): Promise<boolean> {
      return Promise.resolve(this.preferences.get(`${scope.ownerId}:${channel}`) ?? false);
    }

    setNotificationPreference(
      scope: OwnedScope,
      channel: string,
      optedIn: boolean,
    ): Promise<boolean> {
      this.preferences.set(`${scope.ownerId}:${channel}`, optedIn);
      return Promise.resolve(true);
    }

    optIn(scope: OwnedScope, channel: string): Promise<void> {
      this.preferences.set(`${scope.ownerId}:${channel}`, true);
      return Promise.resolve();
    }

    optOut(scope: OwnedScope, channel: string): Promise<void> {
      this.preferences.set(`${scope.ownerId}:${channel}`, false);
      return Promise.resolve();
    }
  }

  beforeEach(async () => {
    clock = new Date('2026-11-15T10:00:00Z');
    linkRepo = new InMemoryTelegramLinkRepository();
    mockClient = new MockHelpTelegramClient();
    tutoringRepo = new TestTutoringRepository();
    content = createTestContentAccess();
    faq = new FaqProvider(content);
    tutoring = new Tutoring(tutoringRepo, faq, undefined, content);
    helpRepo = new InMemoryHelpRepository();
    help = new Help(helpRepo);

    service = new TelegramLinkService(linkRepo, {
      webhookSecret,
      botToken: '123456:help-bot-token',
      now: () => clock,
      telegramClient: mockClient,
      tutoring,
      content,
      help,
    });

    // Link learnerA to Telegram user 98765432
    const { code } = await service.issueLinkCode(learnerA);
    await service.linkAccount({
      code,
      telegramUserId: '98765432',
      telegramChatId: '98765432',
      chatType: 'private',
    });
  });

  it('displays 👤 Talk to a person inline button under tutor answers', async () => {
    const questionUpdate: TelegramUpdate = {
      updateId: 701,
      message: {
        messageId: 401,
        chat: { id: '98765432', type: 'private' },
        from: { id: '98765432', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'What is a virtual assistant?',
      },
    };

    const result = await service.handleWebhookUpdate(questionUpdate, webhookSecret);
    expect(result.status).toBe('answered');

    expect(mockClient.sentMessages).toHaveLength(1);
    const keyboard = mockClient.sentMessages[0]?.replyMarkup?.inline_keyboard;
    expect(keyboard).toBeDefined();

    // Check human help button is present
    const helpBtn = keyboard?.flat().find((b) => b.text.includes('Talk to a person'));
    expect(helpBtn).toBeDefined();
    expect(helpBtn?.callback_data).toMatch(/^hlp:ask:[0-9a-f-]+$/);
  });

  it('displays Amharic 👤 ሰው ያነጋግሩ button under Amharic answers', async () => {
    const questionUpdate: TelegramUpdate = {
      updateId: 702,
      message: {
        messageId: 402,
        chat: { id: '98765432', type: 'private' },
        from: { id: '98765432', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'ቨርቹዋል ረዳት ምንድን ነው?',
      },
    };

    const result = await service.handleWebhookUpdate(questionUpdate, webhookSecret);
    expect(result.status).toBe('answered');

    const keyboard = mockClient.sentMessages[0]?.replyMarkup?.inline_keyboard;
    const amharicHelpBtn = keyboard?.flat().find((b) => b.text.includes('ሰው ያነጋግሩ'));
    expect(amharicHelpBtn).toBeDefined();
    expect(amharicHelpBtn?.callback_data).toMatch(/^hlp:ask:[0-9a-f-]+$/);
  });

  it('tapping 👤 Talk to a person displays disclosure preview with course/question context', async () => {
    // 1. Ask a question to generate a help context
    const questionUpdate: TelegramUpdate = {
      updateId: 703,
      message: {
        messageId: 403,
        chat: { id: '98765432', type: 'private' },
        from: { id: '98765432', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: 'How do I invoice clients?',
      },
    };
    await service.handleWebhookUpdate(questionUpdate, webhookSecret);

    const helpBtn = mockClient.sentMessages[0]?.replyMarkup?.inline_keyboard
      ?.flat()
      .find((b) => b.text.includes('Talk to a person'));
    const callbackData = helpBtn!.callback_data!;

    // 2. Click the help button
    const askCbUpdate: TelegramUpdate = {
      updateId: 704,
      callbackQuery: {
        id: 'cb-help-ask-1',
        from: { id: '98765432', isBot: false },
        data: callbackData,
        message: {
          messageId: 404,
          chat: { id: '98765432', type: 'private' },
          date: Math.floor(clock.getTime() / 1000),
        },
      },
    };

    const previewResult = await service.handleWebhookUpdate(askCbUpdate, webhookSecret);
    expect(previewResult.status).toBe('help_preview');

    // Message 2 should be the disclosure preview
    const previewMsg = mockClient.sentMessages[1];
    expect(previewMsg).toBeDefined();
    expect(previewMsg?.text).toContain('Human Help Request Preview');
    expect(previewMsg?.text).toContain('Course: course-1');
    expect(previewMsg?.text).toContain('How do I invoice clients?');
    expect(previewMsg?.text).toContain(
      'Only you and an authorized support coordinator will see this request',
    );

    // Check Confirm & Cancel buttons are attached
    const previewButtons = previewMsg?.replyMarkup?.inline_keyboard?.flat();
    expect(previewButtons?.some((b) => b.text.includes('Confirm & Send'))).toBe(true);
    expect(previewButtons?.some((b) => b.text.includes('Cancel'))).toBe(true);
  });

  it('confirming help request creates owned Help request in queue and opts in to Telegram replies', async () => {
    // 1. Ask question
    await service.handleWebhookUpdate(
      {
        updateId: 705,
        message: {
          messageId: 405,
          chat: { id: '98765432', type: 'private' },
          from: { id: '98765432', isBot: false },
          date: Math.floor(clock.getTime() / 1000),
          text: 'Need help with tax forms',
        },
      },
      webhookSecret,
    );

    const helpBtn = mockClient.sentMessages[0]?.replyMarkup?.inline_keyboard
      ?.flat()
      .find((b) => b.text.includes('Talk to a person'));
    const contextId = helpBtn!.callback_data!.replace('hlp:ask:', '');

    // 2. Send confirm callback (hlp:send:<contextId>)
    const confirmUpdate: TelegramUpdate = {
      updateId: 706,
      callbackQuery: {
        id: 'cb-help-confirm-1',
        from: { id: '98765432', isBot: false },
        data: `hlp:send:${contextId}`,
        message: {
          messageId: 406,
          chat: { id: '98765432', type: 'private' },
          date: Math.floor(clock.getTime() / 1000),
        },
      },
    };

    const submitResult = await service.handleWebhookUpdate(confirmUpdate, webhookSecret);
    expect(submitResult.status).toBe('help_submitted');

    // Help request was submitted under learnerA scope
    expect(helpRepo.requests.size).toBe(1);
    const createdReq = Array.from(helpRepo.requests.values())[0]!;
    expect(createdReq.ownerId).toBe(learnerA.id);
    expect(createdReq.state).toBe('waiting');
    expect(createdReq.contextSnapshot).toContain('Need help with tax forms');

    // Learner was opted in to Telegram support reply notifications
    expect(helpRepo.preferences.get(`${learnerA.id}:telegram`)).toBe(true);

    // Confirmation message delivered to Telegram chat
    const confirmMsg = mockClient.sentMessages[1];
    expect(confirmMsg?.text).toContain('Your help request has been submitted to the support queue');
    expect(confirmMsg?.text).toContain(
      'A support coordinator will reply to you here in Telegram chat',
    );
  });

  it('cancelling help request sends cancellation acknowledgment and creates zero requests', async () => {
    await service.handleWebhookUpdate(
      {
        updateId: 707,
        message: {
          messageId: 407,
          chat: { id: '98765432', type: 'private' },
          from: { id: '98765432', isBot: false },
          date: Math.floor(clock.getTime() / 1000),
          text: 'False alarm question',
        },
      },
      webhookSecret,
    );

    const helpBtn = mockClient.sentMessages[0]?.replyMarkup?.inline_keyboard
      ?.flat()
      .find((b) => b.text.includes('Talk to a person'));
    const contextId = helpBtn!.callback_data!.replace('hlp:ask:', '');

    // Click cancel
    const cancelUpdate: TelegramUpdate = {
      updateId: 708,
      callbackQuery: {
        id: 'cb-help-cancel-1',
        from: { id: '98765432', isBot: false },
        data: `hlp:cancel:${contextId}`,
        message: {
          messageId: 408,
          chat: { id: '98765432', type: 'private' },
          date: Math.floor(clock.getTime() / 1000),
        },
      },
    };

    const cancelResult = await service.handleWebhookUpdate(cancelUpdate, webhookSecret);
    expect(cancelResult.status).toBe('help_cancelled');

    // No help request created
    expect(helpRepo.requests.size).toBe(0);

    // Cancel acknowledgment sent
    const cancelMsg = mockClient.sentMessages[1];
    expect(cancelMsg?.text).toContain('Help request cancelled. No information was shared');
  });

  it('/help command presents guidance and inline escalation button', async () => {
    const helpCmdUpdate: TelegramUpdate = {
      updateId: 709,
      message: {
        messageId: 409,
        chat: { id: '98765432', type: 'private' },
        from: { id: '98765432', isBot: false },
        date: Math.floor(clock.getTime() / 1000),
        text: '/help',
      },
    };

    const res = await service.handleWebhookUpdate(helpCmdUpdate, webhookSecret);
    expect(res.status).toBe('help_instructions');

    expect(mockClient.sentMessages).toHaveLength(1);
    expect(mockClient.sentMessages[0]?.text).toContain('Need help from a person?');
    const helpBtn = mockClient.sentMessages[0]?.replyMarkup?.inline_keyboard
      ?.flat()
      .find((b) => b.text.includes('Talk to a person'));
    expect(helpBtn).toBeDefined();
  });

  it('unlinked Telegram user cannot preview or submit help requests', async () => {
    const unlinkedCb: TelegramUpdate = {
      updateId: 710,
      callbackQuery: {
        id: 'cb-unlinked-help',
        from: { id: '99999999', isBot: false }, // not linked
        data: 'hlp:ask:some-context-id',
      },
    };

    const res = await service.handleWebhookUpdate(unlinkedCb, webhookSecret);
    expect(res.status).toBe('unauthenticated');
    expect(
      mockClient.callbackAnswers.some((a) => a.text?.includes('No active linked account')),
    ).toBe(true);
  });

  it('revoked Telegram user cannot submit help requests after unlinking', async () => {
    // Unlink account
    await service.unlinkByTelegram({ telegramUserId: '98765432', chatType: 'private' });

    const revokedCb: TelegramUpdate = {
      updateId: 711,
      callbackQuery: {
        id: 'cb-revoked-help',
        from: { id: '98765432', isBot: false },
        data: 'hlp:send:some-context-id',
      },
    };

    const res = await service.handleWebhookUpdate(revokedCb, webhookSecret);
    expect(res.status).toBe('unauthenticated');
    expect(helpRepo.requests.size).toBe(0);
  });
});
