// PostgreSQL retrieval over current lesson versions. Method recorded in
// docs/decisions.md (T3-005-B): full-text search with English stemming for
// English sources, prefix matching for Amharic (no Amharic dictionary exists),
// headings weighted above bodies, and any matching term counting (OR).
import type pg from 'pg';
import type { LessonReader } from '../application/content-access.ts';
import type { CitationResult, CitedSection, Passage } from '../domain/retrieval.ts';

// Builds one OR-of-prefixes query per text-search configuration from the
// question's own lexemes, then ranks each section with the query for its language.
const SEARCH = `
WITH queries AS (
  SELECT
    (SELECT to_tsquery('simple', string_agg(quote_literal(lexeme) || ':*', ' | '))
       FROM unnest(to_tsvector('english', $2))) AS english,
    (SELECT to_tsquery('simple', string_agg(quote_literal(lexeme) || ':*', ' | '))
       FROM unnest(to_tsvector('simple', $2))) AS simple
)
SELECT v.source_id, x.section_id, v.title, x.heading, x.body, v.language, v.course_id, v.version,
       ts_rank(d.document, d.query) AS rank
  FROM lesson_sources s
  JOIN lesson_source_versions v ON v.id = s.current_version_id
  JOIN lesson_sections x ON x.version_id = v.id
 CROSS JOIN queries q
 CROSS JOIN LATERAL (
   SELECT
     CASE WHEN v.language = 'en'
       THEN setweight(to_tsvector('english', x.heading), 'A') || setweight(to_tsvector('english', x.body), 'B')
       ELSE setweight(to_tsvector('simple', x.heading), 'A') || setweight(to_tsvector('simple', x.body), 'B')
     END AS document,
     CASE WHEN v.language = 'en' THEN q.english ELSE q.simple END AS query
 ) d
 -- Defence in depth: the importer already gives withdrawn versions no sections.
 WHERE NOT v.withdrawn
   AND v.course_id = ANY($1::text[])
   AND d.query IS NOT NULL
   AND d.document @@ d.query
 ORDER BY rank DESC, v.source_id, x.position
 LIMIT $3`;

interface PassageRow {
  source_id: string;
  section_id: string;
  title: string;
  heading: string;
  body: string;
  language: string;
  course_id: string;
  version: string;
}

function toPassage(row: PassageRow): Passage {
  return {
    sourceId: row.source_id,
    sectionId: row.section_id,
    sourceTitle: row.title,
    heading: row.heading,
    text: row.body,
    language: row.language,
    courseId: row.course_id,
    version: row.version,
  };
}

interface CitationRow extends PassageRow {
  withdrawn: boolean;
  provenance: unknown;
  anchor: string | null;
  section_found: boolean;
}

function toProvenance(value: unknown): CitedSection['provenance'] {
  // Written only by the validated importer; reject anything else rather than display it.
  if (typeof value === 'object' && value !== null && 'kind' in value) {
    if (value.kind === 'demo' && 'note' in value && typeof value.note === 'string') {
      return { kind: 'demo', note: value.note };
    }
    if (
      value.kind === 'organiser' &&
      'repository' in value &&
      typeof value.repository === 'string' &&
      'commit' in value &&
      typeof value.commit === 'string' &&
      'path' in value &&
      typeof value.path === 'string'
    ) {
      return {
        kind: 'organiser',
        repository: value.repository,
        commit: value.commit,
        path: value.path,
      };
    }
  }
  throw new Error('Stored lesson provenance is malformed');
}

export class PostgresLessonReader implements LessonReader {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async search(courseIds: readonly string[], question: string, limit: number): Promise<Passage[]> {
    if (courseIds.length === 0) return [];
    const result = await this.#pool.query<PassageRow>(SEARCH, [courseIds, question, limit]);
    return result.rows.map(toPassage);
  }

  async resolve(
    courseIds: readonly string[],
    sourceId: string,
    sectionId: string,
  ): Promise<CitationResult> {
    // The course check uses the current version, so a source moved out of a
    // granted course stops resolving; withdrawn and removed are only reported
    // to readers who may see the source.
    const result = await this.#pool.query<CitationRow>(
      `SELECT v.source_id, v.title, v.language, v.course_id, v.version, v.withdrawn, v.provenance,
              x.section_id, x.heading, x.body, x.anchor, x.section_id IS NOT NULL AS section_found
         FROM lesson_sources s
         JOIN lesson_source_versions v ON v.id = s.current_version_id
         LEFT JOIN lesson_sections x ON x.version_id = v.id AND x.section_id = $3
        WHERE s.id = $2 AND v.course_id = ANY($1::text[])`,
      [courseIds, sourceId, sectionId],
    );
    const row = result.rows[0];
    if (!row) return { kind: 'not_found' };
    if (row.withdrawn) return { kind: 'unavailable', reason: 'withdrawn' };
    if (!row.section_found) return { kind: 'unavailable', reason: 'removed' };
    return {
      kind: 'section',
      section: { ...toPassage(row), anchor: row.anchor, provenance: toProvenance(row.provenance) },
    };
  }
}
