import { describe, expect, it } from 'vitest';
import {
  checksumOf,
  parseJob,
  parseJobFile,
  planJobImport,
  resolveJobStatus,
  type Job,
} from './job.ts';

const VALID_JOB_INPUT = {
  id: 'job-va-specialist-01',
  version: '1.0.0',
  title: 'Virtual Assistant Specialist',
  organization: 'Savanna Digital Services',
  category: 'administrative',
  location: 'Addis Ababa',
  description: 'Manage executive schedules, prepare correspondence, and perform internet research.',
  sourceUrl: 'https://digitalbridge.et/jobs/job-va-specialist-01',
  postedAt: '2026-11-01T09:00:00.000Z',
  expiresAt: '2026-12-01T18:00:00.000Z',
  withdrawn: false,
  provenance: {
    kind: 'demo',
    note: 'Synthetic demo vacancy for testing job ingestion.',
  },
};

describe('parseJob', () => {
  it('parses a valid demo job record', () => {
    const result = parseJob(VALID_JOB_INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.job.id).toBe('job-va-specialist-01');
    expect(result.job.version).toBe('1.0.0');
    expect(result.job.title).toBe('Virtual Assistant Specialist');
    expect(result.job.category).toBe('administrative');
    expect(result.job.postedAt.toISOString()).toBe('2026-11-01T09:00:00.000Z');
    expect(result.job.expiresAt.toISOString()).toBe('2026-12-01T18:00:00.000Z');
    expect(result.job.withdrawn).toBe(false);
    expect(result.job.provenance.kind).toBe('demo');
  });

  it('parses an organiser-provenance job', () => {
    const input = {
      ...VALID_JOB_INPUT,
      provenance: {
        kind: 'organiser',
        repository: 'https://github.com/alx-africa/Savanna-static-pages',
        commit: '9e83ac77891708117728ad9fc05301e124cc8ec8',
        path: 'jobs/va-posting.html',
        approval: 'Verified organiser listing 2026-11-14',
      },
    };
    const result = parseJob(input);
    expect(result.ok).toBe(true);
  });

  it('parses a partner-provenance job', () => {
    const input = {
      ...VALID_JOB_INPUT,
      provenance: {
        kind: 'partner',
        source: 'Ethiopian Employers Federation',
        verifiedAt: '2026-11-14T10:00:00.000Z',
        note: 'Direct vacancy notice',
      },
    };
    const result = parseJob(input);
    expect(result.ok).toBe(true);
  });

  it('rejects non-object input', () => {
    expect(parseJob(null).ok).toBe(false);
    expect(parseJob('string').ok).toBe(false);
    expect(parseJob([]).ok).toBe(false);
  });

  it('collects all errors on malformed input without stopping early', () => {
    const badInput = {
      id: 'INVALID_ID_WITH_CAPS!',
      version: '',
      title: '   ',
      category: 'INVALID CATEGORY',
      sourceUrl: 'not-a-valid-url',
      postedAt: 'not-a-date',
      expiresAt: '2026-99-99',
      withdrawn: 'maybe',
      unknownProperty: 'bad',
      provenance: {
        kind: 'unknown-kind',
      },
    };
    const result = parseJob(badInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors.some((e) => e.includes('id must be lowercase letters'))).toBe(true);
    expect(result.errors.some((e) => e.includes('version must be a non-empty string'))).toBe(true);
    expect(result.errors.some((e) => e.includes('title must be a non-empty string'))).toBe(true);
    expect(result.errors.some((e) => e.includes('sourceUrl must be a valid http(s) URL'))).toBe(
      true,
    );
    expect(result.errors.some((e) => e.includes('postedAt must be a valid ISO 8601 date'))).toBe(
      true,
    );
    expect(result.errors.some((e) => e.includes('expiresAt must be a valid ISO 8601 date'))).toBe(
      true,
    );
    expect(result.errors.some((e) => e.includes('withdrawn must be true or false'))).toBe(true);
    expect(result.errors.some((e) => e.includes('unknownProperty is not a recognised field'))).toBe(
      true,
    );
    expect(result.errors.some((e) => e.includes('provenance.kind must be'))).toBe(true);
  });
});

describe('parseJobFile', () => {
  it('parses single job object in a file', () => {
    const result = parseJobFile(VALID_JOB_INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.id).toBe('job-va-specialist-01');
  });

  it('parses an array of jobs', () => {
    const result = parseJobFile([
      VALID_JOB_INPUT,
      { ...VALID_JOB_INPUT, id: 'job-data-entry-02', title: 'Data Entry Assistant' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jobs).toHaveLength(2);
  });

  it('parses an object with jobs array', () => {
    const result = parseJobFile({
      jobs: [VALID_JOB_INPUT],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jobs).toHaveLength(1);
  });

  it('rejects empty job array', () => {
    const result = parseJobFile([]);
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate job IDs within the same file', () => {
    const result = parseJobFile([VALID_JOB_INPUT, { ...VALID_JOB_INPUT, version: '1.0.1' }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('duplicated in the same input file'))).toBe(true);
  });
});

describe('checksumOf and planJobImport', () => {
  it('produces identical checksum regardless of version label', () => {
    const jobA: Job = {
      ...(parseJob(VALID_JOB_INPUT) as { ok: true; job: Job }).job,
      version: '1.0.0',
    };
    const jobB: Job = {
      ...jobA,
      version: '2.0.0-relabeled',
    };
    expect(checksumOf(jobA)).toBe(checksumOf(jobB));
    expect(planJobImport({ checksum: checksumOf(jobA) }, checksumOf(jobB))).toBe('unchanged');
  });

  it('produces different checksum when meaningful field changes', () => {
    const jobA = (parseJob(VALID_JOB_INPUT) as { ok: true; job: Job }).job;
    const jobB: Job = {
      ...jobA,
      title: 'Senior Virtual Assistant Specialist',
    };
    expect(checksumOf(jobA)).not.toBe(checksumOf(jobB));
    expect(planJobImport({ checksum: checksumOf(jobA) }, checksumOf(jobB))).toBe('new-version');
  });

  it('plans new-version when there is no current version', () => {
    const jobA = (parseJob(VALID_JOB_INPUT) as { ok: true; job: Job }).job;
    expect(planJobImport(null, checksumOf(jobA))).toBe('new-version');
  });
});

describe('resolveJobStatus', () => {
  const asOf = new Date('2026-11-14T12:00:00.000Z');

  it('resolves active when not withdrawn and expiresAt is in the future', () => {
    expect(
      resolveJobStatus(
        {
          withdrawn: false,
          expiresAt: new Date('2026-12-01T00:00:00.000Z'),
        },
        asOf,
      ),
    ).toBe('active');
  });

  it('resolves expired when expiresAt is equal or earlier than asOf', () => {
    expect(
      resolveJobStatus(
        {
          withdrawn: false,
          expiresAt: new Date('2026-11-14T12:00:00.000Z'),
        },
        asOf,
      ),
    ).toBe('expired');

    expect(
      resolveJobStatus(
        {
          withdrawn: false,
          expiresAt: new Date('2026-11-01T00:00:00.000Z'),
        },
        asOf,
      ),
    ).toBe('expired');
  });

  it('resolves withdrawn whenever withdrawn is true, even if unexpired', () => {
    expect(
      resolveJobStatus(
        {
          withdrawn: true,
          expiresAt: new Date('2026-12-31T00:00:00.000Z'),
        },
        asOf,
      ),
    ).toBe('withdrawn');
  });
});
