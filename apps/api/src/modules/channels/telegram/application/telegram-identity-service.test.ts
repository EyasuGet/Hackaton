import { describe, expect, it } from 'vitest';
import type { TelegramIdentityRepository } from './ports/telegram-identity-repository.ts';
import { TelegramIdentityService } from './telegram-identity-service.ts';
import type { TelegramIdentity, TelegramLinkingToken } from '../domain/telegram-identity.ts';
import { hashLinkingToken } from '../domain/telegram-identity.ts';

class InMemoryTelegramIdentityRepository implements TelegramIdentityRepository {
  readonly tokens = new Map<string, TelegramLinkingToken>();
  readonly identities: TelegramIdentity[] = [];

  createLinkingToken(token: {
    readonly tokenDigest: string;
    readonly principalId: string;
    readonly expiresAt: Date;
    readonly createdAt?: Date;
  }): Promise<void> {
    this.tokens.set(token.tokenDigest, {
      tokenDigest: token.tokenDigest,
      principalId: token.principalId,
      expiresAt: token.expiresAt,
      usedAt: null,
      createdAt: token.createdAt ?? new Date(),
    });
    return Promise.resolve();
  }

  findLinkingToken(tokenDigest: string): Promise<TelegramLinkingToken | null> {
    return Promise.resolve(this.tokens.get(tokenDigest) ?? null);
  }

  markTokenUsed(tokenDigest: string, usedAt: Date): Promise<void> {
    const existing = this.tokens.get(tokenDigest);
    if (existing) {
      this.tokens.set(tokenDigest, { ...existing, usedAt });
    }
    return Promise.resolve();
  }

  findActiveByPrincipalId(principalId: string): Promise<TelegramIdentity | null> {
    return Promise.resolve(
      this.identities.find((id) => id.principalId === principalId && id.revokedAt === null) ?? null,
    );
  }

  findActiveByTelegramUserId(telegramUserId: string): Promise<TelegramIdentity | null> {
    return Promise.resolve(
      this.identities.find((id) => id.telegramUserId === telegramUserId && id.revokedAt === null) ??
        null,
    );
  }

  upsertActiveIdentity(params: {
    readonly principalId: string;
    readonly telegramUserId: string;
    readonly chatId: string;
    readonly now: Date;
  }): Promise<TelegramIdentity> {
    const existingIndex = this.identities.findIndex(
      (id) => id.principalId === params.principalId && id.telegramUserId === params.telegramUserId,
    );

    if (existingIndex >= 0) {
      const existing = this.identities[existingIndex]!;
      const updated: TelegramIdentity = {
        ...existing,
        chatId: params.chatId,
        updatedAt: params.now,
        revokedAt: null,
      };
      this.identities[existingIndex] = updated;
      return Promise.resolve(updated);
    }

    const created: TelegramIdentity = {
      id: `id-${this.identities.length + 1}`,
      principalId: params.principalId,
      telegramUserId: params.telegramUserId,
      chatId: params.chatId,
      createdAt: params.now,
      updatedAt: params.now,
      revokedAt: null,
    };
    this.identities.push(created);
    return Promise.resolve(created);
  }

  revokeByPrincipalId(principalId: string, revokedAt: Date): Promise<boolean> {
    let modified = false;
    for (let i = 0; i < this.identities.length; i++) {
      const item = this.identities[i]!;
      if (item.principalId === principalId && item.revokedAt === null) {
        this.identities[i] = { ...item, revokedAt, updatedAt: revokedAt };
        modified = true;
      }
    }
    return Promise.resolve(modified);
  }

  revokeByTelegramUserId(telegramUserId: string, revokedAt: Date): Promise<boolean> {
    let modified = false;
    for (let i = 0; i < this.identities.length; i++) {
      const item = this.identities[i]!;
      if (item.telegramUserId === telegramUserId && item.revokedAt === null) {
        this.identities[i] = { ...item, revokedAt, updatedAt: revokedAt };
        modified = true;
      }
    }
    return Promise.resolve(modified);
  }
}

describe('TelegramIdentityService', () => {
  const baseTime = new Date('2026-11-15T10:00:00.000Z');
  let currentTime = baseTime;
  const clock = () => currentTime;

  function createFixture(ttlSeconds = 600) {
    const repository = new InMemoryTelegramIdentityRepository();
    const service = new TelegramIdentityService(repository, { clock, tokenTtlSeconds: ttlSeconds });
    return { repository, service };
  }

  describe('createLinkingToken', () => {
    it('creates a token with digest and proper expiration', async () => {
      const { repository, service } = createFixture(300);
      const res = await service.createLinkingToken('principal-1');

      expect(res.token).toMatch(/^tlk_[0-9a-f]{32}$/);
      expect(res.expiresInSeconds).toBe(300);
      expect(res.expiresAt.toISOString()).toBe('2026-11-15T10:05:00.000Z');

      // The digest is stored, never the raw token
      const digest = hashLinkingToken(res.token);
      const stored = await repository.findLinkingToken(digest);
      expect(stored).not.toBeNull();
      expect(stored?.principalId).toBe('principal-1');
      expect(stored?.usedAt).toBeNull();
    });
  });

  describe('getIdentityStatus', () => {
    it('reports unlinked when no active identity exists', async () => {
      const { service } = createFixture();
      const status = await service.getIdentityStatus('principal-1');
      expect(status).toEqual({ linked: false });
    });

    it('reports linked status with masked telegram id when active', async () => {
      const { service } = createFixture();
      const { token } = await service.createLinkingToken('principal-1');
      await service.linkFromTelegram({
        token,
        telegramUserId: '987654321',
        chatId: '987654321',
        chatType: 'private',
      });

      const status = await service.getIdentityStatus('principal-1');
      expect(status.linked).toBe(true);
      expect(status.telegramUserIdMasked).toBe('***4321');
      expect(status.linkedAt).toEqual(baseTime);
    });
  });

  describe('linkFromTelegram', () => {
    it('successfully links a private Telegram user with a valid token', async () => {
      const { repository, service } = createFixture();
      const { token } = await service.createLinkingToken('principal-1');

      const outcome = await service.linkFromTelegram({
        token,
        telegramUserId: '10001',
        chatId: '10001',
        chatType: 'private',
      });

      expect(outcome.success).toBe(true);
      if (outcome.success) {
        expect(outcome.identity.principalId).toBe('principal-1');
        expect(outcome.identity.telegramUserId).toBe('10001');
      }

      // Token is now marked used
      const storedToken = await repository.findLinkingToken(hashLinkingToken(token));
      expect(storedToken?.usedAt).toEqual(baseTime);
    });

    it('rejects attempts from non-private chats (e.g. group or supergroup)', async () => {
      const { service } = createFixture();
      const { token } = await service.createLinkingToken('principal-1');

      const outcome = await service.linkFromTelegram({
        token,
        telegramUserId: '10001',
        chatId: '-100987654',
        chatType: 'group',
      });

      expect(outcome.success).toBe(false);
      if (!outcome.success) {
        expect(outcome.reason).toBe('group_chat_forbidden');
      }
    });

    it('rejects invalid or non-existent tokens', async () => {
      const { service } = createFixture();
      const outcome = await service.linkFromTelegram({
        token: 'tlk_non_existent',
        telegramUserId: '10001',
        chatId: '10001',
        chatType: 'private',
      });

      expect(outcome.success).toBe(false);
      if (!outcome.success) {
        expect(outcome.reason).toBe('invalid_token');
      }
    });

    it('rejects expired tokens', async () => {
      const { service } = createFixture(600);
      const { token } = await service.createLinkingToken('principal-1');

      // Fast forward past 10 minutes
      currentTime = new Date(baseTime.getTime() + 601 * 1000);

      const outcome = await service.linkFromTelegram({
        token,
        telegramUserId: '10001',
        chatId: '10001',
        chatType: 'private',
      });

      expect(outcome.success).toBe(false);
      if (!outcome.success) {
        expect(outcome.reason).toBe('expired_token');
      }
    });

    it('rejects already used tokens (replay guard)', async () => {
      const { service } = createFixture();
      const { token } = await service.createLinkingToken('principal-1');

      // First use succeeds
      const first = await service.linkFromTelegram({
        token,
        telegramUserId: '10001',
        chatId: '10001',
        chatType: 'private',
      });
      expect(first.success).toBe(true);

      // Replay attempt fails
      const replay = await service.linkFromTelegram({
        token,
        telegramUserId: '10001',
        chatId: '10001',
        chatType: 'private',
      });
      expect(replay.success).toBe(false);
      if (!replay.success) {
        expect(replay.reason).toBe('token_already_used');
      }
    });

    it('guards against cross-user linking (same Telegram user linked to another learner)', async () => {
      const { service } = createFixture();
      const token1 = (await service.createLinkingToken('principal-1')).token;
      const token2 = (await service.createLinkingToken('principal-2')).token;

      // User links with principal-1
      await service.linkFromTelegram({
        token: token1,
        telegramUserId: '10001',
        chatId: '10001',
        chatType: 'private',
      });

      // Same Telegram user tries to link to principal-2 with another token
      const crossAttempt = await service.linkFromTelegram({
        token: token2,
        telegramUserId: '10001',
        chatId: '10001',
        chatType: 'private',
      });

      expect(crossAttempt.success).toBe(false);
      if (!crossAttempt.success) {
        expect(crossAttempt.reason).toBe('already_linked_to_other_account');
      }
    });

    it('guards against re-linking principal to multiple Telegram accounts simultaneously', async () => {
      const { service } = createFixture();
      const token1 = (await service.createLinkingToken('principal-1')).token;
      const token2 = (await service.createLinkingToken('principal-1')).token;

      // Link to Telegram user A
      await service.linkFromTelegram({
        token: token1,
        telegramUserId: '10001',
        chatId: '10001',
        chatType: 'private',
      });

      // Try to link principal-1 to Telegram user B without revoking first
      const multiAttempt = await service.linkFromTelegram({
        token: token2,
        telegramUserId: '10002',
        chatId: '10002',
        chatType: 'private',
      });

      expect(multiAttempt.success).toBe(false);
      if (!multiAttempt.success) {
        expect(multiAttempt.reason).toBe('account_already_linked');
      }
    });

    it('allows re-linking after revocation', async () => {
      const { service } = createFixture();
      const token1 = (await service.createLinkingToken('principal-1')).token;

      // Link
      await service.linkFromTelegram({
        token: token1,
        telegramUserId: '10001',
        chatId: '10001',
        chatType: 'private',
      });
      expect(await service.resolveActivePrincipalByTelegramUser('10001')).toBe('principal-1');

      // Revoke from web assistant
      await service.revokeIdentity('principal-1');
      expect(await service.resolveActivePrincipalByTelegramUser('10001')).toBeNull();

      // Generate a new token and link again
      const token2 = (await service.createLinkingToken('principal-1')).token;
      const reLink = await service.linkFromTelegram({
        token: token2,
        telegramUserId: '10001',
        chatId: '10001',
        chatType: 'private',
      });
      expect(reLink.success).toBe(true);
      expect(await service.resolveActivePrincipalByTelegramUser('10001')).toBe('principal-1');
    });
  });

  describe('revokeIdentity', () => {
    it('immediately stops Telegram access for the revoked learner', async () => {
      const { service } = createFixture();
      const { token } = await service.createLinkingToken('principal-1');

      await service.linkFromTelegram({
        token,
        telegramUserId: '10001',
        chatId: '10001',
        chatType: 'private',
      });

      expect(await service.resolveActivePrincipalByTelegramUser('10001')).toBe('principal-1');

      // Learner revokes link
      const result = await service.revokeIdentity('principal-1');
      expect(result.revoked).toBe(true);

      // Access is immediately revoked
      expect(await service.resolveActivePrincipalByTelegramUser('10001')).toBeNull();
      const status = await service.getIdentityStatus('principal-1');
      expect(status.linked).toBe(false);
    });
  });

  describe('handleTelegramUpdate', () => {
    it('verifies webhook secret token header when configured', async () => {
      const { service } = createFixture();
      const update = {
        update_id: 1,
        message: {
          message_id: 10,
          chat: { id: 10001, type: 'private' },
          from: { id: 10001, is_bot: false },
          date: 1700000000,
          text: '/status',
        },
      };

      // Mismatched secret returns unauthorized error
      const rejected = await service.handleTelegramUpdate(
        update,
        'wrong-secret',
        'expected-secret',
      );
      expect(rejected).toEqual({ handled: false, error: 'unauthorized' });

      // Valid secret succeeds
      const accepted = await service.handleTelegramUpdate(
        update,
        'expected-secret',
        'expected-secret',
      );
      expect(accepted.handled).toBe(true);
    });

    it('handles /link command via webhook update', async () => {
      const { service } = createFixture();
      const { token } = await service.createLinkingToken('principal-1');

      const outcome = await service.handleTelegramUpdate({
        update_id: 1,
        message: {
          message_id: 10,
          chat: { id: 10001, type: 'private' },
          from: { id: 10001, is_bot: false },
          date: 1700000000,
          text: `/link ${token}`,
        },
      });

      expect(outcome.handled).toBe(true);
      expect(outcome.action).toBe('link');
      expect(outcome.success).toBe(true);
      expect(await service.resolveActivePrincipalByTelegramUser('10001')).toBe('principal-1');
    });

    it('handles /unlink command from Telegram', async () => {
      const { service } = createFixture();
      const { token } = await service.createLinkingToken('principal-1');
      await service.linkFromTelegram({
        token,
        telegramUserId: '10001',
        chatId: '10001',
        chatType: 'private',
      });

      const outcome = await service.handleTelegramUpdate({
        update_id: 2,
        message: {
          message_id: 11,
          chat: { id: 10001, type: 'private' },
          from: { id: 10001, is_bot: false },
          date: 1700000000,
          text: '/unlink',
        },
      });

      expect(outcome.handled).toBe(true);
      expect(outcome.action).toBe('unlink');
      expect(outcome.success).toBe(true);
      expect(await service.resolveActivePrincipalByTelegramUser('10001')).toBeNull();
    });

    it('prompts unlinked user when regular message is received', async () => {
      const { service } = createFixture();
      const outcome = await service.handleTelegramUpdate({
        update_id: 3,
        message: {
          message_id: 12,
          chat: { id: 99999, type: 'private' },
          from: { id: 99999, is_bot: false },
          date: 1700000000,
          text: 'Hello assistant',
        },
      });

      expect(outcome.handled).toBe(true);
      expect(outcome.action).toBe('unlinked_notice');
    });
  });
});
