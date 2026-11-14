// Persistent learner help inbox (T3-016-B).
// Lists the learner's own help requests with state and unread indicators.
// Replies are labelled as fixtures until T3-017-B integrates real staff replies.
import { useEffect, useId, useState } from 'react';
import { T } from '../../shared/i18n/i18n.tsx';
import { listHelpRequests, type HelpRequest } from './help-api.ts';

type LoadPhase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok'; readonly requests: readonly HelpRequest[] }
  | { readonly kind: 'error' };

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
            <li key={req.id} className={`help-inbox-item help-inbox-item--${req.state}`}>
              <span className="help-inbox-state">
                {req.state === 'waiting' ? (
                  <T k="inbox.state.waiting" />
                ) : req.state === 'claimed' ? (
                  <T k="inbox.state.claimed" />
                ) : (
                  <T k="inbox.state.cancelled" />
                )}
              </span>
              <span className="help-inbox-date">
                <T k="inbox.requestedAt" /> {formatDate(req.createdAt)}
              </span>
              {/* Replies are not yet implemented (T3-017-B). The inbox is ready
                  for future staff reply integration. */}
              <p className="help-inbox-no-replies">
                <T k="inbox.noReplies" />
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
