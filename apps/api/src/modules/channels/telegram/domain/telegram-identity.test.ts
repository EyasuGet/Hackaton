import { describe, expect, it } from 'vitest';
import {
  generateLinkingToken,
  hashLinkingToken,
  maskTelegramUserId,
  parseTelegramCommand,
} from './telegram-identity.ts';

describe('telegram-identity domain', () => {
  describe('hashLinkingToken', () => {
    it('produces deterministic SHA-256 hex digest for tokens', () => {
      const digest1 = hashLinkingToken('tlk_test_12345');
      const digest2 = hashLinkingToken('  tlk_test_12345  ');
      expect(digest1).toBe(digest2);
      expect(digest1).toHaveLength(64);
    });

    it('produces different digests for different tokens', () => {
      const digest1 = hashLinkingToken('tlk_token_a');
      const digest2 = hashLinkingToken('tlk_token_b');
      expect(digest1).not.toBe(digest2);
    });
  });

  describe('generateLinkingToken', () => {
    it('generates unique tokens with tlk_ prefix', () => {
      const t1 = generateLinkingToken();
      const t2 = generateLinkingToken();
      expect(t1).toMatch(/^tlk_[0-9a-f]{32}$/);
      expect(t2).toMatch(/^tlk_[0-9a-f]{32}$/);
      expect(t1).not.toBe(t2);
    });
  });

  describe('maskTelegramUserId', () => {
    it('masks the user id while preserving last 4 characters', () => {
      expect(maskTelegramUserId('123456789')).toBe('***6789');
      expect(maskTelegramUserId('9876543210')).toBe('***3210');
    });

    it('masks short user ids safely', () => {
      expect(maskTelegramUserId('123')).toBe('***');
      expect(maskTelegramUserId('1234')).toBe('***');
    });
  });

  describe('parseTelegramCommand', () => {
    it('parses standard /link command with token argument', () => {
      const result = parseTelegramCommand('/link tlk_abc123');
      expect(result).toEqual({ command: 'link', argument: 'tlk_abc123' });
    });

    it('parses /start command with deep-link token argument', () => {
      const result = parseTelegramCommand('/start tlk_abc123');
      expect(result).toEqual({ command: 'start', argument: 'tlk_abc123' });
    });

    it('parses command without leading slash', () => {
      const result = parseTelegramCommand('link tlk_abc123');
      expect(result).toEqual({ command: 'link', argument: 'tlk_abc123' });
    });

    it('strips bot username mention from command', () => {
      const result = parseTelegramCommand('/link@Track3TutorBot tlk_abc123');
      expect(result).toEqual({ command: 'link', argument: 'tlk_abc123' });
    });

    it('parses zero-argument commands like /unlink', () => {
      const result = parseTelegramCommand('/unlink');
      expect(result).toEqual({ command: 'unlink', argument: undefined });
    });

    it('normalizes uppercase commands to lowercase', () => {
      const result = parseTelegramCommand('/LINK tlk_abc123');
      expect(result).toEqual({ command: 'link', argument: 'tlk_abc123' });
    });

    it('returns null for empty or whitespace-only text', () => {
      expect(parseTelegramCommand('')).toBeNull();
      expect(parseTelegramCommand('   ')).toBeNull();
    });
  });
});
