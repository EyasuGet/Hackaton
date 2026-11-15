import {
  isSchemaOrgJobPosting,
  parseSchemaOrgJobPosting,
  toSchemaOrgJobPosting,
  type SchemaOrgJobPosting,
} from './schema-org-job-posting.ts';
// Approved job domain model and strict validation (T3-019-A).
// Parsing collects every error before returning, ensuring malformed files
// fail visibly without mutating stored data.
import { createHash } from 'node:crypto';

/** Where a job record came from: synthetic demo vacancy, official organiser material, or vetted partner. */
export type JobProvenance =
  | { readonly kind: 'demo'; readonly note: string }
  | {
      readonly kind: 'organiser';
      readonly repository: string;
      readonly commit: string;
      readonly path: string;
      readonly approval: string;
    }
  | {
      readonly kind: 'partner';
      readonly source: string;
      readonly verifiedAt: string;
      readonly note?: string;
      readonly employmentType?: string;
      readonly accessibilityNotes?: string;
    };

export interface Job {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly organization: string;
  readonly category: string;
  readonly location: string;
  readonly description: string;
  readonly sourceUrl: string;
  readonly postedAt: Date;
  readonly expiresAt: Date;
  readonly withdrawn: boolean;
  readonly provenance: JobProvenance;
  readonly employmentType?: string;
  readonly accessibilityNotes?: string;
}

export type JobStatus = 'active' | 'expired' | 'withdrawn';

export interface JobRecord extends Job {
  readonly publicationId: string;
  readonly status: JobStatus;
  readonly isDemo: boolean;
  readonly importedAt: Date;
}

export interface JobFilter {
  readonly status?: JobStatus | 'all';
  readonly category?: string;
  readonly location?: string;
}

export type ParseJobResult =
  | { readonly ok: true; readonly job: Job }
  | { readonly ok: false; readonly errors: readonly string[] };

export type ParseJobFileResult =
  | { readonly ok: true; readonly jobs: readonly Job[] }
  | { readonly ok: false; readonly errors: readonly string[] };

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const URL_PATTERN = /^https?:\/\/\S+$/;
const MAX_TITLE = 200;
const MAX_ORGANIZATION = 200;
const MAX_LOCATION = 200;
const MAX_DESCRIPTION = 20_000;
const MAX_URL = 500;
const MAX_NOTE = 500;
const ID_DESCRIPTION = 'lowercase letters, digits and hyphens';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Checker {
  readonly errors: string[] = [];

  keys(value: Json, path: string, allowed: readonly string[]): void {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        this.errors.push(`${path}.${key} is not a recognised field`);
      }
    }
  }

  text(value: Json, key: string, path: string, max: number): string {
    const field = value[key];
    if (typeof field !== 'string' || !field.trim()) {
      this.errors.push(`${path}.${key} must be a non-empty string`);
      return '';
    }
    if (field.length > max) {
      this.errors.push(`${path}.${key} is longer than ${max} characters`);
    }
    return field.trim();
  }

  matching(value: Json, key: string, path: string, pattern: RegExp, description: string): string {
    const field = value[key];
    if (typeof field !== 'string' || !pattern.test(field)) {
      this.errors.push(`${path}.${key} must be ${description}`);
      return '';
    }
    return field;
  }

  date(value: Json, key: string, path: string): Date | null {
    const field = value[key];
    if (typeof field !== 'string' || !field.trim()) {
      this.errors.push(`${path}.${key} must be a non-empty ISO 8601 date string`);
      return null;
    }
    const timestamp = Date.parse(field);
    if (Number.isNaN(timestamp)) {
      this.errors.push(`${path}.${key} must be a valid ISO 8601 date string`);
      return null;
    }
    return new Date(timestamp);
  }
}

function parseProvenance(check: Checker, value: unknown, path: string): JobProvenance | null {
  if (!isObject(value)) {
    check.errors.push(`${path} must be an object`);
    return null;
  }
  if (value.kind === 'demo') {
    check.keys(value, path, ['kind', 'note']);
    return { kind: 'demo', note: check.text(value, 'note', path, MAX_NOTE) };
  }
  if (value.kind === 'organiser') {
    check.keys(value, path, ['kind', 'repository', 'commit', 'path', 'approval']);
    return {
      kind: 'organiser',
      repository: check.matching(value, 'repository', path, URL_PATTERN, 'an http or https URL'),
      commit: check.matching(
        value,
        'commit',
        path,
        COMMIT_PATTERN,
        'a full 40-character commit hash',
      ),
      path: check.text(value, 'path', path, 300),
      approval: check.text(value, 'approval', path, MAX_NOTE),
    };
  }
  if (value.kind === 'partner') {
    check.keys(value, path, [
      'kind',
      'source',
      'verifiedAt',
      'note',
      'employmentType',
      'accessibilityNotes',
    ]);
    const verifiedAt = check.date(value, 'verifiedAt', path);
    const note = value.note !== undefined ? check.text(value, 'note', path, MAX_NOTE) : undefined;
    const employmentType =
      typeof value.employmentType === 'string' && value.employmentType.trim()
        ? value.employmentType.trim()
        : undefined;
    const accessibilityNotes =
      typeof value.accessibilityNotes === 'string' && value.accessibilityNotes.trim()
        ? value.accessibilityNotes.trim()
        : undefined;
    return {
      kind: 'partner',
      source: check.text(value, 'source', path, 200),
      verifiedAt: verifiedAt ? verifiedAt.toISOString() : '',
      ...(note ? { note } : {}),
      ...(employmentType ? { employmentType } : {}),
      ...(accessibilityNotes ? { accessibilityNotes } : {}),
    };
  }
  check.errors.push(`${path}.kind must be "demo", "organiser" or "partner"`);
  return null;
}

/** Validates one job object. Returns all found errors if invalid. */
export function parseJob(input: unknown, path = 'job'): ParseJobResult {
  if (!isObject(input)) {
    return { ok: false, errors: [`${path} must be a JSON object`] };
  }

  const check = new Checker();
  check.keys(input, path, [
    'id',
    'version',
    'title',
    'organization',
    'category',
    'location',
    'description',
    'sourceUrl',
    'postedAt',
    'expiresAt',
    'withdrawn',
    'provenance',
    'employmentType',
    'accessibilityNotes',
  ]);

  const id = check.matching(input, 'id', path, ID_PATTERN, ID_DESCRIPTION);
  const version = check.text(input, 'version', path, 64);
  const title = check.text(input, 'title', path, MAX_TITLE);
  const organization = check.text(input, 'organization', path, MAX_ORGANIZATION);
  const category = check.matching(input, 'category', path, ID_PATTERN, ID_DESCRIPTION);
  const location = check.text(input, 'location', path, MAX_LOCATION);
  const description = check.text(input, 'description', path, MAX_DESCRIPTION);
  const sourceUrl = check.matching(input, 'sourceUrl', path, URL_PATTERN, 'a valid http(s) URL');
  if (typeof input.sourceUrl === 'string' && input.sourceUrl.length > MAX_URL) {
    check.errors.push(`${path}.sourceUrl is longer than ${MAX_URL} characters`);
  }

  const postedAt = check.date(input, 'postedAt', path);
  const expiresAt = check.date(input, 'expiresAt', path);

  const withdrawnRaw = input.withdrawn ?? false;
  if (typeof withdrawnRaw !== 'boolean') {
    check.errors.push(`${path}.withdrawn must be true or false`);
  }
  const withdrawn = withdrawnRaw === true;

  const provenance = parseProvenance(check, input.provenance, `${path}.provenance`);

  if (check.errors.length > 0 || !postedAt || !expiresAt || !provenance) {
    return { ok: false, errors: check.errors };
  }

  return {
    ok: true,
    job: {
      id,
      version,
      title,
      organization,
      category,
      location,
      description,
      sourceUrl,
      postedAt,
      expiresAt,
      withdrawn,
      provenance,
      ...(typeof input.employmentType === 'string' && input.employmentType.trim()
        ? { employmentType: input.employmentType.trim() }
        : {}),
      ...(typeof input.accessibilityNotes === 'string' && input.accessibilityNotes.trim()
        ? { accessibilityNotes: input.accessibilityNotes.trim() }
        : {}),
    },
  };
}

/**
 * Validates a job input file containing either a single job object,
 * an array of jobs, or an object with a `jobs` array.
 */
export function parseJobFile(input: unknown): ParseJobFileResult {
  const rawList: unknown[] = Array.isArray(input)
    ? input
    : isObject(input) && Array.isArray(input.jobs)
      ? input.jobs
      : isObject(input) && Array.isArray(input['@graph'])
        ? input['@graph']
        : [input];

  if (rawList.length === 0) {
    return { ok: false, errors: ['job file contains no jobs'] };
  }

  const allErrors: string[] = [];
  const parsedJobs: Job[] = [];
  const seenIds = new Set<string>();

  rawList.forEach((item, index) => {
    const path = rawList.length > 1 ? `jobs[${index}]` : 'job';
    const result = isSchemaOrgJobPosting(item)
      ? parseSchemaOrgJobPosting(item, path)
      : parseJob(item, path);
    if (!result.ok) {
      allErrors.push(...result.errors);
    } else {
      if (seenIds.has(result.job.id)) {
        allErrors.push(`${path}.id "${result.job.id}" is duplicated in the same input file`);
      }
      seenIds.add(result.job.id);
      parsedJobs.push(result.job);
    }
  });

  if (allErrors.length > 0) {
    return { ok: false, errors: allErrors };
  }

  return { ok: true, jobs: parsedJobs };
}

/**
 * Deterministic fingerprint of a job's content.
 * The version label is excluded: changing the label without changing content
 * is an idempotent no-op.
 */
export function checksumOf(job: Job): string {
  const canonical = JSON.stringify([
    job.id,
    job.title,
    job.organization,
    job.category,
    job.location,
    job.description,
    job.sourceUrl,
    job.postedAt.toISOString(),
    job.expiresAt.toISOString(),
    job.withdrawn,
    job.provenance,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Determines whether an incoming job version changes stored content. */
export function planJobImport(
  current: { readonly checksum: string } | null,
  incomingChecksum: string,
): 'unchanged' | 'new-version' {
  return current?.checksum === incomingChecksum ? 'unchanged' : 'new-version';
}

/** Resolves the queryable status for a job given a reference time. */
export function resolveJobStatus(
  job: Pick<Job, 'withdrawn' | 'expiresAt'>,
  asOf: Date = new Date(),
): JobStatus {
  if (job.withdrawn) return 'withdrawn';
  return job.expiresAt.getTime() <= asOf.getTime() ? 'expired' : 'active';
}

export {
  isSchemaOrgJobPosting,
  parseSchemaOrgJobPosting,
  toSchemaOrgJobPosting,
  type SchemaOrgJobPosting,
};
