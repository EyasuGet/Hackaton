import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, HEALTH_TIMEOUT_MS } from './app.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('App API status', () => {
  it('reports the API as available when /api/health returns ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'ok' })));
    render(<App />);

    expect(await screen.findByText('API available')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('API available');
  });

  it.each([
    // The body would pass validation, so only the HTTP status check can reject it.
    ['the API returns an error status', async () => Response.json({ status: 'ok' }, { status: 503 })],
    ['the request fails', async () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('reports the API as unavailable when %s', async (_case, fetchImpl) => {
    vi.stubGlobal('fetch', vi.fn(fetchImpl));
    render(<App />);

    expect(await screen.findByText('API unavailable')).toBeTruthy();
  });

  it('reports the API as unavailable when it does not answer in time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // A hung request that only settles when its signal aborts.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      ),
    );
    render(<App />);
    expect(screen.getByRole('status').textContent).toBe('Checking the API…');

    await act(() => vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS));

    expect(screen.getByRole('status').textContent).toBe('API unavailable');
  });
});
