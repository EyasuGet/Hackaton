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
import { ContentAccess } from '../content/application/content-access.ts';
import { PostgresLessonReader } from '../content/infrastructure/postgres-lesson-reader.ts';
import { DemoRecords } from '../demo-records/demo-records.ts';
import {
  PostgresDemoRecordRepository,
  seedDemoRecords,
} from '../demo-records/postgres-demo-record-repository.ts';
import { DemoSessions, HANDOFF_TTL_MS, SESSION_TTL_MS } from './application/demo-sessions.ts';
import { ResolvePrincipal } from './application/resolve-principal.ts';
import { PostgresDemoSessionRepository } from './infrastructure/postgres-demo-session-repository.ts';
import {
  PostgresPrincipalRepository,
  provisionDemoPrincipals,
  type DemoCredential,
  type DemoPrincipalKey,
} from './infrastructure/postgres-principal-repository.ts';
import { Tutoring } from '../tutoring/application/tutoring.ts';
import { PostgresTutoringRepository } from '../tutoring/infrastructure/persistence/postgres-tutoring-repository.ts';

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

const PAGE_ORIGIN = 'http://localhost:5173';
/** A second allowed page, such as the static host the embed will add. */
const OTHER_PAGE_ORIGIN = 'http://127.0.0.1:8765';

/** Controlled clock shared by session issue, exchange and authentication. */
let clock = new Date('2026-11-14T09:00:00Z');
const now = () => clock;

function demoSessions(demoMode = true) {
  return new DemoSessions(new PostgresDemoSessionRepository(pool), demoMode, now);
}

function appWithDemoMode(demoMode: boolean) {
  return buildApp({
    checkReadiness: () => Promise.resolve({ ready: true }),
    resolvePrincipal: new ResolvePrincipal(new PostgresPrincipalRepository(pool), demoMode, now),
    demoRecords: new DemoRecords(new PostgresDemoRecordRepository(pool)),
    demoSessions: demoSessions(demoMode),
    demoAllowedOrigins: [PAGE_ORIGIN, OTHER_PAGE_ORIGIN],
    tutoring: new Tutoring(new PostgresTutoringRepository(pool)),
    content: new ContentAccess(new PostgresLessonReader(pool), []),
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

describe('demo sessions', () => {
  async function handoff(key: DemoPrincipalKey, audience = PAGE_ORIGIN): Promise<string> {
    const issued = await demoSessions().issueHandoff(key, audience);
    if (!issued) throw new Error(`No handoff issued for ${key}`);
    return issued.secret;
  }

  /** `origin: null` sends no Origin header at all. */
  async function exchange(code: string, origin: string | null = PAGE_ORIGIN) {
    const app = appWithDemoMode(true);
    try {
      return await app.inject({
        method: 'POST',
        url: '/api/demo/session',
        headers: origin === null ? {} : { origin },
        payload: { code },
      });
    } finally {
      await app.close();
    }
  }

  async function sessionFor(key: DemoPrincipalKey): Promise<string> {
    const response = await exchange(await handoff(key));
    expect(response.statusCode).toBe(201);
    return response.json<{ token: string }>().token;
  }

  it('exchanges a handoff for a session that identifies only that principal', async () => {
    const session = await sessionFor('learner-a');

    const me = await get('/api/me', session);
    expect(me.json()).toMatchObject({ label: 'Demo learner A', role: 'learner', demo: true });

    // Learner isolation and staff protection hold for session tokens too.
    const other = await get(`/api/demo/records/${await recordId('b-course-1')}`, session, {
      'x-role': 'support',
    });
    expect(other.statusCode).toBe(404);
    expect(
      (await get('/api/demo/support-check', session, { 'x-role': 'support' })).statusCode,
    ).toBe(403);
    expect((await get('/api/demo/support-check', await sessionFor('support'))).json()).toEqual({
      ok: true,
    });
  });

  it('accepts a handoff code only once', async () => {
    const code = await handoff('learner-a');

    expect((await exchange(code)).statusCode).toBe(201);
    const replay = await exchange(code);

    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual({ error: 'invalid_handoff' });
  });

  it('gives exactly one session when the same code is exchanged concurrently', async () => {
    const code = await handoff('learner-b');

    const results = await Promise.all([exchange(code), exchange(code), exchange(code)]);

    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 401, 401]);
  });

  it('rejects an expired handoff code', async () => {
    const code = await handoff('learner-a');
    clock = new Date(clock.getTime() + HANDOFF_TTL_MS);

    expect((await exchange(code)).statusCode).toBe(401);
  });

  it.each([
    ['a different origin', 'https://attacker.example'],
    ['the null origin', 'null'],
    ['no origin', null],
  ])('refuses %s without using up the code', async (_case, origin) => {
    const code = await handoff('learner-a');

    const refused = await exchange(code, origin);

    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: 'origin_not_allowed' });
    expect((await exchange(code)).statusCode).toBe(201);
  });

  it('ends the session when it expires', async () => {
    const session = await sessionFor('learner-a');
    expect((await get('/api/me', session)).statusCode).toBe(200);

    clock = new Date(clock.getTime() + SESSION_TTL_MS);

    expect((await get('/api/me', session)).statusCode).toBe(401);
  });

  it('ends the session on sign-out', async () => {
    const session = await sessionFor('learner-a');
    const app = appWithDemoMode(true);
    const signOut = await app.inject({
      method: 'DELETE',
      url: '/api/demo/session',
      headers: { authorization: `Bearer ${session}` },
    });
    await app.close();

    expect(signOut.statusCode).toBe(204);
    expect((await get('/api/me', session)).statusCode).toBe(401);
  });

  it('issues, exchanges and honours nothing while demo mode is off', async () => {
    const session = await sessionFor('learner-a');
    const code = await handoff('learner-a');
    const offApp = appWithDemoMode(false);
    try {
      const exchanged = await offApp.inject({
        method: 'POST',
        url: '/api/demo/session',
        headers: { origin: PAGE_ORIGIN },
        payload: { code },
      });
      const me = await offApp.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: `Bearer ${session}` },
      });

      expect(await demoSessions(false).issueHandoff('learner-a', PAGE_ORIGIN)).toBeNull();
      expect(exchanged.statusCode).toBe(401);
      expect(me.statusCode).toBe(401);
    } finally {
      await offApp.close();
    }
  });

  it('issues no handoff for a name that is not a provisioned demo principal', async () => {
    expect(await demoSessions().issueHandoff('admin', PAGE_ORIGIN)).toBeNull();
  });

  it('accepts a code only at the page origin it was minted for, without using it up elsewhere', async () => {
    const code = await handoff('learner-a', PAGE_ORIGIN);

    expect((await exchange(code, OTHER_PAGE_ORIGIN)).statusCode).toBe(401);
    expect((await exchange(code, PAGE_ORIGIN)).statusCode).toBe(201);
  });

  it('ignores a role or other claims in the exchange body', async () => {
    const app = appWithDemoMode(true);
    const forged = await app.inject({
      method: 'POST',
      url: '/api/demo/session',
      headers: { origin: PAGE_ORIGIN },
      payload: { code: await handoff('learner-a'), role: 'support', courseIds: ['course-2'] },
    });
    await app.close();

    // Unknown body properties are stripped by validation; the session is still learner A's.
    const session = forged.json<{ token: string }>().token;
    expect((await get('/api/me', session)).json()).toMatchObject({
      role: 'learner',
      courseIds: ['course-1'],
    });
    expect((await get('/api/demo/support-check', session)).statusCode).toBe(403);
  });

  it('does not report signing out a token that is not a session', async () => {
    const app = appWithDemoMode(true);
    const signOut = await app.inject({
      method: 'DELETE',
      url: '/api/demo/session',
      headers: { authorization: `Bearer ${tokens['learner-a']}` },
    });
    await app.close();

    expect(signOut.statusCode).toBe(400);
    expect(signOut.json()).toEqual({ error: 'not_a_session' });
  });
});
