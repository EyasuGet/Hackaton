// Application use case for importing approved career records (T3-019-A).
// Validates all incoming records before executing storage operations,
// preventing partial corruption or invalid records from entering the database.
import {
  checksumOf,
  parseJobFile,
  type Job,
  type JobFilter,
  type JobRecord,
} from '../domain/job.ts';

export type JobImportOutcome = {
  readonly id: string;
  readonly status: 'imported' | 'updated' | 'withdrawn' | 'unchanged';
  readonly isNewPublication: boolean;
  readonly publicationId: string;
  readonly version: string;
};

export interface JobRepository {
  /**
   * Imports or updates a job version atomically.
   * - If content checksum matches current version: returns 'unchanged'.
   * - If version label was already used for a different content version: throws JobVersionConflictError.
   * - If job is new: creates job with stable publicationId and records 'imported'.
   * - If job exists and content differs: updates current version and records 'updated' (or 'withdrawn').
   */
  importJob(job: Job, checksum: string): Promise<JobImportOutcome>;

  /** Retrieves the current authoritative version of a job, resolving status relative to asOf. */
  getJob(id: string, asOf?: Date): Promise<JobRecord | null>;

  /** Lists current authoritative jobs matching the given filter criteria. */
  listJobs(filter?: JobFilter, asOf?: Date): Promise<JobRecord[]>;

  /** Retrieves the publication identity record if present. */
  getPublicationEvent(
    publicationId: string,
  ): Promise<{ publicationId: string; jobId: string; createdAt: Date } | null>;
}

export class InvalidJobError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid job record: ${problems.join('; ')}`);
    this.problems = problems;
  }
}

export class JobVersionConflictError extends Error {
  constructor(jobId: string, version: string) {
    super(
      `Version "${version}" of job "${jobId}" is already used by another stored version; use a new version label`,
    );
  }
}

export class ImportJobs {
  readonly #repository: JobRepository;

  constructor(repository: JobRepository) {
    this.#repository = repository;
  }

  /**
   * Validates and imports one or more jobs.
   * @throws InvalidJobError before touching storage if any record is invalid.
   */
  async execute(input: unknown): Promise<JobImportOutcome[]> {
    const parsed = parseJobFile(input);
    if (!parsed.ok) {
      throw new InvalidJobError(parsed.errors);
    }

    const outcomes: JobImportOutcome[] = [];
    for (const job of parsed.jobs) {
      const outcome = await this.#repository.importJob(job, checksumOf(job));
      outcomes.push(outcome);
    }
    return outcomes;
  }
}
