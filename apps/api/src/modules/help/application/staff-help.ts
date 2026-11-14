// Staff-facing help use cases. Only principals with role 'support' may call
// these; learner principals receive null / empty results so the same guard
// is consistent with the learner-facing Help use case.
import type { Principal } from '../../identity/domain/principal.ts';
import type { ClaimResult, HelpRepository, QueueItem } from './ports/help-repository.ts';

export class StaffHelp {
  readonly #repository: HelpRepository;

  constructor(repository: HelpRepository) {
    this.#repository = repository;
  }

  /**
   * Returns queue metadata for all non-expired waiting requests, oldest first.
   * Context snapshots are withheld until a request is claimed.
   * Returns null for non-support principals.
   */
  async listQueue(principal: Principal): Promise<readonly QueueItem[] | null> {
    if (principal.role !== 'support') return null;
    return this.#repository.listQueue();
  }

  /**
   * Atomically claims a waiting request for the given support principal.
   * Returns the full request (including contextSnapshot) on success.
   * Returns null for non-support principals or when the request is not found
   * or is in a terminal state other than 'claimed'.
   */
  async claimRequest(principal: Principal, id: string): Promise<ClaimResult | null> {
    if (principal.role !== 'support') return null;
    return this.#repository.claimRequest(id, principal.id);
  }
}
