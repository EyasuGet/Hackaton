// FIXTURE ONLY: PostgreSQL storage and seeding for the synthetic demo records.
import type pg from 'pg';
import type { OwnedScope } from '../identity/domain/principal.ts';
import type { DemoRecord, DemoRecordRepository } from './demo-records.ts';

// The scope condition shared by list and single-record reads, so both enforce one rule.
const IN_SCOPE = 'owner_id = $1 AND course_id = ANY($2::text[])';

interface RecordRow {
  id: string;
  course_id: string;
  body: string;
}

function toRecord(row: RecordRow): DemoRecord {
  return { id: row.id, courseId: row.course_id, body: row.body };
}

export class PostgresDemoRecordRepository implements DemoRecordRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async list(scope: OwnedScope): Promise<DemoRecord[]> {
    const result = await this.#pool.query<RecordRow>(
      `SELECT id, course_id, body FROM demo_records WHERE ${IN_SCOPE} ORDER BY course_id, id`,
      [scope.ownerId, scope.courseIds],
    );
    return result.rows.map(toRecord);
  }

  async find(id: string, scope: OwnedScope): Promise<DemoRecord | null> {
    const result = await this.#pool.query<RecordRow>(
      `SELECT id, course_id, body FROM demo_records WHERE ${IN_SCOPE} AND id = $3`,
      [scope.ownerId, scope.courseIds, id],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }
}

/**
 * Learner A also owns a course-2 record without a course-2 grant, so ownership
 * alone must not be enough to read it.
 */
const DEMO_RECORDS = [
  {
    key: 'a-course-1',
    owner: 'learner-a',
    courseId: 'course-1',
    body: 'Synthetic note: A, course 1',
  },
  {
    key: 'a-course-2',
    owner: 'learner-a',
    courseId: 'course-2',
    body: 'Synthetic note: A, course 2',
  },
  {
    key: 'b-course-1',
    owner: 'learner-b',
    courseId: 'course-1',
    body: 'Synthetic note: B, course 1',
  },
  {
    key: 'b-course-2',
    owner: 'learner-b',
    courseId: 'course-2',
    body: 'Synthetic note: B, course 2',
  },
] as const satisfies readonly {
  key: string;
  // Demo principal key; checked against the provisioned ids when seeding, so this
  // fixture does not depend on identity's infrastructure types.
  owner: string;
  courseId: string;
  body: string;
}[];

/** Creates or refreshes the fixture records; run in the provisioning transaction. */
export async function seedDemoRecords(
  client: pg.ClientBase,
  principalIds: ReadonlyMap<string, string>,
): Promise<void> {
  for (const record of DEMO_RECORDS) {
    const ownerId = principalIds.get(record.owner);
    if (!ownerId) throw new Error(`Demo principal ${record.owner} was not provisioned`);
    await client.query(
      `INSERT INTO demo_records (demo_key, owner_id, course_id, body) VALUES ($1, $2, $3, $4)
       ON CONFLICT (demo_key) DO UPDATE
         SET owner_id = EXCLUDED.owner_id, course_id = EXCLUDED.course_id, body = EXCLUDED.body`,
      [record.key, ownerId, record.courseId, record.body],
    );
  }
}
