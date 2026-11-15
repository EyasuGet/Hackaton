import { describe, expect, it } from 'vitest';
import { analyzeSmsText } from './sms-encoding.ts';

describe('analyzeSmsText', () => {
  describe('GSM-7 standard alphabet', () => {
    it('identifies standard ASCII and GSM-7 characters as GSM-7 with 1 segment under 160 chars', () => {
      const text = 'Hello learner! Welcome to Track3 course. Your lesson is ready today?';
      const analysis = analyzeSmsText(text);

      expect(analysis.encoding).toBe('GSM-7');
      expect(analysis.hasUnicode).toBe(false);
      expect(analysis.characterCount).toBe(text.length);
      expect(analysis.segmentCount).toBe(1);
      expect(analysis.exceedsLimit).toBe(false);
    });

    it('counts single message exactly at the 160-character GSM-7 boundary', () => {
      const text160 = 'A'.repeat(160);
      const analysis = analyzeSmsText(text160);

      expect(analysis.encoding).toBe('GSM-7');
      expect(analysis.characterCount).toBe(160);
      expect(analysis.segmentCount).toBe(1);
      expect(analysis.exceedsLimit).toBe(false);
    });

    it('splits concatenated GSM-7 messages at 153 characters per segment', () => {
      // 161 characters should split into 2 segments of 153 capacity: ceil(161 / 153) = 2.
      const text161 = 'A'.repeat(161);
      const analysis = analyzeSmsText(text161);

      expect(analysis.encoding).toBe('GSM-7');
      expect(analysis.characterCount).toBe(161);
      expect(analysis.segmentCount).toBe(2);
      expect(analysis.exceedsLimit).toBe(false);

      // Exactly 306 characters: 2 * 153 = 306.
      const text306 = 'A'.repeat(306);
      expect(analyzeSmsText(text306).segmentCount).toBe(2);

      // 307 characters: ceil(307 / 153) = 3.
      const text307 = 'A'.repeat(307);
      expect(analyzeSmsText(text307).segmentCount).toBe(3);
    });

    it('counts GSM-7 extension characters (such as € or [ ]) as 2 septets', () => {
      // Text with 10 characters plus '€' (counts as 2 units -> total 12 units).
      const text = 'Price: 10 €';
      const analysis = analyzeSmsText(text);

      expect(analysis.encoding).toBe('GSM-7');
      expect(analysis.characterCount).toBe(text.length + 1); // 1 extra septet for €
      expect(analysis.segmentCount).toBe(1);
    });
  });

  describe("UCS-2 Unicode (Amharic Ge'ez and emojis)", () => {
    it("detects Amharic Ge'ez text as UCS-2 encoding", () => {
      const amharicText = 'ሰላም! አዲስ የስራ ማስታወቂያ ወጥቷል።';
      const analysis = analyzeSmsText(amharicText);

      expect(analysis.encoding).toBe('UCS-2');
      expect(analysis.hasUnicode).toBe(true);
      expect(analysis.singleMessageLimit).toBe(70);
      expect(analysis.concatenatedSegmentLimit).toBe(67);
      expect(analysis.segmentCount).toBe(1);
      expect(analysis.exceedsLimit).toBe(false);
    });

    it('calculates single UCS-2 message boundary at 70 characters', () => {
      const amharic70 = 'ሰ'.repeat(70);
      const analysis = analyzeSmsText(amharic70);

      expect(analysis.encoding).toBe('UCS-2');
      expect(analysis.characterCount).toBe(70);
      expect(analysis.segmentCount).toBe(1);
      expect(analysis.exceedsLimit).toBe(false);
    });

    it('splits concatenated UCS-2 messages at 67 characters per segment', () => {
      // 71 characters should split into 2 segments: ceil(71 / 67) = 2.
      const amharic71 = 'ሰ'.repeat(71);
      const analysis = analyzeSmsText(amharic71);

      expect(analysis.encoding).toBe('UCS-2');
      expect(analysis.characterCount).toBe(71);
      expect(analysis.segmentCount).toBe(2);
      expect(analysis.exceedsLimit).toBe(false);

      // Exactly 134 characters: 2 * 67 = 134.
      const amharic134 = 'ሰ'.repeat(134);
      expect(analyzeSmsText(amharic134).segmentCount).toBe(2);

      // 135 characters: ceil(135 / 67) = 3.
      const amharic135 = 'ሰ'.repeat(135);
      expect(analyzeSmsText(amharic135).segmentCount).toBe(3);
    });
  });

  describe('segmentation limits and validation bounds', () => {
    it('flags an empty string with an actionable rejection reason', () => {
      const analysis = analyzeSmsText('');
      expect(analysis.exceedsLimit).toBe(true);
      expect(analysis.rejectionReason).toContain('cannot be empty');
    });

    it('rejects GSM-7 messages exceeding the maximum segmentation limit', () => {
      // With default max 4 segments, max GSM-7 chars is 4 * 153 = 612.
      const textOverLimit = 'A'.repeat(613); // 5 segments
      const analysis = analyzeSmsText(textOverLimit, 4);

      expect(analysis.exceedsLimit).toBe(true);
      expect(analysis.segmentCount).toBe(5);
      expect(analysis.rejectionReason).toContain(
        'exceeds maximum GSM-7 segmentation limit of 4 parts',
      );
    });

    it('rejects UCS-2 messages exceeding the maximum segmentation limit', () => {
      // With default max 4 segments, max UCS-2 chars is 4 * 67 = 268.
      const amharicOverLimit = 'ሰ'.repeat(269); // 5 segments
      const analysis = analyzeSmsText(amharicOverLimit, 4);

      expect(analysis.exceedsLimit).toBe(true);
      expect(analysis.segmentCount).toBe(5);
      expect(analysis.rejectionReason).toContain(
        'exceeds maximum UCS-2 Unicode segmentation limit of 4 parts',
      );
    });

    it('respects a custom maximum segment parameter', () => {
      const text = 'A'.repeat(200); // 2 segments
      expect(analyzeSmsText(text, 1).exceedsLimit).toBe(true);
      expect(analyzeSmsText(text, 2).exceedsLimit).toBe(false);
    });
  });
});
