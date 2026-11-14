// Creates the shared PostgreSQL connection pool for the API process.
import pg from 'pg';
import type { DatabaseConfig } from '../../bootstrap/config.ts';

/**
 * Connection attempts fail fast so readiness answers promptly while the
 * database is down; the pool reconnects on later queries once it recovers.
 */
export function createPool(config: DatabaseConfig, onIdleError: (error: Error) => void): pg.Pool {
  const pool = new pg.Pool({ ...config, connectionTimeoutMillis: 2000 });
  // Without a listener, an idle client dropped by a database restart crashes the process.
  pool.on('error', onIdleError);
  return pool;
}
