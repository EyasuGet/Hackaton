import type { Principal } from '../domain/principal.ts';

export interface PrincipalRepository {
  /**
   * Returns the demo principal holding this token digest — a provisioned demo
   * token, or a session that is unrevoked and unexpired at `now` — with its
   * course grants, or null. Never returns a non-demo principal.
   */
  findDemoByTokenDigest(digest: string, now: Date): Promise<Principal | null>;
}
