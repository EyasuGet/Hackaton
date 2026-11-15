// Browser-side client for the help request API (T3-016-A, T3-017-B).
// Never rejects: errors are returned as typed results.

export interface HelpRequest {
  readonly id: string;
  readonly ownerId: string;
  readonly clientRequestId: string;
  readonly contextSnapshot: string;
  readonly consentGiven: boolean;
  readonly state: 'waiting' | 'cancelled' | 'claimed' | 'resolved';
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly updatedAt: string;
  readonly cancelledAt: string | null;
  readonly claimedBy: string | null;
  readonly claimedAt: string | null;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
}

export interface HelpReply {
  readonly id: string;
  readonly helpRequestId: string;
  readonly authorId: string;
  readonly clientReplyId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export type SubmitResult =
  | { readonly kind: 'submitted' | 'existing'; readonly request: HelpRequest }
  | { readonly kind: 'denied' | 'failed' };

export type CancelResult =
  | { readonly kind: 'cancelled'; readonly request: HelpRequest }
  | { readonly kind: 'not_found' | 'denied' | 'failed' };

export type AddReplyResult =
  | { readonly kind: 'added' | 'existing'; readonly reply: HelpReply }
  | { readonly kind: 'terminal' | 'denied' | 'failed' };

export type ListRepliesResult =
  | { readonly kind: 'ok'; readonly replies: readonly HelpReply[] }
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
    (r.state !== 'waiting' &&
      r.state !== 'cancelled' &&
      r.state !== 'claimed' &&
      r.state !== 'resolved') ||
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
    claimedBy: typeof r.claimedBy === 'string' ? r.claimedBy : null,
    claimedAt: typeof r.claimedAt === 'string' ? r.claimedAt : null,
    resolvedAt: typeof r.resolvedAt === 'string' ? r.resolvedAt : null,
    resolvedBy: typeof r.resolvedBy === 'string' ? r.resolvedBy : null,
  };
}

function parseReply(raw: unknown): HelpReply | null {
  const r = isRecord(raw) ? raw : null;
  if (
    !r ||
    typeof r.id !== 'string' ||
    typeof r.helpRequestId !== 'string' ||
    typeof r.authorId !== 'string' ||
    typeof r.clientReplyId !== 'string' ||
    typeof r.body !== 'string' ||
    typeof r.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id: r.id,
    helpRequestId: r.helpRequestId,
    authorId: r.authorId,
    clientReplyId: r.clientReplyId,
    body: r.body,
    createdAt: r.createdAt,
    readAt: typeof r.readAt === 'string' ? r.readAt : null,
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

export type ListResult =
  | { readonly kind: 'ok'; readonly requests: readonly HelpRequest[] }
  | { readonly kind: 'denied' | 'failed' };

/** Lists the learner's own non-expired help requests. Owner-scoped by the API. */
export async function listHelpRequests(token: string): Promise<ListResult> {
  try {
    const response = await fetch('/api/help/requests', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.requests)) return { kind: 'failed' };
    const requests = (body.requests as unknown[])
      .map(parseRequest)
      .filter((r): r is HelpRequest => r !== null);
    return { kind: 'ok', requests };
  } catch {
    return { kind: 'failed' };
  }
}

/** Sends a reply to a help request. */
export async function addReply(
  token: string,
  helpRequestId: string,
  clientReplyId: string,
  body: string,
): Promise<AddReplyResult> {
  try {
    const response = await fetch(`/api/help/requests/${helpRequestId}/replies`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ clientReplyId, body }),
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (response.status === 409) return { kind: 'terminal' };
    if (!response.ok) return { kind: 'failed' };
    const responseBody: unknown = await response.json();
    if (!isRecord(responseBody)) return { kind: 'failed' };
    const kind = responseBody.kind === 'existing' ? 'existing' : 'added';
    const reply = parseReply(responseBody.reply);
    if (!reply) return { kind: 'failed' };
    return { kind, reply };
  } catch {
    return { kind: 'failed' };
  }
}

/** Lists replies for a help request. */
export async function listReplies(
  token: string,
  helpRequestId: string,
): Promise<ListRepliesResult> {
  try {
    const response = await fetch(`/api/help/requests/${helpRequestId}/replies`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (response.status === 404) return { kind: 'not_found' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.replies)) return { kind: 'failed' };
    const replies = (body.replies as unknown[])
      .map(parseReply)
      .filter((r): r is HelpReply => r !== null);
    return { kind: 'ok', replies };
  } catch {
    return { kind: 'failed' };
  }
}

/** Marks all unread replies on a help request as read. */
export async function markRepliesRead(token: string, helpRequestId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/help/requests/${helpRequestId}/replies/read`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}` },
    });
    return response.ok || response.status === 204;
  } catch {
    return false;
  }
}

/** Attaches the chosen image to an owned help request. Resolves true on success. */
export async function attachScreenshot(token: string, id: string, image: File): Promise<boolean> {
  try {
    const response = await fetch(`/api/help/requests/${id}/screenshot`, {
      method: 'PUT',
      headers: { 'content-type': image.type, authorization: `Bearer ${token}` },
      body: image,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Deletes the screenshot from an owned help request. Resolves true on success. */
export async function removeScreenshot(token: string, id: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/help/requests/${id}/screenshot`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}
