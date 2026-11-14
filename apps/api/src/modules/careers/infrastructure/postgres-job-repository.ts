// PostgreSQL implementation of the JobRepository (T3-019-A).
// Atomic versioning and checksum comparison guarantee idempotent imports,
// preventing duplicate jobs and ensuring stable publication identities.
import type pg from 'pg';
import {
  JobVersionConflictError,
  type JobImportOutcome,
  type JobRepository,
} from '../application/import-jobs.ts';
import {
  planJobImport,
  type Job,
  type JobFilter,
  type JobProvenance,
  type JobRecord,
  type JobStatus,
} from '../domain/job.ts';

interface StoredJobRow {
  id: string;
  publication_id: string;
  version: string;
  title: string;
  organization: string;
  category: string;
  location: string;
  description: string;
  source_url: string;
  posted_at: Date | string;
  expires_at: Date | string;
  withdrawn: boolean;
  is_demo: boolean;
  provenance: JobProvenance;
  imported_at: Date | string;
  status: JobStatus;
}

export class PostgresJobRepository implements JobRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async importJob(job: Job, checksum: string): Promise<JobImportOutcome> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');

      // Ensure root job entry exists with an immutable publication_id.
      await client.query(
        'INSERT INTO jobs (id, publication_id) VALUES ($1, gen_random_uuid()) ON CONFLICT (id) DO NOTHING',
        [job.id],
      );

      // Lock row for update so concurrent imports of the same job sequence cleanly.
      const currentRes = await client.query<{
        publication_id: string;
        current_version_id: string | null;
        version: string | null;
        checksum: string | null;
      }>(
        `SELECT j.publication_id,
                j.current_version_id,
                v.version,
                v.checksum
           FROM jobs j
           LEFT JOIN job_versions v ON v.id = j.current_version_id
          WHERE j.id = $1
          FOR UPDATE OF j`,
        [job.id],
      );

      const current = currentRes.rows[0];
      if (!current) {
        throw new Error(`Failed to initialize job entry for ${job.id}`);
      }

      const isNewPublication = current.current_version_id === null;
      const currentChecksum = current.checksum
        ? { checksum: current.checksum, version: current.version ?? '' }
        : null;

      if (planJobImport(currentChecksum, checksum) === 'unchanged') {
        await client.query('COMMIT');
        return {
          id: job.id,
          status: 'unchanged',
          isNewPublication: false,
          publicationId: current.publication_id,
          version: current.version ?? job.version,
        };
      }

      const versionId = await this.#insertVersion(client, job, checksum);

      await client.query('UPDATE jobs SET current_version_id = $2 WHERE id = $1', [
        job.id,
        versionId,
      ]);

      await client.query('COMMIT');

      if (job.withdrawn) {
        return {
          id: job.id,
          status: 'withdrawn',
          isNewPublication: false,
          publicationId: current.publication_id,
          version: job.version,
        };
      }

      return {
        id: job.id,
        status: isNewPublication ? 'imported' : 'updated',
        isNewPublication,
        publicationId: current.publication_id,
        version: job.version,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getJob(id: string, asOf: Date = new Date()): Promise<JobRecord | null> {
    const result = await this.#pool.query<StoredJobRow>(
      `SELECT j.id,
              j.publication_id,
              v.version,
              v.title,
              v.organization,
              v.category,
              v.location,
              v.description,
              v.source_url,
              v.posted_at,
              v.expires_at,
              v.withdrawn,
              v.is_demo,
              v.provenance,
              v.imported_at,
              CASE
                WHEN v.withdrawn THEN 'withdrawn'
                WHEN v.expires_at <= $2 THEN 'expired'
                ELSE 'active'
              END AS status
         FROM jobs j
         JOIN job_versions v ON v.id = j.current_version_id
        WHERE j.id = $1`,
      [id, asOf],
    );

    const row = result.rows[0];
    if (!row) return null;
    return this.#mapRow(row);
  }

  async listJobs(filter: JobFilter = {}, asOf: Date = new Date()): Promise<JobRecord[]> {
    const clauses: string[] = [];
    const values: unknown[] = [asOf];

    if (filter.status && filter.status !== 'all') {
      values.push(filter.status);
      clauses.push(`
        (CASE
           WHEN v.withdrawn THEN 'withdrawn'
           WHEN v.expires_at <= $1 THEN 'expired'
           ELSE 'active'
         END) = $${values.length}`);
    }

    if (filter.category) {
      values.push(filter.category);
      clauses.push(`v.category = $${values.length}`);
    }

    if (filter.location) {
      values.push(filter.location);
      clauses.push(`v.location = $${values.length}`);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `
      SELECT j.id,
             j.publication_id,
             v.version,
             v.title,
             v.organization,
             v.category,
             v.location,
             v.description,
             v.source_url,
             v.posted_at,
             v.expires_at,
             v.withdrawn,
             v.is_demo,
             v.provenance,
             v.imported_at,
             CASE
               WHEN v.withdrawn THEN 'withdrawn'
               WHEN v.expires_at <= $1 THEN 'expired'
               ELSE 'active'
             END AS status
        FROM jobs j
        JOIN job_versions v ON v.id = j.current_version_id
       ${whereClause}
       ORDER BY v.posted_at DESC, j.id ASC`;

    const result = await this.#pool.query<StoredJobRow>(sql, values);
    return result.rows.map((row) => this.#mapRow(row));
  }

  async getPublicationEvent(
    publicationId: string,
  ): Promise<{ publicationId: string; jobId: string; createdAt: Date } | null> {
    const result = await this.#pool.query<{
      publication_id: string;
      job_id: string;
      created_at: Date | string;
    }>(
      `SELECT publication_id, id AS job_id, created_at
         FROM jobs
        WHERE publication_id = $1`,
      [publicationId],
    );

    const row = result.rows[0];
    if (!row) return null;
    return {
      publicationId: row.publication_id,
      jobId: row.job_id,
      createdAt: new Date(row.created_at),
    };
  }

  async #insertVersion(client: pg.PoolClient, job: Job, checksum: string): Promise<string> {
    try {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO job_versions
           (job_id, version, checksum, title, organization, category, location,
            description, source_url, posted_at, expires_at, withdrawn, is_demo, provenance)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
        [
          job.id,
          job.version,
          checksum,
          job.title,
          job.organization,
          job.category,
          job.location,
          job.description,
          job.sourceUrl,
          job.postedAt,
          job.expiresAt,
          job.withdrawn,
          job.provenance.kind === 'demo',
          job.provenance,
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('INSERT into job_versions returned no row');
      return row.id;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new JobVersionConflictError(job.id, job.version);
      }
      throw error;
    }
  }

  #mapRow(row: StoredJobRow): JobRecord {
    return {
      id: row.id,
      publicationId: row.publication_id,
      version: row.version,
      title: row.title,
      organization: row.organization,
      category: row.category,
      location: row.location,
      description: row.description,
      sourceUrl: row.source_url,
      postedAt: new Date(row.posted_at),
      expiresAt: new Date(row.expires_at),
      withdrawn: row.withdrawn,
      isDemo: row.is_demo,
      provenance: row.provenance,
      importedAt: new Date(row.imported_at),
      status: row.status,
    };
  }
}
