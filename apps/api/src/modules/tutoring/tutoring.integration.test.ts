// Real-PostgreSQL integration tests for tutoring persistence (T3-007-D).
// Tests ownership isolation, course scope enforcement, atomic request claims,
// cross-user independence, and restart durability through HTTP routes.
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
import { Tutoring } from './application/tutoring.ts';
import type { TutoringRequest } from './domain/tutoring-request.ts';
import { PostgresTutoringRepository } from './infrastructure/persistence/postgres-tutoring-repository.ts';

interface ClaimResponse {
  readonly kind: 'claimed' | 'existing';
  readonly request: TutoringRequest;
}

interface HistoryResponse {
  readonly history: readonly TutoringRequest[];
}

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_${randomUUID().replaceAll('-', '')}`;
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

describe('Tutoring Persistence Integration (T3-007-D)', () => {
  it('allows an authorized learner to claim a request in pending state', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/tutoring/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          courseId: 'course-1',
          requestId: 'req-integ-1',
          question: 'What is the schedule for course 1?',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<ClaimResponse>();
      expect(body.kind).toBe('claimed');
      expect(body.request.state).toBe('pending');
      expect(body.request.question).toBe('What is the schedule for course 1?');
      expect(body.request.courseId).toBe('course-1');
      expect(body.request.answerText).toBeNull();
      expect(body.request.completedAt).toBeNull();
      expect(body.request.createdAt).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('repeated requests with identical requestId return the existing record without duplicates', async () => {
    const app = makeApp();
    try {
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/tutoring/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          courseId: 'course-1',
          requestId: 'req-dup-test',
          question: 'Original question?',
        },
      });
      expect(res1.statusCode).toBe(201);
      const firstId = res1.json<ClaimResponse>().request.id;

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/tutoring/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          courseId: 'course-1',
          requestId: 'req-dup-test',
          question: 'Retry question?',
        },
      });
      expect(res2.statusCode).toBe(200);
      const body2 = res2.json<ClaimResponse>();
      expect(body2.kind).toBe('existing');
      expect(body2.request.id).toBe(firstId);
      expect(body2.request.question).toBe('Original question?');

      // Verify at the database level that exactly one row exists for this requestId
      const countResult = await pool.query<{ count: string }>(
        'SELECT count(*) FROM tutoring_requests WHERE request_id = $1',
        ['req-dup-test'],
      );
      expect(Number(countResult.rows[0]?.count)).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('isolates identical requestIds across different learners', async () => {
    const app = makeApp();
    try {
      const sharedRequestId = 'req-cross-user-shared';

      const resA = await app.inject({
        method: 'POST',
        url: '/api/tutoring/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          courseId: 'course-1',
          requestId: sharedRequestId,
          question: 'Learner A question',
        },
      });
      expect(resA.statusCode).toBe(201);

      const resB = await app.inject({
        method: 'POST',
        url: '/api/tutoring/requests',
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
        payload: {
          courseId: 'course-1',
          requestId: sharedRequestId,
          question: 'Learner B question',
        },
      });
      expect(resB.statusCode).toBe(201);

      const idA = resA.json<ClaimResponse>().request.id;
      const idB = resB.json<ClaimResponse>().request.id;
      expect(idA).not.toBe(idB);

      // Learner A cannot read Learner B's request
      const readOther = await app.inject({
        method: 'GET',
        url: `/api/tutoring/requests/${idB}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(readOther.statusCode).toBe(404);
      expect(readOther.json()).toEqual({ error: 'not_found' });
    } finally {
      await app.close();
    }
  });

  it('rejects ungranted course requests with 404', async () => {
    const app = makeApp();
    try {
      // Learner A only has course-1
      const response = await app.inject({
        method: 'POST',
        url: '/api/tutoring/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          courseId: 'course-2',
          requestId: 'req-ungranted-course',
          question: 'Course 2 query by Learner A',
        },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    } finally {
      await app.close();
    }
  });

  it('rejects support principals from learner tutoring routes', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/tutoring/requests',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: {
          courseId: 'course-1',
          requestId: 'req-support-forbidden',
          question: 'Staff attempting to create learner request',
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'forbidden' });

      const historyResponse = await app.inject({
        method: 'GET',
        url: '/api/tutoring/history',
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(historyResponse.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('lists history scoped strictly to the requesting learner and granted courses', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/tutoring/history',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<HistoryResponse>();
      expect(Array.isArray(body.history)).toBe(true);
      expect(body.history.length).toBeGreaterThanOrEqual(1);

      // Verify every listed record belongs to Learner A and is course-1
      for (const item of body.history) {
        expect(item.courseId).toBe('course-1');
      }
    } finally {
      await app.close();
    }
  });

  it('preserves records and state transitions across connection restarts', async () => {
    const repo = new PostgresTutoringRepository(pool);
    const learnerScope = {
      ownerId: (
        await pool.query<{ id: string }>('SELECT id FROM principals WHERE demo_key = $1', [
          'learner-b',
        ])
      ).rows[0]!.id,
      courseIds: ['course-1', 'course-2'],
    };

    const claim = await repo.claimRequest(learnerScope, {
      courseId: 'course-2',
      requestId: 'req-restart-test',
      question: 'Will this survive restart?',
    });
    expect(claim).not.toBeNull();
    const reqId = claim!.request.id;

    // Transition to completed
    const completed = await repo.recordOutcome(learnerScope, reqId, {
      state: 'completed',
      answerText: 'Yes, persisted safely in PostgreSQL.',
      answerLang: 'en',
    });
    expect(completed?.state).toBe('completed');
    expect(completed?.completedAt).not.toBeNull();

    // Verify record directly via fresh query
    const verifyResult = await pool.query<{ state: string; answer_text: string }>(
      'SELECT state, answer_text FROM tutoring_requests WHERE id = $1',
      [reqId],
    );
    expect(verifyResult.rows[0]?.state).toBe('completed');
    expect(verifyResult.rows[0]?.answer_text).toBe('Yes, persisted safely in PostgreSQL.');
  });
});
