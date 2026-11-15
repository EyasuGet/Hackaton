// Unit tests for HelpInbox component (T3-016-B, T3-017-B).
// Tests: loading state, empty list, list with requests, error state,
// reply thread, unread indicator, Addis Ababa meeting note, reply composition & send,
// and terminal/failed error states.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as helpApi from './help-api.ts';
import { HelpInbox } from './help-inbox.tsx';
import type { HelpReply, HelpRequest } from './help-api.ts';
import { LocaleContext } from '../../shared/i18n/i18n.tsx';

function wrap(ui: React.ReactElement) {
  return render(<LocaleContext value="en">{ui}</LocaleContext>);
}

const FAKE_REQUEST: HelpRequest = {
  id: 'req-1',
  ownerId: 'owner-1',
  clientRequestId: 'client-1',
  contextSnapshot: 'Need help with lesson 2.',
  consentGiven: true,
  state: 'waiting',
  createdAt: new Date('2026-11-15T10:00:00Z').toISOString(),
  expiresAt: new Date('2026-11-22T10:00:00Z').toISOString(),
  updatedAt: new Date('2026-11-15T10:00:00Z').toISOString(),
  cancelledAt: null,
  claimedBy: null,
  claimedAt: null,
  resolvedAt: null,
  resolvedBy: null,
};

const FAKE_REPLIES: HelpReply[] = [
  {
    id: 'reply-1',
    helpRequestId: 'req-1',
    authorId: 'staff-1',
    clientReplyId: 'cr-staff-1',
    body: 'Can we meet at 14:00 Addis Ababa Time?',
    createdAt: new Date('2026-11-15T11:00:00Z').toISOString(),
    readAt: null,
  },
  {
    id: 'reply-2',
    helpRequestId: 'req-1',
    authorId: 'owner-1',
    clientReplyId: 'cr-learner-1',
    body: 'Yes, 14:00 EAT works for me.',
    createdAt: new Date('2026-11-15T11:05:00Z').toISOString(),
    readAt: null,
  },
];

afterEach(cleanup);

describe('HelpInbox (T3-016-B & T3-017-B)', () => {
  it('shows loading state initially', () => {
    vi.spyOn(helpApi, 'listHelpRequests').mockReturnValue(new Promise(() => {}));
    wrap(<HelpInbox token="tok" />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(/loading your requests/i)).toBeTruthy();
  });

  it('shows empty message when no requests', async () => {
    vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({ kind: 'ok', requests: [] });
    wrap(<HelpInbox token="tok" />);
    await waitFor(() => {
      expect(screen.getByText(/you have no help requests yet/i)).toBeTruthy();
    });
  });

  it('shows request list with state and date', async () => {
    vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({
      kind: 'ok',
      requests: [FAKE_REQUEST],
    });
    wrap(<HelpInbox token="tok" />);
    await waitFor(() => {
      expect(screen.getByText(/waiting for staff/i)).toBeTruthy();
      expect(screen.getByText(/requested:/i)).toBeTruthy();
    });
  });

  it('shows no-replies label for requests without replies', async () => {
    vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({
      kind: 'ok',
      requests: [FAKE_REQUEST],
    });
    vi.spyOn(helpApi, 'listReplies').mockResolvedValue({ kind: 'ok', replies: [] });
    wrap(<HelpInbox token="tok" />);
    await waitFor(() => {
      expect(screen.getByText(/no replies yet/i)).toBeTruthy();
    });
  });

  it('shows load error when list fails', async () => {
    vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({ kind: 'failed' });
    wrap(<HelpInbox token="tok" />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText(/could not load/i)).toBeTruthy();
    });
  });

  it('shows cancelled state label correctly', async () => {
    vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({
      kind: 'ok',
      requests: [
        {
          ...FAKE_REQUEST,
          state: 'cancelled',
          cancelledAt: new Date().toISOString(),
        },
      ],
    });
    wrap(<HelpInbox token="tok" />);
    await waitFor(() => {
      expect(screen.getByText(/cancelled/i)).toBeTruthy();
    });
  });

  it('shows claimed state label for a claimed request', async () => {
    vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({
      kind: 'ok',
      requests: [
        {
          ...FAKE_REQUEST,
          state: 'claimed',
          claimedBy: 'staff-1',
          claimedAt: new Date().toISOString(),
        },
      ],
    });
    wrap(<HelpInbox token="tok" />);
    await waitFor(() => {
      expect(screen.getByText(/being handled by staff/i)).toBeTruthy();
    });
  });

  it('shows resolved state label for a resolved request', async () => {
    vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({
      kind: 'ok',
      requests: [
        {
          ...FAKE_REQUEST,
          state: 'resolved',
          claimedBy: 'staff-1',
          resolvedBy: 'staff-1',
          resolvedAt: new Date().toISOString(),
        },
      ],
    });
    wrap(<HelpInbox token="tok" />);
    await waitFor(() => {
      expect(screen.getByText(/resolved/i)).toBeTruthy();
    });
  });

  it('displays explicitly labelled Addis Ababa meeting note on active requests', async () => {
    vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({
      kind: 'ok',
      requests: [FAKE_REQUEST],
    });
    vi.spyOn(helpApi, 'listReplies').mockResolvedValue({ kind: 'ok', replies: [] });
    wrap(<HelpInbox token="tok" />);
    await waitFor(() => {
      const note = screen.getByRole('note');
      expect(note.textContent).toMatch(/Addis Ababa timezone \(EAT, UTC\+3\)/i);
    });
  });

  it('does not display meeting note or reply button on closed/cancelled requests', async () => {
    vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({
      kind: 'ok',
      requests: [
        {
          ...FAKE_REQUEST,
          state: 'cancelled',
          cancelledAt: new Date().toISOString(),
        },
      ],
    });
    wrap(<HelpInbox token="tok" />);
    await waitFor(() => {
      expect(screen.queryByRole('note')).toBeNull();
      expect(screen.queryByRole('button', { name: /^reply$/i })).toBeNull();
    });
  });

  it('renders replies with learner and staff distinctions and unread indicator', async () => {
    vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({
      kind: 'ok',
      requests: [{ ...FAKE_REQUEST, state: 'claimed', claimedBy: 'staff-1' }],
    });
    vi.spyOn(helpApi, 'listReplies').mockResolvedValue({ kind: 'ok', replies: FAKE_REPLIES });
    const markSpy = vi.spyOn(helpApi, 'markRepliesRead').mockResolvedValue(true);

    wrap(<HelpInbox token="tok" />);
    await waitFor(() => {
      expect(screen.getByText(/Can we meet at 14:00 Addis Ababa Time\?/)).toBeTruthy();
      expect(screen.getByText(/Yes, 14:00 EAT works for me\./)).toBeTruthy();
      expect(screen.getByText(/new reply/i)).toBeTruthy();
    });

    const markReadBtn = screen.getByRole('button', { name: /mark as read/i });
    fireEvent.click(markReadBtn);
    expect(markSpy).toHaveBeenCalledWith('tok', 'req-1');
  });

  it('allows learner to compose and send a reply', async () => {
    vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({
      kind: 'ok',
      requests: [{ ...FAKE_REQUEST, state: 'claimed', claimedBy: 'staff-1' }],
    });
    vi.spyOn(helpApi, 'listReplies').mockResolvedValue({ kind: 'ok', replies: [] });
    const addReplySpy = vi.spyOn(helpApi, 'addReply').mockResolvedValue({
      kind: 'added',
      reply: {
        id: 'reply-new',
        helpRequestId: 'req-1',
        authorId: 'owner-1',
        clientReplyId: 'cr-new',
        body: 'Learner reply body.',
        createdAt: new Date().toISOString(),
        readAt: null,
      },
    });

    wrap(<HelpInbox token="tok" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^reply$/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /^reply$/i }));
    const textarea = screen.getByLabelText(/your reply/i);
    expect(textarea).toBeTruthy();

    fireEvent.change(textarea, { target: { value: 'Learner reply body.' } });
    const sendButton = screen.getByRole('button', { name: /^send$/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(addReplySpy).toHaveBeenCalledWith(
        'tok',
        'req-1',
        expect.stringMatching(/^rr-/),
        'Learner reply body.',
      );
    });
  });

  it('shows terminal error when reply fails because request is closed', async () => {
    vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({
      kind: 'ok',
      requests: [{ ...FAKE_REQUEST, state: 'claimed', claimedBy: 'staff-1' }],
    });
    vi.spyOn(helpApi, 'listReplies').mockResolvedValue({ kind: 'ok', replies: [] });
    vi.spyOn(helpApi, 'addReply').mockResolvedValue({ kind: 'terminal' });

    wrap(<HelpInbox token="tok" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^reply$/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /^reply$/i }));
    const textarea = screen.getByLabelText(/your reply/i);
    fireEvent.change(textarea, { target: { value: 'Late reply' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText(/this request is closed/i)).toBeTruthy();
    });
  });

  it('shows failed error when reply encounters a network error', async () => {
    vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({
      kind: 'ok',
      requests: [{ ...FAKE_REQUEST, state: 'claimed', claimedBy: 'staff-1' }],
    });
    vi.spyOn(helpApi, 'listReplies').mockResolvedValue({ kind: 'ok', replies: [] });
    vi.spyOn(helpApi, 'addReply').mockResolvedValue({ kind: 'failed' });

    wrap(<HelpInbox token="tok" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^reply$/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /^reply$/i }));
    const textarea = screen.getByLabelText(/your reply/i);
    fireEvent.change(textarea, { target: { value: 'Some reply' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText(/your reply could not be sent/i)).toBeTruthy();
    });
  });
});
