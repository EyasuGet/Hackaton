// Unit tests for SupportQueue component (T3-055).
// Tests: role guard (/api/me support only, fails closed), waiting list rendering,
// claim success, 409 conflict handling with polite message & queue refresh,
// assigned requests rendering with context snapshot, sending reply, and resolving.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleContext } from '../../shared/i18n/i18n.tsx';
import type { Locale } from '../../shared/i18n/messages.ts';
import * as helpApi from './help-api.ts';
import { SupportQueue, SupportQueuePanel } from './support-queue.tsx';
import type { HelpReply, HelpRequest, QueueItem } from './help-api.ts';

function wrap(ui: React.ReactElement, locale: Locale = 'en') {
  return render(<LocaleContext value={locale}>{ui}</LocaleContext>);
}

const FAKE_WAITING_ITEM: QueueItem = {
  id: 'req-wait-1',
  createdAt: new Date('2026-11-15T12:00:00Z').toISOString(),
  expiresAt: new Date('2026-11-22T12:00:00Z').toISOString(),
  state: 'waiting',
};

const FAKE_ASSIGNED_REQ: HelpRequest = {
  id: 'req-assigned-1',
  ownerId: 'learner-1',
  clientRequestId: 'cr-1',
  contextSnapshot: 'Learner shared context: having trouble with spreadsheet formulas.',
  consentGiven: true,
  state: 'claimed',
  createdAt: new Date('2026-11-15T12:10:00Z').toISOString(),
  expiresAt: new Date('2026-11-22T12:10:00Z').toISOString(),
  updatedAt: new Date('2026-11-15T12:15:00Z').toISOString(),
  cancelledAt: null,
  claimedBy: 'support-1',
  claimedAt: new Date('2026-11-15T12:15:00Z').toISOString(),
  resolvedAt: null,
  resolvedBy: null,
};

const FAKE_REPLIES: HelpReply[] = [
  {
    id: 'reply-1',
    helpRequestId: 'req-assigned-1',
    authorId: 'learner-1',
    clientReplyId: 'cr-l1',
    body: 'Could you explain VLOOKUP?',
    createdAt: new Date('2026-11-15T12:16:00Z').toISOString(),
    readAt: null,
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SupportQueue Role Guard (T3-055)', () => {
  it('renders nothing for a learner principal (fails closed)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (url === '/api/me') {
        return Promise.resolve(new Response(JSON.stringify({ role: 'learner' }), { status: 200 }));
      }
      return Promise.reject(new Error('Unexpected fetch'));
    });

    wrap(<SupportQueue token="tok-learner" />);

    // Wait to ensure role check settles
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('heading', { name: /support help queue/i })).toBeNull();
  });

  it('renders nothing when /api/me fails or is unauthenticated', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));

    wrap(<SupportQueue token="bad-token" />);

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('heading', { name: /support help queue/i })).toBeNull();
  });

  it('renders the support queue when /api/me confirms support role', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (url === '/api/me') {
        return Promise.resolve(new Response(JSON.stringify({ role: 'support' }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ queue: [], requests: [] }), { status: 200 }),
      );
    });

    vi.spyOn(helpApi, 'listQueue').mockResolvedValue({ kind: 'ok', queue: [] });
    vi.spyOn(helpApi, 'listAssignedRequests').mockResolvedValue({ kind: 'ok', requests: [] });

    wrap(<SupportQueue token="tok-support" />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /support help queue/i })).toBeTruthy();
    });
  });
});

describe('SupportQueuePanel Functionality (T3-055)', () => {
  beforeEach(() => {
    vi.spyOn(helpApi, 'listQueue').mockResolvedValue({
      kind: 'ok',
      queue: [FAKE_WAITING_ITEM],
    });
    vi.spyOn(helpApi, 'listAssignedRequests').mockResolvedValue({
      kind: 'ok',
      requests: [FAKE_ASSIGNED_REQ],
    });
    vi.spyOn(helpApi, 'listReplies').mockResolvedValue({
      kind: 'ok',
      replies: FAKE_REPLIES,
    });
    vi.spyOn(helpApi, 'markRepliesRead').mockResolvedValue(true);
  });

  it('renders waiting list and claimed requests with learner context snapshot', async () => {
    wrap(<SupportQueuePanel token="tok-support" />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /waiting help requests/i })).toBeTruthy();
      expect(screen.getByRole('heading', { name: /my claimed requests/i })).toBeTruthy();
    });

    // Waiting item claim button exists
    expect(screen.getByRole('button', { name: /^claim$/i })).toBeTruthy();

    // Context snapshot is visible
    expect(
      screen.getByText(/learner shared context: having trouble with spreadsheet formulas/i),
    ).toBeTruthy();

    // Reply is displayed
    await waitFor(() => {
      expect(screen.getByText('Could you explain VLOOKUP?')).toBeTruthy();
    });
  });

  it('claims a waiting request successfully', async () => {
    const claimedReq: HelpRequest = {
      ...FAKE_ASSIGNED_REQ,
      id: FAKE_WAITING_ITEM.id,
      contextSnapshot: 'Newly claimed context snapshot.',
    };

    vi.spyOn(helpApi, 'claimHelpRequest').mockResolvedValue({
      kind: 'claimed',
      request: claimedReq,
    });

    wrap(<SupportQueuePanel token="tok-support" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^claim$/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /^claim$/i }));

    await waitFor(() => {
      expect(helpApi.claimHelpRequest).toHaveBeenCalledWith('tok-support', FAKE_WAITING_ITEM.id);
      expect(screen.getByText('Newly claimed context snapshot.')).toBeTruthy();
    });
  });

  it('handles 409 conflict when another staff member already claimed the request', async () => {
    vi.spyOn(helpApi, 'claimHelpRequest').mockResolvedValue({
      kind: 'already_claimed',
      claimedBy: 'other-staff-id',
    });

    // When refreshed after 409, queue is now empty
    const listQueueMock = vi.spyOn(helpApi, 'listQueue');
    listQueueMock
      .mockResolvedValueOnce({ kind: 'ok', queue: [FAKE_WAITING_ITEM] })
      .mockResolvedValueOnce({ kind: 'ok', queue: [] });

    wrap(<SupportQueuePanel token="tok-support" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^claim$/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /^claim$/i }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(
        /another support staff member already claimed this request/i,
      );
      expect(screen.getByText(/no waiting help requests/i)).toBeTruthy();
    });
  });

  it('sends a reply to a claimed request', async () => {
    const newReply: HelpReply = {
      id: 'reply-2',
      helpRequestId: FAKE_ASSIGNED_REQ.id,
      authorId: 'support-1',
      clientReplyId: 'sr-1',
      body: 'Here is how VLOOKUP works.',
      createdAt: new Date().toISOString(),
      readAt: null,
    };

    vi.spyOn(helpApi, 'addReply').mockResolvedValue({
      kind: 'added',
      reply: newReply,
    });

    wrap(<SupportQueuePanel token="tok-support" />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/type your reply/i)).toBeTruthy();
    });

    const input = screen.getByPlaceholderText(/type your reply/i);
    fireEvent.change(input, { target: { value: 'Here is how VLOOKUP works.' } });

    const sendBtn = screen.getByRole('button', { name: /^send$/i });
    expect(sendBtn.hasAttribute('disabled')).toBe(false);
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(helpApi.addReply).toHaveBeenCalledWith(
        'tok-support',
        FAKE_ASSIGNED_REQ.id,
        expect.any(String),
        'Here is how VLOOKUP works.',
      );
    });
  });

  it('resolves a claimed request', async () => {
    vi.spyOn(helpApi, 'resolveHelpRequest').mockResolvedValue({
      kind: 'resolved',
      request: { ...FAKE_ASSIGNED_REQ, state: 'resolved' },
    });

    wrap(<SupportQueuePanel token="tok-support" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark resolved/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /mark resolved/i }));

    await waitFor(() => {
      expect(helpApi.resolveHelpRequest).toHaveBeenCalledWith('tok-support', FAKE_ASSIGNED_REQ.id);
      expect(screen.getByText(/you have no claimed requests/i)).toBeTruthy();
    });
  });
});
