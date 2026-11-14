// Real-PostgreSQL checks for lesson import: reimport, update, withdrawal and
// rejection must never duplicate content or leave a stale or partial version
// authoritative. Each run creates and drops its own database.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from '../../bootstrap/config.ts';
import { createPool } from '../../infrastructure/database/connection.ts';
import {
  loadMigrations,
  migrate,
  MIGRATIONS_DIR,
} from '../../infrastructure/database/migrations.ts';
import {
  ImportLessonSource,
  InvalidLessonSourceError,
  VersionConflictError,
} from './application/import-lesson-source.ts';
import { PostgresLessonRepository } from './infrastructure/postgres-lesson-repository.ts';

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_${randomUUID().replaceAll('-', '')}`;
const FIXTURES = new URL('../../../../../fixtures/courses/', import.meta.url);
let admin: pg.Pool;
let pool: pg.Pool;
let importLesson: ImportLessonSource;

interface Fixture {
  sourceId: string;
  version: string;
  sections: { id: string; anchor: string | null; heading: string; text: string }[];
  [key: string]: unknown;
}

async function fixture(name: string): Promise<Fixture> {
  return JSON.parse(await readFile(new URL(name, FIXTURES), 'utf8')) as Fixture;
}

/** The authoritative sections: those of the source's current version, in order. */
async function currentSections(sourceId: string) {
  const result = await pool.query<{ id: string; heading: string; body: string }>(
    `SELECT sec.section_id AS id, sec.heading, sec.body
       FROM lesson_sources s
       JOIN lesson_sections sec ON sec.version_id = s.current_version_id
      WHERE s.id = $1
      ORDER BY sec.position`,
    [sourceId],
  );
  return result.rows;
}

async function storedVersions(sourceId: string): Promise<string[]> {
  const result = await pool.query<{ version: string }>(
    'SELECT version FROM lesson_source_versions WHERE source_id = $1 ORDER BY imported_at, version',
    [sourceId],
  );
  return result.rows.map((row) => row.version);
}

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  importLesson = new ImportLessonSource(new PostgresLessonRepository(pool));
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin?.end();
});

beforeEach(async () => {
  await pool.query(
    'UPDATE lesson_sources SET current_version_id = NULL; TRUNCATE lesson_sections, lesson_source_versions, lesson_sources',
  );
});

describe('importing a lesson source', () => {
  it('stores the approved Savanna lesson once, however often it is reimported', async () => {
    const lesson = await fixture('savanna-va1-future-of-va-industry.json');

    expect(await importLesson.execute(lesson)).toEqual({
      status: 'imported',
      version: 'starter-9e83ac7',
      sections: lesson.sections.length,
    });
    expect(await importLesson.execute(lesson)).toEqual({
      status: 'unchanged',
      version: 'starter-9e83ac7',
    });
    // Relabelling identical content is not a new version either.
    expect(await importLesson.execute({ ...lesson, version: 'relabelled' })).toMatchObject({
      status: 'unchanged',
    });

    expect(await storedVersions(lesson.sourceId)).toEqual(['starter-9e83ac7']);
    expect((await currentSections(lesson.sourceId)).map((s) => s.id)).toEqual(
      lesson.sections.map((s) => s.id),
    );
  });

  it('keeps Amharic text exactly as written', async () => {
    const lesson = await fixture('demo-time-management-am.json');
    await importLesson.execute(lesson);

    expect(await currentSections(lesson.sourceId)).toEqual(
      lesson.sections.map((s) => ({ id: s.id, heading: s.heading, body: s.text })),
    );
  });

  it('makes a revised version authoritative and drops withdrawn sections from it', async () => {
    const original = await fixture('savanna-va1-future-of-va-industry.json');
    await importLesson.execute(original);
    const [first, second, ...rest] = original.sections;
    const revised = {
      ...original,
      version: 'revised-1',
      // Edit the first section and withdraw the second.
      sections: [{ ...first!, text: `${first!.text} (revised)` }, ...rest],
    };

    expect(await importLesson.execute(revised)).toMatchObject({ status: 'imported' });

    const current = await currentSections(original.sourceId);
    expect(current.map((s) => s.id)).not.toContain(second!.id);
    expect(current[0]?.body).toBe(`${first!.text} (revised)`);
    // The earlier version stays stored exactly, for inspection, but not as current.
    const earlier = await pool.query<{ body: string }>(
      `SELECT sec.body FROM lesson_sections sec
         JOIN lesson_source_versions v ON v.id = sec.version_id
        WHERE v.source_id = $1 AND v.version = $2 AND sec.section_id = $3`,
      [original.sourceId, original.version, second!.id],
    );
    expect(earlier.rows).toEqual([{ body: second!.text }]);
  });

  it('retires a withdrawn source', async () => {
    const lesson = await fixture('demo-time-management-am.json');
    await importLesson.execute(lesson);

    const outcome = await importLesson.execute({
      ...lesson,
      version: 'withdrawn-1',
      withdrawn: true,
      sections: [],
    });

    expect(outcome).toEqual({ status: 'withdrawn', version: 'withdrawn-1' });
    expect(await currentSections(lesson.sourceId)).toEqual([]);
  });
});

describe('rejected imports leave the approved version authoritative', () => {
  let lesson: Fixture;
  let approved: Awaited<ReturnType<typeof currentSections>>;

  beforeEach(async () => {
    lesson = await fixture('savanna-va1-future-of-va-industry.json');
    await importLesson.execute(lesson);
    approved = await currentSections(lesson.sourceId);
  });

  it('rejects a malformed file before storing anything', async () => {
    const malformed = { ...lesson, version: 'broken', sections: [{ id: 'Not An Id' }] };

    await expect(importLesson.execute(malformed)).rejects.toThrow(InvalidLessonSourceError);

    expect(await storedVersions(lesson.sourceId)).toEqual(['starter-9e83ac7']);
    expect(await currentSections(lesson.sourceId)).toEqual(approved);
  });

  it('rejects a reused version label with different content', async () => {
    const changed = {
      ...lesson,
      sections: lesson.sections.map((s, i) => (i === 0 ? { ...s, text: 'Different' } : s)),
    };

    await expect(importLesson.execute(changed)).rejects.toThrow(VersionConflictError);

    expect(await storedVersions(lesson.sourceId)).toEqual(['starter-9e83ac7']);
    expect(await currentSections(lesson.sourceId)).toEqual(approved);
  });

  it('rolls back a version whose sections fail to store', async () => {
    // Valid input whose section insert fails inside the transaction, after the
    // version row was written: only atomicity keeps the old version current.
    await pool.query(
      'ALTER TABLE lesson_sections ADD CONSTRAINT reject_sections CHECK (false) NOT VALID',
    );
    try {
      await expect(
        importLesson.execute({ ...lesson, version: 'revised-2', title: 'New' }),
      ).rejects.toThrow('reject_sections');
    } finally {
      await pool.query('ALTER TABLE lesson_sections DROP CONSTRAINT reject_sections');
    }

    expect(await storedVersions(lesson.sourceId)).toEqual(['starter-9e83ac7']);
    expect(await currentSections(lesson.sourceId)).toEqual(approved);
  });
});
