// Unit tests for the HumanHelp component (T3-016-A).
// Tests: disclosure gate (nothing submitted until confirmed), cancel button
// appears after submission, and error states render correct alerts.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as helpApi from './help-api.ts';
import { HumanHelp } from './human-help.tsx';
import type { HelpRequest } from './help-api.ts';
import { LocaleContext } from '../../shared/i18n/i18n.tsx';

function wrap(ui: React.ReactElement) {
  return render(<LocaleContext value="en">{ui}</LocaleContext>);
}

const FAKE_REQUEST: HelpRequest = {
  id: 'fake-uuid-1234',
  ownerId: 'owner-1',
  clientRequestId: 'client-key-1',
  contextSnapshot: 'Need help with lesson 3.',
  consentGiven: true,
  state: 'waiting',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAt: null,
};

afterEach(cleanup);

describe('HumanHelp component (T3-016-A)', () => {
  it('shows the request button in idle state', () => {
    wrap(<HumanHelp token="tok" />);
    expect(screen.getByRole('button', { name: /request help/i })).toBeTruthy();
  });

  it('disclosure notice appears before anything is submitted', () => {
    // submitHelpRequest must NOT be called before the learner confirms
    const spy = vi.spyOn(helpApi, 'submitHelpRequest').mockResolvedValue({
      kind: 'submitted',
      request: FAKE_REQUEST,
    });

    wrap(<HumanHelp token="tok" />);
    fireEvent.click(screen.getByRole('button', { name: /request help/i }));

    // Fill the context textarea
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Need help with lesson 3.' } });

    // Click review
    fireEvent.click(screen.getByRole('button', { name: /review before sending/i }));

    // Disclosure heading must be visible before submit is called
    expect(screen.getByText(/what will be shared with support staff/i)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it('submits only after confirmation and shows waiting state with cancel button', async () => {
    vi.spyOn(helpApi, 'submitHelpRequest').mockResolvedValue({
      kind: 'submitted',
      request: FAKE_REQUEST,
    });

    wrap(<HumanHelp token="tok" />);
    fireEvent.click(screen.getByRole('button', { name: /request help/i }));

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Need help with lesson 3.' } });
    fireEvent.click(screen.getByRole('button', { name: /review before sending/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm and send/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel this request/i })).toBeTruthy();
    });
  });

  it('shows cancelled state after clicking cancel', async () => {
    vi.spyOn(helpApi, 'submitHelpRequest').mockResolvedValue({
      kind: 'submitted',
      request: FAKE_REQUEST,
    });
    vi.spyOn(helpApi, 'cancelHelpRequest').mockResolvedValue({
      kind: 'cancelled',
      request: { ...FAKE_REQUEST, state: 'cancelled', cancelledAt: new Date().toISOString() },
    });

    wrap(<HumanHelp token="tok" />);
    fireEvent.click(screen.getByRole('button', { name: /request help/i }));
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Need help.' } });
    fireEvent.click(screen.getByRole('button', { name: /review before sending/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm and send/i }));

    await waitFor(() => screen.getByRole('button', { name: /cancel this request/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel this request/i }));

    await waitFor(() => {
      expect(screen.getByText(/your request has been cancelled/i)).toBeTruthy();
    });
  });

  it('shows a network error alert when submission fails', async () => {
    vi.spyOn(helpApi, 'submitHelpRequest').mockResolvedValue({ kind: 'failed' });

    wrap(<HumanHelp token="tok" />);
    fireEvent.click(screen.getByRole('button', { name: /request help/i }));
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Some context.' } });
    fireEvent.click(screen.getByRole('button', { name: /review before sending/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm and send/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
  });

  it('allows returning to edit before confirming', () => {
    wrap(<HumanHelp token="tok" />);
    fireEvent.click(screen.getByRole('button', { name: /request help/i }));
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Some context.' } });
    fireEvent.click(screen.getByRole('button', { name: /review before sending/i }));

    // Back button should return to composing
    fireEvent.click(screen.getByRole('button', { name: /go back and edit/i }));
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.queryByText(/what will be shared with support staff/i)).toBeNull();
  });
});
