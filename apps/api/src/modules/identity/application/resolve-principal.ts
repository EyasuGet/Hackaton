// Resolves the bearer credential on a request to a principal. Demo tokens are the
// only credential this build accepts; with demo mode off nothing authenticates,
// so demo access can never stand in for real deployment authentication.
import { createHash } from 'node:crypto';
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

  constructor(
    repository: PrincipalRepository,
    demoMode: boolean,
    now: () => Date = () => new Date(),
  ) {
    this.#repository = repository;
    this.#demoMode = demoMode;
    this.#now = now;
  }

  /** Returns null for an unknown token, or for any token while demo mode is off. */
  async execute(token: string): Promise<Principal | null> {
    if (!this.#demoMode) return null;
    return this.#repository.findDemoByTokenDigest(digestToken(token), this.#now());
  }
}
