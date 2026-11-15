// Real-PostgreSQL integration tests for staff queue and claim (T3-017-A).
// Tests: role guard (learner blocked), concurrent claim idempotence, queue list
// returns metadata only (no contextSnapshot), and access isolation.
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
import { digestToken, ResolvePrincipal } from '../identity/application/resolve-principal.ts';
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
import { Help } from './application/help.ts';
import { StaffHelp } from './application/staff-help.ts';
import type { HelpRequest } from './domain/help-request.ts';
import type { QueueItem } from './application/ports/help-repository.ts';
import { PostgresHelpRepository } from './infrastructure/persistence/postgres-help-repository.ts';

interface SubmitResponse {
  readonly kind: 'submitted' | 'existing';
  readonly request: HelpRequest;
}

interface QueueResponse {
  readonly queue: readonly QueueItem[];
}

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_staff_${randomUUID().replaceAll('-', '')}`;
let admin: pg.Pool;
let pool: pg.Pool;
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
  const helpRepository = new PostgresHelpRepository(pool);
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
    help: new Help(helpRepository),
    staffHelp: new StaffHelp(helpRepository),
  });
}

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  tokens = await provision();
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin?.end();
});

describe('Staff Queue and Claim Integration (T3-017-A)', () => {
  it('learner is forbidden from the queue endpoint', async () => {
    const app = makeApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/help/queue',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden' });
    } finally {
      await app.close();
    }
  });

  it('learner is forbidden from the claim endpoint', async () => {
    const app = makeApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${randomUUID()}/claim`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden' });
    } finally {
      await app.close();
    }
  });

  it('support staff can list the queue; waiting items appear without contextSnapshot', async () => {
    const app = makeApp();
    try {
      // Submit a waiting request as a learner
      const submitRes = await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: 'staff-queue-test-1',
          contextSnapshot: 'Private learner context — must not appear in queue list.',
        },
      });
      expect(submitRes.statusCode).toBe(201);
      const submittedId = submitRes.json<SubmitResponse>().request.id;

      const queueRes = await app.inject({
        method: 'GET',
        url: '/api/help/queue',
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(queueRes.statusCode).toBe(200);
      const { queue } = queueRes.json<QueueResponse>();
      const item = queue.find((q) => q.id === submittedId);
      expect(item).toBeDefined();
      expect(item?.state).toBe('waiting');
      // Context snapshot must not be present in queue metadata
      expect(item).not.toHaveProperty('contextSnapshot');
    } finally {
      await app.close();
    }
  });

  it('support staff can claim a waiting request and receives full context', async () => {
    const app = makeApp();
    try {
      const submitRes = await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: 'staff-claim-test-1',
          contextSnapshot: 'Context for staff claim test.',
        },
      });
      expect(submitRes.statusCode).toBe(201);
      const requestId = submitRes.json<SubmitResponse>().request.id;

      const claimRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/claim`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(claimRes.statusCode).toBe(200);
      const claimed = claimRes.json<{ request: HelpRequest }>().request;
      expect(claimed.state).toBe('claimed');
      expect(claimed.claimedBy).toBeDefined();
      expect(claimed.claimedAt).toBeDefined();
      // Full context is returned after claim
      expect(claimed.contextSnapshot).toBe('Context for staff claim test.');
    } finally {
      await app.close();
    }
  });

  it('concurrent claims on the same request produce exactly one assignee', async () => {
    const app = makeApp();
    try {
      const submitRes = await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
        payload: {
          clientRequestId: 'staff-concurrent-claim-1',
          contextSnapshot: 'Context for concurrent claim test.',
        },
      });
      expect(submitRes.statusCode).toBe(201);
      const requestId = submitRes.json<SubmitResponse>().request.id;

      // Fire two simultaneous claims and collect results
      const [res1, res2] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/api/help/requests/${requestId}/claim`,
          headers: { authorization: `Bearer ${tokens.support}` },
        }),
        app.inject({
          method: 'POST',
          url: `/api/help/requests/${requestId}/claim`,
          headers: { authorization: `Bearer ${tokens.support}` },
        }),
      ]);

      const statuses = [res1.statusCode, res2.statusCode].sort();
      // One succeeds (200), one loses the race (409)
      expect(statuses).toEqual([200, 409]);

      // Verify exactly one claimed_by is set in the database
      const dbRes = await pool.query<{ count: string; claimed_by: string | null }>(
        `SELECT count(*) AS count, claimed_by FROM help_requests WHERE id = $1 GROUP BY claimed_by`,
        [requestId],
      );
      expect(dbRes.rows).toHaveLength(1);
      expect(dbRes.rows[0]?.claimed_by).not.toBeNull();
      expect(Number(dbRes.rows[0]?.count)).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('claiming a non-existent request returns 404', async () => {
    const app = makeApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${randomUUID()}/claim`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('claimed request no longer appears in the waiting queue', async () => {
    const app = makeApp();
    try {
      const submitRes = await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: 'staff-queue-after-claim-1',
          contextSnapshot: 'Context that gets claimed.',
        },
      });
      expect(submitRes.statusCode).toBe(201);
      const requestId = submitRes.json<SubmitResponse>().request.id;

      await app.inject({
        method: 'POST',
        url: `/api/help/requests/${requestId}/claim`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });

      const queueRes = await app.inject({
        method: 'GET',
        url: '/api/help/queue',
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(queueRes.statusCode).toBe(200);
      const { queue } = queueRes.json<QueueResponse>();
      const found = queue.some((q) => q.id === requestId);
      expect(found).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('learner is forbidden from the assigned endpoint', async () => {
    const app = makeApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/help/assigned',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden' });
    } finally {
      await app.close();
    }
  });

  it('unauthenticated caller receives 401 from assigned endpoint', async () => {
    const app = makeApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/help/assigned',
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('support staff lists only their own claimed requests with contextSnapshot, excluding other staff and resolved requests', async () => {
    // Provision a second support staff member to test isolation
    const secondSupportId = randomUUID();
    const secondToken = `tok-support-2-${randomUUID()}`;
    const secondDemoKey = `support-2-${randomUUID()}`;
    await pool.query(
      `INSERT INTO principals (id, role, label, token_digest, is_demo, demo_key)
       VALUES ($1, 'support', 'Demo support person 2', $2, true, $3)`,
      [secondSupportId, digestToken(secondToken), secondDemoKey],
    );

    const app = makeApp();
    try {
      // 1. Submit two requests from learner-a
      const sub1 = await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: `assigned-test-req-1-${randomUUID()}`,
          contextSnapshot: 'Learner A context snapshot for request 1',
        },
      });
      const req1Id = sub1.json<SubmitResponse>().request.id;

      const sub2 = await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: `assigned-test-req-2-${randomUUID()}`,
          contextSnapshot: 'Learner A context snapshot for request 2',
        },
      });
      const req2Id = sub2.json<SubmitResponse>().request.id;

      // 2. Staff 1 claims req1; Staff 2 claims req2
      const claim1 = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${req1Id}/claim`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(claim1.statusCode).toBe(200);

      const claim2 = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${req2Id}/claim`,
        headers: { authorization: `Bearer ${secondToken}` },
      });
      expect(claim2.statusCode).toBe(200);

      // 3. Staff 1 queries /api/help/assigned: should see only req1
      const res1 = await app.inject({
        method: 'GET',
        url: '/api/help/assigned',
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(res1.statusCode).toBe(200);
      const data1 = res1.json<{ requests: readonly HelpRequest[] }>();
      expect(data1.requests.some((r) => r.id === req1Id)).toBe(true);
      expect(data1.requests.some((r) => r.id === req2Id)).toBe(false);

      const myReq1 = data1.requests.find((r) => r.id === req1Id);
      expect(myReq1?.contextSnapshot).toBe('Learner A context snapshot for request 1');
      expect(myReq1?.state).toBe('claimed');

      // 4. Staff 2 queries /api/help/assigned: should see only req2
      const res2 = await app.inject({
        method: 'GET',
        url: '/api/help/assigned',
        headers: { authorization: `Bearer ${secondToken}` },
      });
      expect(res2.statusCode).toBe(200);
      const data2 = res2.json<{ requests: readonly HelpRequest[] }>();
      expect(data2.requests.some((r) => r.id === req2Id)).toBe(true);
      expect(data2.requests.some((r) => r.id === req1Id)).toBe(false);

      // 5. Staff 1 resolves req1: it should disappear from assigned list
      const resolveRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${req1Id}/resolve`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(resolveRes.statusCode).toBe(200);

      const afterResolve = await app.inject({
        method: 'GET',
        url: '/api/help/assigned',
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(afterResolve.statusCode).toBe(200);
      const afterData = afterResolve.json<{ requests: readonly HelpRequest[] }>();
      expect(afterData.requests.some((r) => r.id === req1Id)).toBe(false);
    } finally {
      await app.close();
    }
  });
});
