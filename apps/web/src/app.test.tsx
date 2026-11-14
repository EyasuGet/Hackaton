import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App API status', () => {
  it('reports the API as available when /api/health returns ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'ok' })));
    render(<App />);

    expect(await screen.findByText('API available')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('API available');
  });

  it.each([
    ['the proxy returns an error status', async () => new Response(null, { status: 502 })],
    ['the request fails', async () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('reports the API as unavailable when %s', async (_case, fetchImpl) => {
    vi.stubGlobal('fetch', vi.fn(fetchImpl));
    render(<App />);

    expect(await screen.findByText('API unavailable')).toBeTruthy();
  });
});
