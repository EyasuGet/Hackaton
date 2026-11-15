// Domain unit tests for career research query minimisation and URL safety (T3-028-A).
import { describe, expect, it } from 'vitest';
import { isValidExternalSourceUrl, minimiseCareerQuery } from './career-research.ts';

describe('Career Research Domain Rules (T3-028-A)', () => {
  describe('minimiseCareerQuery (Query Minimisation)', () => {
    it('strips student PII, name, and enrollment references from English query', () => {
      const raw =
        'My name is Abebe Bikila and I am a student enrolled in course CS101. What junior python developer jobs exist in Addis Ababa?';
      const result = minimiseCareerQuery(raw);
      expect(result).not.toBeNull();
      expect(result?.cleanQuery).not.toContain('Abebe');
      expect(result?.cleanQuery).not.toContain('CS101');
      expect(result?.cleanQuery).toContain('junior python developer jobs exist in Addis Ababa');
      expect(result?.language).toBe('en');
    });

    it('strips sensitive accommodation context markers to protect learner privacy', () => {
      const raw = 'Looking for remote data entry with visual accommodation needs and screen reader';
      const result = minimiseCareerQuery(raw);
      expect(result).not.toBeNull();
      expect(result?.cleanQuery).not.toContain('visual accommodation');
      expect(result?.cleanQuery).toContain('remote data entry');
    });

    it('preserves Amharic characters and detects Amharic language context', () => {
      const raw = 'በአዲስ አበባ የሶፍትዌር ኢንጂነር ክፍት የሥራ ቦታ';
      const result = minimiseCareerQuery(raw);
      expect(result).not.toBeNull();
      expect(result?.cleanQuery).toBe('በአዲስ አበባ የሶፍትዌር ኢንጂነር ክፍት የሥራ ቦታ');
      expect(result?.language).toBe('am');
    });

    it('enforces maximum character length bounds (120 chars)', () => {
      const longInput = 'developer '.repeat(30);
      const result = minimiseCareerQuery(longInput);
      expect(result).not.toBeNull();
      expect(result?.cleanQuery.length).toBeLessThanOrEqual(120);
    });

    it('returns null for empty or sub-minimal queries', () => {
      expect(minimiseCareerQuery('')).toBeNull();
      expect(minimiseCareerQuery('   ')).toBeNull();
      expect(minimiseCareerQuery('?')).toBeNull();
      expect(minimiseCareerQuery('my name is Abebe')).toBeNull();
    });
  });

  describe('isValidExternalSourceUrl (SSRF and URL Validation)', () => {
    it('accepts valid public HTTPS URLs', () => {
      expect(isValidExternalSourceUrl('https://ethiojobs.net/jobs/123')).toBe(true);
      expect(isValidExternalSourceUrl('https://careers.et/vacancies/frontend-dev')).toBe(true);
    });

    it('rejects unencrypted HTTP URLs', () => {
      expect(isValidExternalSourceUrl('http://ethiojobs.net/jobs/123')).toBe(false);
    });

    it('rejects dangerous protocols (javascript, file, data)', () => {
      expect(isValidExternalSourceUrl('javascript:alert(1)')).toBe(false);
      expect(isValidExternalSourceUrl('file:///etc/passwd')).toBe(false);
      expect(isValidExternalSourceUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    });

    it('rejects SSRF internal and loopback IP addresses', () => {
      expect(isValidExternalSourceUrl('https://localhost/jobs')).toBe(false);
      expect(isValidExternalSourceUrl('https://127.0.0.1/admin')).toBe(false);
      expect(isValidExternalSourceUrl('https://::1/test')).toBe(false);
      expect(isValidExternalSourceUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
      expect(isValidExternalSourceUrl('https://10.0.0.1/intranet')).toBe(false);
      expect(isValidExternalSourceUrl('https://192.168.1.100/jobs')).toBe(false);
      expect(isValidExternalSourceUrl('https://172.16.0.5/api')).toBe(false);
    });
  });
});
