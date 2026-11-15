// Unit tests for Accommodation coordinator inbox and reload persistence (T3-022-B).
// Tests:
// - Coordinator inbox view (role: 'support')
// - Claiming requests from the inbox
// - Resolving requests
// - Two-sided threaded replies (send reply, reload survival, unread indicators, mark as read)
// - Reload persistence for learner's accommodation requests and reply thread
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './accommodation-api.ts';
import type { AccommodationReply, AccommodationRequest } from './accommodation-api.ts';
import { AccommodationCoordinatorInbox, AccommodationPanel } from './accommodation.tsx';
import { LocaleContext } from '../../shared/i18n/i18n.tsx';

function wrap(ui: React.ReactElement) {
  return render(<LocaleContext value="en">{ui}</LocaleContext>);
}

const FAKE_WAITING_REQUEST: AccommodationRequest = {
  id: 'req-wait-1',
  ownerId: 'learner-1',
  jobId: 'job-1',
  clientRequestId: 'cr-wait-1',
  supportDescription: 'I need a sign language interpreter for the interview.',
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

const FAKE_CLAIMED_REQUEST: AccommodationRequest = {
  ...FAKE_WAITING_REQUEST,
  id: 'req-claimed-1',
  state: 'claimed',
  claimedBy: 'coordinator-1',
  claimedAt: new Date().toISOString(),
};

const FAKE_RESOLVED_REQUEST: AccommodationRequest = {
  ...FAKE_CLAIMED_REQUEST,
  id: 'req-resolved-1',
  state: 'resolved',
  resolvedBy: 'coordinator-1',
  resolvedAt: new Date().toISOString(),
};

const FAKE_REPLY_COORD: AccommodationReply = {
  id: 'rep-1',
  accommodationRequestId: 'req-claimed-1',
  authorId: 'coordinator-1',
  clientReplyId: 'cr-rep-1',
  body: 'An interpreter has been arranged for your interview.',
  createdAt: new Date().toISOString(),
  readAt: null,
};

const FAKE_REPLY_LEARNER: AccommodationReply = {
  id: 'rep-2',
  accommodationRequestId: 'req-claimed-1',
  authorId: 'learner-1',
  clientReplyId: 'cr-rep-2',
  body: 'Thank you so much!',
  createdAt: new Date().toISOString(),
  readAt: null,
};

afterEach(cleanup);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'fetchPrincipal').mockResolvedValue({
    id: 'coordinator-1',
    role: 'support',
    label: 'Coordinator',
  });
});

describe('Accommodation Coordinator Inbox (T3-022-B)', () => {
  it('renders coordinator inbox with waiting requests', async () => {
    vi.spyOn(api, 'listAccommodationRequests').mockResolvedValue({
      kind: 'ok',
      requests: [FAKE_WAITING_REQUEST],
    });
    vi.spyOn(api, 'listAccommodationReplies').mockResolvedValue({
      kind: 'ok',
      replies: [],
    });

    wrap(<AccommodationCoordinatorInbox token="coord-tok" currentUserId="coordinator-1" />);

    await waitFor(() => {
      expect(screen.getByText(/accommodation coordinator inbox/i)).toBeTruthy();
      expect(screen.getByText(/waiting for coordinator/i)).toBeTruthy();
      expect(screen.getByText(/i need a sign language interpreter/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /claim request/i })).toBeTruthy();
    });
  });

  it('allows coordinator to claim a waiting request', async () => {
    vi.spyOn(api, 'listAccommodationRequests').mockResolvedValue({
      kind: 'ok',
      requests: [FAKE_WAITING_REQUEST],
    });
    vi.spyOn(api, 'listAccommodationReplies').mockResolvedValue({
      kind: 'ok',
      replies: [],
    });
    const claimSpy = vi.spyOn(api, 'claimAccommodationRequest').mockResolvedValue({
      kind: 'claimed',
      request: FAKE_CLAIMED_REQUEST,
    });

    wrap(<AccommodationCoordinatorInbox token="coord-tok" currentUserId="coordinator-1" />);

    await waitFor(() => screen.getByRole('button', { name: /claim request/i }));
    fireEvent.click(screen.getByRole('button', { name: /claim request/i }));

    await waitFor(() => {
      expect(claimSpy).toHaveBeenCalledWith('coord-tok', FAKE_WAITING_REQUEST.id);
      expect(screen.getByText(/being handled by coordinator/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /mark as resolved/i })).toBeTruthy();
    });
  });

  it('allows coordinator to reply and resolve a claimed request', async () => {
    vi.spyOn(api, 'listAccommodationRequests').mockResolvedValue({
      kind: 'ok',
      requests: [FAKE_CLAIMED_REQUEST],
    });
    vi.spyOn(api, 'listAccommodationReplies').mockResolvedValue({
      kind: 'ok',
      replies: [FAKE_REPLY_LEARNER],
    });
    const replySpy = vi.spyOn(api, 'addAccommodationReply').mockResolvedValue({
      kind: 'added',
      reply: FAKE_REPLY_COORD,
    });
    const resolveSpy = vi.spyOn(api, 'resolveAccommodationRequest').mockResolvedValue({
      kind: 'resolved',
      request: FAKE_RESOLVED_REQUEST,
    });

    wrap(<AccommodationCoordinatorInbox token="coord-tok" currentUserId="coordinator-1" />);

    // Shows existing reply from learner
    await waitFor(() => {
      expect(screen.getByText('Thank you so much!')).toBeTruthy();
    });

    // Compose reply
    fireEvent.click(screen.getByRole('button', { name: /^reply$/i }));
    await waitFor(() => screen.getByRole('textbox', { name: /your reply/i }));

    fireEvent.change(screen.getByRole('textbox', { name: /your reply/i }), {
      target: { value: 'An interpreter has been arranged for your interview.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(replySpy).toHaveBeenCalledWith(
        'coord-tok',
        FAKE_CLAIMED_REQUEST.id,
        expect.any(String),
        'An interpreter has been arranged for your interview.',
      );
    });

    // Resolve request
    fireEvent.click(screen.getByRole('button', { name: /mark as resolved/i }));
    await waitFor(() => {
      expect(resolveSpy).toHaveBeenCalledWith('coord-tok', FAKE_CLAIMED_REQUEST.id);
      expect(screen.getByText(/resolved/i)).toBeTruthy();
    });
  });

  it('shows unread indicator and marks replies as read', async () => {
    vi.spyOn(api, 'listAccommodationRequests').mockResolvedValue({
      kind: 'ok',
      requests: [FAKE_CLAIMED_REQUEST],
    });
    vi.spyOn(api, 'listAccommodationReplies').mockResolvedValue({
      kind: 'ok',
      replies: [FAKE_REPLY_LEARNER], // unread by coordinator
    });
    const markSpy = vi.spyOn(api, 'markAccommodationRepliesRead').mockResolvedValue(true);

    wrap(<AccommodationCoordinatorInbox token="coord-tok" currentUserId="coordinator-1" />);

    await waitFor(() => {
      expect(screen.getByText(/new reply/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /mark as read/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /mark as read/i }));
    await waitFor(() => {
      expect(markSpy).toHaveBeenCalledWith('coord-tok', FAKE_CLAIMED_REQUEST.id);
    });
  });
});

describe('AccommodationPanel Learner Persistence (T3-022-B)', () => {
  it('loads and displays learner accommodation requests on mount (survives reload)', async () => {
    vi.spyOn(api, 'fetchPrincipal').mockResolvedValue({
      id: 'learner-1',
      role: 'learner',
      label: 'Learner One',
    });
    vi.spyOn(api, 'listAccommodationRequests').mockResolvedValue({
      kind: 'ok',
      requests: [FAKE_CLAIMED_REQUEST],
    });
    vi.spyOn(api, 'listAccommodationReplies').mockResolvedValue({
      kind: 'ok',
      replies: [FAKE_REPLY_COORD],
    });

    wrap(<AccommodationPanel token="learner-tok" role="learner" />);

    await waitFor(() => {
      expect(screen.getByText(/your accommodation requests/i)).toBeTruthy();
      expect(screen.getByText(/being handled by coordinator/i)).toBeTruthy();
      expect(screen.getByText('An interpreter has been arranged for your interview.')).toBeTruthy();
    });
  });

  it('allows learner to send a reply to the coordinator', async () => {
    vi.spyOn(api, 'fetchPrincipal').mockResolvedValue({
      id: 'learner-1',
      role: 'learner',
      label: 'Learner One',
    });
    vi.spyOn(api, 'listAccommodationRequests').mockResolvedValue({
      kind: 'ok',
      requests: [FAKE_CLAIMED_REQUEST],
    });
    vi.spyOn(api, 'listAccommodationReplies').mockResolvedValue({
      kind: 'ok',
      replies: [FAKE_REPLY_COORD],
    });
    const replySpy = vi.spyOn(api, 'addAccommodationReply').mockResolvedValue({
      kind: 'added',
      reply: FAKE_REPLY_LEARNER,
    });

    wrap(<AccommodationPanel token="learner-tok" role="learner" />);

    await waitFor(() => screen.getByRole('button', { name: /^reply$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^reply$/i }));

    await waitFor(() => screen.getByRole('textbox', { name: /your reply/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /your reply/i }), {
      target: { value: 'Thank you so much!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(replySpy).toHaveBeenCalledWith(
        'learner-tok',
        FAKE_CLAIMED_REQUEST.id,
        expect.any(String),
        'Thank you so much!',
      );
    });
  });

  it('automatically renders coordinator inbox when authenticated as support', async () => {
    vi.spyOn(api, 'fetchPrincipal').mockResolvedValue({
      id: 'coord-1',
      role: 'support',
      label: 'Coordinator User',
    });
    vi.spyOn(api, 'listAccommodationRequests').mockResolvedValue({
      kind: 'ok',
      requests: [],
    });

    wrap(<AccommodationPanel token="support-tok" />);

    await waitFor(() => {
      expect(screen.getByText(/accommodation coordinator inbox/i)).toBeTruthy();
      expect(screen.getByText(/no accommodation requests found/i)).toBeTruthy();
    });
  });
});
