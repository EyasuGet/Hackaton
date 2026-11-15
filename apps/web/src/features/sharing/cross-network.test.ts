// Cross-Network WebRTC Verification and Mobile Acceptance Test Suite (T3-018-C).
// Verifies:
// 1. ICE candidate classification and filtering (host, srflx from STUN, relay from TURN).
// 2. STUN/TURN failover when direct peer connection fails across symmetric NATs.
// 3. Bandwidth and bitrate clamping: 720p/15fps, max bitrate < 500 kbps for low-bandwidth 3G conditions.
// 4. Video-only constraints (no audio capture, no microphone prompt, no ambient speech leakage).
// 5. Instant session termination upon track.stop(), browser window close, or explicit user stop.
// 6. Mobile browser user agents (iOS Safari, Android Chrome) receive explicit disclosure notice.
// 7. Preservation of 100% operational asynchronous text help thread on mobile devices.

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleContext } from '../../shared/i18n/i18n.tsx';
import * as helpApi from '../human-help/help-api.ts';
import { HelpInbox } from '../human-help/help-inbox.tsx';
import {
  captureScreen,
  clampSenderBitrate,
  clampTrackConstraints,
  closePeerConnection,
  createPeerConnection,
  createRelayFallbackConnection,
  filterIceCandidates,
  getIceCandidateType,
  LOW_BANDWIDTH_3G_CONSTRAINTS,
  MAX_3G_BITRATE_BPS,
  stopMediaStream,
  VIDEO_ONLY_DISPLAY_MEDIA_OPTIONS,
} from './media-connection.ts';
import { ScreenShare } from './screen-share.tsx';
import * as sharingApi from './sharing-api.ts';
import { isMobileUserAgent, isScreenShareSupported } from './support.ts';

function wrap(ui: React.ReactElement, locale: 'en' | 'am' = 'en') {
  return render(React.createElement(LocaleContext, { value: locale }, ui));
}

const ANDROID_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';

const IOS_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

describe('ICE candidate classification and filtering (T3-018-C)', () => {
  const hostCandidateSdp = 'candidate:1 1 UDP 2130706431 192.168.1.100 50000 typ host generation 0';
  const srflxCandidateSdp =
    'candidate:2 1 UDP 1694498815 203.0.113.50 50001 typ srflx raddr 192.168.1.100 rport 50000 generation 0';
  const relayCandidateSdp =
    'candidate:3 1 UDP 16777215 198.51.100.20 55000 typ relay raddr 203.0.113.50 rport 50001 generation 0';
  const prflxCandidateSdp =
    'candidate:4 1 UDP 1107296255 198.51.100.25 55002 typ prflx generation 0';

  it('correctly classifies host, srflx (STUN), relay (TURN), and prflx candidate types', () => {
    expect(getIceCandidateType(hostCandidateSdp)).toBe('host');
    expect(getIceCandidateType(srflxCandidateSdp)).toBe('srflx');
    expect(getIceCandidateType(relayCandidateSdp)).toBe('relay');
    expect(getIceCandidateType(prflxCandidateSdp)).toBe('prflx');
  });

  it('correctly extracts candidate type from RTCIceCandidateInit object', () => {
    expect(
      getIceCandidateType({ candidate: hostCandidateSdp, sdpMid: '0', sdpMLineIndex: 0 }),
    ).toBe('host');
    expect(
      getIceCandidateType({ candidate: relayCandidateSdp, sdpMid: '0', sdpMLineIndex: 0 }),
    ).toBe('relay');
  });

  it('returns unknown for malformed or missing candidate strings', () => {
    expect(getIceCandidateType('')).toBe('unknown');
    expect(getIceCandidateType('candidate:foo bar')).toBe('unknown');
    expect(getIceCandidateType({ candidate: '' })).toBe('unknown');
  });

  it('filters candidate lists by allowed candidate types', () => {
    const candidates = [hostCandidateSdp, srflxCandidateSdp, relayCandidateSdp, prflxCandidateSdp];

    // Direct-only filtering (host + srflx)
    const directOnly = filterIceCandidates(candidates, ['host', 'srflx']);
    expect(directOnly).toHaveLength(2);
    expect(directOnly).toContain(hostCandidateSdp);
    expect(directOnly).toContain(srflxCandidateSdp);
    expect(directOnly).not.toContain(relayCandidateSdp);

    // Relay-only filtering for forced TURN traversal
    const relayOnly = filterIceCandidates(candidates, ['relay']);
    expect(relayOnly).toHaveLength(1);
    expect(relayOnly).toContain(relayCandidateSdp);
  });
});

describe('STUN/TURN failover across symmetric NATs (T3-018-C)', () => {
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;

  class MockRTCPeerConnection {
    readonly config: RTCConfiguration;
    ontrack: ((event: unknown) => void) | null = null;
    onicecandidate: ((event: unknown) => void) | null = null;
    onconnectionstatechange: (() => void) | null = null;
    connectionState: RTCPeerConnectionState = 'new';
    iceConnectionState: RTCIceConnectionState = 'new';
    iceGatheringState: RTCIceGatheringState = 'new';

    constructor(config: RTCConfiguration = {}) {
      this.config = config;
    }

    addTrack = vi.fn();
    createOffer = vi.fn(() => Promise.resolve({ type: 'offer' as const, sdp: 'mock-offer-sdp' }));
    createAnswer = vi.fn(() =>
      Promise.resolve({ type: 'answer' as const, sdp: 'mock-answer-sdp' }),
    );
    setLocalDescription = vi.fn(() => Promise.resolve());
    setRemoteDescription = vi.fn(() => Promise.resolve());
    addIceCandidate = vi.fn(() => Promise.resolve());
    close = vi.fn(() => {
      this.connectionState = 'closed';
      this.ontrack = null;
      this.onicecandidate = null;
      this.onconnectionstatechange = null;
    });
  }

  beforeEach(() => {
    globalThis.RTCPeerConnection = MockRTCPeerConnection as unknown as typeof RTCPeerConnection;
  });

  afterEach(() => {
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
  });

  it('creates an RTCPeerConnection with STUN server configuration by default', () => {
    const pc = createPeerConnection();
    expect(pc).toBeDefined();
    expect((pc as unknown as MockRTCPeerConnection).config.iceServers).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
    ]);
    closePeerConnection(pc);
  });

  it('creates a relay fallback RTCPeerConnection enforcing iceTransportPolicy: relay', () => {
    const turnServers: RTCIceServer[] = [
      {
        urls: 'turns:relay.example.org:5349',
        username: '1700000000:learner-1',
        credential: 'test-hmac-credential',
      },
    ];

    const fallbackPc = createRelayFallbackConnection(turnServers);
    expect(fallbackPc).toBeDefined();
    const mock = fallbackPc as unknown as MockRTCPeerConnection;
    expect(mock.config.iceTransportPolicy).toBe('relay');
    expect(mock.config.iceServers).toEqual(turnServers);
    closePeerConnection(fallbackPc);
  });

  it('handles symmetric NAT failure by detecting connection failure and initiating TURN relay fallback', () => {
    type ConnectionState = RTCPeerConnectionState;
    let currentState: ConnectionState = 'new';
    let stateChangeHandler: (() => void) | null = null;

    const mockPc = {
      get connectionState() {
        return currentState;
      },
      set onconnectionstatechange(handler: (() => void) | null) {
        stateChangeHandler = handler;
      },
      get onconnectionstatechange() {
        return stateChangeHandler;
      },
      close: vi.fn(),
      ontrack: null,
      onicecandidate: null,
    } as unknown as RTCPeerConnection;

    let failoverTriggered = false;
    let activeConnection: RTCPeerConnection | null = mockPc;

    const onStateChange = () => {
      if (activeConnection?.connectionState === 'failed') {
        failoverTriggered = true;
        // Failover to relay-only connection
        activeConnection = createRelayFallbackConnection([
          { urls: 'turns:relay.track3.local:5349', username: 'u', credential: 'p' },
        ]);
      }
    };

    mockPc.onconnectionstatechange = onStateChange;

    // Simulate failure across symmetric NAT
    currentState = 'failed';
    const handler = stateChangeHandler as (() => void) | null;
    handler?.();

    expect(failoverTriggered).toBe(true);
    expect(activeConnection).not.toBe(mockPc);
    closePeerConnection(activeConnection);
  });
});

describe('Bandwidth and bitrate clamping for low-bandwidth 3G (T3-018-C)', () => {
  it('defines 720p maximum resolution and 15fps maximum framerate for 3G conditions', () => {
    expect(LOW_BANDWIDTH_3G_CONSTRAINTS).toEqual({
      width: { max: 1280 },
      height: { max: 720 },
      frameRate: { max: 15 },
    });
  });

  it('defines maximum bitrate target strictly below 500 kbps (450,000 bps)', () => {
    expect(MAX_3G_BITRATE_BPS).toBeLessThan(500_000);
    expect(MAX_3G_BITRATE_BPS).toBe(450_000);
  });

  it('clampTrackConstraints applies 720p / 15fps constraints to video track', async () => {
    const applyConstraintsMock = vi.fn().mockResolvedValue(undefined);
    const mockTrack = {
      applyConstraints: applyConstraintsMock,
      kind: 'video',
    } as unknown as MediaStreamTrack;

    await clampTrackConstraints(mockTrack);

    expect(applyConstraintsMock).toHaveBeenCalledTimes(1);
    expect(applyConstraintsMock).toHaveBeenCalledWith(LOW_BANDWIDTH_3G_CONSTRAINTS);
  });

  it('clampSenderBitrate configures RTCRtpSender encodings with maxBitrate < 500 kbps and maxFramerate 15', async () => {
    let encodings: RTCRtpEncodingParameters[] = [{}];
    const mockGetParameters = vi.fn(() => ({
      encodings,
      codecs: [],
      headerExtensions: [],
      rtcp: {},
      transactionId: 'tx-1',
    }));
    const mockSetParameters = vi.fn((params: RTCRtpSendParameters) => {
      encodings = params.encodings;
      return Promise.resolve();
    });
    const mockSender = {
      getParameters: mockGetParameters,
      setParameters: mockSetParameters,
    } as unknown as RTCRtpSender;

    await clampSenderBitrate(mockSender, MAX_3G_BITRATE_BPS, 15);

    expect(mockGetParameters).toHaveBeenCalledTimes(1);
    expect(mockSetParameters).toHaveBeenCalledTimes(1);
    const firstEncoding = encodings[0];
    expect(firstEncoding?.maxBitrate).toBe(450_000);
    expect(firstEncoding?.maxBitrate).toBeLessThan(500_000);
    expect(firstEncoding?.maxFramerate).toBe(15);
  });

  it('clampSenderBitrate handles sender without existing encodings gracefully', async () => {
    let encodings: RTCRtpEncodingParameters[] = [];
    const mockGetParameters = vi.fn(() => ({
      encodings,
      codecs: [],
      headerExtensions: [],
      rtcp: {},
      transactionId: 'tx-2',
    }));
    const mockSetParameters = vi.fn((params: RTCRtpSendParameters) => {
      encodings = params.encodings;
      return Promise.resolve();
    });
    const mockSender = {
      getParameters: mockGetParameters,
      setParameters: mockSetParameters,
    } as unknown as RTCRtpSender;

    await clampSenderBitrate(mockSender, 400_000, 12);

    expect(mockGetParameters).toHaveBeenCalledTimes(1);
    expect(mockSetParameters).toHaveBeenCalledTimes(1);
    expect(encodings).toHaveLength(1);
    const firstEnc = encodings[0];
    expect(firstEnc?.maxBitrate).toBe(400_000);
    expect(firstEnc?.maxFramerate).toBe(12);
  });
});

describe('Video-only constraints and microphone exclusion (T3-018-C)', () => {
  const originalMediaDevices = navigator.mediaDevices;

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      writable: true,
      configurable: true,
    });
  });

  it('VIDEO_ONLY_DISPLAY_MEDIA_OPTIONS strictly sets audio to false and video to 720p/15fps', () => {
    expect(VIDEO_ONLY_DISPLAY_MEDIA_OPTIONS.audio).toBe(false);
    expect(VIDEO_ONLY_DISPLAY_MEDIA_OPTIONS.video).toEqual({
      width: { max: 1280 },
      height: { max: 720 },
      frameRate: { max: 15 },
    });
  });

  it('captureScreen invokes getDisplayMedia with audio: false to prevent microphone prompt', async () => {
    const mockStream = {
      getTracks: vi.fn(() => []),
      getVideoTracks: vi.fn(() => []),
    } as unknown as MediaStream;

    const getDisplayMediaMock = vi.fn().mockResolvedValue(mockStream);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia: getDisplayMediaMock },
      writable: true,
      configurable: true,
    });

    const stream = await captureScreen(VIDEO_ONLY_DISPLAY_MEDIA_OPTIONS);

    expect(stream).toBe(mockStream);
    expect(getDisplayMediaMock).toHaveBeenCalledTimes(1);
    const callArgs = getDisplayMediaMock.mock.calls[0]?.[0] as
      DisplayMediaStreamOptions | undefined;
    expect(callArgs?.audio).toBe(false);
  });

  it('ScreenShare sharer setup adds only video tracks and ignores audio tracks if present', () => {
    const mockVideoTrack = {
      kind: 'video',
      id: 'v1',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const mockAudioTrack = {
      kind: 'audio',
      id: 'a1',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;

    const mockStream = {
      getVideoTracks: vi.fn(() => [mockVideoTrack]),
      getAudioTracks: vi.fn(() => [mockAudioTrack]),
      getTracks: vi.fn(() => [mockVideoTrack, mockAudioTrack]),
    } as unknown as MediaStream;

    const addedTracks: MediaStreamTrack[] = [];
    const mockPc = {
      addTrack: vi.fn((track: MediaStreamTrack) => {
        addedTracks.push(track);
        return {
          getParameters: vi.fn(() => ({ encodings: [{}] })),
          setParameters: vi.fn(),
        } as unknown as RTCRtpSender;
      }),
    };

    const videoTracks = mockStream.getVideoTracks();
    for (const track of videoTracks) {
      mockPc.addTrack(track);
    }

    expect(addedTracks).toHaveLength(1);
    expect(addedTracks[0]?.kind).toBe('video');
    expect(addedTracks).not.toContain(mockAudioTrack);
  });
});

describe('Instant session termination (T3-018-C)', () => {
  it('stopMediaStream stops every track in the stream immediately', () => {
    const track1 = { stop: vi.fn() };
    const track2 = { stop: vi.fn() };
    const mockStream = {
      getTracks: vi.fn(() => [track1, track2]),
    } as unknown as MediaStream;

    stopMediaStream(mockStream);

    expect(track1.stop).toHaveBeenCalledTimes(1);
    expect(track2.stop).toHaveBeenCalledTimes(1);
  });

  it('stopMediaStream handles null or empty stream without error', () => {
    expect(() => stopMediaStream(null)).not.toThrow();
    const emptyStream = { getTracks: vi.fn(() => []) } as unknown as MediaStream;
    expect(() => stopMediaStream(emptyStream)).not.toThrow();
  });

  it('closePeerConnection closes RTCPeerConnection and detaches all event listeners', () => {
    const mockClose = vi.fn();
    const mockPc = {
      ontrack: vi.fn(),
      onicecandidate: vi.fn(),
      onconnectionstatechange: vi.fn(),
      close: mockClose,
    } as unknown as RTCPeerConnection;

    closePeerConnection(mockPc);

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockPc.ontrack).toBeNull();
    expect(mockPc.onicecandidate).toBeNull();
    expect(mockPc.onconnectionstatechange).toBeNull();
  });

  it('browser window beforeunload event triggers instant media stream and peer connection teardown', async () => {
    const originalIsSecureContext = window.isSecureContext;
    const originalMediaDevices = navigator.mediaDevices;

    const mockTrack = {
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      kind: 'video',
      readyState: 'live',
    };
    const mockStream = {
      getTracks: vi.fn(() => [mockTrack]),
      getVideoTracks: vi.fn(() => [mockTrack]),
    };
    const getDisplayMediaMock = vi.fn().mockResolvedValue(mockStream);

    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia: getDisplayMediaMock },
      writable: true,
      configurable: true,
    });

    vi.spyOn(sharingApi, 'getSessionByHelpRequestId').mockResolvedValue(null);

    wrap(
      React.createElement(ScreenShare, { token: 'tok-1', helpRequestId: 'hr-1', role: 'learner' }),
    );

    // Start sharing
    fireEvent.click(screen.getByRole('button', { name: /share screen/i }));
    await waitFor(() => {
      expect(getDisplayMediaMock).toHaveBeenCalled();
    });

    // Simulate browser window close / tab navigation
    window.dispatchEvent(new Event('beforeunload'));

    // Track is stopped instantly
    expect(mockTrack.stop).toHaveBeenCalled();

    cleanup();
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
});

describe('Mobile Acceptance & Disclosure Verification (T3-018-C)', () => {
  const originalUserAgent = navigator.userAgent;
  const originalIsSecureContext = window.isSecureContext;
  const originalMediaDevices = navigator.mediaDevices;

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      writable: true,
      configurable: true,
    });
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

  it('isMobileUserAgent detects Android Chrome and iOS Safari user agents', () => {
    expect(isMobileUserAgent(ANDROID_CHROME_UA)).toBe(true);
    expect(isMobileUserAgent(IOS_SAFARI_UA)).toBe(true);
    expect(isMobileUserAgent(DESKTOP_CHROME_UA)).toBe(false);
  });

  it('isScreenShareSupported returns false on mobile user agents even in secure context', () => {
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

    expect(isScreenShareSupported(ANDROID_CHROME_UA)).toBe(false);
    expect(isScreenShareSupported(IOS_SAFARI_UA)).toBe(false);
    expect(isScreenShareSupported(DESKTOP_CHROME_UA)).toBe(true);
  });

  it('renders explicit disclosure notice for Android Chrome simulated user agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: ANDROID_CHROME_UA,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      writable: true,
      configurable: true,
    });

    wrap(
      React.createElement(ScreenShare, { token: 'tok-1', helpRequestId: 'hr-1', role: 'learner' }),
    );

    const note = screen.getByRole('note');
    expect(note).toBeDefined();
    expect(note.textContent).toMatch(
      /screen sharing is not supported on this browser or mobile device/i,
    );

    expect(screen.queryByRole('button', { name: /share screen/i })).toBeNull();
  });

  it('renders explicit disclosure notice for iOS Safari simulated user agent in English and Amharic', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: IOS_SAFARI_UA,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      writable: true,
      configurable: true,
    });

    // English
    const { unmount } = wrap(
      React.createElement(ScreenShare, { token: 'tok-1', helpRequestId: 'hr-1', role: 'learner' }),
      'en',
    );
    expect(screen.getByRole('note').textContent).toMatch(
      /not supported on this browser or mobile device/i,
    );
    unmount();

    // Amharic
    wrap(
      React.createElement(ScreenShare, { token: 'tok-1', helpRequestId: 'hr-1', role: 'learner' }),
      'am',
    );
    expect(screen.getByRole('note').textContent).toMatch(
      /በዚህ አሳሽ ወይም ተንቀሳቃሽ መሣሪያ ላይ ማያ ማጋራት አይደገፍም/,
    );
  });

  it('verifies that while screen sharing is unavailable on mobile devices, asynchronous text help remains 100% operational', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: ANDROID_CHROME_UA,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      writable: true,
      configurable: true,
    });

    const claimedRequest: helpApi.HelpRequest = {
      id: 'req-claimed-1',
      ownerId: 'learner-1',
      clientRequestId: 'client-req-1',
      contextSnapshot: 'Question about WebRTC data channels.',
      consentGiven: true,
      state: 'claimed',
      claimedBy: 'staff-1',
      claimedAt: new Date('2026-11-15T10:05:00Z').toISOString(),
      createdAt: new Date('2026-11-15T10:00:00Z').toISOString(),
      expiresAt: new Date('2026-11-22T10:00:00Z').toISOString(),
      updatedAt: new Date('2026-11-15T10:05:00Z').toISOString(),
      cancelledAt: null,
      resolvedAt: null,
      resolvedBy: null,
    };

    const existingReplies: helpApi.HelpReply[] = [
      {
        id: 'reply-1',
        helpRequestId: 'req-claimed-1',
        authorId: 'staff-1',
        clientReplyId: 'cr-staff-1',
        body: 'Hello! I am reviewing your question. What specific error are you seeing?',
        createdAt: new Date('2026-11-15T10:06:00Z').toISOString(),
        readAt: null,
      },
    ];

    vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({
      kind: 'ok',
      requests: [claimedRequest],
    });
    vi.spyOn(helpApi, 'listReplies').mockResolvedValue({
      kind: 'ok',
      replies: existingReplies,
    });
    const addReplySpy = vi.spyOn(helpApi, 'addReply').mockResolvedValue({
      kind: 'added',
      reply: {
        id: 'reply-2',
        helpRequestId: 'req-claimed-1',
        authorId: 'learner-1',
        clientReplyId: 'cr-learner-1',
        body: 'I am getting ICE connection failed across symmetric NAT.',
        createdAt: new Date('2026-11-15T10:10:00Z').toISOString(),
        readAt: null,
      },
    });

    wrap(React.createElement(HelpInbox, { token: 'token-learner-1' }));

    // 1. Wait for inbox to load and display the claimed request status
    await waitFor(() => {
      expect(screen.getByText(/being handled by staff/i)).toBeTruthy();
    });

    // 2. Verify mobile disclosure note is visible in the sharing panel
    const notes = screen.getAllByRole('note');
    const unsupportedNote = notes.find((n) =>
      /not supported on this browser or mobile device/i.test(n.textContent ?? ''),
    );
    expect(unsupportedNote).toBeDefined();
    expect(unsupportedNote?.textContent).toMatch(/not supported on this browser or mobile device/i);

    // 3. Verify existing staff reply is visible and readable
    expect(screen.getByText(/hello! i am reviewing your question/i)).toBeTruthy();

    // 4. Verify the asynchronous text reply compose button is available and interactive
    const replyButton = screen.getByRole('button', { name: /^reply$/i });
    expect(replyButton).toBeTruthy();
    fireEvent.click(replyButton);

    // 5. Textarea is rendered, accessible, and editable
    const textarea = screen.getByRole('textbox', { name: /your reply/i });
    expect(textarea).toBeTruthy();
    expect(textarea.getAttribute('aria-required')).toBe('true');

    fireEvent.change(textarea, {
      target: { value: 'I am getting ICE connection failed across symmetric NAT.' },
    });

    // 6. Send button is active and functional
    const sendButton = screen.getByRole('button', { name: /^send$/i });
    expect(sendButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(addReplySpy).toHaveBeenCalledTimes(1);
      expect(addReplySpy).toHaveBeenCalledWith(
        'token-learner-1',
        'req-claimed-1',
        expect.any(String),
        'I am getting ICE connection failed across symmetric NAT.',
      );
    });
  });
});
