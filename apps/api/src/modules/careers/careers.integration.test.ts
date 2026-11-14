// Real-PostgreSQL integration checks for job ingestion (T3-019-A).
// Verifies idempotent reimports, stable publication identities, atomic updates,
// safe rejection of malformed records, and queryable active/expired/withdrawn status.
// Each run creates and drops its own temporary database.
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
import { ImportJobs, InvalidJobError, JobVersionConflictError } from './application/import-jobs.ts';
import { PostgresJobRepository } from './infrastructure/postgres-job-repository.ts';

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_${randomUUID().replaceAll('-', '')}`;
const FIXTURES = new URL('../../../../../fixtures/jobs/', import.meta.url);

let admin: pg.Pool;
let pool: pg.Pool;
let repository: PostgresJobRepository;
let importJobs: ImportJobs;

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, FIXTURES), 'utf8'));
}

async function storedVersions(jobId: string): Promise<string[]> {
  const result = await pool.query<{ version: string }>(
    'SELECT version FROM job_versions WHERE job_id = $1 ORDER BY imported_at, version',
    [jobId],
  );
  return result.rows.map((r) => r.version);
}

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  repository = new PostgresJobRepository(pool);
  importJobs = new ImportJobs(repository);
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin?.end();
});

beforeEach(async () => {
  await pool.query(
    'UPDATE jobs SET current_version_id = NULL; TRUNCATE job_versions, jobs CASCADE',
  );
});

describe('importing approved jobs (T3-019-A)', () => {
  it('imports a new job with a stable publication identity', async () => {
    const raw = await fixture('demo-va-specialist.json');
    const outcomes = await importJobs.execute(raw);

    expect(outcomes).toHaveLength(1);
    const outcome = outcomes[0]!;
    expect(outcome.id).toBe('job-va-specialist-01');
    expect(outcome.status).toBe('imported');
    expect(outcome.isNewPublication).toBe(true);
    expect(outcome.version).toBe('starter-1.0');
    expect(outcome.publicationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const record = await repository.getJob('job-va-specialist-01');
    expect(record).not.toBeNull();
    expect(record?.publicationId).toBe(outcome.publicationId);
    expect(record?.status).toBe('active');
    expect(record?.title).toBe('Virtual Assistant Specialist');
    expect(record?.category).toBe('administrative');
    expect(record?.location).toBe('Addis Ababa');

    const pubEvent = await repository.getPublicationEvent(outcome.publicationId);
    expect(pubEvent).not.toBeNull();
    expect(pubEvent?.jobId).toBe('job-va-specialist-01');
  });

  it('re-importing identical content is a no-op that does not duplicate rows', async () => {
    const raw = await fixture('demo-va-specialist.json');

    const first = await importJobs.execute(raw);
    const second = await importJobs.execute(raw);

    expect(second[0]?.status).toBe('unchanged');
    expect(second[0]?.isNewPublication).toBe(false);
    expect(second[0]?.publicationId).toBe(first[0]?.publicationId);

    const versions = await storedVersions('job-va-specialist-01');
    expect(versions).toEqual(['starter-1.0']);

    const jobsCount = await pool.query<{ count: string }>('SELECT COUNT(*) FROM jobs');
    expect(jobsCount.rows[0]?.count).toBe('1');
  });

  it('updates an existing job with a new version without altering its publication identity', async () => {
    const raw = (await fixture('demo-va-specialist.json')) as Record<string, unknown>;
    const first = await importJobs.execute(raw);
    const publicationId = first[0]!.publicationId;

    const revised = {
      ...raw,
      version: 'revised-2.0',
      title: 'Senior Virtual Assistant Specialist',
      description:
        'Expanded responsibilities including junior team coaching and client onboarding.',
    };

    const second = await importJobs.execute(revised);
    expect(second[0]?.status).toBe('updated');
    expect(second[0]?.isNewPublication).toBe(false);
    expect(second[0]?.version).toBe('revised-2.0');
    // Publication ID must remain stable across updates!
    expect(second[0]?.publicationId).toBe(publicationId);

    const record = await repository.getJob('job-va-specialist-01');
    expect(record?.version).toBe('revised-2.0');
    expect(record?.title).toBe('Senior Virtual Assistant Specialist');
    expect(record?.publicationId).toBe(publicationId);

    const versions = await storedVersions('job-va-specialist-01');
    expect(versions).toEqual(['starter-1.0', 'revised-2.0']);
  });

  it('refuses to reuse a version label for modified content', async () => {
    const raw = (await fixture('demo-va-specialist.json')) as Record<string, unknown>;
    await importJobs.execute(raw);

    const conflict = {
      ...raw,
      title: 'Conflicting Title with Same Version Label',
    };

    await expect(importJobs.execute(conflict)).rejects.toThrow(JobVersionConflictError);

    // Current version must remain untouched
    const record = await repository.getJob('job-va-specialist-01');
    expect(record?.title).toBe('Virtual Assistant Specialist');
    expect(record?.version).toBe('starter-1.0');
  });

  it('rejects malformed records without corrupting approved data', async () => {
    const valid = await fixture('demo-va-specialist.json');
    await importJobs.execute(valid);

    const malformed = {
      id: 'job-broken',
      title: 'Broken Job',
      // Missing required fields: version, organization, category, sourceUrl, dates, provenance
    };

    await expect(importJobs.execute(malformed)).rejects.toThrow(InvalidJobError);

    // Existing approved job must still exist and be intact
    const record = await repository.getJob('job-va-specialist-01');
    expect(record).not.toBeNull();
    expect(record?.id).toBe('job-va-specialist-01');

    // No broken record was created
    const broken = await repository.getJob('job-broken');
    expect(broken).toBeNull();
  });

  it('consistently queries active, expired, and withdrawn statuses', async () => {
    const asOf = new Date('2026-11-14T12:00:00.000Z');

    const activeRaw = await fixture('demo-va-specialist.json');
    const expiredRaw = await fixture('demo-expired-data-clerk.json');

    await importJobs.execute(activeRaw);
    await importJobs.execute(expiredRaw);

    // Query active jobs as of current test time
    const activeJobs = await repository.listJobs({ status: 'active' }, asOf);
    expect(activeJobs).toHaveLength(1);
    expect(activeJobs[0]?.id).toBe('job-va-specialist-01');
    expect(activeJobs[0]?.status).toBe('active');

    // Query expired jobs
    const expiredJobs = await repository.listJobs({ status: 'expired' }, asOf);
    expect(expiredJobs).toHaveLength(1);
    expect(expiredJobs[0]?.id).toBe('job-data-clerk-02');
    expect(expiredJobs[0]?.status).toBe('expired');

    // Query by category filter
    const adminJobs = await repository.listJobs({ category: 'administrative' }, asOf);
    expect(adminJobs).toHaveLength(2);

    // Withdraw the active job with a new version
    const withdrawnJob = {
      ...((await fixture('demo-va-specialist.json')) as Record<string, unknown>),
      version: 'withdrawn-v2',
      withdrawn: true,
    };
    const outcome = await importJobs.execute(withdrawnJob);
    expect(outcome[0]?.status).toBe('withdrawn');

    // It should now appear under withdrawn, and no longer under active
    const activeAfter = await repository.listJobs({ status: 'active' }, asOf);
    expect(activeAfter).toHaveLength(0);

    const withdrawnAfter = await repository.listJobs({ status: 'withdrawn' }, asOf);
    expect(withdrawnAfter).toHaveLength(1);
    expect(withdrawnAfter[0]?.id).toBe('job-va-specialist-01');
    expect(withdrawnAfter[0]?.status).toBe('withdrawn');
  });
});
