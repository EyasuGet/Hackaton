// Synthetic demo sessions (T3-004-C): an operator mints a short-lived,
// single-use handoff code for a provisioned demo principal; the browser trades
// it for a short-lived, revocable session token sent as a bearer credential.
// Nothing the browser sends can choose a role or course grant.
import { randomBytes } from 'node:crypto';
import { digestToken } from './resolve-principal.ts';

/** Long enough to open a sign-in link, short enough that a leaked one soon expires. */
export const HANDOFF_TTL_MS = 2 * 60 * 1000;
/** One demo sitting; afterwards a new handoff is needed. */
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export interface DemoSessionRepository {
  /** Stores a handoff for the demo principal with this key; false if there is no such principal. */
  createHandoff(
    principalKey: string,
    audience: string,
    codeDigest: string,
    expiresAt: Date,
  ): Promise<boolean>;
  /**
   * Marks an unused, unexpired handoff minted for `audience` as used and returns
   * its principal id, or null. Must be atomic so a code can be exchanged only
   * once, even concurrently; a wrong audience leaves the code unused.
   */
  consumeHandoff(codeDigest: string, audience: string, now: Date): Promise<string | null>;
  createSession(principalId: string, tokenDigest: string, expiresAt: Date): Promise<void>;
  /** True if an active session was revoked; false if the token was not one. */
  revokeSession(tokenDigest: string, now: Date): Promise<boolean>;
}

export interface IssuedSecret {
  /** Shown once; only its digest is stored. */
  readonly secret: string;
  readonly expiresAt: Date;
}

function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export class DemoSessions {
  readonly #repository: DemoSessionRepository;
  readonly #demoMode: boolean;
  readonly #now: () => Date;

  constructor(
    repository: DemoSessionRepository,
    demoMode: boolean,
    now: () => Date = () => new Date(),
  ) {
    this.#repository = repository;
    this.#demoMode = demoMode;
    this.#now = now;
  }

  /**
   * Mints a code usable only from the page origin `audience`. Null when demo
   * mode is off or the key names no provisioned demo principal.
   */
  async issueHandoff(principalKey: string, audience: string): Promise<IssuedSecret | null> {
    if (!this.#demoMode) return null;
    const code = newSecret();
    const expiresAt = new Date(this.#now().getTime() + HANDOFF_TTL_MS);
    const created = await this.#repository.createHandoff(
      principalKey,
      audience,
      digestToken(code),
      expiresAt,
    );
    return created ? { secret: code, expiresAt } : null;
  }

  /**
   * Null for an unknown, used, expired or other-audience code, indistinguishably,
   * or when demo mode is off.
   */
  async exchange(code: string, origin: string): Promise<IssuedSecret | null> {
    if (!this.#demoMode) return null;
    const now = this.#now();
    const principalId = await this.#repository.consumeHandoff(digestToken(code), origin, now);
    if (!principalId) return null;
    const token = newSecret();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await this.#repository.createSession(principalId, digestToken(token), expiresAt);
    return { secret: token, expiresAt };
  }

  /** Ends the session for this bearer token. False if the token is not an active session. */
  async revoke(token: string): Promise<boolean> {
    return this.#repository.revokeSession(digestToken(token), this.#now());
  }
}
