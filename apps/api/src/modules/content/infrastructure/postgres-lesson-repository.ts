// PostgreSQL storage for imported lesson versions.
import type pg from 'pg';
import {
  VersionConflictError,
  type ImportOutcome,
  type LessonRepository,
} from '../application/import-lesson-source.ts';
import { planImport, type LessonSource } from '../domain/lesson-source.ts';

export class PostgresLessonRepository implements LessonRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async importVersion(source: LessonSource, checksum: string): Promise<ImportOutcome> {
    const client = await this.#pool.connect();
    try {
      // The new version, its sections and the current-version switch commit
      // together: a failure anywhere leaves the previous version authoritative.
      await client.query('BEGIN');
      await client.query('INSERT INTO lesson_sources (id) VALUES ($1) ON CONFLICT DO NOTHING', [
        source.sourceId,
      ]);
      // Imports are operator-run, so no lock is taken: if two runs race, the
      // unique (source_id, version) constraint still stops a duplicate version.
      const current = await client.query<{ version: string; checksum: string }>(
        `SELECT v.version, v.checksum
           FROM lesson_sources s
           LEFT JOIN lesson_source_versions v ON v.id = s.current_version_id
          WHERE s.id = $1`,
        [source.sourceId],
      );
      const row = current.rows[0];
      const currentVersion = row?.checksum
        ? { version: row.version, checksum: row.checksum }
        : null;

      if (planImport(currentVersion, checksum) === 'unchanged') {
        await client.query('COMMIT');
        // Report the stored label: identical content may arrive under another one.
        return { status: 'unchanged', version: currentVersion?.version ?? source.version };
      }

      const versionId = await this.#insertVersion(client, source, checksum);
      await client.query(
        `INSERT INTO lesson_sections (version_id, section_id, position, anchor, heading, body)
         SELECT $1, s.id, s.position, s.anchor, s.heading, s.body
           FROM unnest($2::text[], $3::int[], $4::text[], $5::text[], $6::text[])
             AS s(id, position, anchor, heading, body)`,
        [
          versionId,
          source.sections.map((s) => s.id),
          source.sections.map((_s, index) => index),
          source.sections.map((s) => s.anchor),
          source.sections.map((s) => s.heading),
          source.sections.map((s) => s.text),
        ],
      );
      await client.query('UPDATE lesson_sources SET current_version_id = $2 WHERE id = $1', [
        source.sourceId,
        versionId,
      ]);
      await client.query('COMMIT');

      return source.withdrawn
        ? { status: 'withdrawn', version: source.version }
        : { status: 'imported', version: source.version, sections: source.sections.length };
    } catch (error) {
      // Report the import failure, not a secondary rollback failure on a dead connection.
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async #insertVersion(client: pg.PoolClient, source: LessonSource, checksum: string) {
    try {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO lesson_source_versions
           (source_id, version, checksum, title, course_id, language, is_demo, provenance, withdrawn)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          source.sourceId,
          source.version,
          checksum,
          source.title,
          source.courseId,
          source.language,
          source.provenance.kind === 'demo',
          source.provenance,
          source.withdrawn,
        ],
      );
      return inserted.rows[0]!.id; // INSERT … RETURNING always yields one row.
    } catch (error) {
      // 23505 = unique_violation on (source_id, version): the label already names
      // another stored version (content identical to the current one returned above).
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new VersionConflictError(source.sourceId, source.version);
      }
      throw error;
    }
  }
}
