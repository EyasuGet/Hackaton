// Browser-side client for the help request API (T3-016-A).
// Never rejects: errors are returned as typed results.

export interface HelpRequest {
  readonly id: string;
  readonly ownerId: string;
  readonly clientRequestId: string;
  readonly contextSnapshot: string;
  readonly consentGiven: boolean;
  readonly state: 'waiting' | 'cancelled';
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly updatedAt: string;
  readonly cancelledAt: string | null;
}

export type SubmitResult =
  | { readonly kind: 'submitted' | 'existing'; readonly request: HelpRequest }
  | { readonly kind: 'denied' | 'failed' };

export type CancelResult =
  | { readonly kind: 'cancelled'; readonly request: HelpRequest }
  | { readonly kind: 'not_found' | 'denied' | 'failed' };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseRequest(raw: unknown): HelpRequest | null {
  const r = isRecord(raw) ? raw : null;
  if (
    !r ||
    typeof r.id !== 'string' ||
    typeof r.ownerId !== 'string' ||
    typeof r.clientRequestId !== 'string' ||
    typeof r.contextSnapshot !== 'string' ||
    typeof r.consentGiven !== 'boolean' ||
    (r.state !== 'waiting' && r.state !== 'cancelled') ||
    typeof r.createdAt !== 'string' ||
    typeof r.expiresAt !== 'string' ||
    typeof r.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: r.id,
    ownerId: r.ownerId,
    clientRequestId: r.clientRequestId,
    contextSnapshot: r.contextSnapshot,
    consentGiven: r.consentGiven,
    state: r.state,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    updatedAt: r.updatedAt,
    cancelledAt: typeof r.cancelledAt === 'string' ? r.cancelledAt : null,
  };
}

/** Submits a help request after the learner confirms the disclosure. */
export async function submitHelpRequest(
  token: string,
  clientRequestId: string,
  contextSnapshot: string,
): Promise<SubmitResult> {
  try {
    const response = await fetch('/api/help/requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ clientRequestId, contextSnapshot }),
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body)) return { kind: 'failed' };
    const kind = body.kind === 'existing' ? 'existing' : 'submitted';
    const request = parseRequest(body.request);
    if (!request) return { kind: 'failed' };
    return { kind, request };
  } catch {
    return { kind: 'failed' };
  }
}

/** Cancels an owned waiting help request. */
export async function cancelHelpRequest(token: string, id: string): Promise<CancelResult> {
  try {
    const response = await fetch(`/api/help/requests/${id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (response.status === 404) return { kind: 'not_found' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body)) return { kind: 'failed' };
    const request = parseRequest(body.request);
    if (!request) return { kind: 'failed' };
    return { kind: 'cancelled', request };
  } catch {
    return { kind: 'failed' };
  }
}
