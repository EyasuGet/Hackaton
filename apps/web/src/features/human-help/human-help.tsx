// Learner help request panel (T3-016-A). The learner writes the context they
// want to share, sees the disclosure notice, then confirms in a single action.
// Nothing is persisted until the learner confirms. A cancel button appears
// while the request is waiting.
//
// No promise of staff availability is made here (spec R04 §6).
// For phones without screen sharing (T3-048), the learner may add what the assistant
// shows as editable text, and attach one screenshot; nothing is captured without
// their action, and they can remove the screenshot at any time.
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { T, useT, type MessageKey } from '../../shared/i18n/i18n.tsx';
import {
  attachScreenshot,
  cancelHelpRequest,
  removeScreenshot,
  submitHelpRequest,
  type HelpRequest,
} from './help-api.ts';

const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const SCREENSHOT_MAX_BYTES = 1024 * 1024;

/**
 * The visible conversation as text. Only rendered messages are read; text fields
 * (including an unsent question) are never included.
 */
function assistantSnapshot(): string {
  return Array.from(document.querySelectorAll('.messages .message'))
    .map((message) => {
      const speaker = message.querySelector('.speaker')?.textContent?.trim() ?? '';
      const text = message.querySelector('.message-text')?.textContent?.trim() ?? '';
      return `${speaker}: ${text}`;
    })
    .join('\n');
}

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
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [screenshotNote, setScreenshotNote] = useState<MessageKey | null>(null);
  const [screenshotAttached, setScreenshotAttached] = useState(false);
  const t = useT();
  const inFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const ids = {
    heading: useId(),
    context: useId(),
    disclosure: useId(),
    status: useId(),
    shareHint: useId(),
    screenshot: useId(),
    screenshotHint: useId(),
  };

  useEffect(() => {
    if (!screenshot) return setPreview(null);
    const url = URL.createObjectURL(screenshot);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  function onShareView() {
    const snapshot = assistantSnapshot();
    if (!snapshot) {
      setScreenshotNote('help.snapshotEmpty');
      return;
    }
    setScreenshotNote(null);
    const shared = `${t('help.snapshotHeading')}\n${snapshot}`;
    setDraft((prev) => (prev.trim() ? `${prev.trim()}\n\n${shared}` : shared));
  }

  function onScreenshotChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;
    if (!SCREENSHOT_TYPES.includes(file.type)) return setScreenshotNote('help.screenshotType');
    if (file.size > SCREENSHOT_MAX_BYTES) return setScreenshotNote('help.screenshotTooLarge');
    setScreenshotNote(null);
    setScreenshot(file);
  }

  async function onRemoveAttached(request: HelpRequest) {
    if (await removeScreenshot(token, request.id)) {
      setScreenshotAttached(false);
      setScreenshotNote('help.screenshotRemoved');
    }
  }

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
      if (screenshot) {
        const attached = await attachScreenshot(token, result.request.id, screenshot);
        setScreenshotAttached(attached);
        setScreenshotNote(attached ? null : 'help.screenshotAttachFailed');
        setScreenshot(null);
      }
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
    setScreenshot(null);
    setScreenshotAttached(false);
    setScreenshotNote(null);
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
          <button type="button" onClick={onShareView} aria-describedby={ids.shareHint}>
            <T k="help.shareView" />
          </button>
          <p id={ids.shareHint} className="hint">
            <T k="help.shareViewHint" />
          </p>
          <label htmlFor={ids.screenshot}>
            <T k="help.screenshotLabel" />
          </label>
          <p id={ids.screenshotHint} className="hint">
            <T k="help.screenshotHint" />
          </p>
          <input
            id={ids.screenshot}
            type="file"
            accept={SCREENSHOT_TYPES.join(',')}
            onChange={onScreenshotChange}
            aria-describedby={ids.screenshotHint}
          />
          {preview && (
            <figure className="help-screenshot-preview">
              <img src={preview} alt={t('help.screenshotPreview')} />
              <button type="button" onClick={() => setScreenshot(null)}>
                <T k="help.screenshotRemove" />
              </button>
            </figure>
          )}
          {screenshotNote && (
            <p role="status">
              <T k={screenshotNote} />
            </p>
          )}
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
            {preview && (
              <>
                <p>
                  <T k="help.screenshotIncluded" />
                </p>
                <img
                  className="help-screenshot-preview"
                  src={preview}
                  alt={t('help.screenshotPreview')}
                />
              </>
            )}
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
          {screenshotAttached && (
            <button type="button" onClick={() => void onRemoveAttached(phase.request)}>
              <T k="help.screenshotRemove" />
            </button>
          )}
          {screenshotNote && (
            <p role={screenshotNote === 'help.screenshotAttachFailed' ? 'alert' : 'status'}>
              <T k={screenshotNote} />
            </p>
          )}
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
