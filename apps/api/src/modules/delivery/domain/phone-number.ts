// Ethiopian mobile phone number validation and E.164 normalization.
// Supports mobile operators in Ethiopia: Ethio Telecom (+2519... / 09...) and
// Safaricom Ethiopia (+2517... / 07...). Rejects landlines, non-Ethiopian numbers,
// and malformed inputs.

export type EthiopianMobileOperator = 'ethio_telecom' | 'safaricom_ethiopia';

export type PhoneNumberValidationResult =
  | {
      readonly valid: true;
      /** Standard international E.164 format: +251XXXXXXXXX (13 characters). */
      readonly normalized: string;
      /** Standard national 10-digit format: 0XXXXXXXXX. */
      readonly national: string;
      /** Recognized Ethiopian mobile operator. */
      readonly operator: EthiopianMobileOperator;
    }
  | {
      readonly valid: false;
      /** User-facing, actionable rejection reason. */
      readonly reason: string;
    };

/**
 * Validates and normalizes an Ethiopian mobile phone number.
 * Accepts E.164 (+2519..., +2517...), national (09..., 07...), or unadorned (9..., 7...) formats
 * with optional spaces, dashes, or parentheses.
 */
export function validateEthiopianPhoneNumber(raw: string): PhoneNumberValidationResult {
  if (!raw || !raw.trim()) {
    return { valid: false, reason: 'Phone number cannot be empty' };
  }

  // Strip common formatting whitespace and separators.
  const cleaned = raw.trim().replace(/[\s\-().]/g, '');

  // Detect non-numeric characters (aside from leading +).
  if (!/^\+?\d+$/.test(cleaned)) {
    return {
      valid: false,
      reason: 'Phone number contains invalid non-numeric characters',
    };
  }

  let normalized: string;
  if (cleaned.startsWith('+251')) {
    normalized = cleaned;
  } else if (cleaned.startsWith('251')) {
    normalized = `+${cleaned}`;
  } else if (cleaned.startsWith('0')) {
    normalized = `+251${cleaned.slice(1)}`;
  } else if (cleaned.startsWith('9') || cleaned.startsWith('7')) {
    normalized = `+251${cleaned}`;
  } else if (cleaned.startsWith('+')) {
    return {
      valid: false,
      reason: 'Only Ethiopian destination numbers (+251) are supported',
    };
  } else {
    return {
      valid: false,
      reason: 'Invalid Ethiopian mobile number prefix: expected 09 or 07',
    };
  }

  // Check for Ethiopian landlines (e.g., Addis Ababa +25111... or national 011...).
  if (/^\+251[1-6]/.test(normalized)) {
    return {
      valid: false,
      reason: 'Landline numbers are not supported for mobile SMS delivery',
    };
  }

  // Validate exact length and mobile operator prefix (9 or 7 followed by 8 digits).
  const match = /^\+251(9|7)(\d{8})$/.exec(normalized);
  if (!match) {
    if (normalized.length < 13) {
      return { valid: false, reason: 'Phone number is too short for an Ethiopian mobile number' };
    }
    if (normalized.length > 13) {
      return { valid: false, reason: 'Phone number is too long for an Ethiopian mobile number' };
    }
    return {
      valid: false,
      reason: 'Invalid Ethiopian mobile number: must start with +251 9 or +251 7',
    };
  }

  const prefix = match[1];
  const operator: EthiopianMobileOperator = prefix === '9' ? 'ethio_telecom' : 'safaricom_ethiopia';
  const national = `0${prefix}${match[2]}`;

  return {
    valid: true,
    normalized,
    national,
    operator,
  };
}

/**
 * Normalizes an Ethiopian mobile phone number to E.164.
 * Throws an Error if the number is invalid.
 */
export function normalizeEthiopianPhoneNumber(raw: string): string {
  const result = validateEthiopianPhoneNumber(raw);
  if (!result.valid) {
    throw new Error(result.reason);
  }
  return result.normalized;
}
