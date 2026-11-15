// Real-PostgreSQL checks for the migration runner and readiness. Each run
// creates and drops its own database, so it never touches development data.
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from '../../bootstrap/config.ts';
import { createPool } from './connection.ts';
import { checkReadiness, loadMigrations, migrate, type Migration } from './migrations.ts';

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_${randomUUID().replaceAll('-', '')}`;
let admin: pg.Pool;
let pool: pg.Pool;
let dir: URL;

async function writeMigrations(files: Record<string, string>): Promise<Migration[]> {
  for (const [name, sql] of Object.entries(files)) await writeFile(new URL(name, dir), sql);
  return loadMigrations(dir);
}

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin?.end();
});

beforeEach(async () => {
  dir = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'migrations-'))}/`);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const FIXTURES = {
  '0001_create_notes.sql': 'CREATE TABLE notes (id serial PRIMARY KEY, body text NOT NULL);',
  '0002_seed_note.sql': "INSERT INTO notes (body) VALUES ('first');",
};

describe('migrate', () => {
  it('migrates a fresh database and is a no-op when run again', async () => {
    const migrations = await writeMigrations(FIXTURES);
    expect(await checkReadiness(pool, migrations)).toEqual({
      ready: false,
      reason: 'migrations_pending',
    });

    expect(await migrate(pool, migrations)).toEqual([
      '0001_create_notes.sql',
      '0002_seed_note.sql',
    ]);
    expect(await migrate(pool, migrations)).toEqual([]);

    const notes = await pool.query('SELECT body FROM notes');
    expect(notes.rows).toEqual([{ body: 'first' }]);
    expect(await checkReadiness(pool, migrations)).toEqual({ ready: true });
  });

  it('reports a newly added migration as pending until applied', async () => {
    await migrate(
      pool,
      await writeMigrations({ '0001_create_notes.sql': FIXTURES['0001_create_notes.sql'] }),
    );
    const migrations = await writeMigrations({
      '0002_seed_note.sql': FIXTURES['0002_seed_note.sql'],
    });

    expect(await checkReadiness(pool, migrations)).toEqual({
      ready: false,
      reason: 'migrations_pending',
    });
    expect(await migrate(pool, migrations)).toEqual(['0002_seed_note.sql']);
    expect(await checkReadiness(pool, migrations)).toEqual({ ready: true });
  });

  it('applies each migration once when runners race', async () => {
    const migrations = await writeMigrations(FIXTURES);

    const results = await Promise.all([migrate(pool, migrations), migrate(pool, migrations)]);

    expect(results.flat().sort()).toEqual(['0001_create_notes.sql', '0002_seed_note.sql']);
    expect((await pool.query('SELECT count(*)::int AS n FROM notes')).rows[0]).toEqual({ n: 1 });
  });

  it('rolls back a migration whose history record cannot be written', async () => {
    // The SQL itself succeeds but makes recording it fail, so only the shared
    // transaction can undo the schema change.
    const migrations = await writeMigrations({
      '0001_create_notes.sql': FIXTURES['0001_create_notes.sql'],
      '0002_unrecordable.sql':
        'CREATE TABLE partial (id int); ALTER TABLE schema_migrations ADD CONSTRAINT reject_history CHECK (false) NOT VALID;',
    });

    await expect(migrate(pool, migrations)).rejects.toThrow('reject_history');

    const tables = await pool.query("SELECT to_regclass('partial') AS partial");
    expect(tables.rows[0]).toEqual({ partial: null });
    const history = await pool.query('SELECT name FROM schema_migrations');
    expect(history.rows).toEqual([{ name: '0001_create_notes.sql' }]);
  });

  it('refuses to continue when an applied migration was edited', async () => {
    await migrate(pool, await writeMigrations(FIXTURES));
    const edited = await writeMigrations({
      '0002_seed_note.sql': "INSERT INTO notes (body) VALUES ('edited');",
    });

    await expect(migrate(pool, edited)).rejects.toThrow('0002_seed_note.sql was modified');
  });

  it('accepts the recorded earlier version of 0008 and still refuses other edits to it', async () => {
    // A database that ran the in-place edit of 0008 (6721457) before it was restored.
    const name = '0008_tutoring_expiry.sql';
    const restored = await writeMigrations({ [name]: 'SELECT 1;' });
    await migrate(pool, []);
    const record = 'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)';
    const superseded = '9adfa1cfa1d09a5858b29eb5aaa16d426feff58936f2dcc14b1d46cf85909747';
    await pool.query(record, [name, superseded]);
    expect(await migrate(pool, restored)).toEqual([]);

    await pool.query('UPDATE schema_migrations SET checksum = $1 WHERE name = $2', ['other', name]);
    await expect(migrate(pool, restored)).rejects.toThrow(`${name} was modified`);
  });
});

describe('checkReadiness', () => {
  it('recovers on the same pool after its database connections are dropped', async () => {
    const migrations = await writeMigrations(FIXTURES);
    await migrate(pool, migrations);
    let dropped = 0;
    let expectedDrops = Infinity;
    let allDropped = () => {};
    const observedDrops = new Promise<void>((resolve) => (allDropped = resolve));
    const restartPool = createPool({ ...config, database: testDatabase }, () => {
      if (++dropped === expectedDrops) allDropped();
    });
    try {
      expect(await checkReadiness(restartPool, migrations)).toEqual({ ready: true });
      expectedDrops = restartPool.idleCount;

      // Simulates a database restart: the server terminates every session the pool holds.
      // Waiting for the pool to observe each drop mirrors a real outage, where the
      // database is down long enough for idle connections to be discarded first.
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
        [testDatabase],
      );
      await observedDrops;

      expect(await checkReadiness(restartPool, migrations)).toEqual({ ready: true });
    } finally {
      await restartPool.end();
    }
  });

  it('reports the database as unavailable when it cannot be reached', async () => {
    // Port 1 is reserved and closed, so the connection is refused immediately.
    const unreachable = createPool({ ...config, port: 1 }, () => {});
    try {
      expect(await checkReadiness(unreachable, [])).toEqual({
        ready: false,
        reason: 'database_unavailable',
      });
    } finally {
      await unreachable.end();
    }
  });
});
