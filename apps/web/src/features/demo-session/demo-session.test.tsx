import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoSession } from './demo-session.tsx';
import { takeHandoffCode } from './session-api.ts';

const TOKEN = 'session-token-value-that-must-stay-in-memory';
const CODE = 'handoff-code-aaaaaaaaaaaaaaaa';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

/** Fake API: answers the exchange with `exchangeStatus`, /api/me for the token, and sign-out with `signOutStatus`. */
function stubApi({ exchangeStatus = 201, signOutStatus = 204 } = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/demo/session' && init?.method === 'POST') {
      return Promise.resolve(
        exchangeStatus === 201
          ? Response.json({ token: TOKEN, expiresAt: '2026-11-14T11:00:00Z' }, { status: 201 })
          : Response.json({ error: 'refused' }, { status: exchangeStatus }),
      );
    }
    if (url === '/api/me') {
      return Promise.resolve(
        Response.json({ label: 'Demo learner A', role: 'learner', demo: true }),
      );
    }
    if (url === '/api/demo/session' && init?.method === 'DELETE') {
      return Promise.resolve(new Response(null, { status: signOutStatus }));
    }
    return Promise.reject(new Error(`Unexpected request ${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const status = () => screen.getByRole('status', { name: 'Sign-in status' });

describe('takeHandoffCode', () => {
  it('returns the code from the fragment and removes it from the address bar', () => {
    window.history.replaceState(null, '', `/?lang=am#handoff=${CODE}`);

    expect(takeHandoffCode()).toBe(CODE);
    expect(window.location.href).not.toContain(CODE);
    expect(window.location.search).toBe('?lang=am');
    expect(takeHandoffCode()).toBeNull();
  });
});

describe('DemoSession', () => {
  it('explains how to sign in when there is no code, without calling the API', () => {
    const fetchMock = stubApi();
    render(<DemoSession handoffCode={null} />);

    expect(status().textContent).toContain('Not signed in');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges the code once, even under StrictMode, and shows the labelled identity', async () => {
    const fetchMock = stubApi();
    const { container } = render(
      <StrictMode>
        <DemoSession handoffCode={CODE} />
      </StrictMode>,
    );

    expect(await screen.findByText(/Signed in as Demo learner A \(learner\)/)).toBeTruthy();
    expect(status().textContent).toContain('not real authentication');
    const exchanges = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(exchanges).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/me', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(container.innerHTML).not.toContain(TOKEN);
  });

  it.each([
    [401, 'invalid, has expired or was already used'],
    [403, 'not allowed to start a demo session'],
  ])('explains a refused exchange (%i)', async (exchangeStatus, message) => {
    stubApi({ exchangeStatus });
    render(<DemoSession handoffCode={CODE} />);

    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('signs out, revokes the token and moves focus to the status message', async () => {
    const fetchMock = stubApi();
    render(<DemoSession handoffCode={CODE} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText(/You have signed out/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/demo/session', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(document.activeElement).toBe(status());
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('stays signed in and says so when sign-out cannot be confirmed', async () => {
    stubApi({ signOutStatus: 503 });
    render(<DemoSession handoffCode={CODE} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect((await screen.findByRole('alert')).textContent).toContain('could not be confirmed');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});
