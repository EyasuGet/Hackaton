// PostgreSQL storage for principals and their course grants, plus provisioning
// of the synthetic demo identities.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { digestToken } from '../application/resolve-principal.ts';
import type { PrincipalRepository } from '../application/principal-repository.ts';
import type { Principal, Role } from '../domain/principal.ts';

interface PrincipalRow {
  id: string;
  role: string;
  label: string;
  course_ids: string[];
}

function toRole(value: string): Role {
  // The table's CHECK constraint guarantees this; fail loudly if it is ever bypassed.
  if (value !== 'learner' && value !== 'support') throw new Error('Unknown principal role');
  return value;
}

export class PostgresPrincipalRepository implements PrincipalRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async findDemoByTokenDigest(digest: string): Promise<Principal | null> {
    // `is_demo` is checked here as well as by the table constraint, so a demo
    // token can never resolve to a real principal.
    const result = await this.#pool.query<PrincipalRow>(
      `SELECT p.id, p.role, p.label,
              coalesce(array_agg(g.course_id ORDER BY g.course_id)
                       FILTER (WHERE g.course_id IS NOT NULL), '{}') AS course_ids
         FROM principals p
         LEFT JOIN course_grants g ON g.principal_id = p.id
        WHERE p.token_digest = $1 AND p.is_demo
        GROUP BY p.id`,
      [digest],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      role: toRole(row.role),
      label: row.label,
      demo: true,
      courseIds: row.course_ids,
    };
  }
}

/** Synthetic identities only: no real names, contact details or captured host data. */
export const DEMO_PRINCIPALS = [
  { key: 'learner-a', role: 'learner', label: 'Demo learner A', courseIds: ['course-1'] },
  {
    key: 'learner-b',
    role: 'learner',
    label: 'Demo learner B',
    courseIds: ['course-1', 'course-2'],
  },
  { key: 'support', role: 'support', label: 'Demo support person', courseIds: [] },
] as const satisfies readonly {
  key: string;
  role: Role;
  label: string;
  courseIds: readonly string[];
}[];

export type DemoPrincipalKey = (typeof DEMO_PRINCIPALS)[number]['key'];

export interface DemoCredential {
  readonly key: DemoPrincipalKey;
  readonly id: string;
  readonly role: Role;
  readonly label: string;
  /** Shown once to the operator; only its digest is stored. */
  readonly token: string;
}

/**
 * Creates or refreshes the demo principals and their grants on the caller's
 * client (run it inside a transaction). Every run issues new tokens, so earlier
 * tokens stop working.
 */
export async function provisionDemoPrincipals(client: pg.ClientBase): Promise<DemoCredential[]> {
  const credentials: DemoCredential[] = [];
  for (const principal of DEMO_PRINCIPALS) {
    const token = randomBytes(32).toString('base64url');
    const result = await client.query<{ id: string }>(
      `INSERT INTO principals (demo_key, role, label, is_demo, token_digest)
       VALUES ($1, $2, $3, true, $4)
       ON CONFLICT (demo_key) DO UPDATE
         SET role = EXCLUDED.role, label = EXCLUDED.label, token_digest = EXCLUDED.token_digest
       RETURNING id`,
      [principal.key, principal.role, principal.label, digestToken(token)],
    );
    const id = result.rows[0]!.id; // INSERT … RETURNING always yields one row.
    // Grants are replaced, not merged, so the fixture definition stays authoritative.
    await client.query('DELETE FROM course_grants WHERE principal_id = $1', [id]);
    await client.query(
      'INSERT INTO course_grants (principal_id, course_id) SELECT $1, unnest($2::text[])',
      [id, principal.courseIds],
    );
    credentials.push({
      key: principal.key,
      id,
      role: principal.role,
      label: principal.label,
      token,
    });
  }
  return credentials;
}
