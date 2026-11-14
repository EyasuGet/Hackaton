// Real-PostgreSQL checks of demo authentication and the learner-owned access
// rule, through the HTTP routes, with two learners and one support principal.
// Each run creates and drops its own database.
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
import { ResolvePrincipal } from './application/resolve-principal.ts';
import {
  PostgresPrincipalRepository,
  provisionDemoPrincipals,
  type DemoCredential,
  type DemoPrincipalKey,
} from './infrastructure/postgres-principal-repository.ts';

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
    // Every key in DEMO_PRINCIPALS is provisioned, so the record is complete.
    return Object.fromEntries(credentials.map((c) => [c.key, c.token])) as Record<
      DemoPrincipalKey,
      string
    >;
  } finally {
    client.release();
  }
}

function appWithDemoMode(demoMode: boolean) {
  return buildApp({
    checkReadiness: () => Promise.resolve({ ready: true }),
    resolvePrincipal: new ResolvePrincipal(new PostgresPrincipalRepository(pool), demoMode),
    demoRecords: new DemoRecords(new PostgresDemoRecordRepository(pool)),
  });
}

async function get(url: string, token?: string, headers: Record<string, string> = {}) {
  const app = appWithDemoMode(true);
  try {
    const authorization = token ? { authorization: `Bearer ${token}` } : {};
    return await app.inject({ method: 'GET', url, headers: { ...authorization, ...headers } });
  } finally {
    await app.close();
  }
}

/** Fixture record ids by key, read directly so tests do not rely on the API under test. */
async function recordId(key: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM demo_records WHERE demo_key = $1',
    [key],
  );
  return result.rows[0]!.id; // Seeded by provision(); a missing row is a fixture bug.
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

describe('authentication', () => {
  it('identifies a demo principal from server-side state and labels it as a demo', async () => {
    const response = await get('/api/me', tokens['learner-b']);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      role: 'learner',
      label: 'Demo learner B',
      courseIds: ['course-1', 'course-2'],
      demo: true,
      notice: 'Synthetic demo identity — not real authentication',
    });
  });

  it.each([
    ['no credential', undefined],
    ['an unknown token', 'x'.repeat(43)],
  ])('rejects %s', async (_case, token) => {
    const response = await get('/api/me', token);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthenticated' });
  });

  it('rejects valid demo tokens when demo mode is off', async () => {
    const app = appWithDemoMode(false);
    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${tokens.support}` },
    });
    await app.close();

    expect(response.statusCode).toBe(401);
  });

  it('invalidates earlier tokens when demo identities are provisioned again', async () => {
    const previous = tokens;
    tokens = await provision();

    expect((await get('/api/me', previous['learner-a'])).statusCode).toBe(401);
    expect((await get('/api/me', tokens['learner-a'])).statusCode).toBe(200);
  });
});

describe('learner-owned records', () => {
  it('lists only the learner’s own records in granted courses', async () => {
    const a = await get('/api/demo/records', tokens['learner-a']);
    const b = await get('/api/demo/records', tokens['learner-b']);

    // Learner A also owns a course-2 record but holds no course-2 grant.
    expect(a.json()).toEqual({
      records: [
        {
          id: await recordId('a-course-1'),
          courseId: 'course-1',
          body: 'Synthetic note: A, course 1',
        },
      ],
    });
    expect(b.json<{ records: { id: string }[] }>().records.map((r) => r.id)).toEqual([
      await recordId('b-course-1'),
      await recordId('b-course-2'),
    ]);
  });

  it('returns an in-scope record to its owner', async () => {
    const response = await get(
      `/api/demo/records/${await recordId('a-course-1')}`,
      tokens['learner-a'],
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ courseId: 'course-1' });
  });

  it.each([
    ['another learner’s record', 'b-course-1'],
    ['the learner’s own record in an ungranted course', 'a-course-2'],
  ])('answers 404 without content for %s', async (_case, key) => {
    const response = await get(`/api/demo/records/${await recordId(key)}`, tokens['learner-a']);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('answers 404 for a malformed record id', async () => {
    const response = await get('/api/demo/records/not-a-uuid', tokens['learner-a']);

    expect(response.statusCode).toBe(404);
  });

  it('ignores forged role, owner and course claims in the request', async () => {
    const forged = {
      'x-role': 'support',
      'x-principal-id': 'learner-b',
      'x-course-id': 'course-2',
    };
    const list = await get(
      '/api/demo/records?role=support&ownerId=learner-b&courseId=course-2',
      tokens['learner-a'],
      forged,
    );
    const other = await get(
      `/api/demo/records/${await recordId('b-course-2')}?role=support`,
      tokens['learner-a'],
      forged,
    );
    const staffOnly = await get(
      '/api/demo/support-check?role=support',
      tokens['learner-a'],
      forged,
    );

    expect(list.json<{ records: { id: string }[] }>().records.map((r) => r.id)).toEqual([
      await recordId('a-course-1'),
    ]);
    expect(other.statusCode).toBe(404);
    expect(staffOnly.statusCode).toBe(403);
  });
});

describe('support permissions', () => {
  it('allows the support operation for support staff only', async () => {
    expect((await get('/api/demo/support-check', tokens.support)).json()).toEqual({ ok: true });
    expect((await get('/api/demo/support-check', tokens['learner-b'])).statusCode).toBe(403);
  });

  it('gives support staff no access to learner records, for lists and single records alike', async () => {
    const list = await get('/api/demo/records', tokens.support);
    const record = await get(`/api/demo/records/${await recordId('a-course-1')}`, tokens.support);

    expect(list.statusCode).toBe(403);
    expect(record.statusCode).toBe(403);
    expect(record.json()).toEqual({ error: 'forbidden' });
  });
});
