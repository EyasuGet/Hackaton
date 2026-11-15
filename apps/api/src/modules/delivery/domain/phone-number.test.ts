import { describe, expect, it } from 'vitest';
import { normalizeEthiopianPhoneNumber, validateEthiopianPhoneNumber } from './phone-number.ts';

describe('validateEthiopianPhoneNumber', () => {
  describe('valid Ethiopian mobile numbers', () => {
    it('accepts E.164 Ethio Telecom numbers (+2519...)', () => {
      const result = validateEthiopianPhoneNumber('+251912345678');
      expect(result).toEqual({
        valid: true,
        normalized: '+251912345678',
        national: '0912345678',
        operator: 'ethio_telecom',
      });
    });

    it('accepts E.164 Safaricom Ethiopia numbers (+2517...)', () => {
      const result = validateEthiopianPhoneNumber('+251712345678');
      expect(result).toEqual({
        valid: true,
        normalized: '+251712345678',
        national: '0712345678',
        operator: 'safaricom_ethiopia',
      });
    });

    it('accepts national 10-digit format (09... and 07...) and normalizes to E.164', () => {
      expect(validateEthiopianPhoneNumber('0911223344')).toEqual({
        valid: true,
        normalized: '+251911223344',
        national: '0911223344',
        operator: 'ethio_telecom',
      });
      expect(validateEthiopianPhoneNumber('0711223344')).toEqual({
        valid: true,
        normalized: '+251711223344',
        national: '0711223344',
        operator: 'safaricom_ethiopia',
      });
    });

    it('accepts numbers without leading plus (2519... / 2517...)', () => {
      expect(validateEthiopianPhoneNumber('251912345678')).toMatchObject({
        valid: true,
        normalized: '+251912345678',
      });
    });

    it('accepts 9-digit local subscriber numbers (9XXXXXXXX / 7XXXXXXXX)', () => {
      expect(validateEthiopianPhoneNumber('912345678')).toMatchObject({
        valid: true,
        normalized: '+251912345678',
      });
      expect(validateEthiopianPhoneNumber('712345678')).toMatchObject({
        valid: true,
        normalized: '+251712345678',
      });
    });

    it('strips spaces, dashes, dots and parentheses', () => {
      const result = validateEthiopianPhoneNumber('+251 (911) 22-33-44');
      expect(result).toEqual({
        valid: true,
        normalized: '+251911223344',
        national: '0911223344',
        operator: 'ethio_telecom',
      });
    });
  });

  describe('rejections and edge cases', () => {
    it('rejects empty, null, or whitespace-only inputs', () => {
      expect(validateEthiopianPhoneNumber('')).toEqual({
        valid: false,
        reason: 'Phone number cannot be empty',
      });
      expect(validateEthiopianPhoneNumber('   ')).toEqual({
        valid: false,
        reason: 'Phone number cannot be empty',
      });
    });

    it('rejects non-numeric characters', () => {
      const result = validateEthiopianPhoneNumber('091234abcd');
      expect(result).toEqual({
        valid: false,
        reason: 'Phone number contains invalid non-numeric characters',
      });
    });

    it('rejects non-Ethiopian international numbers', () => {
      expect(validateEthiopianPhoneNumber('+12025550123')).toEqual({
        valid: false,
        reason: 'Only Ethiopian destination numbers (+251) are supported',
      });
      expect(validateEthiopianPhoneNumber('+447911123456')).toEqual({
        valid: false,
        reason: 'Only Ethiopian destination numbers (+251) are supported',
      });
      expect(validateEthiopianPhoneNumber('+254712345678')).toEqual({
        valid: false,
        reason: 'Only Ethiopian destination numbers (+251) are supported',
      });
    });

    it('rejects Ethiopian landlines', () => {
      expect(validateEthiopianPhoneNumber('0111234567')).toEqual({
        valid: false,
        reason: 'Landline numbers are not supported for mobile SMS delivery',
      });
      expect(validateEthiopianPhoneNumber('+251111234567')).toEqual({
        valid: false,
        reason: 'Landline numbers are not supported for mobile SMS delivery',
      });
    });

    it('rejects invalid mobile prefixes', () => {
      expect(validateEthiopianPhoneNumber('0812345678')).toEqual({
        valid: false,
        reason: 'Invalid Ethiopian mobile number: must start with +251 9 or +251 7',
      });
      expect(validateEthiopianPhoneNumber('+251812345678')).toEqual({
        valid: false,
        reason: 'Invalid Ethiopian mobile number: must start with +251 9 or +251 7',
      });
      expect(validateEthiopianPhoneNumber('812345678')).toEqual({
        valid: false,
        reason: 'Invalid Ethiopian mobile number prefix: expected 09 or 07',
      });
    });

    it('rejects numbers that are too short or too long', () => {
      expect(validateEthiopianPhoneNumber('+25191234')).toEqual({
        valid: false,
        reason: 'Phone number is too short for an Ethiopian mobile number',
      });
      expect(validateEthiopianPhoneNumber('+251912345678999')).toEqual({
        valid: false,
        reason: 'Phone number is too long for an Ethiopian mobile number',
      });
    });
  });
});

describe('normalizeEthiopianPhoneNumber', () => {
  it('returns normalized E.164 on valid input', () => {
    expect(normalizeEthiopianPhoneNumber('0912345678')).toBe('+251912345678');
  });

  it('throws an informative error on invalid input', () => {
    expect(() => normalizeEthiopianPhoneNumber('invalid')).toThrow(
      'Phone number contains invalid non-numeric characters',
    );
  });
});
