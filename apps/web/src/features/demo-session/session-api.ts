// Browser side of the synthetic demo-session contract (T3-004-C). The session
// token is returned to the caller to keep in memory only: never in storage,
// cookies, URLs or the DOM.

export interface DemoIdentity {
  readonly label: string;
  readonly role: string;
}

export type ExchangeResult =
  | {
      readonly kind: 'session';
      readonly token: string;
      readonly expiresAt: Date;
      readonly identity: DemoIdentity;
    }
  | { readonly kind: 'invalid' | 'origin' | 'failed' };

/**
 * Reads the one-time code from the `#handoff=` fragment — never sent to servers,
 * so it stays out of access logs — and removes it from the address bar and history entry.
 */
export function takeHandoffCode(): string | null {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const code = fragment.get('handoff');
  if (code === null) return null;
  fragment.delete('handoff');
  url.hash = fragment.toString();
  window.history.replaceState(window.history.state, '', url);
  return code;
}

/**
 * The server's expiry as a deadline on this device's clock, measured from the
 * response's Date header, so a phone with a wrong clock still warns on time.
 */
function localDeadline(response: Response, expiresAt: string): Date {
  const serverNow = Date.parse(response.headers.get('date') ?? '');
  const remaining = Date.parse(expiresAt) - (Number.isNaN(serverNow) ? Date.now() : serverNow);
  return new Date(Date.now() + remaining);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Trades a handoff code for a session, then reads who it belongs to. Never rejects. */
export async function exchangeHandoff(code: string): Promise<ExchangeResult> {
  try {
    const response = await fetch('/api/demo/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (response.status === 401 || response.status === 400) return { kind: 'invalid' };
    if (response.status === 403) return { kind: 'origin' };
    const body: unknown = await response.json();
    if (
      !response.ok ||
      !isRecord(body) ||
      typeof body.token !== 'string' ||
      typeof body.expiresAt !== 'string'
    )
      return { kind: 'failed' };

    const me = await fetch('/api/me', { headers: { authorization: `Bearer ${body.token}` } });
    const identity: unknown = await me.json();
    if (!me.ok || !isRecord(identity)) return { kind: 'failed' };
    const { label, role } = identity;
    if (typeof label !== 'string' || typeof role !== 'string') return { kind: 'failed' };
    return {
      kind: 'session',
      token: body.token,
      expiresAt: localDeadline(response, body.expiresAt),
      identity: { label, role },
    };
  } catch {
    return { kind: 'failed' };
  }
}

/** Gives the session a fresh lifetime. Resolves its new local deadline, or null if it has ended. */
export async function extendSession(token: string): Promise<Date | null> {
  try {
    const response = await fetch('/api/demo/session/extend', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    const body: unknown = await response.json();
    if (!response.ok || !isRecord(body) || typeof body.expiresAt !== 'string') return null;
    return localDeadline(response, body.expiresAt);
  } catch {
    return null;
  }
}

/** Revokes the session on the server. Resolves false if that could not be confirmed. */
export async function signOut(token: string): Promise<boolean> {
  try {
    const response = await fetch('/api/demo/session', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}
