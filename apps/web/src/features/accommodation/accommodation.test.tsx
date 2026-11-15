// Unit tests for AccommodationPanel component (T3-022-A).
// Tests: disclosure gate (nothing submitted until confirmed), job selection required,
// preview shown before submit, cancel appears after submission, and error states.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './accommodation-api.ts';
import {
  AccommodationPanel,
  AccommodationReplyThread,
  CoordinatorAccommodationPanel,
} from './accommodation.tsx';
import type { AccommodationReply, AccommodationRequest, Job } from './accommodation-api.ts';
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
  reviewedAt: null,
  reviewedBy: null,
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

  it('displays existing accommodation requests for learner (survives reload)', async () => {
    vi.spyOn(api, 'listAccommodationRequests').mockResolvedValue({
      kind: 'ok',
      requests: [FAKE_REQUEST],
    });
    vi.spyOn(api, 'listAccommodationReplies').mockResolvedValue({
      kind: 'ok',
      replies: [],
    });

    wrap(<AccommodationPanel token="tok" role="learner" />);

    await waitFor(() => {
      expect(screen.getByText(/your accommodation requests/i)).toBeTruthy();
      expect(screen.getByText(/waiting for coordinator/i)).toBeTruthy();
      expect(screen.getByText(/i need extra time\./i)).toBeTruthy();
    });
  });

  describe('CoordinatorAccommodationPanel (T3-022-B)', () => {
    const FAKE_REPLY: AccommodationReply = {
      id: 'rep-1',
      accommodationRequestId: FAKE_REQUEST.id,
      authorId: 'support-1',
      clientReplyId: 'cr-rep-1',
      body: 'Sign language interpreter confirmed.',
      createdAt: new Date().toISOString(),
      readAt: null,
    };

    it('lists requests in coordinator inbox and handles status updates', async () => {
      vi.spyOn(api, 'listCoordinatorAccommodationRequests').mockResolvedValue({
        kind: 'ok',
        requests: [FAKE_REQUEST],
      });
      vi.spyOn(api, 'listAccommodationReplies').mockResolvedValue({
        kind: 'ok',
        replies: [],
      });
      const updateSpy = vi.spyOn(api, 'updateAccommodationStatus').mockResolvedValue({
        kind: 'ok',
        request: { ...FAKE_REQUEST, state: 'confirmed' },
      });

      wrap(<CoordinatorAccommodationPanel token="tok" />);

      await waitFor(() => {
        expect(screen.getByText(/accommodation coordinator inbox/i)).toBeTruthy();
        expect(screen.getByText(/i need extra time\./i)).toBeTruthy();
      });

      // Confirm button is available
      const confirmBtn = screen.getByRole('button', { name: /confirm accommodation/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith('tok', FAKE_REQUEST.id, 'confirmed');
        expect(screen.getByText(/confirmed/i)).toBeTruthy();
      });
    });

    it('exchanges replies and marks as read in reply thread', async () => {
      vi.spyOn(api, 'listAccommodationReplies').mockResolvedValue({
        kind: 'ok',
        replies: [FAKE_REPLY],
      });
      const markReadSpy = vi.spyOn(api, 'markAccommodationRepliesRead').mockResolvedValue(true);
      const addReplySpy = vi.spyOn(api, 'addAccommodationReply').mockResolvedValue({
        kind: 'added',
        reply: {
          id: 'rep-2',
          accommodationRequestId: FAKE_REQUEST.id,
          authorId: 'owner-1',
          clientReplyId: 'lr-rep-1',
          body: 'Thank you!',
          createdAt: new Date().toISOString(),
          readAt: null,
        },
      });

      wrap(<AccommodationReplyThread request={FAKE_REQUEST} token="tok" role="learner" />);

      // Reply is displayed
      await waitFor(() => {
        expect(screen.getByText(/sign language interpreter confirmed\./i)).toBeTruthy();
      });

      // Unread badge is shown for learner
      const markReadBtn = screen.getByRole('button', { name: /mark as read/i });
      fireEvent.click(markReadBtn);

      await waitFor(() => {
        expect(markReadSpy).toHaveBeenCalledWith('tok', FAKE_REQUEST.id);
      });

      // Compose a reply
      fireEvent.click(screen.getByRole('button', { name: /^reply$/i }));
      await waitFor(() => screen.getByRole('textbox'));

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Thank you!' } });
      fireEvent.click(screen.getByRole('button', { name: /send reply/i }));

      await waitFor(() => {
        expect(addReplySpy).toHaveBeenCalled();
        expect(screen.getByText(/thank you!/i)).toBeTruthy();
      });
    });

    it('AccommodationPanel renders CoordinatorAccommodationPanel when role is support', async () => {
      vi.spyOn(api, 'listCoordinatorAccommodationRequests').mockResolvedValue({
        kind: 'ok',
        requests: [],
      });

      wrap(<AccommodationPanel token="tok" role="support" />);

      await waitFor(() => {
        expect(screen.getByText(/accommodation coordinator inbox/i)).toBeTruthy();
        expect(
          screen.getByText(/no accommodation requests in the coordinator inbox/i),
        ).toBeTruthy();
      });
    });
  });
});
