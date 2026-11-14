import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

describe('GET /api/health', () => {
  const app = buildApp();
  afterEach(() => app.close());

  it('reports the API as available', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
