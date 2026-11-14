// Learner accommodation request panel (T3-022-A).
// Multi-step: idle → job selection → description → preview → submitted → waiting → cancelled.
// Nothing is persisted until the learner confirms the preview.
// Private by design: only the learner and an authorised coordinator see this content.
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { T } from '../../shared/i18n/i18n.tsx';
import {
  cancelAccommodationRequest,
  listJobs,
  submitAccommodationRequest,
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

function requestKey(): string {
  return `ar-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AccommodationPanel({ token }: { readonly token: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const inFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const ids = {
    heading: useId(),
    job: useId(),
    description: useId(),
    status: useId(),
  };

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
    // Re-fetch jobs on back (jobs list is not retained in composing phase)
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
    } else {
      setPhase({ kind: 'error', message: result.kind });
    }
  }

  async function onCancel() {
    if (inFlight.current || phase.kind !== 'waiting') return;
    inFlight.current = true;

    const result = await cancelAccommodationRequest(token, phase.request.id);
    inFlight.current = false;

    if (result.kind === 'cancelled' || result.kind === 'not_found') {
      setPhase({ kind: 'cancelled' });
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
          <button type="button" onClick={() => void onCancel()}>
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
    </section>
  );
}
