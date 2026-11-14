import { describe, expect, it } from 'vitest';
import type { Readiness } from '../infrastructure/database/migrations.ts';
import { DemoRecords } from '../modules/demo-records/demo-records.ts';
import { DemoSessions } from '../modules/identity/application/demo-sessions.ts';
import type { PrincipalRepository } from '../modules/identity/application/principal-repository.ts';
import { ResolvePrincipal } from '../modules/identity/application/resolve-principal.ts';
import { buildApp } from './app.ts';

const noPrincipals: PrincipalRepository = { findDemoByTokenDigest: () => Promise.resolve(null) };
const noRecords = new DemoRecords({
  list: () => Promise.resolve([]),
  find: () => Promise.resolve(null),
});

function appWith(
  readiness: Readiness = { ready: true },
  principals: PrincipalRepository = noPrincipals,
) {
  return buildApp({
    checkReadiness: () => Promise.resolve(readiness),
    resolvePrincipal: new ResolvePrincipal(principals, true),
    demoRecords: noRecords,
    demoSessions: new DemoSessions(
      {
        createHandoff: () => Promise.resolve(false),
        consumeHandoff: () => Promise.resolve(null),
        createSession: () => Promise.resolve(),
        revokeSession: () => Promise.resolve(false),
      },
      true,
    ),
    demoAllowedOrigins: [],
  });
}

describe('GET /api/health', () => {
  it('reports the API as available even when the database is not', async () => {
    const app = appWith({ ready: false, reason: 'database_unavailable' });
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /api/ready', () => {
  it('returns 200 when ready', async () => {
    const app = appWith({ ready: true });
    const response = await app.inject({ method: 'GET', url: '/api/ready' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready' });
  });

  it.each(['database_unavailable', 'migrations_pending'] as const)(
    'returns 503 with reason %s when not ready',
    async (reason) => {
      const app = appWith({ ready: false, reason });
      const response = await app.inject({ method: 'GET', url: '/api/ready' });
      await app.close();

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'not_ready', reason });
    },
  );
});

describe('unexpected errors', () => {
  it('return a fixed 500 body without the underlying error message', async () => {
    // A driver error can name the database user or host; it must not reach the client.
    const failing: PrincipalRepository = {
      findDemoByTokenDigest: () =>
        Promise.reject(new Error('password authentication failed for user "track3"')),
    };
    const app = appWith({ ready: true }, failing);
    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${'a'.repeat(43)}` },
    });
    await app.close();

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal' });
  });
});
