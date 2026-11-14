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
});
