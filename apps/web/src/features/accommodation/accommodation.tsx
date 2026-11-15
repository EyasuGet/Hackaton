// Accommodation request and coordinator inbox components (T3-022-A, T3-022-B).
// Includes:
// - Learner request wizard (job selection → description → preview → submit)
// - Learner persistent accommodation inbox (survives reload, threaded replies with coordinator)
// - Coordinator inbox for support role (view queue/requests, claim, threaded replies, resolve)
// Private by design: only the requesting learner and authorised coordinator see this content.
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { T } from '../../shared/i18n/i18n.tsx';
import {
  addAccommodationReply,
  cancelAccommodationRequest,
  claimAccommodationRequest,
  fetchPrincipal,
  listAccommodationReplies,
  listAccommodationRequests,
  listJobs,
  markAccommodationRepliesRead,
  resolveAccommodationRequest,
  submitAccommodationRequest,
  type AccommodationReply,
  type AccommodationRequest,
  type Job,
} from './accommodation-api.ts';

type Phase =
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
  return `arr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

function hasUnread(replies: readonly AccommodationReply[], currentUserId: string): boolean {
  return replies.some((r) => r.authorId !== currentUserId && r.readAt === null);
}

// ---------------------------------------------------------------------------
// Single request item with two-sided reply thread (used by learner and coordinator)
// ---------------------------------------------------------------------------
export function AccommodationRequestItem({
  req,
  token,
  currentUserId,
  isCoordinator,
  onStatusChange,
}: {
  readonly req: AccommodationRequest;
  readonly token: string;
  readonly currentUserId: string;
  readonly isCoordinator: boolean;
  readonly onStatusChange?: () => void;
}) {
  const [thread, setThread] = useState<ReplyThreadState>({
    replies: [],
    loaded: false,
    hasUnread: false,
    phase: { kind: 'idle' },
  });
  const [currentReq, setCurrentReq] = useState<AccommodationRequest>(req);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inAction, setInAction] = useState(false);
  const inFlight = useRef(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const textareaId = useId();

  // Keep internal state in sync with prop updates
  useEffect(() => {
    setCurrentReq(req);
  }, [req]);

  const isActive = currentReq.state === 'claimed' || currentReq.state === 'waiting';

  // Load replies when request is active or resolved
  useEffect(() => {
    if (currentReq.state === 'cancelled') return;
    let cancelled = false;
    void (async () => {
      const result = await listAccommodationReplies(token, currentReq.id);
      if (cancelled) return;
      if (result.kind === 'ok') {
        const unread = hasUnread(result.replies, currentUserId);
        setThread((prev) => ({
          ...prev,
          replies: result.replies,
          loaded: true,
          hasUnread: unread,
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, currentReq.id, currentReq.state, currentUserId]);

  async function onMarkRead() {
    if (inFlight.current) return;
    inFlight.current = true;
    await markAccommodationRepliesRead(token, currentReq.id);
    inFlight.current = false;
    setThread((prev) => ({
      ...prev,
      hasUnread: false,
      replies: prev.replies.map((r) =>
        r.authorId !== currentUserId && r.readAt === null
          ? { ...r, readAt: new Date().toISOString() }
          : r,
      ),
    }));
  }

  function onDraftChange(value: string) {
    setThread((prev) => ({
      ...prev,
      phase: { kind: 'composing', draft: value },
    }));
  }

  async function onSendReply() {
    if (inFlight.current || thread.phase.kind !== 'composing' || !thread.phase.draft.trim()) {
      return;
    }
    const body = thread.phase.draft.trim();
    inFlight.current = true;
    setThread((prev) => ({ ...prev, phase: { kind: 'sending' } }));

    const result = await addAccommodationReply(token, currentReq.id, replyKey(), body);
    inFlight.current = false;

    if (result.kind === 'added' || result.kind === 'existing') {
      const listResult = await listAccommodationReplies(token, currentReq.id);
      const replies = listResult.kind === 'ok' ? listResult.replies : [result.reply];
      setThread((prev) => ({
        ...prev,
        replies,
        loaded: true,
        hasUnread: false,
        phase: { kind: 'idle' },
      }));
    } else if (result.kind === 'terminal') {
      setThread((prev) => ({ ...prev, phase: { kind: 'error', reason: 'terminal' } }));
    } else {
      setThread((prev) => ({ ...prev, phase: { kind: 'error', reason: 'failed' } }));
    }
  }

  async function onClaim() {
    if (inAction) return;
    setInAction(true);
    setActionError(null);
    const result = await claimAccommodationRequest(token, currentReq.id);
    setInAction(false);
    if (result.kind === 'claimed') {
      setCurrentReq(result.request);
      onStatusChange?.();
    } else if (result.kind === 'already_claimed') {
      setActionError('already_claimed');
      onStatusChange?.();
    } else {
      setActionError('failed');
    }
  }

  async function onResolve() {
    if (inAction) return;
    setInAction(true);
    setActionError(null);
    const result = await resolveAccommodationRequest(token, currentReq.id);
    setInAction(false);
    if (result.kind === 'resolved') {
      setCurrentReq(result.request);
      onStatusChange?.();
    } else {
      setActionError('failed');
    }
  }

  async function onCancelLearner() {
    if (inAction) return;
    setInAction(true);
    const result = await cancelAccommodationRequest(token, currentReq.id);
    setInAction(false);
    if (result.kind === 'cancelled') {
      setCurrentReq(result.request);
      onStatusChange?.();
    }
  }

  function onStartComposing() {
    setThread((prev) => ({
      ...prev,
      phase: { kind: 'composing', draft: '' },
    }));
    setTimeout(() => replyRef.current?.focus(), 0);
  }

  const stateLabel =
    currentReq.state === 'waiting' ? (
      <T k="accommodation.state.waiting" />
    ) : currentReq.state === 'claimed' ? (
      <T k="accommodation.state.claimed" />
    ) : currentReq.state === 'resolved' ? (
      <T k="accommodation.state.resolved" />
    ) : (
      <T k="accommodation.state.cancelled" />
    );

  return (
    <li
      className={`accommodation-inbox-item accommodation-inbox-item--${currentReq.state}`}
      data-testid={`accommodation-item-${currentReq.id}`}
    >
      <div className="accommodation-inbox-header">
        <span className="accommodation-inbox-state">{stateLabel}</span>
        <span className="accommodation-inbox-date">
          <T k="accommodation.inbox.requestedAt" /> {formatDate(currentReq.createdAt)}
        </span>
      </div>

      {/* Support description */}
      <div className="accommodation-inbox-description">
        <p dir="auto">
          <strong>
            <T k="accommodation.descriptionLabel" />:
          </strong>{' '}
          {currentReq.supportDescription}
        </p>
      </div>

      {/* Coordinator claim metadata */}
      {currentReq.claimedBy && (
        <p className="accommodation-inbox-claim-meta">
          {currentReq.claimedBy === currentUserId ? (
            <T k="accommodation.inbox.claimedByYou" />
          ) : (
            <T k="accommodation.inbox.claimedByOther" />
          )}
        </p>
      )}

      {/* Coordinator actions: Claim & Resolve */}
      {isCoordinator && currentReq.state === 'waiting' && (
        <div className="accommodation-inbox-actions">
          <button
            type="button"
            className="accommodation-claim-button"
            onClick={() => void onClaim()}
            disabled={inAction}
          >
            {inAction ? (
              <T k="accommodation.inbox.claiming" />
            ) : (
              <T k="accommodation.inbox.claim" />
            )}
          </button>
        </div>
      )}

      {isCoordinator && currentReq.state === 'claimed' && (
        <div className="accommodation-inbox-actions">
          <button
            type="button"
            className="accommodation-resolve-button"
            onClick={() => void onResolve()}
            disabled={inAction}
          >
            {inAction ? (
              <T k="accommodation.inbox.resolving" />
            ) : (
              <T k="accommodation.inbox.resolve" />
            )}
          </button>
        </div>
      )}

      {/* Learner action: Cancel waiting request */}
      {!isCoordinator && currentReq.state === 'waiting' && (
        <div className="accommodation-inbox-actions">
          <button
            type="button"
            className="accommodation-cancel-button"
            onClick={() => void onCancelLearner()}
            disabled={inAction}
          >
            <T k="accommodation.cancelButton" />
          </button>
        </div>
      )}

      {actionError && (
        <p role="alert" className="accommodation-action-error">
          <T k="accommodation.errorFailed" />
        </p>
      )}

      {/* Unread indicator */}
      {thread.hasUnread && (
        <span className="accommodation-inbox-unread" aria-live="polite">
          <T k="accommodation.inbox.unread" />{' '}
          <button
            type="button"
            className="accommodation-inbox-mark-read"
            onClick={() => void onMarkRead()}
          >
            <T k="accommodation.inbox.markRead" />
          </button>
        </span>
      )}

      {/* Thread replies */}
      {thread.loaded && thread.replies.length > 0 && (
        <ul className="accommodation-inbox-replies" aria-label="Reply thread">
          {thread.replies.map((r) => (
            <li
              key={r.id}
              className={`accommodation-inbox-reply ${
                r.authorId === currentReq.ownerId
                  ? 'accommodation-inbox-reply--learner'
                  : 'accommodation-inbox-reply--coordinator'
              }`}
            >
              <p className="accommodation-inbox-reply-body" dir="auto">
                {r.body}
              </p>
              <time className="accommodation-inbox-reply-time" dateTime={r.createdAt}>
                {formatDate(r.createdAt)}
              </time>
              {r.readAt === null && r.authorId !== currentUserId && (
                <span className="accommodation-inbox-reply-unread" aria-label="Unread" />
              )}
            </li>
          ))}
        </ul>
      )}

      {thread.loaded && thread.replies.length === 0 && currentReq.state !== 'cancelled' && (
        <p className="accommodation-inbox-no-replies">
          <T k="accommodation.inbox.noReplies" />
        </p>
      )}

      {/* Reply compose */}
      {isActive && thread.phase.kind === 'idle' && (
        <button type="button" className="accommodation-inbox-reply-btn" onClick={onStartComposing}>
          <T k="accommodation.inbox.reply" />
        </button>
      )}

      {isActive && thread.phase.kind === 'composing' && (
        <div className="accommodation-inbox-compose">
          <label htmlFor={textareaId}>
            <T k="accommodation.inbox.replyLabel" />
          </label>
          <textarea
            id={textareaId}
            ref={replyRef}
            value={thread.phase.draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={3}
            dir="auto"
            aria-required="true"
          />
          <button
            type="button"
            onClick={() => void onSendReply()}
            disabled={!thread.phase.draft.trim()}
          >
            <T k="accommodation.inbox.send" />
          </button>
        </div>
      )}

      {isActive && thread.phase.kind === 'sending' && (
        <p role="status">
          <T k="accommodation.inbox.sending" />
        </p>
      )}

      {thread.phase.kind === 'error' && (
        <p role="alert">
          {thread.phase.reason === 'terminal' ? (
            <T k="accommodation.inbox.replyTerminal" />
          ) : (
            <T k="accommodation.inbox.replyFailed" />
          )}
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Coordinator Inbox Component (role: 'support')
// ---------------------------------------------------------------------------
export function AccommodationCoordinatorInbox({
  token,
  currentUserId = '',
}: {
  readonly token: string;
  readonly currentUserId?: string;
}) {
  const [requests, setRequests] = useState<readonly AccommodationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [userId, setUserId] = useState(currentUserId);
  const headingId = useId();

  async function loadData() {
    setLoading(true);
    setError(false);
    const res = await listAccommodationRequests(token);
    setLoading(false);
    if (res.kind === 'ok') {
      setRequests(res.requests);
    } else {
      setError(true);
    }
  }

  useEffect(() => {
    void loadData();
    if (!currentUserId) {
      void fetchPrincipal(token).then((p) => {
        if (p) setUserId(p.id);
      });
    }
  }, [token, currentUserId]);

  return (
    <section className="accommodation-coordinator-inbox" aria-labelledby={headingId}>
      <h2 id={headingId}>
        <T k="accommodation.inbox.coordinatorHeading" />
      </h2>

      {loading && (
        <p role="status">
          <T k="accommodation.inbox.loading" />
        </p>
      )}

      {error && (
        <p role="alert">
          <T k="accommodation.inbox.loadError" />
        </p>
      )}

      {!loading && !error && requests.length === 0 && (
        <p className="accommodation-inbox-empty">
          <T k="accommodation.inbox.noRequests" />
        </p>
      )}

      {!loading && !error && requests.length > 0 && (
        <ul className="accommodation-inbox-list" aria-label="Accommodation requests list">
          {requests.map((req) => (
            <AccommodationRequestItem
              key={req.id}
              req={req}
              token={token}
              currentUserId={userId}
              isCoordinator={true}
              onStatusChange={() => void loadData()}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Learner Accommodation Panel (role: 'learner')
// Handles both request creation and tracking existing requests across reloads
// ---------------------------------------------------------------------------
export function AccommodationLearnerPanel({
  token,
  currentUserId = '',
}: {
  readonly token: string;
  readonly currentUserId?: string;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [ownedRequests, setOwnedRequests] = useState<readonly AccommodationRequest[]>([]);
  const [userId, setUserId] = useState(currentUserId);
  const inFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const ids = {
    heading: useId(),
    job: useId(),
    description: useId(),
    status: useId(),
    inboxHeading: useId(),
  };

  async function loadOwned() {
    const result = await listAccommodationRequests(token);
    if (result.kind === 'ok') {
      setOwnedRequests(result.requests);
    }
  }

  // Load owned requests on mount so state survives reload!
  useEffect(() => {
    void loadOwned();
    if (!currentUserId) {
      void fetchPrincipal(token).then((p) => {
        if (p) setUserId(p.id);
      });
    }
  }, [token, currentUserId]);

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
      statusRef.current?.focus();
      void loadOwned();
    } else {
      setPhase({ kind: 'error', message: result.kind });
    }
  }

  async function onCancelWaiting() {
    if (inFlight.current || phase.kind !== 'waiting') return;
    inFlight.current = true;

    const result = await cancelAccommodationRequest(token, phase.request.id);
    inFlight.current = false;

    if (result.kind === 'cancelled' || result.kind === 'not_found') {
      setPhase({ kind: 'cancelled' });
      statusRef.current?.focus();
      void loadOwned();
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

      {phase.kind === 'idle' && (
        <>
          <p>
            <T k="accommodation.intro" />
          </p>
          <button type="button" onClick={() => void startRequest()}>
            <T k="accommodation.startButton" />
          </button>
        </>
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
          <button type="button" onClick={() => void onCancelWaiting()}>
            <T k="accommodation.cancelButton" />
          </button>
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

      {/* Persistent requests list surviving page reload */}
      {ownedRequests.length > 0 && (
        <section className="accommodation-inbox" aria-labelledby={ids.inboxHeading}>
          <h3 id={ids.inboxHeading}>
            <T k="accommodation.inbox.heading" />
          </h3>
          <ul className="accommodation-inbox-list" aria-label="Your accommodation requests">
            {ownedRequests.map((req) => (
              <AccommodationRequestItem
                key={req.id}
                req={req}
                token={token}
                currentUserId={userId}
                isCoordinator={false}
                onStatusChange={() => void loadOwned()}
              />
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Unified AccommodationPanel: dynamically renders Coordinator or Learner view
// based on prop or detected principal role.
// ---------------------------------------------------------------------------
export function AccommodationPanel({
  token,
  role,
}: {
  readonly token: string;
  readonly role?: 'learner' | 'support';
}) {
  const [detectedRole, setDetectedRole] = useState<'learner' | 'support' | null>(role ?? null);

  useEffect(() => {
    if (role) {
      setDetectedRole(role);
      return;
    }
    let cancelled = false;
    void fetchPrincipal(token).then((p) => {
      if (cancelled) return;
      if (p?.role === 'support') {
        setDetectedRole('support');
      } else {
        setDetectedRole('learner');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, role]);

  if (detectedRole === 'support') {
    return <AccommodationCoordinatorInbox token={token} />;
  }

  return <AccommodationLearnerPanel token={token} />;
}
