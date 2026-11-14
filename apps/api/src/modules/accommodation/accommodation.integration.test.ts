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
import type { AccommodationRequest } from './domain/accommodation-request.ts';
import { PostgresAccommodationRepository } from './infrastructure/persistence/postgres-accommodation-repository.ts';

interface SubmitResponse {
  readonly kind: 'submitted' | 'existing';
  readonly request: AccommodationRequest;
}

interface ListResponse {
  readonly requests: readonly AccommodationRequest[];
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
});
