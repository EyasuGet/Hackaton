// Verification of incoming Telegram updates and credentials (T3-012-A).
// Supports secret token verification for webhooks (X-Telegram-Bot-Api-Secret-Token)
// and HMAC-SHA256 hash verification for Telegram WebApp/Widget initData.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TelegramUser } from '../domain/telegram-identity.ts';

/**
 * Validates the secret token header sent by Telegram in webhook updates.
 * Telegram docs: "If you'd like to ensure that the webhook request comes from Telegram,
 * we recommend using the secret_token parameter in setWebhook. The secret will be sent in
 * header X-Telegram-Bot-Api-Secret-Token in each webhook request."
 */
export function verifyWebhookSecret(
  headerSecret: string | undefined,
  expectedSecret: string | undefined,
): boolean {
  if (!headerSecret || !expectedSecret) return false;
  const a = Buffer.from(headerSecret);
  const b = Buffer.from(expectedSecret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface InitDataVerificationResult {
  readonly valid: boolean;
  readonly user?: TelegramUser | undefined;
  readonly authDate?: Date | undefined;
}

/**
 * Verifies the integrity of Telegram WebApp / Login Widget initData.
 * Uses official algorithm: HMAC-SHA256(HMAC-SHA256("WebAppData", botToken), dataCheckString).
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeMs: number = 24 * 60 * 60 * 1000,
  now: Date = new Date(),
): InitDataVerificationResult {
  if (!initData || !botToken) return { valid: false };

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { valid: false };

    params.delete('hash');

    // Build data-check-string by sorting remaining params alphabetically
    const keys = Array.from(params.keys()).sort();
    const dataCheckString = keys.map((key) => `${key}=${params.get(key)}`).join('\n');

    // Secret key = HMAC_SHA256("WebAppData", botToken)
    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const a = Buffer.from(calculatedHash, 'utf8');
    const b = Buffer.from(hash, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false };
    }

    // Verify auth_date expiry
    const authDateRaw = params.get('auth_date');
    if (!authDateRaw) return { valid: false };
    const authDateSec = Number(authDateRaw);
    if (!Number.isFinite(authDateSec)) return { valid: false };

    const authDate = new Date(authDateSec * 1000);
    const ageMs = now.getTime() - authDate.getTime();
    // Reject timestamps too far in the past or from the future (> 1 minute clock drift)
    if (ageMs > maxAgeMs || ageMs < -60_000) {
      return { valid: false };
    }

    const userRaw = params.get('user');
    let user: TelegramUser | undefined;
    if (userRaw) {
      const parsed = JSON.parse(userRaw) as {
        id?: number | string;
        is_bot?: boolean;
        username?: string;
        first_name?: string;
        last_name?: string;
      };
      if (parsed.id !== undefined) {
        user = {
          id: String(parsed.id),
          isBot: Boolean(parsed.is_bot),
          username: parsed.username,
          firstName: parsed.first_name,
          lastName: parsed.last_name,
        };
      }
    }

    return { valid: true, user, authDate };
  } catch {
    return { valid: false };
  }
}
