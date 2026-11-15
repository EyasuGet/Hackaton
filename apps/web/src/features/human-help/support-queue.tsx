// Support staff queue component (T3-055).
// Allows support staff to view waiting requests, claim requests, inspect shared context,
// converse with learners via replies, access screen sharing, and resolve requests.
// Rendered only for the support role (checked via /api/me, failing closed).
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { T, useT } from '../../shared/i18n/i18n.tsx';
import { ScreenShare } from '../sharing/screen-share.tsx';
import {
  addReply,
  claimHelpRequest,
  listAssignedRequests,
  listQueue,
  listReplies,
  markRepliesRead,
  resolveHelpRequest,
  type HelpReply,
  type HelpRequest,
  type QueueItem,
} from './help-api.ts';

interface SupportQueueProps {
  readonly token: string;
}

/** True once the API confirms the signed-in principal has the support role. */
export function useIsSupport(sessionToken: string): boolean {
  const [isSupport, setIsSupport] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setIsSupport(false);
    fetch('/api/me', {
      headers: { authorization: `Bearer ${sessionToken}` },
      signal: controller.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ role?: unknown }>) : null))
      .then((me) => setIsSupport(me?.role === 'support'))
      // Fail closed: an aborted or failed lookup leaves the portal hidden.
      .catch(() => {});
    return () => controller.abort();
  }, [sessionToken]);
  return isSupport;
}

export function SupportQueue({ token }: SupportQueueProps) {
  const isSupport = useIsSupport(token);
  return isSupport ? <SupportQueuePanel token={token} /> : null;
}

function formatAge(createdAt: string): string {
  try {
    const diffMs = Date.now() - new Date(createdAt).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return '< 1m';
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d`;
  } catch {
    return createdAt;
  }
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

function replyKey(): string {
  return `sr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function SupportQueuePanel({ token }: SupportQueueProps) {
  const t = useT();
  const headingId = useId();
  const [waiting, setWaiting] = useState<readonly QueueItem[]>([]);
  const [assigned, setAssigned] = useState<readonly HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [conflictNote, setConflictNote] = useState<string | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('');

  const refreshAll = async () => {
    const [queueRes, assignedRes] = await Promise.all([
      listQueue(token),
      listAssignedRequests(token),
    ]);

    if (queueRes.kind === 'ok') {
      setWaiting(queueRes.queue);
    } else {
      setLoadError(true);
    }

    if (assignedRes.kind === 'ok') {
      setAssigned(assignedRes.requests);
    } else {
      setLoadError(true);
    }

    setLoading(false);
  };

  useEffect(() => {
    void refreshAll();
    const timer = setInterval(() => {
      void refreshAll();
    }, 10000);
    return () => clearInterval(timer);
  }, [token]);

  const handleClaim = async (id: string) => {
    setClaimingId(id);
    setConflictNote(null);
    try {
      const result = await claimHelpRequest(token, id);
      if (result.kind === 'claimed') {
        setLiveAnnouncement(t('inbox.state.claimed'));
        // Add to assigned list and remove from waiting list
        setAssigned((prev) => [result.request, ...prev.filter((r) => r.id !== id)]);
        setWaiting((prev) => prev.filter((item) => item.id !== id));
      } else if (result.kind === 'already_claimed') {
        const message = t('supportQueue.conflict');
        setConflictNote(message);
        setLiveAnnouncement(message);
        // Refresh queue
        const queueRes = await listQueue(token);
        if (queueRes.kind === 'ok') setWaiting(queueRes.queue);
      } else {
        setConflictNote(t('supportQueue.claimError'));
      }
    } finally {
      setClaimingId(null);
    }
  };

  const handleResolved = (id: string) => {
    setAssigned((prev) => prev.filter((r) => r.id !== id));
    setLiveAnnouncement(t('supportQueue.resolvedSuccess'));
  };

  return (
    <section className="support-queue-panel" aria-labelledby={headingId}>
      <h2 id={headingId}>
        <T k="supportQueue.heading" />
      </h2>

      {/* Polite live region for screen-reader announcements */}
      <div role="status" aria-live="polite" className="sr-only">
        {liveAnnouncement}
      </div>

      {loading && (
        <p role="status">
          <T k="supportQueue.loading" />
        </p>
      )}

      {loadError && (
        <p role="alert" className="problem">
          <T k="supportQueue.loadError" />
        </p>
      )}

      {conflictNote && (
        <p role="alert" className="problem">
          {conflictNote}
        </p>
      )}

      {!loading && !loadError && (
        <>
          {/* Waiting Requests Section */}
          <section
            className="support-waiting-section"
            aria-label={t('supportQueue.waitingHeading')}
          >
            <h3>
              <T k="supportQueue.waitingHeading" />
            </h3>
            {waiting.length === 0 ? (
              <p>
                <T k="supportQueue.noWaiting" />
              </p>
            ) : (
              <ul className="support-waiting-list">
                {waiting.map((item) => (
                  <li key={item.id} className="support-waiting-item">
                    <div className="support-waiting-meta">
                      <span className="support-request-age">
                        <T k="supportQueue.age" /> {formatAge(item.createdAt)}
                      </span>
                      <time dateTime={item.createdAt} className="support-request-time">
                        {formatDate(item.createdAt)}
                      </time>
                    </div>
                    <button
                      type="button"
                      disabled={claimingId === item.id}
                      onClick={() => {
                        void handleClaim(item.id);
                      }}
                      className="claim-button"
                    >
                      {claimingId === item.id ? (
                        <T k="supportQueue.claiming" />
                      ) : (
                        <T k="supportQueue.claim" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Assigned (Claimed) Requests Section */}
          <section
            className="support-assigned-section"
            aria-label={t('supportQueue.assignedHeading')}
          >
            <h3>
              <T k="supportQueue.assignedHeading" />
            </h3>
            {assigned.length === 0 ? (
              <p>
                <T k="supportQueue.noAssigned" />
              </p>
            ) : (
              <ul className="support-assigned-list">
                {assigned.map((req) => (
                  <AssignedRequestItem
                    key={req.id}
                    req={req}
                    token={token}
                    onResolved={handleResolved}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}

interface AssignedRequestItemProps {
  readonly req: HelpRequest;
  readonly token: string;
  readonly onResolved: (id: string) => void;
}

function AssignedRequestItem({ req, token, onResolved }: AssignedRequestItemProps) {
  const t = useT();
  const replyInputId = useId();
  const [replies, setReplies] = useState<readonly HelpReply[]>([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const previousReplyCount = useRef<number>(0);

  const fetchReplies = async () => {
    const result = await listReplies(token, req.id);
    if (result.kind === 'ok') {
      if (previousReplyCount.current > 0 && result.replies.length > previousReplyCount.current) {
        // Unread replies from learner
        void markRepliesRead(token, req.id);
      }
      previousReplyCount.current = result.replies.length;
      setReplies(result.replies);
    }
  };

  useEffect(() => {
    void fetchReplies();
    const timer = setInterval(() => {
      void fetchReplies();
    }, 5000);
    return () => clearInterval(timer);
  }, [token, req.id]);

  const handleSendReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || isSending) return;
    setIsSending(true);
    setSendError(null);
    try {
      const result = await addReply(token, req.id, replyKey(), draft.trim());
      if (result.kind === 'added' || result.kind === 'existing') {
        setDraft('');
        await fetchReplies();
      } else if (result.kind === 'terminal') {
        setSendError(t('inbox.replyTerminal'));
      } else {
        setSendError(t('inbox.replyFailed'));
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleResolve = async () => {
    setIsResolving(true);
    setResolveError(null);
    try {
      const result = await resolveHelpRequest(token, req.id);
      if (result.kind === 'resolved') {
        onResolved(req.id);
      } else {
        setResolveError(t('supportQueue.resolveError'));
      }
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <li className="support-assigned-item">
      <div className="support-assigned-header">
        <div className="support-assigned-meta">
          <span className="badge">
            <T k="inbox.state.claimed" />
          </span>
          <time dateTime={req.createdAt} className="support-request-time">
            <T k="supportQueue.requestedAt" /> {formatDate(req.createdAt)}
          </time>
        </div>
        <button
          type="button"
          disabled={isResolving}
          onClick={() => {
            void handleResolve();
          }}
          className="resolve-button"
        >
          {isResolving ? <T k="supportQueue.resolving" /> : <T k="supportQueue.resolve" />}
        </button>
      </div>

      {resolveError && (
        <p role="alert" className="problem">
          {resolveError}
        </p>
      )}

      {/* Shared learner context snapshot */}
      <div className="support-context-snapshot">
        <h4>
          <T k="supportQueue.contextHeading" />
        </h4>
        <p dir="auto" className="context-text">
          {req.contextSnapshot}
        </p>
      </div>

      {/* Screen Sharing Component for Support Role */}
      <ScreenShare token={token} helpRequestId={req.id} role="support" />

      {/* Conversation Thread */}
      <div className="support-reply-thread">
        <h4>
          <T k="supportQueue.repliesHeading" />
        </h4>
        {replies.length === 0 ? (
          <p className="no-replies">
            <T k="inbox.noReplies" />
          </p>
        ) : (
          <ul className="support-replies-list">
            {replies.map((reply) => {
              const isMe = reply.authorId === req.claimedBy;
              return (
                <li
                  key={reply.id}
                  className={`support-reply-item ${isMe ? 'support-author-me' : 'support-author-learner'}`}
                >
                  <div className="support-reply-meta">
                    <span className="reply-author">
                      {isMe ? <T k="status.available" /> : <T k="app.title" />}
                    </span>
                    <time dateTime={reply.createdAt} className="reply-time">
                      {formatDate(reply.createdAt)}
                    </time>
                  </div>
                  <p dir="auto" className="reply-body">
                    {reply.body}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {/* Reply Composer Form */}
        <form
          onSubmit={(e) => {
            void handleSendReply(e);
          }}
          className="support-reply-form"
        >
          <label htmlFor={replyInputId}>
            <T k="inbox.replyLabel" />
          </label>
          <textarea
            id={replyInputId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('inbox.replyPlaceholder')}
            rows={3}
          />
          {sendError && (
            <p role="alert" className="problem">
              {sendError}
            </p>
          )}
          <button type="submit" disabled={isSending || !draft.trim()} className="send-reply-button">
            {isSending ? <T k="inbox.sending" /> : <T k="inbox.send" />}
          </button>
        </form>
      </div>
    </li>
  );
}
