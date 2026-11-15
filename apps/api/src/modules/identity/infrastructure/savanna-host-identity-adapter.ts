// Production host identity adapter for Savanna LMS platform integration (T3-004-B).
// Validates incoming signed handoff tokens, enforces audience/issuer/expiry,
// prevents replay via JTI registry, and maps claims to verified Principal scopes.
// Long-lived signing secrets remain strictly server-side and are never sent to clients.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { digestToken } from '../application/resolve-principal.ts';
import type {
  HandoffExchangeResult,
  HandoffSession,
  HandoffTokenPayload,
  HostIdentityAdapter,
  HostIdentityValidationResult,
} from '../domain/host-identity-adapter.ts';
import type { Principal, Role } from '../domain/principal.ts';

export interface SavannaHostIdentityAdapterConfig {
  /** Server-side signing secret shared with Savanna host platform. Kept strictly server-side. */
  readonly secret: string;
  /** Expected token issuer (e.g. 'https://savanna.alxafrica.com'). */
  readonly issuer: string;
  /** Primary expected token audience (e.g. 'track3-assistant' or assistant origin). */
  readonly audience: string;
  /** Additional allowed audiences (e.g. origins). */
  readonly allowedAudiences?: readonly string[];
  /** Clock tolerance in ms for future iat/exp drift (default: 60,000ms / 1min). */
  readonly clockToleranceMs?: number;
  /** Assistant session TTL in ms (default: 2 hours). */
  readonly sessionTtlMs?: number;
}

export interface ReplayCache {
  /**
   * Atomically checks whether JTI has been consumed.
   * If fresh, records it with an expiration timestamp and returns true.
   * If already seen, returns false (replayed).
   */
  checkAndRecord(jti: string, expiresAt: Date): Promise<boolean> | boolean;
}

export class MemoryReplayCache implements ReplayCache {
  readonly #seen = new Map<string, number>();

  checkAndRecord(jti: string, expiresAt: Date): boolean {
    const now = Date.now();
    this.#prune(now);
    const existing = this.#seen.get(jti);
    if (existing !== undefined && existing > now) {
      return false;
    }
    this.#seen.set(jti, expiresAt.getTime());
    return true;
  }

  #prune(now: number): void {
    for (const [key, exp] of this.#seen.entries()) {
      if (exp <= now) {
        this.#seen.delete(key);
      }
    }
  }

  clear(): void {
    this.#seen.clear();
  }
}

export interface HostSessionStore {
  createSession(tokenDigest: string, principal: Principal, expiresAt: Date): Promise<void> | void;
  findSession(tokenDigest: string, now: Date): Promise<Principal | null> | Principal | null;
  revokeSession(tokenDigest: string): Promise<boolean> | boolean;
}

export class MemoryHostSessionStore implements HostSessionStore {
  readonly #sessions = new Map<string, { principal: Principal; expiresAt: number }>();

  createSession(tokenDigest: string, principal: Principal, expiresAt: Date): void {
    this.#sessions.set(tokenDigest, { principal, expiresAt: expiresAt.getTime() });
  }

  findSession(tokenDigest: string, now: Date): Principal | null {
    const session = this.#sessions.get(tokenDigest);
    if (!session) return null;
    if (session.expiresAt <= now.getTime()) {
      this.#sessions.delete(tokenDigest);
      return null;
    }
    return session.principal;
  }

  revokeSession(tokenDigest: string): boolean {
    return this.#sessions.delete(tokenDigest);
  }

  clear(): void {
    this.#sessions.clear();
  }
}

/**
 * Creates and signs a compact JWT handoff token with the given secret.
 * Exported for tests, embed consumers, and host simulation.
 */
export function createSignedHandoffToken(
  payload: HandoffTokenPayload,
  secret: string,
  algorithm: string = 'HS256',
): string {
  const header = { alg: algorithm, typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  if (algorithm === 'none') {
    return `${headerB64}.${payloadB64}.`;
  }
  const signature = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

const VALID_ROLES = new Set<Role>(['learner', 'support', 'teacher']);

export class SavannaHostIdentityAdapter implements HostIdentityAdapter {
  readonly #secret: string;
  readonly #issuer: string;
  readonly #audience: string;
  readonly #allowedAudiences: readonly string[];
  readonly #clockToleranceMs: number;
  readonly #sessionTtlMs: number;
  readonly #replayCache: ReplayCache;
  readonly #sessionStore: HostSessionStore;
  readonly #now: () => Date;

  constructor(
    config: SavannaHostIdentityAdapterConfig,
    options: {
      replayCache?: ReplayCache;
      sessionStore?: HostSessionStore;
      now?: () => Date;
    } = {},
  ) {
    if (!config.secret || config.secret.trim().length === 0) {
      throw new Error('SavannaHostIdentityAdapter requires a non-empty signing secret');
    }
    if (!config.issuer || config.issuer.trim().length === 0) {
      throw new Error('SavannaHostIdentityAdapter requires an issuer');
    }
    if (!config.audience || config.audience.trim().length === 0) {
      throw new Error('SavannaHostIdentityAdapter requires an audience');
    }

    this.#secret = config.secret;
    this.#issuer = config.issuer;
    this.#audience = config.audience;
    this.#allowedAudiences = config.allowedAudiences ?? [];
    this.#clockToleranceMs = config.clockToleranceMs ?? 60_000;
    this.#sessionTtlMs = config.sessionTtlMs ?? 2 * 60 * 60 * 1000; // 2 hours
    this.#replayCache = options.replayCache ?? new MemoryReplayCache();
    this.#sessionStore = options.sessionStore ?? new MemoryHostSessionStore();
    this.#now = options.now ?? (() => new Date());
  }

  async validateHandoff(
    rawToken: string,
    expectedAudience?: string,
  ): Promise<HostIdentityValidationResult> {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.trim().length === 0) {
      return { valid: false, error: 'missing_token', reason: 'Missing handoff token' };
    }

    const segments = rawToken.trim().split('.');
    if (segments.length !== 3) {
      return {
        valid: false,
        error: 'invalid_format',
        reason: 'Handoff token must have 3 segments separated by dots',
      };
    }

    const [headerB64, payloadB64, signatureB64] = segments as [string, string, string];

    // Decode and validate header
    let header: { alg?: string; typ?: string };
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as {
        alg?: string;
        typ?: string;
      };
    } catch {
      return { valid: false, error: 'invalid_format', reason: 'Malformed token header' };
    }

    if (!header || typeof header !== 'object' || header.alg !== 'HS256') {
      return {
        valid: false,
        error: 'invalid_signature',
        reason: `Unsupported or prohibited token algorithm: ${header?.alg}`,
      };
    }

    if (!signatureB64 || signatureB64.length === 0) {
      return { valid: false, error: 'invalid_signature', reason: 'Missing token signature' };
    }

    // Cryptographic signature check
    const expectedSig = createHmac('sha256', this.#secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    const sigBuf = Buffer.from(signatureB64, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return { valid: false, error: 'invalid_signature', reason: 'Signature verification failed' };
    }

    // Decode and parse payload
    let payloadRaw: unknown;
    try {
      payloadRaw = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      return { valid: false, error: 'invalid_format', reason: 'Malformed token payload' };
    }

    if (!payloadRaw || typeof payloadRaw !== 'object') {
      return { valid: false, error: 'invalid_format', reason: 'Malformed token payload object' };
    }

    const payload = payloadRaw as HandoffTokenPayload;

    // Issuer validation
    if (typeof payload.iss !== 'string' || payload.iss !== this.#issuer) {
      return {
        valid: false,
        error: 'invalid_issuer',
        reason: `Token issuer '${payload.iss}' does not match expected issuer '${this.#issuer}'`,
      };
    }

    // Audience validation
    const acceptableAudiences = new Set<string>(
      [expectedAudience, this.#audience, ...this.#allowedAudiences].filter((a): a is string =>
        Boolean(a && a.length > 0),
      ),
    );

    const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const audienceMatched = tokenAudiences.some(
      (aud) => typeof aud === 'string' && acceptableAudiences.has(aud),
    );

    if (!audienceMatched) {
      return {
        valid: false,
        error: 'invalid_audience',
        reason: `Token audience '${JSON.stringify(payload.aud)}' is not acceptable`,
      };
    }

    // Expiry check
    const now = this.#now();
    const nowSec = now.getTime() / 1000;
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return { valid: false, error: 'invalid_claims', reason: 'Token exp claim must be a number' };
    }

    if (nowSec >= payload.exp) {
      return {
        valid: false,
        error: 'token_expired',
        reason: `Token expired at ${new Date(payload.exp * 1000).toISOString()}`,
      };
    }

    // Clock-skew future check for iat
    if (payload.iat !== undefined) {
      if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) {
        return {
          valid: false,
          error: 'invalid_claims',
          reason: 'Token iat claim must be a number',
        };
      }
      if (payload.iat * 1000 > now.getTime() + this.#clockToleranceMs) {
        return {
          valid: false,
          error: 'token_not_yet_valid',
          reason: 'Token issued at time is in the future beyond tolerance',
        };
      }
    }

    // JTI / Nonce replay prevention
    if (typeof payload.jti !== 'string' || payload.jti.trim().length === 0) {
      return {
        valid: false,
        error: 'invalid_claims',
        reason: 'Token must include a non-empty jti nonce claim',
      };
    }

    const fresh = await this.#replayCache.checkAndRecord(payload.jti, new Date(payload.exp * 1000));
    if (!fresh) {
      return {
        valid: false,
        error: 'token_replayed',
        reason: `Token with jti '${payload.jti}' has already been consumed (replay prevented)`,
      };
    }

    // Identity and scope claims validation
    if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) {
      return {
        valid: false,
        error: 'invalid_claims',
        reason: 'Token sub claim must be a non-empty string',
      };
    }

    if (!VALID_ROLES.has(payload.role)) {
      return {
        valid: false,
        error: 'invalid_role',
        reason: `Token role '${payload.role}' is not an authorized role ('learner' | 'support' | 'teacher')`,
      };
    }

    if (
      !Array.isArray(payload.course_ids) ||
      payload.course_ids.some((c) => typeof c !== 'string')
    ) {
      return {
        valid: false,
        error: 'invalid_claims',
        reason: 'Token course_ids must be an array of string course IDs',
      };
    }

    // Construct verified Principal
    const courseIds: readonly string[] = Object.freeze(payload.course_ids.map((id) => String(id)));
    const principal: Principal = {
      id: payload.sub.trim(),
      role: payload.role,
      label:
        payload.name && payload.name.trim().length > 0 ? payload.name.trim() : payload.sub.trim(),
      demo: false, // Production host identity!
      courseIds,
    };

    return { valid: true, principal, payload };
  }

  async exchangeHandoff(
    rawToken: string,
    expectedAudience?: string,
  ): Promise<HandoffExchangeResult> {
    const validation = await this.validateHandoff(rawToken, expectedAudience);
    if (!validation.valid || !validation.principal) {
      return {
        success: false,
        error: validation.error,
        reason: validation.reason,
      };
    }

    const sessionSecret = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.#now().getTime() + this.#sessionTtlMs);
    await this.#sessionStore.createSession(
      digestToken(sessionSecret),
      validation.principal,
      expiresAt,
    );

    const session: HandoffSession = {
      token: sessionSecret,
      principal: validation.principal,
      expiresAt,
    };

    return {
      success: true,
      session,
      principal: validation.principal,
    };
  }

  async resolveSession(sessionToken: string): Promise<Principal | null> {
    if (!sessionToken || typeof sessionToken !== 'string') return null;
    const digest = digestToken(sessionToken);
    return this.#sessionStore.findSession(digest, this.#now());
  }

  async revokeSession(sessionToken: string): Promise<boolean> {
    if (!sessionToken || typeof sessionToken !== 'string') return false;
    const digest = digestToken(sessionToken);
    return this.#sessionStore.revokeSession(digest);
  }
}
