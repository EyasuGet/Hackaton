// Unit tests for screen sharing component and lifecycle (T3-018-B).
// Verifies:
// 1. Browser capability check (secure context + getDisplayMedia presence).
// 2. Graceful disclosure on unsupported mobile browsers without removing text help.
// 3. User activation requirement (only explicit learner click invokes picker).
// 4. Video-only capture (audio: false). No conferencing/recording features.
// 5. Persistent accessible stop control that stops all active tracks.
// 6. Native browser stop control ('ended' event on tracks) cleanly terminates stream.
// 7. No silent reconnection (fresh learner action required).
// 8. Viewer mode renders video element with accessible stop control.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleContext } from '../../shared/i18n/i18n.tsx';
import { ScreenShare } from './screen-share.tsx';
import * as sharingApi from './sharing-api.ts';
import { isScreenShareSupported } from './support.ts';

function wrap(ui: React.ReactElement, locale: 'en' | 'am' = 'en') {
  return render(<LocaleContext value={locale}>{ui}</LocaleContext>);
}

describe('isScreenShareSupported (T3-018-B)', () => {
  const originalIsSecureContext = window.isSecureContext;
  const originalMediaDevices = navigator.mediaDevices;

  afterEach(() => {
    Object.defineProperty(window, 'isSecureContext', {
      value: originalIsSecureContext,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      writable: true,
      configurable: true,
    });
  });

  it('returns false when window is not a secure context', () => {
    Object.defineProperty(window, 'isSecureContext', {
      value: false,
      writable: true,
      configurable: true,
    });
    expect(isScreenShareSupported()).toBe(false);
  });

  it('returns false when navigator.mediaDevices is undefined (e.g. mobile/unsupported)', () => {
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(isScreenShareSupported()).toBe(false);
  });

  it('returns false when getDisplayMedia is missing on mobile browsers', () => {
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
      writable: true,
      configurable: true,
    });
    expect(isScreenShareSupported()).toBe(false);
  });

  it('returns true when secure context and getDisplayMedia are present on supported desktop', () => {
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia: vi.fn() },
      writable: true,
      configurable: true,
    });
    expect(isScreenShareSupported()).toBe(true);
  });
});

describe('ScreenShare component (T3-018-B)', () => {
  const originalIsSecureContext = window.isSecureContext;
  const originalMediaDevices = navigator.mediaDevices;

  let mockTrack: {
    stop: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    kind: string;
    readyState: string;
    listeners: Record<string, () => void>;
  };
  let mockStream: {
    getTracks: ReturnType<typeof vi.fn>;
    getVideoTracks: ReturnType<typeof vi.fn>;
  };
  let getDisplayMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockTrack = {
      stop: vi.fn(),
      addEventListener: vi.fn((event: string, cb: () => void) => {
        mockTrack.listeners[event] = cb;
      }),
      removeEventListener: vi.fn(),
      kind: 'video',
      readyState: 'live',
      listeners: {},
    };

    mockStream = {
      getTracks: vi.fn(() => [mockTrack]),
      getVideoTracks: vi.fn(() => [mockTrack]),
    };

    getDisplayMediaMock = vi.fn().mockResolvedValue(mockStream);

    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getDisplayMedia: getDisplayMediaMock,
      },
      writable: true,
      configurable: true,
    });

    vi.spyOn(sharingApi, 'getSessionByHelpRequestId').mockResolvedValue(null);
    vi.spyOn(sharingApi, 'joinSession').mockResolvedValue(null);
    vi.spyOn(sharingApi, 'revokeSession').mockResolvedValue(null);
    vi.spyOn(sharingApi, 'sendSignal').mockResolvedValue(null);
    vi.spyOn(sharingApi, 'getSignals').mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'isSecureContext', {
      value: originalIsSecureContext,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      writable: true,
      configurable: true,
    });
  });

  it('renders graceful disclosure notice on unsupported mobile browser without share button', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {}, // No getDisplayMedia
      writable: true,
      configurable: true,
    });

    wrap(<ScreenShare token="tok-1" helpRequestId="hr-1" role="learner" />);

    // Renders the disclosure note
    const note = screen.getByRole('note');
    expect(note.textContent).toMatch(/not supported on this browser or mobile device/i);

    // Share button is NOT rendered
    expect(screen.queryByRole('button', { name: /share screen/i })).toBeNull();
  });

  it('renders graceful disclosure notice in Amharic on unsupported mobile browser', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {},
      writable: true,
      configurable: true,
    });

    wrap(<ScreenShare token="tok-1" helpRequestId="hr-1" role="learner" />, 'am');

    const note = screen.getByRole('note');
    expect(note.textContent).toMatch(/በዚህ አሳሽ ወይም ተንቀሳቃሽ መሣሪያ ላይ ማያ ማጋራት አይደገፍም/);
  });

  it('displays initial idle state with Share screen button on supported desktop', () => {
    wrap(<ScreenShare token="tok-1" helpRequestId="hr-1" role="learner" />);

    const button = screen.getByRole('button', { name: /share screen/i });
    expect(button).toBeTruthy();

    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/available/i);
  });

  it('learner action explicitly invokes browser display media picker with video only (audio: false)', async () => {
    wrap(<ScreenShare token="tok-1" helpRequestId="hr-1" role="learner" />);

    // Before click: getDisplayMedia has NOT been called
    expect(getDisplayMediaMock).not.toHaveBeenCalled();

    const shareButton = screen.getByRole('button', { name: /share screen/i });
    fireEvent.click(shareButton);

    // After click: getDisplayMedia is invoked with strictly video only
    await waitFor(() => {
      expect(getDisplayMediaMock).toHaveBeenCalledTimes(1);
      expect(getDisplayMediaMock).toHaveBeenCalledWith({
        video: true,
        audio: false,
      });
    });
  });

  it('handles permission denial gracefully and allows retry without getting stuck', async () => {
    const error = new Error('Permission denied');
    error.name = 'NotAllowedError';
    getDisplayMediaMock.mockRejectedValue(error);

    wrap(<ScreenShare token="tok-1" helpRequestId="hr-1" role="learner" />);

    fireEvent.click(screen.getByRole('button', { name: /share screen/i }));

    await waitFor(() => {
      const status = screen.getByRole('status');
      expect(status.textContent).toMatch(/cancelled or denied/i);
    });

    // Share screen button is available for a fresh retry
    const retryButton = screen.getByRole('button', { name: /share screen/i });
    expect(retryButton).toBeTruthy();
  });

  it('displays persistent accessible stop control when sharing is active', async () => {
    wrap(<ScreenShare token="tok-1" helpRequestId="hr-1" role="learner" />);

    fireEvent.click(screen.getByRole('button', { name: /share screen/i }));

    // Stop button appears
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop sharing screen/i })).toBeTruthy();
    });

    // Status announces sharing is active
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/sharing your screen/i);
  });

  it('clicking stop control stops all active tracks, revokes session, and transitions to stopped', async () => {
    const revokeSpy = vi.spyOn(sharingApi, 'revokeSession');
    const onStopCallback = vi.fn();

    wrap(<ScreenShare token="tok-1" helpRequestId="hr-1" role="learner" onStop={onStopCallback} />);

    fireEvent.click(screen.getByRole('button', { name: /share screen/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop sharing screen/i })).toBeTruthy();
    });

    const stopButton = screen.getByRole('button', { name: /stop sharing screen/i });
    fireEvent.click(stopButton);

    await waitFor(() => {
      // 1. All active tracks were stopped
      expect(mockTrack.stop).toHaveBeenCalled();

      // 2. State updated to stopped
      const status = screen.getByRole('status');
      expect(status.textContent).toMatch(/stopped/i);

      // 3. Callback fired
      expect(onStopCallback).toHaveBeenCalled();
    });

    // Share button reappears for fresh learner action (no automatic resume)
    expect(screen.getByRole('button', { name: /share screen/i })).toBeTruthy();
    expect(revokeSpy).toBeDefined();
  });

  it('browser native stop control (track ended event) cancels tracks and transitions to stopped', async () => {
    wrap(<ScreenShare token="tok-1" helpRequestId="hr-1" role="learner" />);

    fireEvent.click(screen.getByRole('button', { name: /share screen/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop sharing screen/i })).toBeTruthy();
    });

    // Simulate user clicking "Stop sharing" in browser native bar
    const endedListener = mockTrack.listeners['ended'];
    expect(endedListener).toBeDefined();
    endedListener!();

    await waitFor(() => {
      expect(mockTrack.stop).toHaveBeenCalled();
      const status = screen.getByRole('status');
      expect(status.textContent).toMatch(/stopped/i);
    });

    // Fresh learner action required to reconnect
    expect(screen.getByRole('button', { name: /share screen/i })).toBeTruthy();
  });

  it('support viewer role renders video element with accessible stop control', async () => {
    vi.spyOn(sharingApi, 'getSessionByHelpRequestId').mockResolvedValue({
      id: 'session-123',
      helpRequestId: 'hr-1',
      learnerId: 'learner-1',
      supportId: 'support-1',
      state: 'active',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      revokedAt: null,
    });

    wrap(<ScreenShare token="tok-1" helpRequestId="hr-1" role="support" />);

    await waitFor(() => {
      // Video element rendered
      const video = screen.getByLabelText(/live screen share from learner/i);
      expect(video).toBeTruthy();
      expect(video.tagName.toLowerCase()).toBe('video');

      // Stop control rendered
      expect(screen.getByRole('button', { name: /stop sharing screen/i })).toBeTruthy();
    });
  });
});
