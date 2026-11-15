// Resolves the bearer credential on a request to a principal.
// When a host identity adapter is configured, it resolves real host session tokens.
// In demo mode, it resolves synthetic demo session and bearer tokens.
// With demo mode off and no host session, nothing authenticates.
import { createHash } from 'node:crypto';
import type { HostIdentityAdapter } from '../domain/host-identity-adapter.ts';
import type { Principal } from '../domain/principal.ts';
import type { PrincipalRepository } from './principal-repository.ts';

/** Tokens are stored only as this digest. They are 256-bit random values, so a fast hash suffices. */
export function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class ResolvePrincipal {
  readonly #repository: PrincipalRepository;
  readonly #demoMode: boolean;
  readonly #now: () => Date;
  readonly #hostAdapter: HostIdentityAdapter | undefined;

  constructor(
    repository: PrincipalRepository,
    demoMode: boolean,
    now: () => Date = () => new Date(),
    hostAdapter?: HostIdentityAdapter,
  ) {
    this.#repository = repository;
    this.#demoMode = demoMode;
    this.#now = now;
    this.#hostAdapter = hostAdapter;
  }

  /**
   * Returns the authenticated Principal for a bearer token.
   * If a host identity adapter is provided, checks host sessions first.
   * Falls back to demo tokens if demo mode is enabled.
   */
  async execute(token: string): Promise<Principal | null> {
    if (this.#hostAdapter) {
      const hostPrincipal = await this.#hostAdapter.resolveSession(token);
      if (hostPrincipal) return hostPrincipal;
    }
    if (!this.#demoMode) return null;
    return this.#repository.findDemoByTokenDigest(digestToken(token), this.#now());
  }
}
