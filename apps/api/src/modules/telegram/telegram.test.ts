import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '../identity/domain/principal.ts';
import type {
  ConsumeLinkParams,
  ConsumeLinkResult,
  TelegramLinkRepository,
} from './application/ports/telegram-link-repository.ts';
import {
  verifyTelegramInitData,
  verifyWebhookSecret,
} from './application/telegram-authenticity.ts';
import {
  digestLinkCode,
  TelegramLinkService,
  TELEGRAM_LINK_CODE_TTL_MS,
} from './application/telegram-link-service.ts';
import type { TelegramIdentity, TelegramUpdate } from './domain/telegram-identity.ts';

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

  async findPrincipalByTelegramUserId(telegramUserId: string): Promise<Principal | null> {
    const identity = await this.findIdentityByTelegramUserId(telegramUserId);
    if (!identity) return null;
    if (identity.learnerId === learnerA.id) return learnerA;
    if (identity.learnerId === learnerB.id) return learnerB;
    return null;
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
});
