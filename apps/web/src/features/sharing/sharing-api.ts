// HTTP API client for screen-sharing signalling and session lifecycle (T3-018-B).
// Restricts session participation to the owner learner and claiming staff member.
// No recording or remote control operations exist.

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

export type SignalType = 'offer' | 'answer' | 'candidate';

export interface SharingSignal {
  readonly id: number;
  readonly sessionId: string;
  readonly senderId: string;
  readonly type: SignalType;
  readonly payload: unknown;
  readonly createdAt: string;
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null;
}

export async function getSession(token: string, sessionId: string): Promise<SharingSession | null> {
  try {
    const res = await fetch(`/api/sharing/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (isRecord(body) && isRecord(body.session)) {
      return body.session as unknown as SharingSession;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getSessionByHelpRequestId(
  token: string,
  helpRequestId: string,
): Promise<SharingSession | null> {
  try {
    const res = await fetch(
      `/api/sharing/sessions/by-request/${encodeURIComponent(helpRequestId)}`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (isRecord(body) && isRecord(body.session)) {
      return body.session as unknown as SharingSession;
    }
    return null;
  } catch {
    return null;
  }
}

export async function initiateSession(
  token: string,
  helpRequestId: string,
): Promise<SharingSession | null> {
  try {
    const res = await fetch('/api/sharing/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ helpRequestId }),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (isRecord(body) && isRecord(body.session)) {
      return body.session as unknown as SharingSession;
    }
    return null;
  } catch {
    return null;
  }
}

export async function joinSession(
  token: string,
  sessionId: string,
): Promise<SharingSession | null> {
  try {
    const res = await fetch(`/api/sharing/sessions/${encodeURIComponent(sessionId)}/join`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (isRecord(body) && isRecord(body.session)) {
      return body.session as unknown as SharingSession;
    }
    return null;
  } catch {
    return null;
  }
}

export async function revokeSession(
  token: string,
  sessionId: string,
): Promise<SharingSession | null> {
  try {
    const res = await fetch(`/api/sharing/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (isRecord(body) && isRecord(body.session)) {
      return body.session as unknown as SharingSession;
    }
    return null;
  } catch {
    return null;
  }
}

export async function sendSignal(
  token: string,
  sessionId: string,
  type: SignalType,
  payload: unknown,
): Promise<SharingSignal | null> {
  try {
    const res = await fetch(`/api/sharing/sessions/${encodeURIComponent(sessionId)}/signals`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type, payload }),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (isRecord(body) && isRecord(body.signal)) {
      return body.signal as unknown as SharingSignal;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getSignals(
  token: string,
  sessionId: string,
  afterId?: number,
): Promise<readonly SharingSignal[]> {
  try {
    const url =
      afterId !== undefined
        ? `/api/sharing/sessions/${encodeURIComponent(sessionId)}/signals?after=${afterId}`
        : `/api/sharing/sessions/${encodeURIComponent(sessionId)}/signals`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    if (isRecord(body) && Array.isArray(body.signals)) {
      return body.signals as SharingSignal[];
    }
    return [];
  } catch {
    return [];
  }
}
