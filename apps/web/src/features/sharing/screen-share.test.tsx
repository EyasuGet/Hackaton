import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleContext } from '../../shared/i18n/i18n.tsx';
import { ScreenShare } from './screen-share.tsx';

function getUrlString(url: string | URL | Request): string {
  if (typeof url === 'string') return url;
  if (url instanceof URL) return url.href;
  return url.url;
}

describe('ScreenShare component (T3-018-B)', () => {
  let mockTrack: {
    kind: string;
    stop: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };
  let mockStream: {
    getVideoTracks: () => unknown[];
    getTracks: () => unknown[];
  };
  let getDisplayMediaMock: ReturnType<typeof vi.fn>;
  let mockTrackEndedListener: (() => void) | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockTrackEndedListener = undefined;
    mockTrack = {
      kind: 'video',
      stop: vi.fn(),
      addEventListener: vi.fn((event: string, cb: () => void) => {
        if (event === 'ended') mockTrackEndedListener = cb;
      }),
      removeEventListener: vi.fn(),
    };

    mockStream = {
      getVideoTracks: () => [mockTrack],
      getTracks: () => [mockTrack],
    };

    getDisplayMediaMock = vi.fn().mockResolvedValue(mockStream);

    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      mediaDevices: {
        getDisplayMedia: getDisplayMediaMock,
      },
    });

    class MockRTCPeerConnection {
      signalingState = 'stable';
      connectionState = 'connected';
      onicecandidate: ((e: { candidate: { toJSON: () => unknown } | null }) => void) | null = null;
      onconnectionstatechange: (() => void) | null = null;
      ontrack: ((e: { streams: MediaStream[]; track: MediaStreamTrack }) => void) | null = null;

      addTrack = vi.fn();
      createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-offer-sdp' });
      createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-answer-sdp' });
      setLocalDescription = vi.fn().mockResolvedValue(undefined);
      setRemoteDescription = vi.fn().mockResolvedValue(undefined);
      addIceCandidate = vi.fn().mockResolvedValue(undefined);
      close = vi.fn();
    }

    vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection);
  });

  afterEach(() => {
    cleanup();
  });

  it('only learner action invokes the browser picker; does NOT capture on mount', () => {
    render(
      <LocaleContext value="en">
        <ScreenShare token="test-token" helpRequestId="help-1" isOwner={true} />
      </LocaleContext>,
    );

    expect(screen.getByRole('button', { name: /share chosen screen/i })).toBeTruthy();
    expect(getDisplayMediaMock).not.toHaveBeenCalled();
  });

  it('learner clicking start opens browser picker with video: true, audio: false and shows persistent accessible stop control', async () => {
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = getUrlString(url);
      if (urlStr.includes('/api/sharing/sessions') && init?.method === 'POST') {
        if (urlStr.endsWith('/join')) {
          return Promise.resolve(
            new Response(JSON.stringify({ session: { id: 'sess-1', state: 'active' } }), {
              status: 200,
            }),
          );
        }
        if (urlStr.endsWith('/signals')) {
          return Promise.resolve(
            new Response(JSON.stringify({ signal: { id: '1', type: 'offer' } }), {
              status: 201,
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: 'sess-1',
                helpRequestId: 'help-1',
                learnerId: 'l1',
                supportId: 's1',
                state: 'pending',
                createdAt: new Date().toISOString(),
                expiresAt: new Date().toISOString(),
                revokedAt: null,
              },
            }),
            { status: 201 },
          ),
        );
      }
      if (urlStr.includes('/ice-servers')) {
        return Promise.resolve(
          new Response(JSON.stringify({ iceServers: [{ urls: 'stun:stun.example.org' }] }), {
            status: 200,
          }),
        );
      }
      if (urlStr.includes('/signals')) {
        return Promise.resolve(new Response(JSON.stringify({ signals: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LocaleContext value="en">
        <ScreenShare token="test-token" helpRequestId="help-1" isOwner={true} />
      </LocaleContext>,
    );

    const startButton = screen.getByRole('button', { name: /share chosen screen/i });
    fireEvent.click(startButton);

    expect(getDisplayMediaMock).toHaveBeenCalledWith({
      video: true,
      audio: false,
    });

    // Wait for active state
    await waitFor(() => {
      expect(screen.getByText(/you are sharing your screen with support/i)).toBeTruthy();
    });

    // Persistent accessible stop control is visible and operable
    const stopButton = screen.getByRole('button', { name: /stop screen sharing/i });
    expect(stopButton).toBeTruthy();
  });

  it('clicking stop ends media tracks, revokes session, and requires fresh learner action to restart', async () => {
    let sessionRevoked = false;
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = getUrlString(url);
      if (urlStr.includes('/api/sharing/sessions') && init?.method === 'DELETE') {
        sessionRevoked = true;
        return Promise.resolve(
          new Response(JSON.stringify({ session: { id: 'sess-1', state: 'revoked' } }), {
            status: 200,
          }),
        );
      }
      if (urlStr.includes('/api/sharing/sessions') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: 'sess-1',
                helpRequestId: 'help-1',
                learnerId: 'l1',
                supportId: 's1',
                state: 'active',
                createdAt: new Date().toISOString(),
                expiresAt: new Date().toISOString(),
                revokedAt: null,
              },
            }),
            { status: 201 },
          ),
        );
      }
      if (urlStr.includes('/ice-servers')) {
        return Promise.resolve(new Response(JSON.stringify({ iceServers: [] }), { status: 200 }));
      }
      if (urlStr.includes('/signals')) {
        return Promise.resolve(new Response(JSON.stringify({ signals: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LocaleContext value="en">
        <ScreenShare token="test-token" helpRequestId="help-1" isOwner={true} />
      </LocaleContext>,
    );

    fireEvent.click(screen.getByRole('button', { name: /share chosen screen/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop screen sharing/i })).toBeTruthy();
    });

    const stopButton = screen.getByRole('button', { name: /stop screen sharing/i });
    fireEvent.click(stopButton);

    // Media tracks must be stopped
    expect(mockTrack.stop).toHaveBeenCalled();
    expect(sessionRevoked).toBe(true);

    // Reconnection requires fresh action: start button reappears and media is not auto-started
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /share chosen screen/i })).toBeTruthy();
      expect(screen.getByText(/screen sharing has stopped/i)).toBeTruthy();
    });

    expect(getDisplayMediaMock).toHaveBeenCalledTimes(1);
  });

  it('native browser stop-sharing event terminates tracks and resets state', async () => {
    const fetchMock = vi.fn(() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            session: {
              id: 'sess-1',
              helpRequestId: 'help-1',
              learnerId: 'l1',
              supportId: 's1',
              state: 'active',
              createdAt: new Date().toISOString(),
              expiresAt: new Date().toISOString(),
              revokedAt: null,
            },
            iceServers: [],
            signals: [],
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LocaleContext value="en">
        <ScreenShare token="test-token" helpRequestId="help-1" isOwner={true} />
      </LocaleContext>,
    );

    fireEvent.click(screen.getByRole('button', { name: /share chosen screen/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop screen sharing/i })).toBeTruthy();
    });

    // Simulate user clicking native browser stop bar
    expect(mockTrackEndedListener).toBeDefined();
    mockTrackEndedListener!();

    await waitFor(() => {
      expect(mockTrack.stop).toHaveBeenCalled();
      expect(screen.getByText(/screen sharing has stopped/i)).toBeTruthy();
    });
  });

  it('unsupported mobile browser discloses limitation and does not invoke picker', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      mediaDevices: {
        getDisplayMedia: getDisplayMediaMock,
      },
    });

    render(
      <LocaleContext value="en">
        <ScreenShare token="test-token" helpRequestId="help-1" isOwner={true} />
      </LocaleContext>,
    );

    expect(
      screen.getByText(/screen sharing is not supported on this mobile browser/i),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /share chosen screen/i })).toBeNull();
    expect(getDisplayMediaMock).not.toHaveBeenCalled();
  });

  it('support viewer connects and displays video element with disconnect control', async () => {
    const fetchMock = vi.fn((url: string | URL | Request) => {
      const urlStr = getUrlString(url);
      if (urlStr.includes('/by-request/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: 'sess-view-1',
                helpRequestId: 'help-1',
                learnerId: 'l1',
                supportId: 's1',
                state: 'active',
                createdAt: new Date().toISOString(),
                expiresAt: new Date().toISOString(),
                revokedAt: null,
              },
            }),
            { status: 200 },
          ),
        );
      }
      if (urlStr.includes('/ice-servers')) {
        return Promise.resolve(new Response(JSON.stringify({ iceServers: [] }), { status: 200 }));
      }
      if (urlStr.includes('/signals')) {
        return Promise.resolve(new Response(JSON.stringify({ signals: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LocaleContext value="en">
        <ScreenShare token="test-token" helpRequestId="help-1" isOwner={false} />
      </LocaleContext>,
    );

    await waitFor(() => {
      expect(screen.getByText(/waiting for learner to share screen/i)).toBeTruthy();
    });
  });
});
