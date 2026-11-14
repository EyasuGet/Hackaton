import { describe, expect, it } from 'vitest';
import type { Readiness } from '../infrastructure/database/migrations.ts';
import { buildApp } from './app.ts';

function appWithReadiness(readiness: Readiness) {
  return buildApp({ checkReadiness: () => Promise.resolve(readiness) });
}

describe('GET /api/health', () => {
  it('reports the API as available even when the database is not', async () => {
    const app = appWithReadiness({ ready: false, reason: 'database_unavailable' });
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /api/ready', () => {
  it('returns 200 when ready', async () => {
    const app = appWithReadiness({ ready: true });
    const response = await app.inject({ method: 'GET', url: '/api/ready' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready' });
  });

  it.each(['database_unavailable', 'migrations_pending'] as const)(
    'returns 503 with reason %s when not ready',
    async (reason) => {
      const app = appWithReadiness({ ready: false, reason });
      const response = await app.inject({ method: 'GET', url: '/api/ready' });
      await app.close();

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'not_ready', reason });
    },
  );
});
