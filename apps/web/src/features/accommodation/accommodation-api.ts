// Browser-side client for the accommodation request and coordinator API (T3-022-A, T3-022-B).
// Never rejects: errors are returned as typed results.

export interface Job {
  readonly id: string;
  readonly title: string;
  readonly organization: string;
  readonly category: string;
  readonly location: string | null;
  readonly sourceUrl: string;
}

export type AccommodationState = 'waiting' | 'reviewing' | 'confirmed' | 'declined' | 'cancelled';

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
  readonly reviewedAt: string | null;
  readonly reviewedBy: string | null;
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

export type UpdateStatusResult =
  | { readonly kind: 'ok'; readonly request: AccommodationRequest }
  | { readonly kind: 'denied' | 'terminal_or_not_found' | 'failed' };

export type AddReplyResult =
  | { readonly kind: 'added' | 'existing'; readonly reply: AccommodationReply }
  | { readonly kind: 'denied' | 'terminal_or_not_found' | 'failed' };

export type ListRepliesResult =
  | { readonly kind: 'ok'; readonly replies: readonly AccommodationReply[] }
  | { readonly kind: 'denied' | 'not_found' | 'failed' };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const VALID_STATES = new Set<AccommodationState>([
  'waiting',
  'reviewing',
  'confirmed',
  'declined',
  'cancelled',
]);

function parseRequest(raw: unknown): AccommodationRequest | null {
  const r = isRecord(raw) ? raw : null;
  if (
    !r ||
    typeof r.id !== 'string' ||
    typeof r.ownerId !== 'string' ||
    typeof r.jobId !== 'string' ||
    typeof r.clientRequestId !== 'string' ||
    typeof r.supportDescription !== 'string' ||
    typeof r.state !== 'string' ||
    !VALID_STATES.has(r.state as AccommodationState) ||
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
    state: r.state as AccommodationState,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    updatedAt: r.updatedAt,
    cancelledAt: typeof r.cancelledAt === 'string' ? r.cancelledAt : null,
    reviewedAt: typeof r.reviewedAt === 'string' ? r.reviewedAt : null,
    reviewedBy: typeof r.reviewedBy === 'string' ? r.reviewedBy : null,
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

/** Lists non-expired accommodation requests for the authenticated learner. */
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

/** Lists all accommodation requests for an authorised coordinator (support role). */
export async function listCoordinatorAccommodationRequests(
  token: string,
): Promise<ListRequestsResult> {
  try {
    const response = await fetch('/api/accommodation/coordinator/requests', {
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

/** Updates accommodation request status (reviewing, confirmed, declined). Coordinator only. */
export async function updateAccommodationStatus(
  token: string,
  id: string,
  status: 'reviewing' | 'confirmed' | 'declined',
): Promise<UpdateStatusResult> {
  try {
    const response = await fetch(`/api/accommodation/requests/${id}/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (response.status === 404 || response.status === 409)
      return { kind: 'terminal_or_not_found' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body)) return { kind: 'failed' };
    const request = parseRequest(body.request);
    if (!request) return { kind: 'failed' };
    return { kind: 'ok', request };
  } catch {
    return { kind: 'failed' };
  }
}

/** Adds a reply to an accommodation request (learner or coordinator). */
export async function addAccommodationReply(
  token: string,
  id: string,
  clientReplyId: string,
  bodyText: string,
): Promise<AddReplyResult> {
  try {
    const response = await fetch(`/api/accommodation/requests/${id}/replies`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ clientReplyId, body: bodyText }),
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (response.status === 404 || response.status === 409)
      return { kind: 'terminal_or_not_found' };
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body)) return { kind: 'failed' };
    const kind = body.kind === 'existing' ? 'existing' : 'added';
    const reply = parseReply(body.reply);
    if (!reply) return { kind: 'failed' };
    return { kind, reply };
  } catch {
    return { kind: 'failed' };
  }
}

/** Lists replies for an accommodation request in chronological order. */
export async function listAccommodationReplies(
  token: string,
  id: string,
): Promise<ListRepliesResult> {
  try {
    const response = await fetch(`/api/accommodation/requests/${id}/replies`, {
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

/** Marks unread replies (by others) on an accommodation request as read. */
export async function markAccommodationRepliesRead(token: string, id: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/accommodation/requests/${id}/replies/read`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}
