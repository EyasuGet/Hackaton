// Help use cases enforcing learner ownership. Non-learner principals have no
// scope and receive null or empty results. The spec forbids promising staff
// availability or capturing screens in this leaf (T3-016-A).
import { ownedScope, type Principal } from '../../identity/domain/principal.ts';
import type { HelpReply, HelpRequest } from '../domain/help-request.ts';
import type {
  AddReplyResult,
  HelpRepository,
  SubmitHelpInput,
  SubmitResult,
} from './ports/help-repository.ts';

export class Help {
  readonly #repository: HelpRepository;

  constructor(repository: HelpRepository) {
    this.#repository = repository;
  }

  /**
   * Submits a help request on behalf of a learner principal.
   * Returns null for non-learner principals or empty context.
   */
  async submit(principal: Principal, input: SubmitHelpInput): Promise<SubmitResult | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    if (!input.contextSnapshot.trim()) return null;
    return this.#repository.submit(scope, input);
  }

  /**
   * Cancels an owned waiting help request. Returns null when the principal
   * is not a learner, the request is not found, or it is not in waiting state.
   */
  async cancel(principal: Principal, id: string): Promise<HelpRequest | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    return this.#repository.cancel(scope, id);
  }

  /**
   * Retrieves an owned help request by id. Returns null for requests that
   * belong to another learner or do not exist.
   */
  async getById(principal: Principal, id: string): Promise<HelpRequest | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    return this.#repository.findById(scope, id);
  }

  /**
   * Lists non-expired help requests for the learner, newest first.
   */
  async listOwned(principal: Principal): Promise<readonly HelpRequest[]> {
    const scope = ownedScope(principal);
    if (!scope) return [];
    return this.#repository.listOwned(scope);
  }

  /**
   * Adds a reply to the learner's own help request.
   * Returns null when the principal is not a learner, the request does not
   * belong to them, the request is in a terminal state, or it has expired.
   */
  async addReply(
    principal: Principal,
    helpRequestId: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddReplyResult | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    if (!body.trim()) return null;
    // Confirm the learner owns this request before allowing a reply.
    const request = await this.#repository.findById(scope, helpRequestId);
    if (!request) return null;
    return this.#repository.addReply(helpRequestId, principal.id, clientReplyId, body.trim());
  }

  /**
   * Lists replies for the learner's own help request in chronological order.
   * Returns null when the principal is not a learner or does not own the request.
   */
  async listReplies(
    principal: Principal,
    helpRequestId: string,
  ): Promise<readonly HelpReply[] | null> {
    const scope = ownedScope(principal);
    if (!scope) return null;
    const request = await this.#repository.findById(scope, helpRequestId);
    if (!request) return null;
    return this.#repository.listReplies(helpRequestId);
  }

  /**
   * Marks all unread replies (by others) on the learner's request as read.
   * Returns false when the principal is not a learner or does not own the request.
   */
  async markRepliesRead(principal: Principal, helpRequestId: string): Promise<boolean> {
    const scope = ownedScope(principal);
    if (!scope) return false;
    const request = await this.#repository.findById(scope, helpRequestId);
    if (!request) return false;
    await this.#repository.markRepliesRead(helpRequestId, principal.id);
    return true;
  }
}
