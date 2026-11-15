// Unit tests for SMS job alert formatting, encoding, and bounding domain logic (T3-021-B).
import { describe, expect, it } from 'vitest';
import {
  buildJobAlertUrl,
  formatSmsJobAlert,
  parseJobAlertContentRef,
  truncateSafeUnicode,
} from './sms-job-alert.ts';
import { analyzeSmsText } from './sms-encoding.ts';

describe('sms-job-alert domain logic', () => {
  describe('1. Content reference parsing', () => {
    it('parses valid job content references into jobId and version', () => {
      expect(parseJobAlertContentRef('job:job-va-specialist-01:1.0')).toEqual({
        jobId: 'job-va-specialist-01',
        version: '1.0',
      });
      expect(parseJobAlertContentRef('job:data-clerk-02:2026.11.15')).toEqual({
        jobId: 'data-clerk-02',
        version: '2026.11.15',
      });
    });

    it('returns null for non-job or malformed content references', () => {
      expect(parseJobAlertContentRef(null)).toBeNull();
      expect(parseJobAlertContentRef(undefined)).toBeNull();
      expect(parseJobAlertContentRef('')).toBeNull();
      expect(parseJobAlertContentRef('   ')).toBeNull();
      expect(parseJobAlertContentRef('help-reply:123:456')).toBeNull();
      expect(parseJobAlertContentRef('job::1.0')).toBeNull();
      expect(parseJobAlertContentRef('job:job-01:')).toBeNull();
      expect(parseJobAlertContentRef('job:INVALID_UPPERCASE:1.0')).toBeNull();
    });
  });

  describe('2. Job alert URL construction', () => {
    it('preserves existing digitalbridge.et URLs', () => {
      const url = buildJobAlertUrl(
        'job-va-01',
        'https://digitalbridge.et/jobs/job-va-specialist-01',
      );
      expect(url).toBe('https://digitalbridge.et/jobs/job-va-specialist-01');
    });

    it('constructs canonical digitalbridge.et URLs when sourceUrl is omitted or external', () => {
      expect(buildJobAlertUrl('job-va-01')).toBe('https://digitalbridge.et/jobs/job-va-01');
      expect(buildJobAlertUrl('job-va-01', 'https://other-domain.com/apply')).toBe(
        'https://digitalbridge.et/jobs/job-va-01',
      );
    });

    it('respects custom baseUrl without double slashes', () => {
      expect(buildJobAlertUrl('job-va-01', undefined, 'https://test.digitalbridge.et/')).toBe(
        'https://test.digitalbridge.et/jobs/job-va-01',
      );
    });
  });

  describe('3. Unicode-safe truncation', () => {
    it('does not truncate strings within limit', () => {
      expect(truncateSafeUnicode('Hello World', 20)).toBe('Hello World');
      expect(truncateSafeUnicode('ዳታ ክለርክ', 10)).toBe('ዳታ ክለርክ');
    });

    it('truncates English strings with ellipsis on character boundaries', () => {
      const result = truncateSafeUnicode('Senior Executive Administrative Assistant', 20);
      expect(result).toHaveLength(20);
      expect(result.endsWith('...')).toBe(true);
    });

    it('truncates Amharic Ge’ez script safely on code-point boundaries with zero mojibake', () => {
      const amharicText = 'የቢሮ አስተዳደር እና የሰነድ አያያዝ ባለሙያ';
      const truncated = truncateSafeUnicode(amharicText, 15);
      expect(Array.from(truncated).length).toBe(15);
      expect(truncated.endsWith('...')).toBe(true);
      // Verify no invalid or replacement characters (e.g. \uFFFD)
      expect(truncated).not.toContain('\uFFFD');
      expect(truncated).not.toContain('?');
    });
  });

  describe('4. English SMS Job Alert formatting & bounding', () => {
    it('formats a concise English job alert within GSM-7 encoding and 1 segment', () => {
      const formatted = formatSmsJobAlert({
        id: 'job-01',
        title: 'Virtual Assistant',
        organization: 'Savanna',
        location: 'Addis Ababa',
        sourceUrl: 'https://digitalbridge.et/jobs/job-01',
      });

      expect(formatted.language).toBe('en');
      expect(formatted.encoding).toBe('GSM-7');
      expect(formatted.segments).toBe(1);
      expect(formatted.message).toContain('Job Alert: Virtual Assistant at Savanna (Addis Ababa).');
      expect(formatted.message).toContain('https://digitalbridge.et/jobs/job-01');
      expect(formatted.message).toContain('STOP to opt out');

      // Verify GSM-7 analysis
      const analysis = analyzeSmsText(formatted.message);
      expect(analysis.encoding).toBe('GSM-7');
      expect(analysis.segmentCount).toBe(1);
      expect(analysis.characterCount).toBeLessThanOrEqual(160);
    });

    it('bounds very long English job titles to stay strictly within 2 segments (<= 306 chars)', () => {
      const formatted = formatSmsJobAlert(
        {
          id: 'job-long-01',
          title:
            'Senior Principal Cloud Infrastructure Systems Architect and Distributed Database Operations Lead Engineer for East Africa Operations',
          organization: 'International Digital Innovation Hub Ethiopia PLC',
          location: 'Addis Ababa, Bole Sub-City, Commercial District',
          sourceUrl: 'https://digitalbridge.et/jobs/job-long-01',
        },
        { maxSegments: 2 },
      );

      expect(formatted.encoding).toBe('GSM-7');
      expect(formatted.segments).toBeLessThanOrEqual(2);
      expect(formatted.message).toContain('https://digitalbridge.et/jobs/job-long-01');
      expect(formatted.message).toContain('STOP to opt out');

      const analysis = analyzeSmsText(formatted.message, 2);
      expect(analysis.exceedsLimit).toBe(false);
      expect(analysis.segmentCount).toBeLessThanOrEqual(2);
    });
  });

  describe('5. Amharic Ge’ez SMS Job Alert formatting & bounding', () => {
    it('auto-detects Amharic Ge’ez script from job title and applies UCS-2 encoding', () => {
      const formatted = formatSmsJobAlert({
        id: 'job-am-01',
        title: 'የዳታ ክለርክ',
        organization: 'ሳቫና',
        sourceUrl: 'https://digitalbridge.et/jobs/job-am-01',
      });

      expect(formatted.language).toBe('am');
      expect(formatted.encoding).toBe('UCS-2');
      expect(formatted.segments).toBeLessThanOrEqual(2);
      expect(formatted.message).toContain('አዲስ የስራ እድል፡ የዳታ ክለርክ በሳቫና።');
      expect(formatted.message).toContain('https://digitalbridge.et/jobs/job-am-01');
      expect(formatted.message).toContain('ማቆም');

      // Character integrity: zero garbling or mojibake
      expect(formatted.message).not.toContain('\uFFFD');
      expect(formatted.message).not.toContain('???');

      const analysis = analyzeSmsText(formatted.message, 2);
      expect(analysis.encoding).toBe('UCS-2');
      expect(analysis.exceedsLimit).toBe(false);
      expect(analysis.segmentCount).toBeLessThanOrEqual(2);
    });

    it('formats Amharic alert with explicit language option', () => {
      const formatted = formatSmsJobAlert(
        {
          id: 'job-02',
          title: 'Office Assistant',
          organization: 'Digital Bridge',
          sourceUrl: 'https://digitalbridge.et/jobs/job-02',
        },
        { language: 'am' },
      );

      expect(formatted.language).toBe('am');
      expect(formatted.message).toContain('አዲስ የስራ እድል፡ Office Assistant');
      expect(formatted.message).toContain('ማቆም');
      expect(formatted.encoding).toBe('UCS-2');
    });

    it('bounds long Amharic job postings to stay strictly within 2 UCS-2 segments (<= 134 chars)', () => {
      const formatted = formatSmsJobAlert(
        {
          id: 'job-am-long',
          title: 'ዋና የቢሮ አስተዳደር እና የሰነድ አያያዝ ከፍተኛ ባለሙያ እንዲሁም የደንበኞች ግንኙነት አስተባባሪ',
          organization: 'የኢትዮጵያ ዲጂታል ትራንስፎርሜሽን ማዕከል',
          sourceUrl: 'https://digitalbridge.et/jobs/job-am-long',
        },
        { maxSegments: 2 },
      );

      expect(formatted.encoding).toBe('UCS-2');
      expect(formatted.segments).toBeLessThanOrEqual(2);
      expect(formatted.message).toContain('https://digitalbridge.et/jobs/job-am-long');
      expect(formatted.message).toContain('ማቆም');

      const analysis = analyzeSmsText(formatted.message, 2);
      expect(analysis.exceedsLimit).toBe(false);
      expect(analysis.segmentCount).toBeLessThanOrEqual(2);
      expect(analysis.characterCount).toBeLessThanOrEqual(134);
    });

    it('bounds Amharic job postings to 1 UCS-2 segment when maxSegments: 1 is requested', () => {
      const formatted = formatSmsJobAlert(
        {
          id: 'j1',
          title: 'ረዳት',
          organization: 'ድርጅት',
          sourceUrl: 'https://digitalbridge.et/jobs/j1',
        },
        { maxSegments: 1, language: 'am' },
      );

      expect(formatted.segments).toBe(1);
      const analysis = analyzeSmsText(formatted.message, 1);
      expect(analysis.exceedsLimit).toBe(false);
      expect(analysis.characterCount).toBeLessThanOrEqual(70);
    });
  });
});
