import type { Principal } from '../domain/principal.ts';

export interface PrincipalRepository {
  /**
   * Returns the demo principal holding this token digest, with its course grants,
   * or null. Never returns a non-demo principal.
   */
  findDemoByTokenDigest(digest: string): Promise<Principal | null>;
}
