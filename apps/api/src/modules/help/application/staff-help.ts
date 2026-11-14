// Staff-facing help use cases. Only principals with role 'support' may call
// these; learner principals receive null / empty results so the same guard
// is consistent with the learner-facing Help use case.
import type { Principal } from '../../identity/domain/principal.ts';
import type { HelpReply, HelpRequest } from '../domain/help-request.ts';
import type {
  AddReplyResult,
  ClaimResult,
  HelpRepository,
  QueueItem,
} from './ports/help-repository.ts';

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

  /**
   * Adds a reply to any claimed help request. Support staff may reply to any
   * request they can see (not restricted to those they claimed).
   * Returns null for non-support principals or when the request is in a
   * terminal state or has expired.
   */
  async addReply(
    principal: Principal,
    helpRequestId: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddReplyResult | null> {
    if (principal.role !== 'support') return null;
    if (!body.trim()) return null;
    return this.#repository.addReply(helpRequestId, principal.id, clientReplyId, body.trim());
  }

  /**
   * Lists replies for any help request (staff have read access to all requests).
   * Returns null for non-support principals or when the request does not exist.
   */
  async listReplies(
    principal: Principal,
    helpRequestId: string,
  ): Promise<readonly HelpReply[] | null> {
    if (principal.role !== 'support') return null;
    // Confirm the request exists (staff can access any non-expired request by id).
    const request = await this.#repository.findByIdAsStaff(helpRequestId);
    if (!request) return null;
    return this.#repository.listReplies(helpRequestId);
  }

  /**
   * Marks all unread replies (by others) on a help request as read for the
   * support principal. Staff can mark reads on any request they can see.
   * Returns false for non-support principals or when the request does not exist.
   */
  async markRepliesRead(principal: Principal, helpRequestId: string): Promise<boolean> {
    if (principal.role !== 'support') return false;
    const request = await this.#repository.findByIdAsStaff(helpRequestId);
    if (!request) return false;
    await this.#repository.markRepliesRead(helpRequestId, principal.id);
    return true;
  }

  /**
   * Transitions a claimed request to resolved.
   * Returns the updated request on success, null for non-support principals
   * or when the request does not exist or cannot be resolved.
   */
  async resolveRequest(principal: Principal, helpRequestId: string): Promise<HelpRequest | null> {
    if (principal.role !== 'support') return null;
    return this.#repository.resolveRequest(helpRequestId, principal.id);
  }
}
