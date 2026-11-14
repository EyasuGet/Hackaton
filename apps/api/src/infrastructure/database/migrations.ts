// Applies ordered SQL migrations and reports whether the schema is current.
// Files named NNNN_description.sql run in lexical order, each in its own
// transaction, and are recorded with a checksum so an already-applied file
// cannot be silently edited.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type pg from 'pg';

export interface Migration {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

/** Shipped migrations; the path resolves the same from src/ and the compiled dist/. */
export const MIGRATIONS_DIR = new URL(
  '../../../src/infrastructure/database/migrations/',
  import.meta.url,
);

// Arbitrary constant identifying this application's migration lock.
const MIGRATION_LOCK_ID = 7_301_001;

const CREATE_HISTORY_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

export async function loadMigrations(dir: URL): Promise<Migration[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(new URL(name, dir), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

async function appliedChecksums(client: pg.ClientBase): Promise<Map<string, string>> {
  const result = await client.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM schema_migrations',
  );
  return new Map(result.rows.map((row) => [row.name, row.checksum]));
}

/** Applies pending migrations; safe to run repeatedly and from concurrent processes. */
export async function migrate(pool: pg.Pool, migrations: readonly Migration[]): Promise<string[]> {
  const client = await pool.connect();
  try {
    // Session lock: a second runner waits instead of applying the same file twice.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(CREATE_HISTORY_TABLE);
    const applied = await appliedChecksums(client);
    const newlyApplied: string[] = [];

    for (const migration of migrations) {
      const checksum = applied.get(migration.name);
      if (checksum !== undefined) {
        if (checksum !== migration.checksum) {
          throw new Error(
            `Applied migration ${migration.name} was modified; add a new migration instead`,
          );
        }
        continue;
      }
      // The schema change and its history row commit together or not at all.
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        // Report the migration failure, not a secondary rollback failure on a dead connection.
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
      newlyApplied.push(migration.name);
    }
    return newlyApplied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

export type Readiness =
  | { readonly ready: true }
  | { readonly ready: false; readonly reason: 'database_unavailable' | 'migrations_pending' };

/** Ready only when the database answers and every shipped migration has been applied. */
export async function checkReadiness(
  pool: pg.Pool,
  migrations: readonly Migration[],
): Promise<Readiness> {
  let applied: Set<string>;
  try {
    const result = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
    applied = new Set(result.rows.map((row) => row.name));
  } catch (error) {
    // 42P01 = undefined_table: a fresh database is reachable but not yet migrated.
    const undefinedTable = error instanceof Error && 'code' in error && error.code === '42P01';
    return { ready: false, reason: undefinedTable ? 'migrations_pending' : 'database_unavailable' };
  }
  const pending = migrations.some((migration) => !applied.has(migration.name));
  return pending ? { ready: false, reason: 'migrations_pending' } : { ready: true };
}
