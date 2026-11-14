import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, HEALTH_TIMEOUT_MS } from './app.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('App API status', () => {
  it('reports the API as available when /api/health returns ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ status: 'ok' }))),
    );
    render(<App />);

    expect(await screen.findByText('API available')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Service status' }).textContent).toBe(
      'API available',
    );
  });

  it.each([
    // The body would pass validation, so only the HTTP status check can reject it.
    [
      'the API returns an error status',
      () => Promise.resolve(Response.json({ status: 'ok' }, { status: 503 })),
    ],
    ['the request fails', () => Promise.reject(new TypeError('Failed to fetch'))],
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
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
    render(<App />);
    expect(screen.getByRole('status', { name: 'Service status' }).textContent).toBe(
      'Checking the API…',
    );

    await act(() => vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS));

    expect(screen.getByRole('status', { name: 'Service status' }).textContent).toBe(
      'API unavailable',
    );
  });
});

describe('App language', () => {
  it('switches the interface to Amharic without losing an unsent question', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ status: 'ok' }))),
    );
    render(<App />);
    await screen.findByText('API available');
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'ያልተላከ ጥያቄ' } });

    fireEvent.click(screen.getByRole('button', { name: 'አማርኛ' }));

    expect(document.documentElement.lang).toBe('am');
    expect(screen.getByRole('button', { name: 'አማርኛ' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getByLabelText('ጥያቄዎ')).toHaveProperty('value', 'ያልተላከ ጥያቄ');
    expect(screen.getByRole('button', { name: 'ላክ' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'የአገልግሎት ሁኔታ' }).textContent).toBe('ኤፒአዩ ይገኛል');

    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByLabelText('Your question')).toHaveProperty('value', 'ያልተላከ ጥያቄ');
  });

  it('does not rewrite the last announcement when the language changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ status: 'ok' }))),
    );
    render(<App />);
    await screen.findByText('API available');
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const updates = await screen.findByRole('status', { name: 'Conversation updates' });
    await screen.findAllByText(/not a tutor answer/);
    const announced = updates.textContent;

    fireEvent.click(screen.getByRole('button', { name: 'አማርኛ' }));

    // A changed live region would make screen readers read the reply again.
    expect(updates.textContent).toBe(announced);
  });
});
