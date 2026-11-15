// Unit tests for accommodation coordinator claiming, replies, and resolution use cases (T3-022-B).
// Verifies principal role guards, ownership boundaries, input validation,
// terminal-state guards, idempotency, and read-state transitions in memory.
import { describe, expect, it } from 'vitest';
import type { OwnedScope, Principal } from '../identity/domain/principal.ts';
import { Accommodation } from './application/accommodation.ts';
import type {
  AccommodationRepository,
  AddAccommodationReplyResult,
  ClaimAccommodationResult,
  SubmitAccommodationInput,
  SubmitAccommodationResult,
} from './application/ports/accommodation-repository.ts';
import type {
  AccommodationQueueItem,
  AccommodationReply,
  AccommodationRequest,
} from './domain/accommodation-request.ts';

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

const COORDINATOR: Principal = {
  id: 'coord-1',
  role: 'support',
  label: 'Support Coordinator',
  demo: true,
  courseIds: [],
};

class InMemoryAccommodationRepository implements AccommodationRepository {
  readonly requests = new Map<string, AccommodationRequest>();
  readonly replies = new Map<string, AccommodationReply[]>();
  #counter = 1;

  submit(scope: OwnedScope, input: SubmitAccommodationInput): Promise<SubmitAccommodationResult> {
    const existing = [...this.requests.values()].find(
      (r) => r.ownerId === scope.ownerId && r.clientRequestId === input.clientRequestId,
    );
    if (existing) return Promise.resolve({ kind: 'existing', request: existing });

    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const req: AccommodationRequest = {
      id: `accomm-${this.#counter++}`,
      ownerId: scope.ownerId,
      jobId: input.jobId,
      clientRequestId: input.clientRequestId,
      supportDescription: input.supportDescription,
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

  cancel(scope: OwnedScope, id: string): Promise<AccommodationRequest | null> {
    const req = this.requests.get(id);
    if (!req || req.ownerId !== scope.ownerId || req.state !== 'waiting') {
      return Promise.resolve(null);
    }
    if (new Date(req.expiresAt).getTime() <= Date.now()) return Promise.resolve(null);
    const updated: AccommodationRequest = {
      ...req,
      state: 'cancelled',
      cancelledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.requests.set(id, updated);
    return Promise.resolve(updated);
  }

  findById(scope: OwnedScope, id: string): Promise<AccommodationRequest | null> {
    const req = this.requests.get(id);
    if (!req || req.ownerId !== scope.ownerId) return Promise.resolve(null);
    if (new Date(req.expiresAt).getTime() <= Date.now()) return Promise.resolve(null);
    return Promise.resolve(req);
  }

  coordinatorFindById(id: string): Promise<AccommodationRequest | null> {
    const req = this.requests.get(id);
    if (!req) return Promise.resolve(null);
    if (new Date(req.expiresAt).getTime() <= Date.now()) return Promise.resolve(null);
    return Promise.resolve(req);
  }

  listOwned(scope: OwnedScope): Promise<readonly AccommodationRequest[]> {
    const now = Date.now();
    const list = [...this.requests.values()]
      .filter((r) => r.ownerId === scope.ownerId && new Date(r.expiresAt).getTime() > now)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Promise.resolve(list);
  }

  listQueue(): Promise<readonly AccommodationQueueItem[]> {
    const now = Date.now();
    const items: AccommodationQueueItem[] = [...this.requests.values()]
      .filter((r) => r.state === 'waiting' && new Date(r.expiresAt).getTime() > now)
      .map((r) => ({
        id: r.id,
        jobId: r.jobId,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        state: 'waiting' as const,
      }));
    return Promise.resolve(items);
  }

  listForCoordinator(): Promise<readonly AccommodationRequest[]> {
    const now = Date.now();
    const list = [...this.requests.values()]
      .filter((r) => new Date(r.expiresAt).getTime() > now)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Promise.resolve(list);
  }

  claimRequest(id: string, coordinatorId: string): Promise<ClaimAccommodationResult | null> {
    const req = this.requests.get(id);
    if (!req) return Promise.resolve(null);
    if (req.state === 'claimed') return Promise.resolve({ kind: 'already_claimed', request: req });
    if (req.state !== 'waiting' || new Date(req.expiresAt).getTime() <= Date.now()) {
      return Promise.resolve(null);
    }
    const claimed: AccommodationRequest = {
      ...req,
      state: 'claimed',
      claimedBy: coordinatorId,
      claimedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.requests.set(id, claimed);
    return Promise.resolve({ kind: 'claimed', request: claimed });
  }

  addReply(
    accommodationRequestId: string,
    authorId: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddAccommodationReplyResult | null> {
    const req = this.requests.get(accommodationRequestId);
    if (!req) return Promise.resolve(null);
    if (req.state === 'cancelled' || req.state === 'resolved') return Promise.resolve(null);
    if (new Date(req.expiresAt).getTime() <= Date.now()) return Promise.resolve(null);

    const existingList = this.replies.get(accommodationRequestId) ?? [];
    const existingReply = existingList.find((r) => r.clientReplyId === clientReplyId);
    if (existingReply) return Promise.resolve({ kind: 'existing', reply: existingReply });

    const reply: AccommodationReply = {
      id: `rep-${this.#counter++}`,
      accommodationRequestId,
      authorId,
      clientReplyId,
      body,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    this.replies.set(accommodationRequestId, [...existingList, reply]);
    return Promise.resolve({ kind: 'added', reply });
  }

  listReplies(accommodationRequestId: string): Promise<readonly AccommodationReply[]> {
    return Promise.resolve(this.replies.get(accommodationRequestId) ?? []);
  }

  markRepliesRead(accommodationRequestId: string, readerId: string): Promise<void> {
    const list = this.replies.get(accommodationRequestId) ?? [];
    const now = new Date().toISOString();
    const updated = list.map((r) =>
      r.authorId !== readerId && r.readAt === null ? { ...r, readAt: now } : r,
    );
    this.replies.set(accommodationRequestId, updated);
    return Promise.resolve();
  }

  resolveRequest(
    accommodationRequestId: string,
    coordinatorId: string,
  ): Promise<AccommodationRequest | null> {
    const req = this.requests.get(accommodationRequestId);
    if (!req || req.state !== 'claimed' || new Date(req.expiresAt).getTime() <= Date.now()) {
      return Promise.resolve(null);
    }
    const resolved: AccommodationRequest = {
      ...req,
      state: 'resolved',
      resolvedBy: coordinatorId,
      resolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.requests.set(accommodationRequestId, resolved);
    return Promise.resolve(resolved);
  }
}

describe('Accommodation Coordinator & Replies Unit Tests (T3-022-B)', () => {
  it('allows coordinator to list queue and claim a waiting request', async () => {
    const repo = new InMemoryAccommodationRepository();
    const accommodation = new Accommodation(repo);

    const sub = await accommodation.submit(LEARNER, {
      clientRequestId: 'ar-1',
      jobId: 'job-1',
      supportDescription: 'Screen reader accommodation needed.',
    });
    if (!sub || sub.kind === 'job_not_found') throw new Error('submit failed');
    const reqId: string = sub.request.id;

    // Queue contains the request without supportDescription
    const queue = await accommodation.listQueue(COORDINATOR);
    expect(queue).toHaveLength(1);
    expect(queue?.[0]?.id).toBe(reqId);
    expect((queue?.[0] as unknown as Record<string, unknown>).supportDescription).toBeUndefined();

    // Learner cannot list queue
    const learnerQueue = await accommodation.listQueue(LEARNER);
    expect(learnerQueue).toBeNull();

    // Coordinator claims request
    const claim = await accommodation.claimRequest(COORDINATOR, reqId);
    expect(claim?.kind).toBe('claimed');
    expect(claim?.request.state).toBe('claimed');
    expect(claim?.request.claimedBy).toBe(COORDINATOR.id);

    // Learner cannot claim
    const learnerClaim = await accommodation.claimRequest(LEARNER, reqId);
    expect(learnerClaim).toBeNull();
  });

  it('allows two-sided reply exchange between coordinator and requesting learner', async () => {
    const repo = new InMemoryAccommodationRepository();
    const accommodation = new Accommodation(repo);

    const sub = await accommodation.submit(LEARNER, {
      clientRequestId: 'ar-2',
      jobId: 'job-1',
      supportDescription: 'Need extra time for technical exercise.',
    });
    if (!sub || sub.kind === 'job_not_found') throw new Error('submit failed');
    const reqId: string = sub.request.id;
    await accommodation.claimRequest(COORDINATOR, reqId);

    // Coordinator replies
    const coordReply = await accommodation.addReply(
      COORDINATOR,
      reqId,
      'cr-1',
      'We have allocated 45 additional minutes.',
    );
    expect(coordReply?.kind).toBe('added');
    expect(coordReply?.reply.body).toBe('We have allocated 45 additional minutes.');

    // Learner replies back
    const learnerReply = await accommodation.addReply(
      LEARNER,
      reqId,
      'lr-1',
      'Thank you, confirmed.',
    );
    expect(learnerReply?.kind).toBe('added');

    // Duplicate clientReplyId is idempotent
    const dup = await accommodation.addReply(LEARNER, reqId, 'lr-1', 'Different text');
    expect(dup?.kind).toBe('existing');
    expect(dup?.reply.body).toBe('Thank you, confirmed.');

    // List replies
    const replies = await accommodation.listReplies(LEARNER, reqId);
    expect(replies).toHaveLength(2);

    // Read state
    await accommodation.markRepliesRead(LEARNER, reqId);
    const updated = await accommodation.listReplies(COORDINATOR, reqId);
    expect(updated?.[0]?.readAt).not.toBeNull(); // Coordinator's reply marked read by learner
  });

  it('denies unrelated learners from replying or reading replies', async () => {
    const repo = new InMemoryAccommodationRepository();
    const accommodation = new Accommodation(repo);

    const sub = await accommodation.submit(LEARNER, {
      clientRequestId: 'ar-3',
      jobId: 'job-1',
      supportDescription: 'Private request.',
    });
    if (!sub || sub.kind === 'job_not_found') throw new Error('submit failed');
    const reqId: string = sub.request.id;

    // Other learner cannot reply
    const replyRes = await accommodation.addReply(
      OTHER_LEARNER,
      reqId,
      'spy-1',
      'Snooping message',
    );
    expect(replyRes).toBeNull();

    // Other learner cannot list replies
    const listRes = await accommodation.listReplies(OTHER_LEARNER, reqId);
    expect(listRes).toBeNull();
  });

  it('allows coordinator to resolve request; terminal states reject replies', async () => {
    const repo = new InMemoryAccommodationRepository();
    const accommodation = new Accommodation(repo);

    const sub = await accommodation.submit(LEARNER, {
      clientRequestId: 'ar-4',
      jobId: 'job-1',
      supportDescription: 'Private request for resolving.',
    });
    if (!sub || sub.kind === 'job_not_found') throw new Error('submit failed');
    const reqId: string = sub.request.id;
    await accommodation.claimRequest(COORDINATOR, reqId);

    // Learner cannot resolve
    const learnerResolve = await accommodation.resolveRequest(LEARNER, reqId);
    expect(learnerResolve).toBeNull();

    // Coordinator resolves
    const resolved = await accommodation.resolveRequest(COORDINATOR, reqId);
    expect(resolved?.state).toBe('resolved');
    expect(resolved?.resolvedBy).toBe(COORDINATOR.id);

    // Post-resolve reply fails
    const postReply = await accommodation.addReply(COORDINATOR, reqId, 'post-1', 'Closed now');
    expect(postReply).toBeNull();
  });
});
