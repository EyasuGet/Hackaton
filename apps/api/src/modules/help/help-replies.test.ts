// Unit tests for help reply and resolution domain/application use cases (T3-017-B).
// Verifies principal role guards, ownership boundaries, input validation,
// terminal-state guards, idempotency, and read-state transitions in memory.
import { describe, expect, it } from 'vitest';
import type { OwnedScope, Principal } from '../identity/domain/principal.ts';
import { Help } from './application/help.ts';
import type {
  AddReplyResult,
  ClaimResult,
  HelpRepository,
  QueueItem,
  SubmitHelpInput,
  SubmitResult,
} from './application/ports/help-repository.ts';
import { StaffHelp } from './application/staff-help.ts';
import type { HelpReply, HelpRequest } from './domain/help-request.ts';

const LEARNER: Principal = {
  id: 'learner-1',
  role: 'learner',
  label: 'Learner One',
  demo: true,
  courseIds: ['course-1'],
};

const OTHER_LEARNER: Principal = {
  id: 'learner-2',
  role: 'learner',
  label: 'Learner Two',
  demo: true,
  courseIds: ['course-1'],
};

const SUPPORT: Principal = {
  id: 'staff-1',
  role: 'support',
  label: 'Support Staff',
  demo: true,
  courseIds: [],
};

class InMemoryHelpRepository implements HelpRepository {
  readonly requests = new Map<string, HelpRequest>();
  readonly replies = new Map<string, HelpReply[]>();
  #counter = 1;

  submit(scope: OwnedScope, input: SubmitHelpInput): Promise<SubmitResult> {
    const existing = [...this.requests.values()].find(
      (r) => r.ownerId === scope.ownerId && r.clientRequestId === input.clientRequestId,
    );
    if (existing) return Promise.resolve({ kind: 'existing', request: existing });

    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const req: HelpRequest = {
      id: `req-${this.#counter++}`,
      ownerId: scope.ownerId,
      clientRequestId: input.clientRequestId,
      contextSnapshot: input.contextSnapshot,
      consentGiven: true,
      state: 'waiting',
      createdAt: now,
      expiresAt: expires,
      updatedAt: now,
      cancelledAt: null,
      claimedBy: null,
      claimedAt: null,
      resolvedAt: null,
      resolvedBy: null,
    };
    this.requests.set(req.id, req);
    return Promise.resolve({ kind: 'submitted', request: req });
  }

  cancel(scope: OwnedScope, id: string): Promise<HelpRequest | null> {
    const req = this.requests.get(id);
    if (!req || req.ownerId !== scope.ownerId || req.state !== 'waiting')
      return Promise.resolve(null);
    if (new Date(req.expiresAt).getTime() <= Date.now()) return Promise.resolve(null);
    const updated: HelpRequest = {
      ...req,
      state: 'cancelled',
      cancelledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.requests.set(id, updated);
    return Promise.resolve(updated);
  }

  findById(scope: OwnedScope, id: string): Promise<HelpRequest | null> {
    const req = this.requests.get(id);
    if (!req || req.ownerId !== scope.ownerId) return Promise.resolve(null);
    return Promise.resolve(req);
  }

  findByIdAsStaff(id: string): Promise<HelpRequest | null> {
    return Promise.resolve(this.requests.get(id) ?? null);
  }

  listOwned(scope: OwnedScope): Promise<readonly HelpRequest[]> {
    const now = Date.now();
    const list = [...this.requests.values()]
      .filter((r) => r.ownerId === scope.ownerId && new Date(r.expiresAt).getTime() > now)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Promise.resolve(list);
  }

  listQueue(): Promise<readonly QueueItem[]> {
    const now = Date.now();
    const items: QueueItem[] = [...this.requests.values()]
      .filter((r) => r.state === 'waiting' && new Date(r.expiresAt).getTime() > now)
      .map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        state: 'waiting' as const,
      }));
    return Promise.resolve(items);
  }

  claimRequest(id: string, staffId: string): Promise<ClaimResult | null> {
    const req = this.requests.get(id);
    if (!req) return Promise.resolve(null);
    if (req.state === 'claimed') return Promise.resolve({ kind: 'already_claimed', request: req });
    if (req.state !== 'waiting' || new Date(req.expiresAt).getTime() <= Date.now()) {
      return Promise.resolve(null);
    }
    const claimed: HelpRequest = {
      ...req,
      state: 'claimed',
      claimedBy: staffId,
      claimedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.requests.set(id, claimed);
    return Promise.resolve({ kind: 'claimed', request: claimed });
  }

  addReply(
    helpRequestId: string,
    authorId: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddReplyResult | null> {
    const req = this.requests.get(helpRequestId);
    if (!req) return Promise.resolve(null);
    if (req.state === 'cancelled' || req.state === 'resolved') return Promise.resolve(null);
    if (new Date(req.expiresAt).getTime() <= Date.now()) return Promise.resolve(null);

    const existingList = this.replies.get(helpRequestId) ?? [];
    const existingReply = existingList.find((r) => r.clientReplyId === clientReplyId);
    if (existingReply) return Promise.resolve({ kind: 'existing', reply: existingReply });

    const reply: HelpReply = {
      id: `rep-${this.#counter++}`,
      helpRequestId,
      authorId,
      clientReplyId,
      body,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    this.replies.set(helpRequestId, [...existingList, reply]);
    return Promise.resolve({ kind: 'added', reply });
  }

  listReplies(helpRequestId: string): Promise<readonly HelpReply[]> {
    return Promise.resolve(this.replies.get(helpRequestId) ?? []);
  }

  markRepliesRead(helpRequestId: string, readerId: string): Promise<void> {
    const list = this.replies.get(helpRequestId) ?? [];
    const now = new Date().toISOString();
    const updated = list.map((r) =>
      r.authorId !== readerId && r.readAt === null ? { ...r, readAt: now } : r,
    );
    this.replies.set(helpRequestId, updated);
    return Promise.resolve();
  }

  resolveRequest(helpRequestId: string, supportId: string): Promise<HelpRequest | null> {
    const req = this.requests.get(helpRequestId);
    if (!req || req.state !== 'claimed' || new Date(req.expiresAt).getTime() <= Date.now()) {
      return Promise.resolve(null);
    }
    const resolved: HelpRequest = {
      ...req,
      state: 'resolved',
      resolvedBy: supportId,
      resolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.requests.set(helpRequestId, resolved);
    return Promise.resolve(resolved);
  }
}

describe('Help Application - Replies & Resolution (T3-017-B)', () => {
  it('allows owner learner to add reply and returns added result', async () => {
    const repo = new InMemoryHelpRepository();
    const help = new Help(repo);
    const sub = await help.submit(LEARNER, {
      clientRequestId: 'cr-1',
      contextSnapshot: 'Need help.',
    });
    const reqId = sub?.request.id ?? '';

    const result = await help.addReply(LEARNER, reqId, 'rep-key-1', '  Learner message  ');
    expect(result?.kind).toBe('added');
    expect(result?.reply.body).toBe('Learner message');
    expect(result?.reply.authorId).toBe(LEARNER.id);
  });

  it('retrying with same clientReplyId is idempotent', async () => {
    const repo = new InMemoryHelpRepository();
    const help = new Help(repo);
    const sub = await help.submit(LEARNER, {
      clientRequestId: 'cr-1',
      contextSnapshot: 'Need help.',
    });
    const reqId = sub?.request.id ?? '';

    const first = await help.addReply(LEARNER, reqId, 'dup-key', 'Initial body');
    expect(first?.kind).toBe('added');

    const second = await help.addReply(LEARNER, reqId, 'dup-key', 'Different body');
    expect(second?.kind).toBe('existing');
    expect(second?.reply.id).toBe(first?.reply.id);
    expect(second?.reply.body).toBe('Initial body');
  });

  it('rejects replies from non-learners or un-owned requests', async () => {
    const repo = new InMemoryHelpRepository();
    const help = new Help(repo);
    const sub = await help.submit(LEARNER, {
      clientRequestId: 'cr-1',
      contextSnapshot: 'Need help.',
    });
    const reqId = sub?.request.id ?? '';

    // Non-learner calling learner use case
    const supportAttempt = await help.addReply(SUPPORT, reqId, 'rep-1', 'Support text');
    expect(supportAttempt).toBeNull();

    // Another learner calling on learner-1's request
    const otherAttempt = await help.addReply(OTHER_LEARNER, reqId, 'rep-2', 'Other learner');
    expect(otherAttempt).toBeNull();
  });

  it('rejects empty or whitespace-only reply bodies', async () => {
    const repo = new InMemoryHelpRepository();
    const help = new Help(repo);
    const sub = await help.submit(LEARNER, {
      clientRequestId: 'cr-1',
      contextSnapshot: 'Need help.',
    });
    const reqId = sub?.request.id ?? '';

    const empty = await help.addReply(LEARNER, reqId, 'rep-empty', '   ');
    expect(empty).toBeNull();
  });

  it('rejects replies after request is cancelled or resolved', async () => {
    const repo = new InMemoryHelpRepository();
    const help = new Help(repo);
    const staffHelp = new StaffHelp(repo);
    const sub = await help.submit(LEARNER, {
      clientRequestId: 'cr-1',
      contextSnapshot: 'Need help.',
    });
    const reqId = sub?.request.id ?? '';

    // Cancel request
    await help.cancel(LEARNER, reqId);

    const replyAfterCancel = await help.addReply(LEARNER, reqId, 'rep-after-c', 'Still need help');
    expect(replyAfterCancel).toBeNull();

    // Submit new request, claim it, resolve it
    const sub2 = await help.submit(LEARNER, {
      clientRequestId: 'cr-2',
      contextSnapshot: 'Another question.',
    });
    const reqId2 = sub2?.request.id ?? '';
    await staffHelp.claimRequest(SUPPORT, reqId2);
    await staffHelp.resolveRequest(SUPPORT, reqId2);

    const replyAfterResolve = await help.addReply(
      LEARNER,
      reqId2,
      'rep-after-r',
      'Resolved follow-up',
    );
    expect(replyAfterResolve).toBeNull();
  });

  it('supports staff replying to claimed requests and tracks read state', async () => {
    const repo = new InMemoryHelpRepository();
    const help = new Help(repo);
    const staffHelp = new StaffHelp(repo);

    const sub = await help.submit(LEARNER, {
      clientRequestId: 'cr-1',
      contextSnapshot: 'Need advice on scheduling.',
    });
    const reqId = sub?.request.id ?? '';
    await staffHelp.claimRequest(SUPPORT, reqId);

    // Staff replies proposing Addis Ababa meeting time
    const staffReply = await staffHelp.addReply(
      SUPPORT,
      reqId,
      'sr-1',
      'Can we meet at 15:00 Addis Ababa Time (EAT)?',
    );
    expect(staffReply?.kind).toBe('added');
    expect(staffReply?.reply.body).toContain('Addis Ababa Time (EAT)');

    // Learner lists replies
    const learnerReplies = await help.listReplies(LEARNER, reqId);
    expect(learnerReplies).toHaveLength(1);
    expect(learnerReplies?.[0]?.readAt).toBeNull();

    // Learner marks replies as read
    const marked = await help.markRepliesRead(LEARNER, reqId);
    expect(marked).toBe(true);

    const updatedReplies = await help.listReplies(LEARNER, reqId);
    expect(updatedReplies?.[0]?.readAt).not.toBeNull();
  });

  it('only support staff can resolve a request; learner cannot resolve', async () => {
    const repo = new InMemoryHelpRepository();
    const help = new Help(repo);
    const staffHelp = new StaffHelp(repo);

    const sub = await help.submit(LEARNER, {
      clientRequestId: 'cr-1',
      contextSnapshot: 'Need help.',
    });
    const reqId = sub?.request.id ?? '';
    await staffHelp.claimRequest(SUPPORT, reqId);

    // Learner cannot resolve
    const learnerResolve = await staffHelp.resolveRequest(LEARNER, reqId);
    expect(learnerResolve).toBeNull();

    // Staff resolves
    const staffResolve = await staffHelp.resolveRequest(SUPPORT, reqId);
    expect(staffResolve?.state).toBe('resolved');
    expect(staffResolve?.resolvedBy).toBe(SUPPORT.id);
  });
});
