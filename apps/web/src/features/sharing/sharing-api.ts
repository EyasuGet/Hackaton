// Browser API client for screen sharing signalling sessions (T3-018-A / T3-018-B).
// Connects browser capture using the validated signalling path with session lifecycle guards.

export type SharingSessionState = 'pending' | 'active' | 'revoked' | 'expired';

export interface SharingSession {
  readonly id: string;
  readonly helpRequestId: string;
  readonly learnerId: string;
  readonly supportId: string;
  readonly state: SharingSessionState;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

export type SignalType = 'offer' | 'answer' | 'ice-candidate';

export interface SharingSignal {
  readonly id: string;
  readonly sessionId: string;
  readonly senderId: string;
  readonly type: SignalType;
  readonly payload: unknown;
  readonly createdAt: string;
}

export interface IceServerConfig {
  readonly urls: string | readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

export type SharingResult<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'not_found' | 'forbidden' | 'failed' }
  | { readonly kind: 'invalid_state'; readonly state?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseSession(raw: unknown): SharingSession | null {
  const r = isRecord(raw) ? raw : null;
  if (
    !r ||
    typeof r.id !== 'string' ||
    typeof r.helpRequestId !== 'string' ||
    typeof r.learnerId !== 'string' ||
    typeof r.supportId !== 'string' ||
    (r.state !== 'pending' &&
      r.state !== 'active' &&
      r.state !== 'revoked' &&
      r.state !== 'expired') ||
    typeof r.createdAt !== 'string' ||
    typeof r.expiresAt !== 'string'
  ) {
    return null;
  }
  return {
    id: r.id,
    helpRequestId: r.helpRequestId,
    learnerId: r.learnerId,
    supportId: r.supportId,
    state: r.state,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    revokedAt: typeof r.revokedAt === 'string' ? r.revokedAt : null,
  };
}

function parseSignal(raw: unknown): SharingSignal | null {
  const r = isRecord(raw) ? raw : null;
  if (
    !r ||
    typeof r.id !== 'string' ||
    typeof r.sessionId !== 'string' ||
    typeof r.senderId !== 'string' ||
    (r.type !== 'offer' && r.type !== 'answer' && r.type !== 'ice-candidate') ||
    r.payload === undefined ||
    typeof r.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id: r.id,
    sessionId: r.sessionId,
    senderId: r.senderId,
    type: r.type,
    payload: r.payload,
    createdAt: r.createdAt,
  };
}

export async function initiateSharingSession(
  token: string,
  helpRequestId: string,
): Promise<SharingResult<SharingSession>> {
  try {
    const response = await fetch('/api/sharing/sessions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ helpRequestId }),
    });
    if (response.status === 404) return { kind: 'not_found' };
    if (response.status === 401 || response.status === 403) return { kind: 'forbidden' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body)) return { kind: 'failed' };
    const session = parseSession(body.session);
    return session ? { kind: 'ok', value: session } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

export async function getSharingSessionByHelpRequest(
  token: string,
  helpRequestId: string,
): Promise<SharingResult<SharingSession>> {
  try {
    const response = await fetch(`/api/sharing/sessions/by-request/${helpRequestId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 404) return { kind: 'not_found' };
    if (response.status === 401 || response.status === 403) return { kind: 'forbidden' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body)) return { kind: 'failed' };
    const session = parseSession(body.session);
    return session ? { kind: 'ok', value: session } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

export async function joinSharingSession(
  token: string,
  sessionId: string,
): Promise<SharingResult<SharingSession>> {
  try {
    const response = await fetch(`/api/sharing/sessions/${sessionId}/join`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 404) return { kind: 'not_found' };
    if (response.status === 401 || response.status === 403) return { kind: 'forbidden' };
    if (response.status === 409) {
      const body: unknown = await response.json();
      const state = isRecord(body) && typeof body.state === 'string' ? body.state : undefined;
      return state !== undefined ? { kind: 'invalid_state', state } : { kind: 'invalid_state' };
    }
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body)) return { kind: 'failed' };
    const session = parseSession(body.session);
    return session ? { kind: 'ok', value: session } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

export async function revokeSharingSession(
  token: string,
  sessionId: string,
): Promise<SharingResult<SharingSession>> {
  try {
    const response = await fetch(`/api/sharing/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 404) return { kind: 'not_found' };
    if (response.status === 401 || response.status === 403) return { kind: 'forbidden' };
    if (response.status === 409) return { kind: 'invalid_state' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body)) return { kind: 'failed' };
    const session = parseSession(body.session);
    return session ? { kind: 'ok', value: session } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

export async function getIceServers(
  token: string,
  sessionId: string,
): Promise<SharingResult<readonly IceServerConfig[]>> {
  try {
    const response = await fetch(`/api/sharing/sessions/${sessionId}/ice-servers`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 404) return { kind: 'not_found' };
    if (response.status === 401 || response.status === 403) return { kind: 'forbidden' };
    if (response.status === 409) return { kind: 'invalid_state' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.iceServers)) return { kind: 'failed' };
    return { kind: 'ok', value: body.iceServers as IceServerConfig[] };
  } catch {
    return { kind: 'failed' };
  }
}

export async function sendSignal(
  token: string,
  sessionId: string,
  type: SignalType,
  payload: unknown,
): Promise<SharingResult<SharingSignal>> {
  try {
    const response = await fetch(`/api/sharing/sessions/${sessionId}/signals`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ type, payload }),
    });
    if (response.status === 404) return { kind: 'not_found' };
    if (response.status === 401 || response.status === 403) return { kind: 'forbidden' };
    if (response.status === 409) return { kind: 'invalid_state' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body)) return { kind: 'failed' };
    const signal = parseSignal(body.signal);
    return signal ? { kind: 'ok', value: signal } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

export async function listSignals(
  token: string,
  sessionId: string,
  afterId?: string,
): Promise<SharingResult<readonly SharingSignal[]>> {
  try {
    const url = afterId
      ? `/api/sharing/sessions/${sessionId}/signals?after=${encodeURIComponent(afterId)}`
      : `/api/sharing/sessions/${sessionId}/signals`;
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 404) return { kind: 'not_found' };
    if (response.status === 401 || response.status === 403) return { kind: 'forbidden' };
    if (response.status === 409) return { kind: 'invalid_state' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.signals)) return { kind: 'failed' };
    const signals = (body.signals as unknown[])
      .map(parseSignal)
      .filter((s): s is SharingSignal => s !== null);
    return { kind: 'ok', value: signals };
  } catch {
    return { kind: 'failed' };
  }
}
