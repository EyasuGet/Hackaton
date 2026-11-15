// Real-PostgreSQL integration tests for coordinator inbox, status transitions, and replies (T3-022-B).
// Tests: coordinator queue access, claim transition, reply exchange, idempotency,
// role isolation, resolution transition, and terminal state rejection.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../bootstrap/app.ts';
import { loadDatabaseConfig } from '../../bootstrap/config.ts';
import { createPool } from '../../infrastructure/database/connection.ts';
import {
  loadMigrations,
  migrate,
  MIGRATIONS_DIR,
} from '../../infrastructure/database/migrations.ts';
import { DemoRecords } from '../demo-records/demo-records.ts';
import {
  PostgresDemoRecordRepository,
  seedDemoRecords,
} from '../demo-records/postgres-demo-record-repository.ts';
import { DemoSessions } from '../identity/application/demo-sessions.ts';
import { ResolvePrincipal } from '../identity/application/resolve-principal.ts';
import { PostgresDemoSessionRepository } from '../identity/infrastructure/postgres-demo-session-repository.ts';
import {
  PostgresPrincipalRepository,
  provisionDemoPrincipals,
  type DemoCredential,
  type DemoPrincipalKey,
} from '../identity/infrastructure/postgres-principal-repository.ts';
import { Tutoring } from '../tutoring/application/tutoring.ts';
import { PostgresTutoringRepository } from '../tutoring/infrastructure/persistence/postgres-tutoring-repository.ts';
import { ContentAccess } from '../content/application/content-access.ts';
import { ImportJobs } from '../careers/application/import-jobs.ts';
import { PostgresJobRepository } from '../careers/infrastructure/postgres-job-repository.ts';
import { Help } from '../help/application/help.ts';
import { PostgresHelpRepository } from '../help/infrastructure/persistence/postgres-help-repository.ts';
import { Accommodation } from './application/accommodation.ts';
import type {
  AccommodationQueueItem,
  AccommodationReply,
  AccommodationRequest,
} from './domain/accommodation-request.ts';
import { PostgresAccommodationRepository } from './infrastructure/persistence/postgres-accommodation-repository.ts';

interface SubmitResponse {
  readonly kind: 'submitted' | 'existing';
  readonly request: AccommodationRequest;
}

interface ReplyResponse {
  readonly kind: 'added' | 'existing';
  readonly reply: AccommodationReply;
}

interface RepliesResponse {
  readonly replies: readonly AccommodationReply[];
}

interface QueueResponse {
  readonly queue: readonly AccommodationQueueItem[];
}

const DEMO_JOB = {
  id: 'job-coordinator-test-01',
  version: 'coord-test-1.0',
  title: 'Coordinator Test Specialist',
  organization: 'Test Org',
  category: 'tech',
  location: 'Addis Ababa',
  description: 'Test job for coordinator accommodation integration tests.',
  sourceUrl: 'https://example.com/jobs/coord-test',
  postedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  withdrawn: false,
  provenance: { kind: 'demo', note: 'Integration test fixture' },
};

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_accomm_coord_${randomUUID().replaceAll('-', '')}`;
let admin: pg.Pool;
let pool: pg.Pool;
let jobRepository: PostgresJobRepository;
let tokens: Record<DemoPrincipalKey, string>;

async function provision(): Promise<Record<DemoPrincipalKey, string>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const credentials: DemoCredential[] = await provisionDemoPrincipals(client);
    await seedDemoRecords(client, new Map(credentials.map((c) => [c.key, c.id])));
    await client.query('COMMIT');
    return Object.fromEntries(credentials.map((c) => [c.key, c.token])) as Record<
      DemoPrincipalKey,
      string
    >;
  } finally {
    client.release();
  }
}

function makeApp() {
  return buildApp({
    checkReadiness: () => Promise.resolve({ ready: true }),
    resolvePrincipal: new ResolvePrincipal(new PostgresPrincipalRepository(pool), true),
    demoRecords: new DemoRecords(new PostgresDemoRecordRepository(pool)),
    demoSessions: new DemoSessions(new PostgresDemoSessionRepository(pool), true),
    demoAllowedOrigins: ['http://localhost:5173'],
    tutoring: new Tutoring(new PostgresTutoringRepository(pool)),
    content: new ContentAccess(
      { search: () => Promise.resolve([]), resolve: () => Promise.resolve({ kind: 'not_found' }) },
      [],
    ),
    help: new Help(new PostgresHelpRepository(pool)),
    accommodation: new Accommodation(new PostgresAccommodationRepository(pool)),
    jobRepository,
  });
}

/** Submits a request as learner-a and returns its id. */
async function submitRequest(app: ReturnType<typeof makeApp>, key: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/accommodation/requests',
    headers: { authorization: `Bearer ${tokens['learner-a']}` },
    payload: {
      clientRequestId: key,
      jobId: DEMO_JOB.id,
      supportDescription: `Support description for ${key}.`,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<SubmitResponse>().request.id;
}

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  tokens = await provision();
  jobRepository = new PostgresJobRepository(pool);
  await new ImportJobs(jobRepository).execute([DEMO_JOB]);
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin?.end();
});

describe('Accommodation Coordinator Inbox & Status Handling (T3-022-B)', () => {
  it('coordinator can view the queue of waiting requests without leaking raw support description', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'coord-queue-test-1');

      // Coordinator (support role) accesses queue
      const coordRes = await app.inject({
        method: 'GET',
        url: '/api/accommodation/queue',
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(coordRes.statusCode).toBe(200);
      const { queue } = coordRes.json<QueueResponse>();
      const item = queue.find((q) => q.id === id);
      expect(item).toBeDefined();
      expect(item?.state).toBe('waiting');
      expect(item?.jobId).toBe(DEMO_JOB.id);
      // Raw support description MUST NOT be in queue summary
      expect((item as unknown as Record<string, unknown>).supportDescription).toBeUndefined();

      // Learner is forbidden from accessing queue
      const learnerRes = await app.inject({
        method: 'GET',
        url: '/api/accommodation/queue',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(learnerRes.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('coordinator claims a waiting request; status transitions to claimed', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'coord-claim-test-1');

      // Learner cannot claim
      const learnerClaim = await app.inject({
        method: 'POST',
        url: `/api/accommodation/requests/${id}/claim`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(learnerClaim.statusCode).toBe(403);

      // Coordinator claims request
      const claimRes = await app.inject({
        method: 'POST',
        url: `/api/accommodation/requests/${id}/claim`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(claimRes.statusCode).toBe(200);
      const body = claimRes.json<{ request: AccommodationRequest }>();
      expect(body.request.state).toBe('claimed');
      expect(body.request.claimedBy).toBeDefined();
      expect(body.request.claimedAt).toBeDefined();
      expect(body.request.supportDescription).toBe('Support description for coord-claim-test-1.');

      // Once claimed, learner cannot cancel it
      const cancelRes = await app.inject({
        method: 'DELETE',
        url: `/api/accommodation/requests/${id}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(cancelRes.statusCode).toBe(404);

      // Repeated claim returns 409 already_claimed
      const reClaim = await app.inject({
        method: 'POST',
        url: `/api/accommodation/requests/${id}/claim`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(reClaim.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it('supports two-sided reply exchange between coordinator and requesting learner', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'coord-replies-test-1');

      // Claim as coordinator
      await app.inject({
        method: 'POST',
        url: `/api/accommodation/requests/${id}/claim`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });

      // Coordinator posts a reply
      const coordReplyRes = await app.inject({
        method: 'POST',
        url: `/api/accommodation/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: {
          clientReplyId: 'cr-coord-01',
          body: 'We can arrange a quiet room and 30 extra minutes.',
        },
      });
      expect(coordReplyRes.statusCode).toBe(201);
      const coordReply = coordReplyRes.json<ReplyResponse>();
      expect(coordReply.kind).toBe('added');
      expect(coordReply.reply.body).toBe('We can arrange a quiet room and 30 extra minutes.');
      expect(coordReply.reply.readAt).toBeNull();

      // Learner-a (owner) replies back
      const learnerReplyRes = await app.inject({
        method: 'POST',
        url: `/api/accommodation/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientReplyId: 'cr-learner-01',
          body: 'Thank you, that would be very helpful.',
        },
      });
      expect(learnerReplyRes.statusCode).toBe(201);

      // Duplicate reply with same clientReplyId is idempotent (200, existing)
      const dupReplyRes = await app.inject({
        method: 'POST',
        url: `/api/accommodation/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientReplyId: 'cr-learner-01',
          body: 'Thank you, that would be very helpful.',
        },
      });
      expect(dupReplyRes.statusCode).toBe(200);
      expect(dupReplyRes.json<ReplyResponse>().kind).toBe('existing');

      // Both learner and coordinator can list replies in chronological order
      const listForLearner = await app.inject({
        method: 'GET',
        url: `/api/accommodation/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(listForLearner.statusCode).toBe(200);
      const { replies } = listForLearner.json<RepliesResponse>();
      expect(replies.length).toBe(2);
      expect(replies[0]?.body).toBe('We can arrange a quiet room and 30 extra minutes.');
      expect(replies[1]?.body).toBe('Thank you, that would be very helpful.');

      // Learner marks coordinator replies read
      const markReadRes = await app.inject({
        method: 'PUT',
        url: `/api/accommodation/requests/${id}/replies/read`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(markReadRes.statusCode).toBe(204);

      // Verify readAt was updated on coordinator's reply
      const updatedRepliesRes = await app.inject({
        method: 'GET',
        url: `/api/accommodation/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      const updatedReplies = updatedRepliesRes.json<RepliesResponse>().replies;
      expect(updatedReplies[0]?.readAt).not.toBeNull();
      // Learner's own reply readAt remains null (reader was learner)
      expect(updatedReplies[1]?.readAt).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('denies other learners access to request and replies', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'coord-isolation-test-1');

      // Learner-b tries to view learner-a's request
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/accommodation/requests/${id}`,
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
      });
      expect(getRes.statusCode).toBe(404);

      // Learner-b tries to post a reply
      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/accommodation/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
        payload: {
          clientReplyId: 'cr-spy-01',
          body: 'Snooping in on this conversation.',
        },
      });
      expect(replyRes.statusCode).toBe(409);

      // Learner-b tries to list replies
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/accommodation/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
      });
      expect(listRes.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('coordinator resolves claimed request; terminal state rejects further replies', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'coord-resolve-test-1');

      // Claim
      await app.inject({
        method: 'POST',
        url: `/api/accommodation/requests/${id}/claim`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });

      // Coordinator resolves request
      const resolveRes = await app.inject({
        method: 'POST',
        url: `/api/accommodation/requests/${id}/resolve`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(resolveRes.statusCode).toBe(200);
      const resolvedReq = resolveRes.json<{ request: AccommodationRequest }>().request;
      expect(resolvedReq.state).toBe('resolved');
      expect(resolvedReq.resolvedBy).toBeDefined();
      expect(resolvedReq.resolvedAt).toBeDefined();

      // Post-resolution reply is rejected (409)
      const postResolveReply = await app.inject({
        method: 'POST',
        url: `/api/accommodation/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: {
          clientReplyId: 'cr-after-resolve',
          body: 'Another reply after resolved.',
        },
      });
      expect(postResolveReply.statusCode).toBe(409);

      // Learner also cannot reply to resolved request
      const learnerPostResolve = await app.inject({
        method: 'POST',
        url: `/api/accommodation/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientReplyId: 'cr-learner-after-resolve',
          body: 'Learner reply after resolved.',
        },
      });
      expect(learnerPostResolve.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it('coordinator can view inbox tracking list', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'coord-inbox-test-1');

      const inboxRes = await app.inject({
        method: 'GET',
        url: '/api/accommodation/inbox',
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(inboxRes.statusCode).toBe(200);
      const { requests } = inboxRes.json<{ requests: readonly AccommodationRequest[] }>();
      const found = requests.find((r) => r.id === id);
      expect(found).toBeDefined();
    } finally {
      await app.close();
    }
  });
});
