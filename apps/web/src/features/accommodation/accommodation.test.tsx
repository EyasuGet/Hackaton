// Unit tests for AccommodationPanel component (T3-022-A).
// Tests: disclosure gate (nothing submitted until confirmed), job selection required,
// preview shown before submit, cancel appears after submission, and error states.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './accommodation-api.ts';
import { AccommodationPanel } from './accommodation.tsx';
import type { AccommodationRequest, Job } from './accommodation-api.ts';
import { LocaleContext } from '../../shared/i18n/i18n.tsx';

function wrap(ui: React.ReactElement) {
  return render(<LocaleContext value="en">{ui}</LocaleContext>);
}

const FAKE_JOB: Job = {
  id: 'job-uuid-1',
  title: 'Software Engineer',
  organization: 'Example Corp',
  category: 'tech',
  location: 'Remote',
  sourceUrl: 'https://example.com/job/1',
};

const FAKE_REQUEST: AccommodationRequest = {
  id: 'req-uuid-1',
  ownerId: 'owner-1',
  jobId: FAKE_JOB.id,
  clientRequestId: 'client-key-1',
  supportDescription: 'I need extra time.',
  state: 'waiting',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAt: null,
  claimedBy: null,
  claimedAt: null,
  resolvedBy: null,
  resolvedAt: null,
};

afterEach(cleanup);

describe('AccommodationPanel (T3-022-A)', () => {
  it('shows start button in idle state', () => {
    wrap(<AccommodationPanel token="tok" />);
    expect(screen.getByRole('button', { name: /start a request/i })).toBeTruthy();
  });

  it('preview and confirm gate: submitAccommodationRequest not called until confirmed', async () => {
    vi.spyOn(api, 'listJobs').mockResolvedValue({ kind: 'ok', jobs: [FAKE_JOB] });
    const submitSpy = vi.spyOn(api, 'submitAccommodationRequest').mockResolvedValue({
      kind: 'submitted',
      request: FAKE_REQUEST,
    });

    wrap(<AccommodationPanel token="tok" />);
    fireEvent.click(screen.getByRole('button', { name: /start a request/i }));

    // Wait for job selection step
    await waitFor(() => screen.getByRole('combobox'));

    // Submit job selection form
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Fill description
    await waitFor(() => screen.getByRole('textbox'));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'I need extra time.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /review before sending/i }));

    // Preview must be visible and submit not yet called
    await waitFor(() => screen.getByText(/review your request/i));
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('submits only after confirm and shows waiting state with cancel button', async () => {
    vi.spyOn(api, 'listJobs').mockResolvedValue({ kind: 'ok', jobs: [FAKE_JOB] });
    vi.spyOn(api, 'submitAccommodationRequest').mockResolvedValue({
      kind: 'submitted',
      request: FAKE_REQUEST,
    });

    wrap(<AccommodationPanel token="tok" />);
    fireEvent.click(screen.getByRole('button', { name: /start a request/i }));

    await waitFor(() => screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => screen.getByRole('textbox'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Extra time needed.' } });
    fireEvent.click(screen.getByRole('button', { name: /review before sending/i }));

    await waitFor(() => screen.getByText(/review your request/i));
    fireEvent.click(screen.getByRole('button', { name: /confirm and send/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel this request/i })).toBeTruthy();
    });
  });

  it('shows cancelled state after clicking cancel', async () => {
    vi.spyOn(api, 'listJobs').mockResolvedValue({ kind: 'ok', jobs: [FAKE_JOB] });
    vi.spyOn(api, 'submitAccommodationRequest').mockResolvedValue({
      kind: 'submitted',
      request: FAKE_REQUEST,
    });
    vi.spyOn(api, 'cancelAccommodationRequest').mockResolvedValue({
      kind: 'cancelled',
      request: { ...FAKE_REQUEST, state: 'cancelled', cancelledAt: new Date().toISOString() },
    });

    wrap(<AccommodationPanel token="tok" />);
    fireEvent.click(screen.getByRole('button', { name: /start a request/i }));

    await waitFor(() => screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => screen.getByRole('textbox'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Extra time.' } });
    fireEvent.click(screen.getByRole('button', { name: /review before sending/i }));

    await waitFor(() => screen.getByText(/review your request/i));
    fireEvent.click(screen.getByRole('button', { name: /confirm and send/i }));

    await waitFor(() => screen.getByRole('button', { name: /cancel this request/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel this request/i }));

    await waitFor(() => {
      expect(screen.getByText(/your request has been cancelled/i)).toBeTruthy();
    });
  });

  it('shows error alert when submission fails', async () => {
    vi.spyOn(api, 'listJobs').mockResolvedValue({ kind: 'ok', jobs: [FAKE_JOB] });
    vi.spyOn(api, 'submitAccommodationRequest').mockResolvedValue({ kind: 'failed' });

    wrap(<AccommodationPanel token="tok" />);
    fireEvent.click(screen.getByRole('button', { name: /start a request/i }));

    await waitFor(() => screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => screen.getByRole('textbox'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Some description.' } });
    fireEvent.click(screen.getByRole('button', { name: /review before sending/i }));

    await waitFor(() => screen.getByText(/review your request/i));
    fireEvent.click(screen.getByRole('button', { name: /confirm and send/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
  });

  it('shows job_not_found error when job becomes unavailable', async () => {
    vi.spyOn(api, 'listJobs').mockResolvedValue({ kind: 'ok', jobs: [FAKE_JOB] });
    vi.spyOn(api, 'submitAccommodationRequest').mockResolvedValue({ kind: 'job_not_found' });

    wrap(<AccommodationPanel token="tok" />);
    fireEvent.click(screen.getByRole('button', { name: /start a request/i }));

    await waitFor(() => screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => screen.getByRole('textbox'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Some description.' } });
    fireEvent.click(screen.getByRole('button', { name: /review before sending/i }));

    await waitFor(() => screen.getByText(/review your request/i));
    fireEvent.click(screen.getByRole('button', { name: /confirm and send/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText(/no longer available/i)).toBeTruthy();
    });
  });
});
