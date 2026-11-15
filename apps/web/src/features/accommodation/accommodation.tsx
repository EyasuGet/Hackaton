// Accommodation request panel and coordinator inbox (T3-022-A, T3-022-B).
// Learner view: multi-step composer and persistent requests with private replies.
// Coordinator view: coordinator inbox listing requests, status controls (reviewing, confirmed, declined),
// and two-sided threaded private replies.
// Private by design: visible only to the requesting learner and authorised coordinator.
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { T, type MessageKey } from '../../shared/i18n/i18n.tsx';
import {
  addAccommodationReply,
  cancelAccommodationRequest,
  listAccommodationReplies,
  listAccommodationRequests,
  listCoordinatorAccommodationRequests,
  listJobs,
  markAccommodationRepliesRead,
  submitAccommodationRequest,
  updateAccommodationStatus,
  type AccommodationReply,
  type AccommodationRequest,
  type AccommodationState,
  type Job,
} from './accommodation-api.ts';

type ComposerPhase =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'selecting_job';
      readonly jobs: readonly Job[];
      readonly selectedJobId: string;
    }
  | { readonly kind: 'composing'; readonly job: Job; readonly description: string }
  | { readonly kind: 'preview'; readonly job: Job; readonly description: string }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'waiting'; readonly request: AccommodationRequest; readonly job: Job }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'loading_jobs' }
  | { readonly kind: 'error'; readonly message: 'denied' | 'job_not_found' | 'failed' };

type ReplyPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'composing'; readonly draft: string }
  | { readonly kind: 'sending' }
  | { readonly kind: 'error'; readonly reason: 'failed' | 'terminal' };

interface ReplyThreadState {
  readonly replies: readonly AccommodationReply[];
  readonly loaded: boolean;
  readonly hasUnread: boolean;
  readonly phase: ReplyPhase;
}

function requestKey(): string {
  return `ar-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function replyKey(): string {
  return `ar-rep-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const STATE_MESSAGES: Record<AccommodationState, MessageKey> = {
  waiting: 'accommodation.state.waiting',
  reviewing: 'accommodation.state.reviewing',
  confirmed: 'accommodation.state.confirmed',
  declined: 'accommodation.state.declined',
  cancelled: 'accommodation.state.cancelled',
};

// Threaded replies component for an accommodation request
export function AccommodationReplyThread({
  request,
  token,
  role,
}: {
  readonly request: AccommodationRequest;
  readonly token: string;
  readonly role: 'learner' | 'support';
}) {
  const [thread, setThread] = useState<ReplyThreadState>({
    replies: [],
    loaded: false,
    hasUnread: false,
    phase: { kind: 'idle' },
  });
  const inFlight = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaId = useId();
  const isTerminal =
    request.state === 'cancelled' || request.state === 'declined' || request.state === 'confirmed';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listAccommodationReplies(token, request.id);
      if (cancelled) return;
      if (result.kind === 'ok') {
        const unreadExists =
          role === 'learner'
            ? result.replies.some((r) => r.authorId !== request.ownerId && r.readAt === null)
            : result.replies.some((r) => r.authorId === request.ownerId && r.readAt === null);
        setThread((prev) => ({
          ...prev,
          replies: result.replies,
          loaded: true,
          hasUnread: unreadExists,
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, request.id, request.ownerId, role]);

  async function onMarkRead() {
    if (inFlight.current) return;
    inFlight.current = true;
    await markAccommodationRepliesRead(token, request.id);
    inFlight.current = false;
    setThread((prev) => ({
      ...prev,
      hasUnread: false,
      replies: prev.replies.map((r) =>
        (role === 'learner' ? r.authorId !== request.ownerId : r.authorId === request.ownerId) &&
        r.readAt === null
          ? { ...r, readAt: new Date().toISOString() }
          : r,
      ),
    }));
  }

  function onStartComposing() {
    setThread((prev) => ({ ...prev, phase: { kind: 'composing', draft: '' } }));
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function onDraftChange(draft: string) {
    if (thread.phase.kind !== 'composing') return;
    setThread((prev) => ({ ...prev, phase: { kind: 'composing', draft } }));
  }

  async function onSend() {
    if (inFlight.current || thread.phase.kind !== 'composing') return;
    const body = thread.phase.draft.trim();
    if (!body) return;
    inFlight.current = true;
    setThread((prev) => ({ ...prev, phase: { kind: 'sending' } }));

    const result = await addAccommodationReply(token, request.id, replyKey(), body);
    inFlight.current = false;

    if (result.kind === 'added' || result.kind === 'existing') {
      const reply = result.reply;
      setThread((prev) => ({
        ...prev,
        replies: prev.replies.some((r) => r.id === reply.id)
          ? prev.replies
          : [...prev.replies, reply],
        phase: { kind: 'idle' },
      }));
    } else if (result.kind === 'terminal_or_not_found') {
      setThread((prev) => ({ ...prev, phase: { kind: 'error', reason: 'terminal' } }));
    } else {
      setThread((prev) => ({ ...prev, phase: { kind: 'error', reason: 'failed' } }));
    }
  }

  return (
    <div className="accommodation-replies">
      <h4>
        <T k="accommodation.repliesHeading" />
      </h4>

      {thread.hasUnread && (
        <div className="accommodation-unread-bar">
          <span className="accommodation-unread-badge" role="status">
            <T k="accommodation.unread" />
          </span>
          <button type="button" onClick={() => void onMarkRead()}>
            <T k="accommodation.markRead" />
          </button>
        </div>
      )}

      {thread.loaded && thread.replies.length === 0 && (
        <p className="accommodation-no-replies">
          <T k="accommodation.noReplies" />
        </p>
      )}

      {thread.replies.length > 0 && (
        <ul className="accommodation-replies-list" aria-label="Messages list">
          {thread.replies.map((r) => {
            const isAuthorOwner = r.authorId === request.ownerId;
            return (
              <li
                key={r.id}
                className={`accommodation-reply ${isAuthorOwner ? 'learner-reply' : 'coordinator-reply'}`}
              >
                <div className="accommodation-reply-meta">
                  <span className="author">{isAuthorOwner ? 'Learner' : 'Coordinator'}</span>
                  <span className="date">{formatDate(r.createdAt)}</span>
                  {r.readAt && <span className="read-status">(read {formatDate(r.readAt)})</span>}
                </div>
                <p className="body" dir="auto">
                  {r.body}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {!isTerminal && thread.phase.kind === 'idle' && (
        <button type="button" className="accommodation-reply-btn" onClick={onStartComposing}>
          <T k="accommodation.reply" />
        </button>
      )}

      {!isTerminal && thread.phase.kind === 'composing' && (
        <div className="accommodation-compose">
          <label htmlFor={textareaId}>
            <T k="accommodation.replyLabel" />
          </label>
          <textarea
            id={textareaId}
            ref={textareaRef}
            value={thread.phase.draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={3}
            dir="auto"
            aria-required="true"
          />
          <div className="actions">
            <button
              type="button"
              onClick={() => void onSend()}
              disabled={!thread.phase.draft.trim()}
            >
              <T k="accommodation.send" />
            </button>
            <button
              type="button"
              onClick={() => setThread((prev) => ({ ...prev, phase: { kind: 'idle' } }))}
            >
              <T k="accommodation.cancelDraft" />
            </button>
          </div>
          <p className="accommodation-disclosure" role="note">
            <T k="accommodation.privateDisclosure" />
          </p>
        </div>
      )}

      {thread.phase.kind === 'sending' && (
        <p role="status">
          <T k="accommodation.sending" />
        </p>
      )}

      {thread.phase.kind === 'error' && (
        <p role="alert">
          {thread.phase.reason === 'terminal' ? (
            <T k="accommodation.replyTerminal" />
          ) : (
            <T k="accommodation.replyFailed" />
          )}
        </p>
      )}
    </div>
  );
}

// Coordinator Inbox View
export function CoordinatorAccommodationPanel({ token }: { readonly token: string }) {
  const [requests, setRequests] = useState<readonly AccommodationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [statusActionId, setStatusActionId] = useState<string | null>(null);
  const headingId = useId();

  async function loadCoordinatorInbox() {
    setLoading(true);
    setLoadError(false);
    const result = await listCoordinatorAccommodationRequests(token);
    setLoading(false);
    if (result.kind === 'ok') {
      setRequests(result.requests);
    } else {
      setLoadError(true);
    }
  }

  useEffect(() => {
    void loadCoordinatorInbox();
  }, [token]);

  async function onUpdateStatus(reqId: string, newStatus: 'reviewing' | 'confirmed' | 'declined') {
    setStatusActionId(reqId);
    const result = await updateAccommodationStatus(token, reqId, newStatus);
    setStatusActionId(null);
    if (result.kind === 'ok') {
      setRequests((prev) => prev.map((r) => (r.id === reqId ? result.request : r)));
    }
  }

  return (
    <section className="coordinator-accommodation-panel" aria-labelledby={headingId}>
      <h2 id={headingId}>
        <T k="accommodation.coordinator.heading" />
      </h2>
      <p>
        <T k="accommodation.coordinator.intro" />
      </p>

      {loading && (
        <p role="status">
          <T k="accommodation.coordinator.loading" />
        </p>
      )}

      {loadError && (
        <p role="alert">
          <T k="accommodation.coordinator.loadError" />
        </p>
      )}

      {!loading && !loadError && requests.length === 0 && (
        <p>
          <T k="accommodation.coordinator.noRequests" />
        </p>
      )}

      {!loading && !loadError && requests.length > 0 && (
        <ul className="coordinator-requests-list">
          {requests.map((req) => {
            const isCancelled = req.state === 'cancelled';
            return (
              <li key={req.id} className="coordinator-request-card">
                <div className="card-header">
                  <span className="job-id">Job: {req.jobId}</span>
                  <span className={`state-badge state-${req.state}`}>
                    <T k={STATE_MESSAGES[req.state]} />
                  </span>
                  <span className="requested-date">{formatDate(req.createdAt)}</span>
                </div>

                <div className="card-body">
                  <p>
                    <strong>
                      <T k="accommodation.descriptionLabel" />:
                    </strong>
                  </p>
                  <blockquote dir="auto">{req.supportDescription}</blockquote>
                </div>

                {/* Coordinator status action buttons */}
                {!isCancelled && (
                  <div
                    className="coordinator-status-controls"
                    role="group"
                    aria-label="Status actions"
                  >
                    <span className="controls-label">
                      <T k="accommodation.coordinator.updateStatus" />:
                    </span>
                    {req.state !== 'reviewing' && (
                      <button
                        type="button"
                        onClick={() => void onUpdateStatus(req.id, 'reviewing')}
                        disabled={statusActionId === req.id}
                      >
                        <T k="accommodation.coordinator.actionReviewing" />
                      </button>
                    )}
                    {req.state !== 'confirmed' && (
                      <button
                        type="button"
                        onClick={() => void onUpdateStatus(req.id, 'confirmed')}
                        disabled={statusActionId === req.id}
                      >
                        <T k="accommodation.coordinator.actionConfirm" />
                      </button>
                    )}
                    {req.state !== 'declined' && (
                      <button
                        type="button"
                        onClick={() => void onUpdateStatus(req.id, 'declined')}
                        disabled={statusActionId === req.id}
                      >
                        <T k="accommodation.coordinator.actionDecline" />
                      </button>
                    )}
                  </div>
                )}

                {/* Two-sided reply thread for this request */}
                <AccommodationReplyThread request={req} token={token} role="support" />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// Learner Accommodation Panel
export function AccommodationPanel({
  token,
  role,
}: {
  readonly token: string;
  readonly role?: 'learner' | 'support';
}) {
  const [phase, setPhase] = useState<ComposerPhase>({ kind: 'idle' });
  const [existingRequests, setExistingRequests] = useState<readonly AccommodationRequest[]>([]);
  const [isCoordinator, setIsCoordinator] = useState(role === 'support');
  const inFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const ids = {
    heading: useId(),
    job: useId(),
    description: useId(),
    status: useId(),
  };

  // Check role and load existing requests on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (role === 'support') {
        setIsCoordinator(true);
        return;
      }
      // If role not explicitly provided, try to detect role via /api/me
      if (!role) {
        try {
          const res = await fetch('/api/me', {
            headers: { authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const body = (await res.json()) as { role?: string };
            if (body.role === 'support') {
              if (!cancelled) setIsCoordinator(true);
              return;
            }
          }
        } catch {
          // Graceful fallback to learner
        }
      }

      // Load learner existing requests so they survive reload
      const result = await listAccommodationRequests(token);
      if (cancelled) return;
      if (result.kind === 'ok') {
        setExistingRequests(result.requests);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, role]);

  // If coordinator role detected, render coordinator inbox
  if (isCoordinator) {
    return <CoordinatorAccommodationPanel token={token} />;
  }

  // Fetch jobs when learner starts the request flow
  async function startRequest() {
    setPhase({ kind: 'loading_jobs' });
    const result = await listJobs(token);
    if (result.kind === 'ok') {
      setPhase({
        kind: 'selecting_job',
        jobs: result.jobs,
        selectedJobId: result.jobs[0]?.id ?? '',
      });
    } else {
      setPhase({ kind: 'error', message: result.kind });
    }
  }

  function onJobSelect(e: ChangeEvent<HTMLSelectElement>) {
    if (phase.kind !== 'selecting_job') return;
    setPhase({ ...phase, selectedJobId: e.target.value });
  }

  function onJobSubmit(e: FormEvent) {
    e.preventDefault();
    if (phase.kind !== 'selecting_job') return;
    const job = phase.jobs.find((j) => j.id === phase.selectedJobId);
    if (!job) return;
    setPhase({ kind: 'composing', job, description: '' });
  }

  function onDescriptionChange(e: ChangeEvent<HTMLTextAreaElement>) {
    if (phase.kind !== 'composing') return;
    setPhase({ ...phase, description: e.target.value });
  }

  function onReview(e: FormEvent) {
    e.preventDefault();
    if (phase.kind !== 'composing') return;
    const description = phase.description.trim();
    if (!description) return;
    setPhase({ kind: 'preview', job: phase.job, description });
  }

  function onBackFromDescription() {
    if (phase.kind !== 'composing') return;
    setPhase({ kind: 'selecting_job', jobs: [], selectedJobId: phase.job.id });
    void (async () => {
      const result = await listJobs(token);
      if (result.kind === 'ok') {
        setPhase({ kind: 'selecting_job', jobs: result.jobs, selectedJobId: phase.job.id });
      }
    })();
  }

  function onBackFromPreview() {
    if (phase.kind !== 'preview') return;
    setPhase({ kind: 'composing', job: phase.job, description: phase.description });
  }

  async function onConfirm() {
    if (inFlight.current || phase.kind !== 'preview') return;
    inFlight.current = true;
    const { job, description } = phase;
    setPhase({ kind: 'submitting' });

    const result = await submitAccommodationRequest(token, requestKey(), job.id, description);
    inFlight.current = false;

    if (result.kind === 'submitted' || result.kind === 'existing') {
      setPhase({ kind: 'waiting', request: result.request, job });
      // Prepend to existing requests list
      setExistingRequests((prev) => [
        result.request,
        ...prev.filter((r) => r.id !== result.request.id),
      ]);
      statusRef.current?.focus();
    } else {
      setPhase({ kind: 'error', message: result.kind });
    }
  }

  async function onCancel(requestId?: string) {
    if (inFlight.current) return;
    const targetId = requestId ?? (phase.kind === 'waiting' ? phase.request.id : null);
    if (!targetId) return;

    inFlight.current = true;
    const result = await cancelAccommodationRequest(token, targetId);
    inFlight.current = false;

    if (result.kind === 'cancelled' || result.kind === 'not_found') {
      setPhase({ kind: 'cancelled' });
      setExistingRequests((prev) =>
        prev.map((r) => (r.id === targetId ? { ...r, state: 'cancelled' } : r)),
      );
      statusRef.current?.focus();
    } else {
      setPhase({ kind: 'error', message: result.kind === 'denied' ? 'denied' : 'failed' });
    }
  }

  function onRetry() {
    setPhase({ kind: 'idle' });
  }

  return (
    <section className="accommodation-panel" aria-labelledby={ids.heading}>
      <h2 id={ids.heading}>
        <T k="accommodation.heading" />
      </h2>

      {/* Persistent learner accommodation requests (survives reload) */}
      {existingRequests.length > 0 && phase.kind === 'idle' && (
        <div className="accommodation-owned-requests">
          <h3>
            <T k="accommodation.activeRequestsHeading" />
          </h3>
          <ul className="accommodation-owned-list">
            {existingRequests.map((req) => (
              <li key={req.id} className="accommodation-request-card">
                <div className="card-header">
                  <span className="job-id">Job: {req.jobId}</span>
                  <span className={`state-badge state-${req.state}`}>
                    <T k={STATE_MESSAGES[req.state]} />
                  </span>
                  <span className="date">{formatDate(req.createdAt)}</span>
                </div>
                <div className="card-body">
                  <p>
                    <strong>
                      <T k="accommodation.descriptionLabel" />:
                    </strong>
                  </p>
                  <blockquote dir="auto">{req.supportDescription}</blockquote>
                </div>

                {req.state === 'waiting' && (
                  <button
                    type="button"
                    className="accommodation-cancel-btn"
                    onClick={() => void onCancel(req.id)}
                  >
                    <T k="accommodation.cancelButton" />
                  </button>
                )}

                {/* Reply thread with coordinator */}
                <AccommodationReplyThread request={req} token={token} role="learner" />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Composer Steps */}
      {phase.kind === 'idle' && (
        <div className="accommodation-composer-start">
          <p>
            <T k="accommodation.intro" />
          </p>
          <button type="button" onClick={() => void startRequest()}>
            <T
              k={
                existingRequests.length > 0
                  ? 'accommodation.newRequest'
                  : 'accommodation.startButton'
              }
            />
          </button>
        </div>
      )}

      {phase.kind === 'loading_jobs' && (
        <p role="status">
          <T k="accommodation.loadingJobs" />
        </p>
      )}

      {phase.kind === 'selecting_job' && (
        <form onSubmit={onJobSubmit} noValidate>
          <p>
            <T k="accommodation.selectJobPrompt" />
          </p>
          <label htmlFor={ids.job}>
            <T k="accommodation.jobLabel" />
          </label>
          <select
            id={ids.job}
            value={phase.selectedJobId}
            onChange={onJobSelect}
            aria-required="true"
          >
            {phase.selectedJobId === '' && (
              <option value="" disabled>
                <T k="accommodation.jobPlaceholder" />
              </option>
            )}
            {phase.jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title} — {job.organization}
              </option>
            ))}
          </select>
          <div className="actions">
            <button type="submit" disabled={!phase.selectedJobId}>
              <T k="accommodation.nextButton" />
            </button>
            <button type="button" onClick={onRetry}>
              <T k="accommodation.cancelDraft" />
            </button>
          </div>
        </form>
      )}

      {phase.kind === 'composing' && (
        <form onSubmit={onReview} noValidate>
          <p>
            <strong>
              <T k="accommodation.selectedJob" />
            </strong>{' '}
            {phase.job.title} — {phase.job.organization}
          </p>
          <p>
            <T k="accommodation.descriptionPrompt" />
          </p>
          <label htmlFor={ids.description}>
            <T k="accommodation.descriptionLabel" />
          </label>
          <textarea
            id={ids.description}
            value={phase.description}
            onChange={onDescriptionChange}
            rows={5}
            dir="auto"
            aria-required="true"
          />
          <div className="actions">
            <button type="submit" disabled={!phase.description.trim()}>
              <T k="accommodation.reviewButton" />
            </button>
            <button type="button" onClick={onBackFromDescription}>
              <T k="accommodation.backButton" />
            </button>
          </div>
        </form>
      )}

      {phase.kind === 'preview' && (
        <div>
          <h3>
            <T k="accommodation.previewHeading" />
          </h3>
          <dl>
            <dt>
              <T k="accommodation.previewRecipient" />
            </dt>
            <dd>
              <T k="accommodation.recipientValue" />
            </dd>
            <dt>
              <T k="accommodation.previewJob" />
            </dt>
            <dd>
              {phase.job.title} — {phase.job.organization}
            </dd>
            <dt>
              <T k="accommodation.previewDescriptionLabel" />
            </dt>
            <dd dir="auto">
              <blockquote>{phase.description}</blockquote>
            </dd>
          </dl>
          <p className="accommodation-disclosure-note" role="note">
            <T k="accommodation.disclosureNote" />
          </p>
          <div className="actions">
            <button type="button" onClick={() => void onConfirm()}>
              <T k="accommodation.confirmButton" />
            </button>
            <button type="button" onClick={onBackFromPreview}>
              <T k="accommodation.backButton" />
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'submitting' && (
        <p role="status">
          <T k="accommodation.submitting" />
        </p>
      )}

      {phase.kind === 'waiting' && (
        <div>
          <p ref={statusRef} tabIndex={-1} role="status" id={ids.status}>
            <T k="accommodation.waiting" />
          </p>
          <button type="button" onClick={() => void onCancel()}>
            <T k="accommodation.cancelButton" />
          </button>
          {/* Include reply thread under waiting request */}
          <AccommodationReplyThread request={phase.request} token={token} role="learner" />
        </div>
      )}

      {phase.kind === 'cancelled' && (
        <div>
          <p ref={statusRef} tabIndex={-1} role="status">
            <T k="accommodation.cancelled" />
          </p>
          <button type="button" onClick={onRetry}>
            <T k="accommodation.startButton" />
          </button>
        </div>
      )}

      {phase.kind === 'error' && (
        <div>
          <p role="alert">
            {phase.message === 'denied' && <T k="accommodation.errorDenied" />}
            {phase.message === 'job_not_found' && <T k="accommodation.errorJobNotFound" />}
            {phase.message === 'failed' && <T k="accommodation.errorFailed" />}
          </p>
          <button type="button" onClick={onRetry}>
            <T k="accommodation.startButton" />
          </button>
        </div>
      )}
    </section>
  );
}
