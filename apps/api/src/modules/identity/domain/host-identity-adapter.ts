// Clean Architecture domain interface for host LMS identity handoff (T3-004-B).
// Real LMS platforms (such as Savanna) supply signed handoff tokens carrying
// authenticated subject, role, and course grants. No client-supplied or DOM-scraped
// identifiers are ever trusted.
import type { Principal, Role } from './principal.ts';

/**
 * Standard token claims payload for incoming Savanna host LMS SSO / handoff tokens.
 * The host signs this payload with a server-side signing secret.
 */
export interface HandoffTokenPayload {
  /** Subject: unique user identifier in host system (e.g. learner UUID / ID). */
  readonly sub: string;
  /** Audience: intended recipient / assistant application origin or identifier. */
  readonly aud: string | readonly string[];
  /** Issuer: host identity provider URL/identifier (e.g. 'https://savanna.alxafrica.com'). */
  readonly iss: string;
  /** Expiration timestamp in seconds (UNIX time). */
  readonly exp: number;
  /** Issued-at timestamp in seconds (UNIX time). */
  readonly iat?: number | undefined;
  /** JWT ID / unique cryptographic nonce for single-use replay prevention. */
  readonly jti: string;
  /** Human-readable display name or profile label. */
  readonly name?: string | undefined;
  /** Authorized role in the host system: 'learner' | 'support' | 'teacher'. */
  readonly role: Role;
  /** Authorized course identifiers granted by the host platform to this user. */
  readonly course_ids: readonly string[];
}

/** Error codes identifying reasons for handoff validation or exchange rejection. */
export type HandoffErrorCode =
  | 'missing_token'
  | 'invalid_format'
  | 'invalid_signature'
  | 'token_expired'
  | 'token_not_yet_valid'
  | 'token_replayed'
  | 'invalid_issuer'
  | 'invalid_audience'
  | 'invalid_role'
  | 'invalid_claims';

export interface HostIdentityValidationResult {
  readonly valid: boolean;
  readonly principal?: Principal | undefined;
  readonly payload?: HandoffTokenPayload | undefined;
  readonly error?: HandoffErrorCode | undefined;
  readonly reason?: string | undefined;
}

export interface HandoffSession {
  readonly token: string;
  readonly principal: Principal;
  readonly expiresAt: Date;
}

export interface HandoffExchangeResult {
  readonly success: boolean;
  readonly session?: HandoffSession | undefined;
  readonly principal?: Principal | undefined;
  readonly error?: HandoffErrorCode | undefined;
  readonly reason?: string | undefined;
}

/**
 * Clean Architecture interface for validating incoming host SSO/handoff payloads
 * and mapping authenticated claims to a verified Principal with permitted courses
 * and role ('learner' | 'support' | 'teacher').
 */
export interface HostIdentityAdapter {
  /**
   * Validates an incoming signed host handoff token against signature, issuer, audience,
   * expiry, single-use replay, and authorized claims.
   */
  validateHandoff(
    rawToken: string,
    expectedAudience?: string,
  ): Promise<HostIdentityValidationResult>;

  /**
   * Exchanges a validated single-use handoff token for an authenticated assistant session,
   * returning the session token and mapped Principal.
   */
  exchangeHandoff(rawToken: string, expectedAudience?: string): Promise<HandoffExchangeResult>;

  /**
   * Resolves a previously issued session token to its authenticated Principal.
   */
  resolveSession(sessionToken: string): Promise<Principal | null>;

  /**
   * Revokes an active session by token.
   */
  revokeSession(sessionToken: string): Promise<boolean>;
}
