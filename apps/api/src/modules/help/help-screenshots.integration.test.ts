// Real-PostgreSQL tests for help-request screenshots (T3-048): owner and claimant access,
// removal, deletion on cancel, expiry, and image validation. Images are synthetic.
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
import { HelpScreenshots } from './application/help-screenshots.ts';
import { StaffHelp } from './application/staff-help.ts';
import type { HelpRequest } from './domain/help-request.ts';
import { PostgresHelpRepository } from './infrastructure/persistence/postgres-help-repository.ts';
import { PostgresHelpScreenshotRepository } from './infrastructure/persistence/postgres-help-screenshot-repository.ts';

interface SubmitResponse {
  readonly kind: 'submitted' | 'existing';
  readonly request: HelpRequest;
}

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_screenshots_${randomUUID().replaceAll('-', '')}`;
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
    helpScreenshots: new HelpScreenshots(new PostgresHelpScreenshotRepository(pool)),
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

// Smallest valid PNG signature plus padding; content is synthetic.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('synthetic image'),
]);

let app: ReturnType<typeof makeApp>;

beforeAll(() => {
  app = makeApp();
});

afterAll(async () => {
  await app?.close();
});

const auth = (key: DemoPrincipalKey) => ({ authorization: `Bearer ${tokens[key]}` });

async function submit(key: DemoPrincipalKey = 'learner-a'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/help/requests',
    headers: auth(key),
    payload: { clientRequestId: randomUUID(), contextSnapshot: 'Synthetic help context' },
  });
  return res.json<SubmitResponse>().request.id;
}

function attach(id: string, key: DemoPrincipalKey = 'learner-a', body = PNG, type = 'image/png') {
  return app.inject({
    method: 'PUT',
    url: `/api/help/requests/${id}/screenshot`,
    headers: { ...auth(key), 'content-type': type },
    payload: body,
  });
}

function view(id: string, key: DemoPrincipalKey) {
  return app.inject({
    method: 'GET',
    url: `/api/help/requests/${id}/screenshot`,
    headers: auth(key),
  });
}

describe('help request screenshots (T3-048)', () => {
  it('lets the owner attach a screenshot and see it back unchanged', async () => {
    const id = await submit();

    expect((await attach(id)).statusCode).toBe(204);

    const res = await view(id, 'learner-a');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.rawPayload.equals(PNG)).toBe(true);
  });

  it('shows it to support only after they claim the request, and never to other learners', async () => {
    const id = await submit();
    await attach(id);

    expect((await view(id, 'learner-b')).statusCode).toBe(404);
    expect((await view(id, 'support')).statusCode).toBe(404);
    expect((await attach(id, 'learner-b')).statusCode).toBe(404);

    await app.inject({
      method: 'POST',
      url: `/api/help/requests/${id}/claim`,
      headers: auth('support'),
    });

    expect((await view(id, 'support')).statusCode).toBe(200);
  });

  it('removes it when the learner removes it', async () => {
    const id = await submit();
    await attach(id);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/help/requests/${id}/screenshot`,
      headers: auth('learner-a'),
    });

    expect(removed.statusCode).toBe(204);
    expect((await view(id, 'learner-a')).statusCode).toBe(404);
  });

  it('deletes it from storage when the learner cancels the request', async () => {
    const id = await submit();
    await attach(id);

    await app.inject({
      method: 'DELETE',
      url: `/api/help/requests/${id}`,
      headers: auth('learner-a'),
    });

    const stored = await pool.query(
      'SELECT 1 FROM help_request_screenshots WHERE help_request_id = $1',
      [id],
    );
    expect(stored.rowCount).toBe(0);
  });

  it('is not served once the request has expired', async () => {
    const id = await submit();
    await attach(id);

    await pool.query(
      `UPDATE help_requests SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [id],
    );

    expect((await view(id, 'learner-a')).statusCode).toBe(404);
  });

  it('refuses a file whose content is not the declared image type', async () => {
    const id = await submit();

    expect((await attach(id, 'learner-a', Buffer.from('<svg/>'), 'image/png')).statusCode).toBe(
      400,
    );
    expect((await attach(id, 'learner-a', Buffer.from('GIF89a'), 'image/gif')).statusCode).toBe(
      415,
    );
  });

  it('refuses an image larger than 1 MiB', async () => {
    const id = await submit();
    const large = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);

    expect((await attach(id, 'learner-a', large)).statusCode).toBe(413);
  });
});
