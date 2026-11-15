import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, HEALTH_TIMEOUT_MS } from './app.tsx';

afterEach(() => {
  cleanup();
  localStorage.clear();
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

describe('App offline banner', () => {
  it('shows the offline banner immediately when navigator.onLine is false', () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ status: 'ok' }))),
    );
    render(<App />);
    expect(screen.getByText(/You are offline/i)).toBeTruthy();
  });

  it('does not show the offline banner when navigator.onLine is true', () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ status: 'ok' }))),
    );
    render(<App />);
    expect(screen.queryByText(/You are offline/i)).toBeNull();
  });

  it('shows the offline banner when the offline event fires', () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ status: 'ok' }))),
    );
    render(<App />);
    expect(screen.queryByText(/You are offline/i)).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByText(/You are offline/i)).toBeTruthy();
  });

  it('hides the offline banner when the online event fires', () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ status: 'ok' }))),
    );
    render(<App />);
    expect(screen.getByText(/You are offline/i)).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.queryByText(/You are offline/i)).toBeNull();
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

  it('mirrors the page in Arabic, marks the draft translation and notes the reply language', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ status: 'ok' }))),
    );
    render(<App />);
    await screen.findByText('API available');

    fireEvent.click(screen.getByRole('button', { name: 'العربية' }));

    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('note').textContent).toContain('مسودة');
    fireEvent.change(screen.getByLabelText('سؤالك'), { target: { value: 'Question' } });
    fireEvent.click(screen.getByRole('button', { name: 'إرسال' }));
    expect(await screen.findByText(/الإجابات غير متاحة بلغتك/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(document.documentElement.dir).toBe('ltr');
    expect(screen.queryByText(/not yet available in your language/)).toBeNull();
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

  it('persists selected language preference across page reloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ status: 'ok' }))),
    );

    // Initial session: learner switches to Amharic
    const { unmount } = render(<App />);
    await screen.findByText('API available');
    fireEvent.click(screen.getByRole('button', { name: 'አማርኛ' }));
    expect(document.documentElement.lang).toBe('am');

    // Simulate page reload / remount
    unmount();
    render(<App />);

    expect(document.documentElement.lang).toBe('am');
    expect(screen.getByRole('button', { name: 'አማርኛ' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('App update notification', () => {
  it('renders an accessible update banner when a new version is available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ status: 'ok' }))),
    );

    const postMessage = vi.fn();
    const mockWaitingWorker = {
      state: 'installed',
      postMessage,
      addEventListener: vi.fn(),
    };
    const mockRegistration = {
      waiting: mockWaitingWorker,
      installing: null,
      addEventListener: vi.fn(),
    };

    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      serviceWorker: {
        controller: { state: 'activated' },
        getRegistration: vi.fn().mockResolvedValue(mockRegistration),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    render(<App />);
    await screen.findByText('API available');

    const banner = await screen.findByRole('status', {
      name: /A new version of the app is available/i,
    });
    expect(banner).toBeTruthy();

    const refreshBtn = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refreshBtn);

    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });
});
