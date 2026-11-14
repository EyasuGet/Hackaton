// Real-PostgreSQL checks of permission-filtered retrieval and citation
// resolution (T3-005-B), plus the bilingual retrieval evaluation whose
// thresholds are fixed in fixtures/evaluations/retrieval-cases.json.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
import { DemoSessions } from '../identity/application/demo-sessions.ts';
import { ResolvePrincipal } from '../identity/application/resolve-principal.ts';
import type { Principal } from '../identity/domain/principal.ts';
import { PostgresDemoSessionRepository } from '../identity/infrastructure/postgres-demo-session-repository.ts';
import {
  PostgresPrincipalRepository,
  provisionDemoPrincipals,
  type DemoPrincipalKey,
} from '../identity/infrastructure/postgres-principal-repository.ts';
import { PostgresDemoRecordRepository } from '../demo-records/postgres-demo-record-repository.ts';
import { ContentAccess } from './application/content-access.ts';
import { ImportLessonSource } from './application/import-lesson-source.ts';
import { loadGlossary } from './infrastructure/glossary-file.ts';
import { PostgresLessonReader } from './infrastructure/postgres-lesson-reader.ts';
import { PostgresLessonRepository } from './infrastructure/postgres-lesson-repository.ts';

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_${randomUUID().replaceAll('-', '')}`;
const fixture = (path: string) => new URL(`../../../../../fixtures/${path}`, import.meta.url);
const SAVANNA = 'savanna-va1-future-of-va-industry';
const DEMO_AM = 'demo-time-management-am';

let admin: pg.Pool;
let pool: pg.Pool;
let tokens: Record<DemoPrincipalKey, string>;
let content: ContentAccess;

async function readJson(path: string): Promise<Record<string, unknown>> {
  const data: unknown = JSON.parse(await readFile(fixture(path), 'utf8'));
  if (typeof data !== 'object' || data === null) throw new Error(`${path} is not an object`);
  return data as Record<string, unknown>; // Test fixture, validated again by the importer.
}

async function importSource(source: Record<string, unknown>) {
  return new ImportLessonSource(new PostgresLessonRepository(pool)).execute(source);
}

function learner(courseIds: string[]): Principal {
  return { id: randomUUID(), role: 'learner', label: 'Test learner', demo: true, courseIds };
}

async function get(url: string, key: DemoPrincipalKey) {
  const app = buildApp({
    checkReadiness: () => Promise.resolve({ ready: true }),
    resolvePrincipal: new ResolvePrincipal(new PostgresPrincipalRepository(pool), true),
    demoRecords: new DemoRecords(new PostgresDemoRecordRepository(pool)),
    demoSessions: new DemoSessions(new PostgresDemoSessionRepository(pool), true),
    demoAllowedOrigins: [],
    content,
  });
  try {
    return await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${tokens[key]}` },
    });
  } finally {
    await app.close();
  }
}

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  const client = await pool.connect();
  try {
    const credentials = await provisionDemoPrincipals(client);
    tokens = Object.fromEntries(credentials.map((c) => [c.key, c.token])) as Record<
      DemoPrincipalKey,
      string
    >; // Every DEMO_PRINCIPALS key is provisioned.
  } finally {
    client.release();
  }
  content = new ContentAccess(new PostgresLessonReader(pool), await loadGlossary());
  await importSource(await readJson(`courses/${SAVANNA}.json`));
  await importSource(await readJson(`courses/${DEMO_AM}.json`));
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin?.end();
});

describe('citation resolution over HTTP', () => {
  it('shows a granted learner the cited section with its provenance', async () => {
    const response = await get(
      `/api/content/sources/${SAVANNA}/sections/introduction`,
      'learner-a',
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sourceId: SAVANNA,
      sectionId: 'introduction',
      language: 'en',
      courseId: 'course-1',
      provenance: { kind: 'organiser', commit: '9e83ac77891708117728ad9fc05301e124cc8ec8' },
    });
  });

  it('keeps Amharic text, ids and demo provenance intact', async () => {
    const response = await get(`/api/content/sources/${DEMO_AM}/sections/planning`, 'learner-b');

    expect(response.json()).toMatchObject({
      heading: 'እቅድ ማውጣት',
      language: 'am',
      provenance: { kind: 'demo' },
    });
  });

  it('answers the same 404 for a forbidden course and a missing source', async () => {
    const forbidden = await get(`/api/content/sources/${DEMO_AM}/sections/planning`, 'learner-a');
    const missing = await get('/api/content/sources/no-such-source/sections/planning', 'learner-a');

    expect(forbidden.statusCode).toBe(404);
    expect(forbidden.json()).toEqual(missing.json());
  });

  it('refuses support staff, who have no course content access yet', async () => {
    expect((await get(`/api/content/search?q=planning`, 'support')).statusCode).toBe(403);
  });

  it('searches only the learner’s granted courses', async () => {
    const response = await get(`/api/content/search?q=${encodeURIComponent('እቅድ')}`, 'learner-a');

    expect(response.json<{ passages: unknown[] }>().passages).toEqual([]);
  });
});

describe('updated and withdrawn sources', () => {
  const both = learner(['course-1']);
  const section = (id: string, text: string) => ({ id, anchor: null, heading: id, text });
  // Each test uses its own source, so neither depends on the other's imports.
  const source = (sourceId: string, version: string, sections: unknown[], withdrawn = false) => ({
    sourceId,
    version,
    title: 'Lifecycle test',
    courseId: 'course-1',
    language: 'en',
    provenance: { kind: 'demo', note: 'Synthetic lifecycle fixture' },
    withdrawn,
    sections,
  });

  it('stops citing a removed section and reports it honestly', async () => {
    const sourceId = 'lifecycle-removed';
    await importSource(
      source(sourceId, 'v1', [section('kept', 'zebra stripes'), section('gone', 'quokka smiles')]),
    );
    await importSource(source(sourceId, 'v2', [section('kept', 'zebra stripes, revised')]));

    expect(await content.resolve(both, sourceId, 'gone')).toEqual({
      kind: 'unavailable',
      reason: 'removed',
    });
    expect(await content.search(both, 'quokka')).toEqual([]);
    expect((await content.search(both, 'zebra'))[0]?.text).toBe('zebra stripes, revised');
  });

  it('stops citing and finding a withdrawn source', async () => {
    const sourceId = 'lifecycle-withdrawn';
    await importSource(source(sourceId, 'v1', [section('kept', 'narwhal tusks')]));
    await importSource(source(sourceId, 'v2', [], true));

    expect(await content.resolve(both, sourceId, 'kept')).toEqual({
      kind: 'unavailable',
      reason: 'withdrawn',
    });
    expect(await content.search(both, 'narwhal')).toEqual([]);
  });
});

describe('bilingual retrieval evaluation', () => {
  it('meets the thresholds fixed in fixtures/evaluations/retrieval-cases.json', async () => {
    const cases = await readJson('evaluations/retrieval-cases.json');
    const supported = cases.supported as { direction: string; question: string; expect: string }[];
    const outOfCorpus = cases.outOfCorpus as string[];
    const reader = learner(['course-1', 'course-2']);

    const results = await Promise.all(
      supported.map(async (c) => {
        const top = (await content.search(reader, c.question)).slice(0, 3).map((p) => p.sectionId);
        return { ...c, top, hit: top.includes(c.expect) };
      }),
    );
    const empties = await Promise.all(
      outOfCorpus.map(async (q) => ({ q, count: (await content.search(reader, q)).length })),
    );
    // Recorded with the T3-005-B decision; printed so a run's evidence is visible.
    console.log(JSON.stringify({ results, empties }, null, 2));

    expect(results.filter((r) => r.hit).length).toBeGreaterThanOrEqual(9);
    for (const direction of ['en→en', 'am→en', 'am→am', 'en→am']) {
      expect(results.some((r) => r.direction === direction && r.hit)).toBe(true);
    }
    expect(empties.every((e) => e.count === 0)).toBe(true);
  });
});
