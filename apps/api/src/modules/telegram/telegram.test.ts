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
import type {
  ClaimRequestInput,
  ClaimResult,
  RecordOutcomeInput,
  TutoringRepository,
} from '../tutoring/application/ports/tutoring-repository.ts';
import type { TutoringConversation } from '../tutoring/domain/conversation.ts';
import type { TutoringRequest } from '../tutoring/domain/tutoring-request.ts';
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
  type TelegramIdentity,
  type TelegramUpdate,
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
    preferences: { readonly externalConsent?: boolean; readonly activeCourseId?: string },
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
    });

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

  async claimRequest(scope: OwnedScope, input: ClaimRequestInput): Promise<ClaimResult | null> {
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
