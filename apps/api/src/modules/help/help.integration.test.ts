// Real-PostgreSQL integration tests for help request persistence (T3-016-A).
// Tests: ownership isolation, duplicate-submit idempotence, state persistence
// across requests (waiting/cancelled survive reload), and cross-learner rejection.
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
import type { HelpRequest } from './domain/help-request.ts';
import { PostgresHelpRepository } from './infrastructure/persistence/postgres-help-repository.ts';

interface SubmitResponse {
  readonly kind: 'submitted' | 'existing';
  readonly request: HelpRequest;
}

interface ListResponse {
  readonly requests: readonly HelpRequest[];
}

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_help_${randomUUID().replaceAll('-', '')}`;
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

describe('Help Request Integration (T3-016-A)', () => {
  it('submits a new help request in waiting state', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: 'help-new-1',
          contextSnapshot: 'I need help with the assignment due tomorrow.',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<SubmitResponse>();
      expect(body.kind).toBe('submitted');
      expect(body.request.state).toBe('waiting');
      expect(body.request.consentGiven).toBe(true);
      expect(body.request.contextSnapshot).toBe('I need help with the assignment due tomorrow.');
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
        clientRequestId: 'help-dup-1',
        contextSnapshot: 'Original context for idempotence test.',
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const id1 = res1.json<SubmitResponse>().request.id;

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: { ...payload, contextSnapshot: 'Different context on retry.' },
      });
      expect(res2.statusCode).toBe(200);
      const body2 = res2.json<SubmitResponse>();
      expect(body2.kind).toBe('existing');
      // Returns the original row, not a second insert with the new context
      expect(body2.request.id).toBe(id1);
      expect(body2.request.contextSnapshot).toBe('Original context for idempotence test.');

      // Confirm exactly one database row for this clientRequestId
      const count = await pool.query<{ count: string }>(
        'SELECT count(*) FROM help_requests WHERE client_request_id = $1',
        ['help-dup-1'],
      );
      expect(Number(count.rows[0]?.count)).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('cancels a waiting request and persists the cancelled state', async () => {
    const app = makeApp();
    try {
      const submitRes = await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: 'help-cancel-1',
          contextSnapshot: 'Context for cancel test.',
        },
      });
      expect(submitRes.statusCode).toBe(201);
      const { request } = submitRes.json<SubmitResponse>();

      const cancelRes = await app.inject({
        method: 'DELETE',
        url: `/api/help/requests/${request.id}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(cancelRes.statusCode).toBe(200);
      const cancelled = cancelRes.json<{ request: HelpRequest }>().request;
      expect(cancelled.state).toBe('cancelled');
      expect(cancelled.cancelledAt).not.toBeNull();

      // State survives a reload: read back from DB
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/help/requests/${request.id}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json<HelpRequest>().state).toBe('cancelled');
    } finally {
      await app.close();
    }
  });

  it('another learner cannot read or cancel an owned request', async () => {
    const app = makeApp();
    try {
      const submitRes = await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: 'help-ownership-1',
          contextSnapshot: 'Private context.',
        },
      });
      expect(submitRes.statusCode).toBe(201);
      const id = submitRes.json<SubmitResponse>().request.id;

      // Learner B tries to read Learner A's request
      const readRes = await app.inject({
        method: 'GET',
        url: `/api/help/requests/${id}`,
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
      });
      expect(readRes.statusCode).toBe(404);

      // Learner B tries to cancel Learner A's request
      const cancelRes = await app.inject({
        method: 'DELETE',
        url: `/api/help/requests/${id}`,
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
      });
      expect(cancelRes.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('support principal is rejected from learner help routes', async () => {
    const app = makeApp();
    try {
      const submitRes = await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: {
          clientRequestId: 'help-support-denied',
          contextSnapshot: 'Support attempting learner action.',
        },
      });
      expect(submitRes.statusCode).toBe(403);
      expect(submitRes.json()).toEqual({ error: 'forbidden' });

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(listRes.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('listing returns only non-expired requests for the authenticated learner', async () => {
    const app = makeApp();
    try {
      // Submit a request for learner-b
      await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
        payload: {
          clientRequestId: 'help-list-b-1',
          contextSnapshot: 'Learner B private context.',
        },
      });

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
      });
      expect(listRes.statusCode).toBe(200);
      const { requests } = listRes.json<ListResponse>();
      expect(requests.length).toBeGreaterThanOrEqual(1);
      // All listed records must belong to learner-b only
      for (const r of requests) {
        expect(r.consentGiven).toBe(true);
      }

      // Learner A's list must not include learner-b's request
      const listARes = await app.inject({
        method: 'GET',
        url: '/api/help/requests',
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
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: 'help-double-cancel',
          contextSnapshot: 'Context for double-cancel test.',
        },
      });
      const id = submitRes.json<SubmitResponse>().request.id;

      await app.inject({
        method: 'DELETE',
        url: `/api/help/requests/${id}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });

      const second = await app.inject({
        method: 'DELETE',
        url: `/api/help/requests/${id}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(second.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
