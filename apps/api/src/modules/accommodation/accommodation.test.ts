// Unit tests for Accommodation application use cases (T3-022-A, T3-022-B).
// Verifies principal role guards, ownership boundaries, input validation,
// terminal-state guards, idempotency, and read-state transitions in memory.
import { describe, expect, it } from 'vitest';
import type { OwnedScope, Principal } from '../identity/domain/principal.ts';
import { Accommodation } from './application/accommodation.ts';
import type {
  AccommodationRepository,
  AddAccommodationReplyResult,
  SubmitAccommodationInput,
  SubmitAccommodationResult,
} from './application/ports/accommodation-repository.ts';
import type { AccommodationReply, AccommodationRequest } from './domain/accommodation-request.ts';

const LEARNER_A: Principal = {
  id: 'learner-a-id',
  role: 'learner',
  label: 'Learner A',
  demo: true,
  courseIds: ['course-1'],
};

const LEARNER_B: Principal = {
  id: 'learner-b-id',
  role: 'learner',
  label: 'Learner B',
  demo: true,
  courseIds: ['course-1'],
};

const SUPPORT: Principal = {
  id: 'support-id',
  role: 'support',
  label: 'Support Coordinator',
  demo: true,
  courseIds: [],
};

class InMemoryAccommodationRepository implements AccommodationRepository {
  readonly requests = new Map<string, AccommodationRequest>();
  readonly replies = new Map<string, AccommodationReply[]>();

  submit(scope: OwnedScope, input: SubmitAccommodationInput): Promise<SubmitAccommodationResult> {
    const existing = [...this.requests.values()].find(
      (r) => r.ownerId === scope.ownerId && r.clientRequestId === input.clientRequestId,
    );
    if (existing) return Promise.resolve({ kind: 'existing', request: existing });

    const req: AccommodationRequest = {
      id: `req-${this.requests.size + 1}`,
      ownerId: scope.ownerId,
      jobId: input.jobId,
      clientRequestId: input.clientRequestId,
      supportDescription: input.supportDescription,
      state: 'waiting',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
      cancelledAt: null,
      reviewedAt: null,
      reviewedBy: null,
    };
    this.requests.set(req.id, req);
    return Promise.resolve({ kind: 'submitted', request: req });
  }

  cancel(scope: OwnedScope, id: string): Promise<AccommodationRequest | null> {
    const r = this.requests.get(id);
    if (!r || r.ownerId !== scope.ownerId || r.state !== 'waiting') return Promise.resolve(null);
    const updated: AccommodationRequest = {
      ...r,
      state: 'cancelled',
      cancelledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.requests.set(id, updated);
    return Promise.resolve(updated);
  }

  findById(scope: OwnedScope, id: string): Promise<AccommodationRequest | null> {
    const r = this.requests.get(id);
    if (!r || r.ownerId !== scope.ownerId) return Promise.resolve(null);
    return Promise.resolve(r);
  }

  listOwned(scope: OwnedScope): Promise<readonly AccommodationRequest[]> {
    return Promise.resolve([...this.requests.values()].filter((r) => r.ownerId === scope.ownerId));
  }

  coordinatorFindById(id: string): Promise<AccommodationRequest | null> {
    return Promise.resolve(this.requests.get(id) ?? null);
  }

  coordinatorListAll(): Promise<readonly AccommodationRequest[]> {
    return Promise.resolve([...this.requests.values()]);
  }

  updateStatus(
    id: string,
    coordinatorId: string,
    status: 'reviewing' | 'confirmed' | 'declined',
  ): Promise<AccommodationRequest | null> {
    const r = this.requests.get(id);
    if (!r || r.state === 'cancelled') return Promise.resolve(null);
    const updated: AccommodationRequest = {
      ...r,
      state: status,
      reviewedBy: coordinatorId,
      reviewedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.requests.set(id, updated);
    return Promise.resolve(updated);
  }

  addReply(
    accommodationRequestId: string,
    authorId: string,
    clientReplyId: string,
    body: string,
  ): Promise<AddAccommodationReplyResult | null> {
    const r = this.requests.get(accommodationRequestId);
    if (!r || r.state === 'cancelled') return Promise.resolve(null);

    const list = this.replies.get(accommodationRequestId) ?? [];
    const existing = list.find((rep) => rep.clientReplyId === clientReplyId);
    if (existing) return Promise.resolve({ kind: 'existing', reply: existing });

    const reply: AccommodationReply = {
      id: `rep-${list.length + 1}`,
      accommodationRequestId,
      authorId,
      clientReplyId,
      body,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    list.push(reply);
    this.replies.set(accommodationRequestId, list);
    return Promise.resolve({ kind: 'added', reply });
  }

  listReplies(accommodationRequestId: string): Promise<readonly AccommodationReply[]> {
    return Promise.resolve(this.replies.get(accommodationRequestId) ?? []);
  }

  markRepliesRead(accommodationRequestId: string, readerPrincipalId: string): Promise<void> {
    const list = this.replies.get(accommodationRequestId);
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const rep = list[i];
        if (rep && rep.authorId !== readerPrincipalId && rep.readAt === null) {
          list[i] = { ...rep, readAt: new Date().toISOString() };
        }
      }
    }
    return Promise.resolve();
  }
}

describe('Accommodation Use Cases (T3-022-B)', () => {
  it('listCoordinatorQueue allows support and rejects learner', async () => {
    const repo = new InMemoryAccommodationRepository();
    const accommodation = new Accommodation(repo);
    await accommodation.submit(LEARNER_A, {
      clientRequestId: 'c1',
      jobId: 'j1',
      supportDescription: 'Desk adjustment',
    });

    const supportResult = await accommodation.listCoordinatorQueue(SUPPORT);
    expect(supportResult).toHaveLength(1);
    expect(supportResult?.[0]?.supportDescription).toBe('Desk adjustment');

    const learnerResult = await accommodation.listCoordinatorQueue(LEARNER_A);
    expect(learnerResult).toBeNull();
  });

  it('updateStatus allows support with valid statuses and rejects invalid or learner', async () => {
    const repo = new InMemoryAccommodationRepository();
    const accommodation = new Accommodation(repo);
    const sub = await accommodation.submit(LEARNER_A, {
      clientRequestId: 'c1',
      jobId: 'j1',
      supportDescription: 'Screen magnifier',
    });
    const reqId = (sub as { request: AccommodationRequest }).request.id;

    // Support can transition to reviewing
    const result = await accommodation.updateStatus(SUPPORT, reqId, 'reviewing');
    expect(result?.state).toBe('reviewing');
    expect(result?.reviewedBy).toBe(SUPPORT.id);

    // Support can transition to confirmed
    const confirmed = await accommodation.updateStatus(SUPPORT, reqId, 'confirmed');
    expect(confirmed?.state).toBe('confirmed');

    // Learner is rejected
    const learnerResult = await accommodation.updateStatus(LEARNER_A, reqId, 'confirmed');
    expect(learnerResult).toBeNull();

    // Invalid status string rejected
    const invalidResult = await accommodation.updateStatus(
      SUPPORT,
      reqId,
      'invalid' as unknown as 'reviewing',
    );
    expect(invalidResult).toBeNull();
  });

  it('addReply allows support and learner owner, rejects empty body or cross-learner', async () => {
    const repo = new InMemoryAccommodationRepository();
    const accommodation = new Accommodation(repo);
    const sub = await accommodation.submit(LEARNER_A, {
      clientRequestId: 'c1',
      jobId: 'j1',
      supportDescription: 'Captions needed',
    });
    const reqId = (sub as { request: AccommodationRequest }).request.id;

    // Support adds reply
    const coordReply = await accommodation.addReply(SUPPORT, reqId, 'reply-1', 'Support response.');
    expect(coordReply?.kind).toBe('added');
    expect(coordReply?.reply.body).toBe('Support response.');

    // Duplicate clientReplyId is idempotent
    const dupReply = await accommodation.addReply(SUPPORT, reqId, 'reply-1', 'Support response.');
    expect(dupReply?.kind).toBe('existing');

    // Learner owner adds reply
    const learnerReply = await accommodation.addReply(
      LEARNER_A,
      reqId,
      'reply-2',
      'Learner follow-up.',
    );
    expect(learnerReply?.kind).toBe('added');

    // Empty body is rejected
    const emptyReply = await accommodation.addReply(SUPPORT, reqId, 'reply-3', '   ');
    expect(emptyReply).toBeNull();

    // Cross-learner attempt is rejected
    const otherLearner = await accommodation.addReply(
      LEARNER_B,
      reqId,
      'reply-4',
      'Cross-learner attempt.',
    );
    expect(otherLearner).toBeNull();
  });

  it('addReply and updateStatus reject cancelled requests', async () => {
    const repo = new InMemoryAccommodationRepository();
    const accommodation = new Accommodation(repo);
    const sub = await accommodation.submit(LEARNER_A, {
      clientRequestId: 'c1',
      jobId: 'j1',
      supportDescription: 'Request to cancel',
    });
    const reqId = (sub as { request: AccommodationRequest }).request.id;

    // Learner cancels
    const cancelled = await accommodation.cancel(LEARNER_A, reqId);
    expect(cancelled?.state).toBe('cancelled');

    // Coordinator cannot reply to cancelled request
    const supportReply = await accommodation.addReply(SUPPORT, reqId, 'reply-c1', 'Support msg.');
    expect(supportReply).toBeNull();

    // Coordinator cannot update status of cancelled request
    const coordUpdate = await accommodation.updateStatus(SUPPORT, reqId, 'confirmed');
    expect(coordUpdate).toBeNull();
  });

  it('listReplies and markRepliesRead enforce access boundaries', async () => {
    const repo = new InMemoryAccommodationRepository();
    const accommodation = new Accommodation(repo);
    const sub = await accommodation.submit(LEARNER_A, {
      clientRequestId: 'c1',
      jobId: 'j1',
      supportDescription: 'Interpreter request',
    });
    const reqId = (sub as { request: AccommodationRequest }).request.id;

    await accommodation.addReply(SUPPORT, reqId, 'rep-1', 'Interpreter confirmed.');

    // Support can list replies
    const supportReplies = await accommodation.listReplies(SUPPORT, reqId);
    expect(supportReplies).toHaveLength(1);

    // Learner owner can list replies
    const learnerReplies = await accommodation.listReplies(LEARNER_A, reqId);
    expect(learnerReplies).toHaveLength(1);
    expect(learnerReplies?.[0]?.readAt).toBeNull();

    // Learner B cannot list Learner A's replies
    const otherReplies = await accommodation.listReplies(LEARNER_B, reqId);
    expect(otherReplies).toBeNull();

    // Mark replies read by learner
    expect(await accommodation.markRepliesRead(LEARNER_A, reqId)).toBe(true);

    const updated = await accommodation.listReplies(LEARNER_A, reqId);
    expect(updated?.[0]?.readAt).not.toBeNull();

    // Learner B cannot mark Learner A's replies as read
    expect(await accommodation.markRepliesRead(LEARNER_B, reqId)).toBe(false);
  });
});
