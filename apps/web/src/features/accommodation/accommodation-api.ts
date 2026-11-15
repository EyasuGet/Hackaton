// Browser-side client for the accommodation request API (T3-022-A, T3-022-B).
// Never rejects: errors are returned as typed results.

export interface Job {
  readonly id: string;
  readonly title: string;
  readonly organization: string;
  readonly category: string;
  readonly location: string | null;
  readonly sourceUrl: string;
}

export type AccommodationState = 'waiting' | 'cancelled' | 'claimed' | 'resolved';

export interface AccommodationRequest {
  readonly id: string;
  readonly ownerId: string;
  readonly jobId: string;
  readonly clientRequestId: string;
  readonly supportDescription: string;
  readonly state: AccommodationState;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly updatedAt: string;
  readonly cancelledAt: string | null;
  readonly claimedBy: string | null;
  readonly claimedAt: string | null;
  readonly resolvedBy: string | null;
  readonly resolvedAt: string | null;
}

export interface AccommodationReply {
  readonly id: string;
  readonly accommodationRequestId: string;
  readonly authorId: string;
  readonly clientReplyId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface AccommodationQueueItem {
  readonly id: string;
  readonly jobId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: 'waiting';
}

export type JobsResult =
  { readonly kind: 'ok'; readonly jobs: readonly Job[] } | { readonly kind: 'denied' | 'failed' };

export type SubmitResult =
  | { readonly kind: 'submitted' | 'existing'; readonly request: AccommodationRequest }
  | { readonly kind: 'denied' | 'job_not_found' | 'failed' };

export type CancelResult =
  | { readonly kind: 'cancelled'; readonly request: AccommodationRequest }
  | { readonly kind: 'not_found' | 'denied' | 'failed' };

export type ListRequestsResult =
  | { readonly kind: 'ok'; readonly requests: readonly AccommodationRequest[] }
  | { readonly kind: 'denied' | 'failed' };

export type ListQueueResult =
  | { readonly kind: 'ok'; readonly queue: readonly AccommodationQueueItem[] }
  | { readonly kind: 'denied' | 'failed' };

export type ClaimResult =
  | { readonly kind: 'claimed'; readonly request: AccommodationRequest }
  | { readonly kind: 'already_claimed'; readonly claimedBy?: string }
  | { readonly kind: 'not_found' | 'denied' | 'failed' };

export type ResolveResult =
  | { readonly kind: 'resolved'; readonly request: AccommodationRequest }
  | { readonly kind: 'not_found' | 'denied' | 'failed' };

export type AddReplyResult =
  | { readonly kind: 'added' | 'existing'; readonly reply: AccommodationReply }
  | { readonly kind: 'terminal' | 'denied' | 'failed' };

export type ListRepliesResult =
  | { readonly kind: 'ok'; readonly replies: readonly AccommodationReply[] }
  | { readonly kind: 'denied' | 'not_found' | 'failed' };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseRequest(raw: unknown): AccommodationRequest | null {
  const r = isRecord(raw) ? raw : null;
  if (
    !r ||
    typeof r.id !== 'string' ||
    typeof r.ownerId !== 'string' ||
    typeof r.jobId !== 'string' ||
    typeof r.clientRequestId !== 'string' ||
    typeof r.supportDescription !== 'string' ||
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
    jobId: r.jobId,
    clientRequestId: r.clientRequestId,
    supportDescription: r.supportDescription,
    state: r.state,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    updatedAt: r.updatedAt,
    cancelledAt: typeof r.cancelledAt === 'string' ? r.cancelledAt : null,
    claimedBy: typeof r.claimedBy === 'string' ? r.claimedBy : null,
    claimedAt: typeof r.claimedAt === 'string' ? r.claimedAt : null,
    resolvedBy: typeof r.resolvedBy === 'string' ? r.resolvedBy : null,
    resolvedAt: typeof r.resolvedAt === 'string' ? r.resolvedAt : null,
  };
}

function parseReply(raw: unknown): AccommodationReply | null {
  const r = isRecord(raw) ? raw : null;
  if (
    !r ||
    typeof r.id !== 'string' ||
    typeof r.accommodationRequestId !== 'string' ||
    typeof r.authorId !== 'string' ||
    typeof r.clientReplyId !== 'string' ||
    typeof r.body !== 'string' ||
    typeof r.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id: r.id,
    accommodationRequestId: r.accommodationRequestId,
    authorId: r.authorId,
    clientReplyId: r.clientReplyId,
    body: r.body,
    createdAt: r.createdAt,
    readAt: typeof r.readAt === 'string' ? r.readAt : null,
  };
}

function parseQueueItem(raw: unknown): AccommodationQueueItem | null {
  const r = isRecord(raw) ? raw : null;
  if (
    !r ||
    typeof r.id !== 'string' ||
    typeof r.jobId !== 'string' ||
    typeof r.createdAt !== 'string' ||
    typeof r.expiresAt !== 'string' ||
    r.state !== 'waiting'
  ) {
    return null;
  }
  return {
    id: r.id,
    jobId: r.jobId,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    state: 'waiting',
  };
}

function parseJob(raw: unknown): Job | null {
  const r = isRecord(raw) ? raw : null;
  if (
    !r ||
    typeof r.id !== 'string' ||
    typeof r.title !== 'string' ||
    typeof r.organization !== 'string' ||
    typeof r.category !== 'string' ||
    typeof r.sourceUrl !== 'string'
  ) {
    return null;
  }
  return {
    id: r.id,
    title: r.title,
    organization: r.organization,
    category: r.category,
    location: typeof r.location === 'string' ? r.location : null,
    sourceUrl: r.sourceUrl,
  };
}

/** Fetches identity of authenticated principal. */
export async function fetchPrincipal(
  token: string,
): Promise<{ id: string; role: string; label: string } | null> {
  try {
    const response = await fetch('/api/me', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.id !== 'string' || typeof body.role !== 'string') {
      return null;
    }
    return {
      id: body.id,
      role: body.role,
      label: typeof body.label === 'string' ? body.label : '',
    };
  } catch {
    return null;
  }
}

/** Lists active approved jobs available for accommodation requests. */
export async function listJobs(token: string): Promise<JobsResult> {
  try {
    const response = await fetch('/api/jobs', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.jobs)) return { kind: 'failed' };
    const jobs = (body.jobs as unknown[]).map(parseJob).filter((j): j is Job => j !== null);
    return { kind: 'ok', jobs };
  } catch {
    return { kind: 'failed' };
  }
}

/** Submits an accommodation request after the learner confirms the preview. */
export async function submitAccommodationRequest(
  token: string,
  clientRequestId: string,
  jobId: string,
  supportDescription: string,
): Promise<SubmitResult> {
  try {
    const response = await fetch('/api/accommodation/requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ clientRequestId, jobId, supportDescription }),
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (response.status === 422) return { kind: 'job_not_found' };
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

/** Cancels an owned waiting accommodation request. */
export async function cancelAccommodationRequest(token: string, id: string): Promise<CancelResult> {
  try {
    const response = await fetch(`/api/accommodation/requests/${id}`, {
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

/** Lists accommodation requests (owned requests for learners; coordinator inbox for coordinators). */
export async function listAccommodationRequests(token: string): Promise<ListRequestsResult> {
  try {
    const response = await fetch('/api/accommodation/requests', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.requests)) return { kind: 'failed' };
    const requests = (body.requests as unknown[])
      .map(parseRequest)
      .filter((r): r is AccommodationRequest => r !== null);
    return { kind: 'ok', requests };
  } catch {
    return { kind: 'failed' };
  }
}

/** Lists queue of waiting accommodation requests for coordinators. */
export async function listAccommodationQueue(token: string): Promise<ListQueueResult> {
  try {
    const response = await fetch('/api/accommodation/queue', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.queue)) return { kind: 'failed' };
    const queue = (body.queue as unknown[])
      .map(parseQueueItem)
      .filter((q): q is AccommodationQueueItem => q !== null);
    return { kind: 'ok', queue };
  } catch {
    return { kind: 'failed' };
  }
}

/** Claims a waiting accommodation request for the coordinator. */
export async function claimAccommodationRequest(token: string, id: string): Promise<ClaimResult> {
  try {
    const response = await fetch(`/api/accommodation/requests/${id}/claim`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (response.status === 409) {
      const body: unknown = await response.json();
      const claimedBy =
        isRecord(body) && typeof body.claimedBy === 'string' ? body.claimedBy : undefined;
      return claimedBy ? { kind: 'already_claimed', claimedBy } : { kind: 'already_claimed' };
    }
    if (response.status === 404) return { kind: 'not_found' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body)) return { kind: 'failed' };
    const request = parseRequest(body.request);
    if (!request) return { kind: 'failed' };
    return { kind: 'claimed', request };
  } catch {
    return { kind: 'failed' };
  }
}

/** Resolves an accommodation request. Coordinator only. */
export async function resolveAccommodationRequest(
  token: string,
  id: string,
): Promise<ResolveResult> {
  try {
    const response = await fetch(`/api/accommodation/requests/${id}/resolve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (response.status === 404) return { kind: 'not_found' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body)) return { kind: 'failed' };
    const request = parseRequest(body.request);
    if (!request) return { kind: 'failed' };
    return { kind: 'resolved', request };
  } catch {
    return { kind: 'failed' };
  }
}

/** Adds a reply to an accommodation request thread. */
export async function addAccommodationReply(
  token: string,
  accommodationRequestId: string,
  clientReplyId: string,
  body: string,
): Promise<AddReplyResult> {
  try {
    const response = await fetch(`/api/accommodation/requests/${accommodationRequestId}/replies`, {
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
    const data: unknown = await response.json();
    if (!isRecord(data)) return { kind: 'failed' };
    const kind = data.kind === 'existing' ? 'existing' : 'added';
    const reply = parseReply(data.reply);
    if (!reply) return { kind: 'failed' };
    return { kind, reply };
  } catch {
    return { kind: 'failed' };
  }
}

/** Lists replies for an accommodation request in chronological order. */
export async function listAccommodationReplies(
  token: string,
  accommodationRequestId: string,
): Promise<ListRepliesResult> {
  try {
    const response = await fetch(`/api/accommodation/requests/${accommodationRequestId}/replies`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (response.status === 404) return { kind: 'not_found' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.replies)) return { kind: 'failed' };
    const replies = (body.replies as unknown[])
      .map(parseReply)
      .filter((r): r is AccommodationReply => r !== null);
    return { kind: 'ok', replies };
  } catch {
    return { kind: 'failed' };
  }
}

/** Marks unread replies on an accommodation request as read. */
export async function markAccommodationRepliesRead(
  token: string,
  accommodationRequestId: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/accommodation/requests/${accommodationRequestId}/replies/read`,
      {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}` },
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}
