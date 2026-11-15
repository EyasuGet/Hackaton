// Persistent learner help inbox with two-sided reply thread (T3-016-B, T3-017-B).
// Lists the learner's own help requests with state, unread indicators, and
// a reply thread for claimed requests. Resolved and cancelled requests are
// shown as read-only.
import { useEffect, useId, useRef, useState } from 'react';
import { T } from '../../shared/i18n/i18n.tsx';
import { ScreenShare } from '../sharing/screen-share.tsx';
import {
  addReply,
  listHelpRequests,
  listReplies,
  markRepliesRead,
  type HelpReply,
  type HelpRequest,
} from './help-api.ts';

type LoadPhase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok'; readonly requests: readonly HelpRequest[] }
  | { readonly kind: 'error' };

type ReplyPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'composing'; readonly draft: string }
  | { readonly kind: 'sending' }
  | { readonly kind: 'error'; readonly reason: 'failed' | 'terminal' };

interface ReplyThreadState {
  readonly replies: readonly HelpReply[];
  readonly loaded: boolean;
  readonly hasUnread: boolean;
  readonly phase: ReplyPhase;
}

function replyKey(): string {
  return `rr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

function hasUnreadReplies(replies: readonly HelpReply[], ownerId: string): boolean {
  // A reply is "unread" for the learner when it was written by someone else (staff)
  // and has no readAt timestamp.
  return replies.some((r) => r.authorId !== ownerId && r.readAt === null);
}

function RequestItem({ req, token }: { readonly req: HelpRequest; readonly token: string }) {
  const [thread, setThread] = useState<ReplyThreadState>({
    replies: [],
    loaded: false,
    hasUnread: false,
    phase: { kind: 'idle' },
  });
  const inFlight = useRef(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const textareaId = useId();
  const isActive = req.state === 'claimed' || req.state === 'waiting';

  // Load replies when the request is claimed or waiting.
  useEffect(() => {
    if (!isActive && req.state !== 'resolved') return;
    let cancelled = false;
    void (async () => {
      const result = await listReplies(token, req.id);
      if (cancelled) return;
      if (result.kind === 'ok') {
        const unread = hasUnreadReplies(result.replies, req.ownerId);
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
  }, [token, req.id, req.ownerId, isActive, req.state]);

  async function onMarkRead() {
    if (inFlight.current) return;
    inFlight.current = true;
    await markRepliesRead(token, req.id);
    inFlight.current = false;
    setThread((prev) => ({
      ...prev,
      hasUnread: false,
      replies: prev.replies.map((r) =>
        r.authorId !== req.ownerId && r.readAt === null
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

  async function onSend() {
    if (inFlight.current || thread.phase.kind !== 'composing' || !thread.phase.draft.trim()) return;
    const body = thread.phase.draft.trim();
    inFlight.current = true;
    setThread((prev) => ({ ...prev, phase: { kind: 'sending' } }));

    const result = await addReply(token, req.id, replyKey(), body);
    inFlight.current = false;

    if (result.kind === 'added' || result.kind === 'existing') {
      // Reload the full reply list to stay consistent after the send.
      const listResult = await listReplies(token, req.id);
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

  function onStartComposing() {
    setThread((prev) => ({
      ...prev,
      phase: { kind: 'composing', draft: '' },
    }));
    // Focus the textarea after state update.
    setTimeout(() => replyRef.current?.focus(), 0);
  }

  const stateLabel =
    req.state === 'waiting' ? (
      <T k="inbox.state.waiting" />
    ) : req.state === 'claimed' ? (
      <T k="inbox.state.claimed" />
    ) : req.state === 'resolved' ? (
      <T k="inbox.state.resolved" />
    ) : (
      <T k="inbox.state.cancelled" />
    );

  return (
    <li className={`help-inbox-item help-inbox-item--${req.state}`}>
      <span className="help-inbox-state">{stateLabel}</span>
      <span className="help-inbox-date">
        <T k="inbox.requestedAt" /> {formatDate(req.createdAt)}
      </span>

      {/* Unread indicator */}
      {thread.hasUnread && (
        <span className="help-inbox-unread" aria-live="polite">
          <T k="inbox.unread" />{' '}
          <button type="button" className="help-inbox-mark-read" onClick={() => void onMarkRead()}>
            <T k="inbox.markRead" />
          </button>
        </span>
      )}

      {/* Reply thread */}
      {thread.loaded && thread.replies.length > 0 && (
        <ul className="help-inbox-replies" aria-label="Reply thread">
          {thread.replies.map((r) => (
            <li
              key={r.id}
              className={`help-inbox-reply ${r.authorId === req.ownerId ? 'help-inbox-reply--learner' : 'help-inbox-reply--staff'}`}
            >
              <p className="help-inbox-reply-body" dir="auto">
                {r.body}
              </p>
              <time className="help-inbox-reply-time" dateTime={r.createdAt}>
                {formatDate(r.createdAt)}
              </time>
              {r.readAt === null && r.authorId !== req.ownerId && (
                <span className="help-inbox-reply-unread" aria-label="Unread" />
              )}
            </li>
          ))}
        </ul>
      )}

      {thread.loaded && thread.replies.length === 0 && req.state !== 'cancelled' && (
        <p className="help-inbox-no-replies">
          <T k="inbox.noReplies" />
        </p>
      )}

      {/* Meeting arrangement note for active requests */}
      {isActive && (
        <p className="help-inbox-meeting-note" role="note">
          <T k="inbox.meetingNote" />
        </p>
      )}

      {/* Screen sharing for claimed requests (T3-018-B) */}
      {req.state === 'claimed' && (
        <ScreenShare token={token} helpRequestId={req.id} role="learner" />
      )}

      {/* Reply compose for active requests */}
      {isActive && thread.phase.kind === 'idle' && (
        <button type="button" className="help-inbox-reply-btn" onClick={onStartComposing}>
          <T k="inbox.reply" />
        </button>
      )}

      {isActive && thread.phase.kind === 'composing' && (
        <div className="help-inbox-compose">
          <label htmlFor={textareaId}>
            <T k="inbox.replyLabel" />
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
          <button type="button" onClick={() => void onSend()} disabled={!thread.phase.draft.trim()}>
            <T k="inbox.send" />
          </button>
        </div>
      )}

      {isActive && thread.phase.kind === 'sending' && (
        <p role="status">
          <T k="inbox.sending" />
        </p>
      )}

      {thread.phase.kind === 'error' && (
        <p role="alert">
          {thread.phase.reason === 'terminal' ? (
            <T k="inbox.replyTerminal" />
          ) : (
            <T k="inbox.replyFailed" />
          )}
        </p>
      )}
    </li>
  );
}

export function HelpInbox({ token }: { readonly token: string }) {
  const [phase, setPhase] = useState<LoadPhase>({ kind: 'loading' });
  const headingId = useId();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listHelpRequests(token);
      if (cancelled) return;
      if (result.kind === 'ok') {
        setPhase({ kind: 'ok', requests: result.requests });
      } else {
        setPhase({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <section className="help-inbox" aria-labelledby={headingId}>
      <h2 id={headingId}>
        <T k="inbox.heading" />
      </h2>

      {phase.kind === 'loading' && (
        <p role="status">
          <T k="inbox.loading" />
        </p>
      )}

      {phase.kind === 'error' && (
        <p role="alert">
          <T k="inbox.loadError" />
        </p>
      )}

      {phase.kind === 'ok' && phase.requests.length === 0 && (
        <p>
          <T k="inbox.noRequests" />
        </p>
      )}

      {phase.kind === 'ok' && phase.requests.length > 0 && (
        <ul className="help-inbox-list">
          {phase.requests.map((req) => (
            <RequestItem key={req.id} req={req} token={token} />
          ))}
        </ul>
      )}
    </section>
  );
}
