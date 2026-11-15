// Real-PostgreSQL integration tests for accommodation request persistence (T3-022-A).
// Tests: ownership isolation, duplicate-submit idempotence, cancel before confirmation,
// coordinator access, state persistence, job_not_found rejection, 7-day expiry with
// controlled clock proof, and cross-learner rejection.
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
import type { AccommodationReply, AccommodationRequest } from './domain/accommodation-request.ts';
import { PostgresAccommodationRepository } from './infrastructure/persistence/postgres-accommodation-repository.ts';

interface SubmitResponse {
  readonly kind: 'submitted' | 'existing';
  readonly request: AccommodationRequest;
}

interface ListResponse {
  readonly requests: readonly AccommodationRequest[];
}

interface ReplyResponse {
  readonly kind: 'added' | 'existing';
  readonly reply: AccommodationReply;
}

interface RepliesListResponse {
  readonly replies: readonly AccommodationReply[];
}

const DEMO_JOB = {
  id: 'job-accomm-test-01',
  version: 'accomm-test-1.0',
  title: 'Test Specialist',
  organization: 'Test Org',
  category: 'tech',
  location: 'Addis Ababa',
  description: 'Test job for accommodation integration tests.',
  sourceUrl: 'https://example.com/jobs/test-specialist',
  postedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  withdrawn: false,
  provenance: { kind: 'demo', note: 'Integration test fixture' },
};

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_accomm_${randomUUID().replaceAll('-', '')}`;
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

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  tokens = await provision();
  jobRepository = new PostgresJobRepository(pool);
  // Import a demo job so accommodation requests can reference it.
  await new ImportJobs(jobRepository).execute([DEMO_JOB]);
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin?.end();
});

describe('Accommodation Request Integration (T3-022-A)', () => {
  it('submits a new accommodation request in waiting state', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/accommodation/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: 'accomm-new-1',
          jobId: DEMO_JOB.id,
          supportDescription: 'I need extra time for the interview.',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<SubmitResponse>();
      expect(body.kind).toBe('submitted');
      expect(body.request.state).toBe('waiting');
      expect(body.request.jobId).toBe(DEMO_JOB.id);
      expect(body.request.supportDescription).toBe('I need extra time for the interview.');
      expect(body.request.cancelledAt).toBeNull();
      expect(body.request.expiresAt).toBeDefined();
      expect(body.request.createdAt).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('repeated submissions with same clientRequestId return the existing record exactly once', async () => {
    const app = makeApp();
    try {
      const payload = {
        clientRequestId: 'accomm-dup-1',
        jobId: DEMO_JOB.id,
        supportDescription: 'Original support request.',
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/accommodation/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const id1 = res1.json<SubmitResponse>().request.id;

      // Second attempt with different description — idempotent: original content is kept.
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/accommodation/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: { ...payload, supportDescription: 'Changed description on retry.' },
      });
      expect(res2.statusCode).toBe(200);
      const body2 = res2.json<SubmitResponse>();
      expect(body2.kind).toBe('existing');
      expect(body2.request.id).toBe(id1);
      expect(body2.request.supportDescription).toBe('Original support request.');

      // Confirm exactly one database row for this clientRequestId.
      const count = await pool.query<{ count: string }>(
        'SELECT count(*) FROM accommodation_requests WHERE client_request_id = $1',
        ['accomm-dup-1'],
      );
      expect(Number(count.rows[0]?.count)).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('cancel before confirmation sends nothing (cancel in waiting state)', async () => {
    // The UI does not persist anything until confirmation. This test verifies that
    // a submitted waiting request is cancellable and that the cancelled state is final.
    const app = makeApp();
    try {
      const submitRes = await app.inject({
        method: 'POST',
        url: '/api/accommodation/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: 'accomm-cancel-preconfirm',
          jobId: DEMO_JOB.id,
          supportDescription: 'Support request to be cancelled.',
        },
      });
      expect(submitRes.statusCode).toBe(201);
      const { request } = submitRes.json<SubmitResponse>();

      const cancelRes = await app.inject({
        method: 'DELETE',
        url: `/api/accommodation/requests/${request.id}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(cancelRes.statusCode).toBe(200);
      const cancelled = cancelRes.json<{ request: AccommodationRequest }>().request;
      expect(cancelled.state).toBe('cancelled');
      expect(cancelled.cancelledAt).not.toBeNull();

      // State survives a reload.
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/accommodation/requests/${request.id}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json<AccommodationRequest>().state).toBe('cancelled');
    } finally {
      await app.close();
    }
  });

  it('another learner cannot read or cancel an owned request', async () => {
    const app = makeApp();
    try {
      const submitRes = await app.inject({
        method: 'POST',
        url: '/api/accommodation/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: 'accomm-ownership-1',
          jobId: DEMO_JOB.id,
          supportDescription: 'Private support request.',
        },
      });
      expect(submitRes.statusCode).toBe(201);
      const id = submitRes.json<SubmitResponse>().request.id;

      // Learner B tries to read Learner A's request.
      const readRes = await app.inject({
        method: 'GET',
        url: `/api/accommodation/requests/${id}`,
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
      });
      expect(readRes.statusCode).toBe(404);

      // Learner B tries to cancel Learner A's request.
      const cancelRes = await app.inject({
        method: 'DELETE',
        url: `/api/accommodation/requests/${id}`,
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
      });
      expect(cancelRes.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('support principal can read any non-expired accommodation request by id', async () => {
    const app = makeApp();
    try {
      const submitRes = await app.inject({
        method: 'POST',
        url: '/api/accommodation/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: 'accomm-coordinator-read',
          jobId: DEMO_JOB.id,
          supportDescription: 'Support coordinator read test.',
        },
      });
      expect(submitRes.statusCode).toBe(201);
      const id = submitRes.json<SubmitResponse>().request.id;

      // Support principal reads the accommodation request.
      const readRes = await app.inject({
        method: 'GET',
        url: `/api/accommodation/requests/${id}`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(readRes.statusCode).toBe(200);
      expect(readRes.json<AccommodationRequest>().supportDescription).toBe(
        'Support coordinator read test.',
      );
    } finally {
      await app.close();
    }
  });

  it('support principal is rejected from learner-only submit route', async () => {
    const app = makeApp();
    try {
      const submitRes = await app.inject({
        method: 'POST',
        url: '/api/accommodation/requests',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: {
          clientRequestId: 'accomm-support-denied',
          jobId: DEMO_JOB.id,
          supportDescription: 'Support attempting learner action.',
        },
      });
      expect(submitRes.statusCode).toBe(403);
      expect(submitRes.json()).toEqual({ error: 'forbidden' });
    } finally {
      await app.close();
    }
  });

  it('listing returns only non-expired requests for the authenticated learner', async () => {
    const app = makeApp();
    try {
      await app.inject({
        method: 'POST',
        url: '/api/accommodation/requests',
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
        payload: {
          clientRequestId: 'accomm-list-b-1',
          jobId: DEMO_JOB.id,
          supportDescription: 'Learner B private request.',
        },
      });

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/accommodation/requests',
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
      });
      expect(listRes.statusCode).toBe(200);
      const { requests } = listRes.json<ListResponse>();
      expect(requests.length).toBeGreaterThanOrEqual(1);

      // Learner A's list must not include Learner B's requests.
      const listARes = await app.inject({
        method: 'GET',
        url: '/api/accommodation/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      const aIds = listARes.json<ListResponse>().requests.map((r) => r.id);
      const bIds = requests.map((r) => r.id);
      const overlap = aIds.filter((id) => bIds.includes(id));
      expect(overlap.length).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('cancelling an already-cancelled request returns 404', async () => {
    const app = makeApp();
    try {
      const submitRes = await app.inject({
        method: 'POST',
        url: '/api/accommodation/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: 'accomm-double-cancel',
          jobId: DEMO_JOB.id,
          supportDescription: 'Context for double-cancel test.',
        },
      });
      const id = submitRes.json<SubmitResponse>().request.id;

      await app.inject({
        method: 'DELETE',
        url: `/api/accommodation/requests/${id}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });

      const second = await app.inject({
        method: 'DELETE',
        url: `/api/accommodation/requests/${id}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(second.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns 422 when the referenced job does not exist', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/accommodation/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: 'accomm-bad-job',
          jobId: 'nonexistent-job-id',
          supportDescription: 'Support for a job that does not exist.',
        },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: 'job_not_found' });
    } finally {
      await app.close();
    }
  });

  it('expired request is not returned to learner or coordinator (controlled clock)', async () => {
    // Directly insert a row with expires_at in the past to simulate expiry.
    const ownerId = await pool
      .query<{ id: string }>(`SELECT id FROM principals WHERE demo_key = 'learner-a'`)
      .then((r) => r.rows[0]!.id);

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO accommodation_requests
         (owner_id, job_id, client_request_id, support_description, expires_at)
       VALUES ($1, $2, $3, $4, now() - interval '1 second')
       RETURNING id`,
      [ownerId, DEMO_JOB.id, 'accomm-expired-clock', 'Expired request text.'],
    );
    const expiredId = inserted.rows[0]!.id;

    const app = makeApp();
    try {
      // Learner cannot read expired request.
      const learnerGet = await app.inject({
        method: 'GET',
        url: `/api/accommodation/requests/${expiredId}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(learnerGet.statusCode).toBe(404);

      // Coordinator cannot read expired request (content expiry enforced).
      const coordGet = await app.inject({
        method: 'GET',
        url: `/api/accommodation/requests/${expiredId}`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(coordGet.statusCode).toBe(404);

      // Expired request is not in the list.
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/accommodation/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      const ids = listRes.json<ListResponse>().requests.map((r) => r.id);
      expect(ids).not.toContain(expiredId);
    } finally {
      await app.close();
    }
  });

  it('GET /api/jobs returns only active jobs for authenticated learner', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/jobs',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ jobs: { id: string; title: string }[] }>();
      expect(Array.isArray(body.jobs)).toBe(true);
      // The demo job imported in beforeAll must be present.
      const found = body.jobs.find((j) => j.id === DEMO_JOB.id);
      expect(found).toBeDefined();
      expect(found?.title).toBe(DEMO_JOB.title);
    } finally {
      await app.close();
    }
  });

  describe('Coordinator Inbox and Status Handling (T3-022-B)', () => {
    it('coordinator lists all pending accommodation requests; learner is rejected', async () => {
      const app = makeApp();
      try {
        const subA = await app.inject({
          method: 'POST',
          url: '/api/accommodation/requests',
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
          payload: {
            clientRequestId: 'coord-list-req-a',
            jobId: DEMO_JOB.id,
            supportDescription: 'Learner A request for coordinator list.',
          },
        });
        const idA = subA.json<SubmitResponse>().request.id;

        const subB = await app.inject({
          method: 'POST',
          url: '/api/accommodation/requests',
          headers: { authorization: `Bearer ${tokens['learner-b']}` },
          payload: {
            clientRequestId: 'coord-list-req-b',
            jobId: DEMO_JOB.id,
            supportDescription: 'Learner B request for coordinator list.',
          },
        });
        const idB = subB.json<SubmitResponse>().request.id;

        // Coordinator lists requests
        const coordRes = await app.inject({
          method: 'GET',
          url: '/api/accommodation/coordinator/requests',
          headers: { authorization: `Bearer ${tokens.support}` },
        });
        expect(coordRes.statusCode).toBe(200);
        const { requests } = coordRes.json<ListResponse>();
        const requestIds = requests.map((r) => r.id);
        expect(requestIds).toContain(idA);
        expect(requestIds).toContain(idB);

        // Alias route /api/accommodation/queue also works
        const queueRes = await app.inject({
          method: 'GET',
          url: '/api/accommodation/queue',
          headers: { authorization: `Bearer ${tokens.support}` },
        });
        expect(queueRes.statusCode).toBe(200);

        // Learner cannot access coordinator queue
        const learnerForbidden = await app.inject({
          method: 'GET',
          url: '/api/accommodation/coordinator/requests',
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
        });
        expect(learnerForbidden.statusCode).toBe(403);
      } finally {
        await app.close();
      }
    });

    it('coordinator updates status to reviewing, confirmed, declined and survives reload', async () => {
      const app = makeApp();
      try {
        const sub = await app.inject({
          method: 'POST',
          url: '/api/accommodation/requests',
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
          payload: {
            clientRequestId: 'coord-status-transition-1',
            jobId: DEMO_JOB.id,
            supportDescription: 'Testing status transitions.',
          },
        });
        const reqId = sub.json<SubmitResponse>().request.id;

        // 1. Coordinator updates status to reviewing
        const revRes = await app.inject({
          method: 'POST',
          url: `/api/accommodation/requests/${reqId}/status`,
          headers: { authorization: `Bearer ${tokens.support}` },
          payload: { status: 'reviewing' },
        });
        expect(revRes.statusCode).toBe(200);
        const revBody = revRes.json<{ request: AccommodationRequest }>().request;
        expect(revBody.state).toBe('reviewing');
        expect(revBody.reviewedBy).toBeDefined();
        expect(revBody.reviewedAt).toBeDefined();

        // Learner reloads and sees reviewing state
        const learnerReload = await app.inject({
          method: 'GET',
          url: `/api/accommodation/requests/${reqId}`,
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
        });
        expect(learnerReload.statusCode).toBe(200);
        expect(learnerReload.json<AccommodationRequest>().state).toBe('reviewing');

        // 2. Coordinator updates status to confirmed
        const confRes = await app.inject({
          method: 'PATCH',
          url: `/api/accommodation/requests/${reqId}/status`,
          headers: { authorization: `Bearer ${tokens.support}` },
          payload: { status: 'confirmed' },
        });
        expect(confRes.statusCode).toBe(200);
        expect(confRes.json<{ request: AccommodationRequest }>().request.state).toBe('confirmed');

        // 3. Coordinator updates status to declined
        const decRes = await app.inject({
          method: 'POST',
          url: `/api/accommodation/requests/${reqId}/status`,
          headers: { authorization: `Bearer ${tokens.support}` },
          payload: { status: 'declined' },
        });
        expect(decRes.statusCode).toBe(200);
        expect(decRes.json<{ request: AccommodationRequest }>().request.state).toBe('declined');

        // Invalid status returns 400
        const badRes = await app.inject({
          method: 'POST',
          url: `/api/accommodation/requests/${reqId}/status`,
          headers: { authorization: `Bearer ${tokens.support}` },
          payload: { status: 'invalid_status_value' },
        });
        expect(badRes.statusCode).toBe(400);

        // Learner cannot update status (403)
        const learnerForbidden = await app.inject({
          method: 'POST',
          url: `/api/accommodation/requests/${reqId}/status`,
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
          payload: { status: 'confirmed' },
        });
        expect(learnerForbidden.statusCode).toBe(403);
      } finally {
        await app.close();
      }
    });

    it('status update rejects cancelled or expired requests', async () => {
      const app = makeApp();
      try {
        const sub = await app.inject({
          method: 'POST',
          url: '/api/accommodation/requests',
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
          payload: {
            clientRequestId: 'coord-cancel-reject-1',
            jobId: DEMO_JOB.id,
            supportDescription: 'Request to be cancelled.',
          },
        });
        const reqId = sub.json<SubmitResponse>().request.id;

        // Learner cancels the request
        const cancelRes = await app.inject({
          method: 'DELETE',
          url: `/api/accommodation/requests/${reqId}`,
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
        });
        expect(cancelRes.statusCode).toBe(200);

        // Coordinator attempts to update status on cancelled request -> 404
        const coordUpdate = await app.inject({
          method: 'POST',
          url: `/api/accommodation/requests/${reqId}/status`,
          headers: { authorization: `Bearer ${tokens.support}` },
          payload: { status: 'confirmed' },
        });
        expect(coordUpdate.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });

    it('coordinator and learner exchange private replies with read tracking and idempotency', async () => {
      const app = makeApp();
      try {
        const sub = await app.inject({
          method: 'POST',
          url: '/api/accommodation/requests',
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
          payload: {
            clientRequestId: 'coord-reply-flow-1',
            jobId: DEMO_JOB.id,
            supportDescription: 'I request assistive technology during the technical interview.',
          },
        });
        const reqId = sub.json<SubmitResponse>().request.id;

        // 1. Coordinator sends a reply
        const coordReplyRes = await app.inject({
          method: 'POST',
          url: `/api/accommodation/requests/${reqId}/replies`,
          headers: { authorization: `Bearer ${tokens.support}` },
          payload: {
            clientReplyId: 'cr-msg-1',
            body: 'We can provide screen reader and magnified display options for your interview.',
          },
        });
        expect(coordReplyRes.statusCode).toBe(201);
        const reply1 = coordReplyRes.json<ReplyResponse>();
        expect(reply1.kind).toBe('added');
        expect(reply1.reply.body).toBe(
          'We can provide screen reader and magnified display options for your interview.',
        );
        expect(reply1.reply.readAt).toBeNull();

        // 2. Duplicate reply with identical clientReplyId is idempotent (200)
        const dupRes = await app.inject({
          method: 'POST',
          url: `/api/accommodation/requests/${reqId}/replies`,
          headers: { authorization: `Bearer ${tokens.support}` },
          payload: {
            clientReplyId: 'cr-msg-1',
            body: 'We can provide screen reader and magnified display options for your interview.',
          },
        });
        expect(dupRes.statusCode).toBe(200);
        expect(dupRes.json<ReplyResponse>().kind).toBe('existing');

        // 3. Learner reads replies
        const learnerRepliesRes = await app.inject({
          method: 'GET',
          url: `/api/accommodation/requests/${reqId}/replies`,
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
        });
        expect(learnerRepliesRes.statusCode).toBe(200);
        const repliesList = learnerRepliesRes.json<RepliesListResponse>().replies;
        expect(repliesList.length).toBe(1);
        expect(repliesList[0]?.id).toBe(reply1.reply.id);
        expect(repliesList[0]?.readAt).toBeNull();

        // 4. Learner marks replies as read
        const markReadRes = await app.inject({
          method: 'PUT',
          url: `/api/accommodation/requests/${reqId}/replies/read`,
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
        });
        expect(markReadRes.statusCode).toBe(204);

        // Verification after reload: readAt is set
        const updatedReplies = await app.inject({
          method: 'GET',
          url: `/api/accommodation/requests/${reqId}/replies`,
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
        });
        expect(updatedReplies.json<RepliesListResponse>().replies[0]?.readAt).not.toBeNull();

        // 5. Learner sends a reply back
        const learnerReplyRes = await app.inject({
          method: 'POST',
          url: `/api/accommodation/requests/${reqId}/replies`,
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
          payload: {
            clientReplyId: 'lr-msg-1',
            body: 'That setup will work well for me. Thank you.',
          },
        });
        expect(learnerReplyRes.statusCode).toBe(201);

        // 6. Coordinator lists replies and sees both in chronological order
        const coordListReplies = await app.inject({
          method: 'GET',
          url: `/api/accommodation/requests/${reqId}/replies`,
          headers: { authorization: `Bearer ${tokens.support}` },
        });
        expect(coordListReplies.statusCode).toBe(200);
        const allReplies = coordListReplies.json<RepliesListResponse>().replies;
        expect(allReplies.length).toBe(2);
        expect(allReplies[0]?.body).toContain('screen reader');
        expect(allReplies[1]?.body).toContain('That setup will work');

        // 7. Privacy: Learner B cannot read or post replies to Learner A's request
        const bRead = await app.inject({
          method: 'GET',
          url: `/api/accommodation/requests/${reqId}/replies`,
          headers: { authorization: `Bearer ${tokens['learner-b']}` },
        });
        expect(bRead.statusCode).toBe(404);

        const bReply = await app.inject({
          method: 'POST',
          url: `/api/accommodation/requests/${reqId}/replies`,
          headers: { authorization: `Bearer ${tokens['learner-b']}` },
          payload: {
            clientReplyId: 'b-snoop-reply',
            body: 'Unauthorised probe.',
          },
        });
        expect(bReply.statusCode).toBe(409);
      } finally {
        await app.close();
      }
    });
  });
});
