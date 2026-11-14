// Learner help request panel (T3-016-A). The learner writes the context they
// want to share, sees the disclosure notice, then confirms in a single action.
// Nothing is persisted until the learner confirms. A cancel button appears
// while the request is waiting.
//
// No promise of staff availability is made here (spec R04 §6).
// No screen capture is requested in this leaf (spec R05).
import { useId, useRef, useState, type FormEvent } from 'react';
import { T } from '../../shared/i18n/i18n.tsx';
import { cancelHelpRequest, submitHelpRequest, type HelpRequest } from './help-api.ts';

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'composing' }
  | { readonly kind: 'disclosing'; readonly context: string }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'waiting'; readonly request: HelpRequest }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'error'; readonly message: 'denied' | 'failed' };

function requestKey(): string {
  return `hr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function HumanHelp({ token }: { readonly token: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [draft, setDraft] = useState('');
  const inFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const ids = {
    heading: useId(),
    context: useId(),
    disclosure: useId(),
    status: useId(),
  };

  function startComposing() {
    setPhase({ kind: 'composing' });
  }

  function onContextSubmit(event: FormEvent) {
    event.preventDefault();
    const context = draft.trim();
    if (!context) return;
    setPhase({ kind: 'disclosing', context });
  }

  async function onConfirm() {
    if (inFlight.current || phase.kind !== 'disclosing') return;
    inFlight.current = true;
    setPhase({ kind: 'submitting' });

    const result = await submitHelpRequest(token, requestKey(), phase.context);
    inFlight.current = false;

    if (result.kind === 'submitted' || result.kind === 'existing') {
      setPhase({ kind: 'waiting', request: result.request });
      // Move focus to the status region so screen readers announce the new state.
      statusRef.current?.focus();
    } else {
      setPhase({ kind: 'error', message: result.kind });
    }
  }

  async function onCancel() {
    if (inFlight.current || phase.kind !== 'waiting') return;
    inFlight.current = true;

    const result = await cancelHelpRequest(token, phase.request.id);
    inFlight.current = false;

    if (result.kind === 'cancelled') {
      setPhase({ kind: 'cancelled' });
      statusRef.current?.focus();
    } else if (result.kind === 'not_found') {
      // Already cancelled or expired elsewhere; treat as done.
      setPhase({ kind: 'cancelled' });
      statusRef.current?.focus();
    } else {
      setPhase({ kind: 'error', message: result.kind === 'denied' ? 'denied' : 'failed' });
    }
  }

  function onBack() {
    if (phase.kind === 'disclosing') {
      setPhase({ kind: 'composing' });
    }
  }

  function onRetry() {
    setPhase({ kind: 'idle' });
    setDraft('');
  }

  return (
    <section className="human-help" aria-labelledby={ids.heading}>
      <h2 id={ids.heading}>
        <T k="help.heading" />
      </h2>

      {phase.kind === 'idle' && (
        <>
          <p>
            <T k="help.intro" />
          </p>
          <button type="button" onClick={startComposing}>
            <T k="help.requestButton" />
          </button>
        </>
      )}

      {phase.kind === 'composing' && (
        <form onSubmit={onContextSubmit} noValidate>
          <p>
            <T k="help.contextPrompt" />
          </p>
          <label htmlFor={ids.context}>
            <T k="help.contextLabel" />
          </label>
          <textarea
            id={ids.context}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            dir="auto"
            aria-required="true"
          />
          <div className="actions">
            <button type="submit" disabled={!draft.trim()}>
              <T k="help.reviewButton" />
            </button>
            <button type="button" onClick={onRetry}>
              <T k="help.cancelDraft" />
            </button>
          </div>
        </form>
      )}

      {phase.kind === 'disclosing' && (
        <div>
          {/* The disclosure notice must be visible and readable before submission. */}
          <div className="help-disclosure" role="region" aria-labelledby={ids.disclosure}>
            <h3 id={ids.disclosure}>
              <T k="help.disclosureHeading" />
            </h3>
            <p>
              <T k="help.disclosureBody" />
            </p>
            <p className="help-disclosure-note">
              <T k="help.disclosureNoStaffPromise" />
            </p>
          </div>
          <div className="help-preview">
            <p>
              <strong>
                <T k="help.previewLabel" />
              </strong>
            </p>
            <blockquote dir="auto">{phase.context}</blockquote>
          </div>
          <div className="actions">
            <button type="button" onClick={() => void onConfirm()}>
              <T k="help.confirmButton" />
            </button>
            <button type="button" onClick={onBack}>
              <T k="help.backButton" />
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'submitting' && (
        <p role="status">
          <T k="help.submitting" />
        </p>
      )}

      {phase.kind === 'waiting' && (
        <div>
          <p ref={statusRef} tabIndex={-1} role="status" id={ids.status}>
            <T k="help.waiting" />
          </p>
          <p className="help-no-promise" role="note">
            <T k="help.noStaffPromise" />
          </p>
          <button type="button" onClick={() => void onCancel()}>
            <T k="help.cancelButton" />
          </button>
        </div>
      )}

      {phase.kind === 'cancelled' && (
        <div>
          <p ref={statusRef} tabIndex={-1} role="status">
            <T k="help.cancelled" />
          </p>
          <button type="button" onClick={onRetry}>
            <T k="help.requestButton" />
          </button>
        </div>
      )}

      {phase.kind === 'error' && (
        <div>
          <p role="alert">
            {phase.message === 'denied' ? <T k="help.errorDenied" /> : <T k="help.errorFailed" />}
          </p>
          <button type="button" onClick={onRetry}>
            <T k="help.requestButton" />
          </button>
        </div>
      )}
    </section>
  );
}
