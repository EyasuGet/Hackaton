// Unit tests for HelpInbox component (T3-016-B).
// Tests: loading state, empty list, list with requests, error state.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as helpApi from './help-api.ts';
import { HelpInbox } from './help-inbox.tsx';
import type { HelpRequest } from './help-api.ts';
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

afterEach(cleanup);

describe('HelpInbox (T3-016-B)', () => {
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
});
