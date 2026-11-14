// Browser-side client for the accommodation request API (T3-022-A).
// Never rejects: errors are returned as typed results.

export interface Job {
  readonly id: string;
  readonly title: string;
  readonly organization: string;
  readonly category: string;
  readonly location: string | null;
  readonly sourceUrl: string;
}

export interface AccommodationRequest {
  readonly id: string;
  readonly ownerId: string;
  readonly jobId: string;
  readonly clientRequestId: string;
  readonly supportDescription: string;
  readonly state: 'waiting' | 'cancelled';
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly updatedAt: string;
  readonly cancelledAt: string | null;
}

export type JobsResult =
  { readonly kind: 'ok'; readonly jobs: readonly Job[] } | { readonly kind: 'denied' | 'failed' };

export type SubmitResult =
  | { readonly kind: 'submitted' | 'existing'; readonly request: AccommodationRequest }
  | { readonly kind: 'denied' | 'job_not_found' | 'failed' };

export type CancelResult =
  | { readonly kind: 'cancelled'; readonly request: AccommodationRequest }
  | { readonly kind: 'not_found' | 'denied' | 'failed' };

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
    jobId: r.jobId,
    clientRequestId: r.clientRequestId,
    supportDescription: r.supportDescription,
    state: r.state,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    updatedAt: r.updatedAt,
    cancelledAt: typeof r.cancelledAt === 'string' ? r.cancelledAt : null,
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
