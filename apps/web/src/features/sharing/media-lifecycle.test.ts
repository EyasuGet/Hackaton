import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  attachTrackEndedHandler,
  createPeerConnection,
  requestScreenMedia,
  stopMediaStream,
} from './media-lifecycle.ts';
import { canCaptureScreen, isMobileBrowser } from './media-support.ts';

describe('Media lifecycle and permissions (T3-018-B)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('device & browser capability detection', () => {
    it('detects desktop browsers as supported when getDisplayMedia is present', () => {
      const desktopUa =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      expect(isMobileBrowser(desktopUa)).toBe(false);

      vi.stubGlobal('navigator', {
        userAgent: desktopUa,
        mediaDevices: {
          getDisplayMedia: vi.fn(),
        },
      });
      expect(canCaptureScreen(desktopUa)).toBe(true);
    });

    it('detects mobile browsers as unsupported to protect mobile learners', () => {
      const mobileUas = [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      ];
      for (const ua of mobileUas) {
        expect(isMobileBrowser(ua)).toBe(true);
        expect(canCaptureScreen(ua)).toBe(false);
      }
    });
  });

  describe('screen capture invocation', () => {
    it('enforces video-only capture and audio=false (spec R05)', async () => {
      const mockTrack = {
        kind: 'video',
        stop: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaStreamTrack;

      const mockStream = {
        getVideoTracks: () => [mockTrack],
        getTracks: () => [mockTrack],
      } as unknown as MediaStream;

      const getDisplayMediaMock = vi.fn().mockResolvedValue(mockStream);
      vi.stubGlobal('navigator', {
        mediaDevices: {
          getDisplayMedia: getDisplayMediaMock,
        },
      });

      const stream = await requestScreenMedia();
      expect(stream).toBe(mockStream);
      expect(getDisplayMediaMock).toHaveBeenCalledWith({
        video: true,
        audio: false,
      });
    });

    it('rejects if getDisplayMedia is missing', async () => {
      vi.stubGlobal('navigator', { mediaDevices: {} });
      await expect(requestScreenMedia()).rejects.toThrow(/not supported/i);
    });
  });

  describe('track shutdown lifecycle', () => {
    it('stopMediaStream stops every track on the stream', () => {
      const stop1 = vi.fn();
      const stop2 = vi.fn();
      const mockStream = {
        getTracks: () => [
          { kind: 'video', stop: stop1 } as unknown as MediaStreamTrack,
          { kind: 'video', stop: stop2 } as unknown as MediaStreamTrack,
        ],
      } as unknown as MediaStream;

      stopMediaStream(mockStream);
      expect(stop1).toHaveBeenCalledTimes(1);
      expect(stop2).toHaveBeenCalledTimes(1);
    });

    it('handles null stream gracefully', () => {
      expect(() => stopMediaStream(null)).not.toThrow();
    });

    it('attachTrackEndedHandler fires onEnded callback when track ends natively', () => {
      let listener: (() => void) | undefined;
      const removeEventListenerSpy = vi.fn();
      const track = {
        kind: 'video',
        addEventListener: vi.fn((event: string, fn: EventListenerOrEventListenerObject) => {
          if (event === 'ended' && typeof fn === 'function') {
            listener = fn as () => void;
          }
        }),
        removeEventListener: removeEventListenerSpy,
      } as unknown as MediaStreamTrack;

      const mockStream = {
        getVideoTracks: () => [track],
      } as unknown as MediaStream;

      const onEnded = vi.fn();
      const detach = attachTrackEndedHandler(mockStream, onEnded);

      expect(listener).toBeDefined();
      listener!();
      expect(onEnded).toHaveBeenCalledTimes(1);

      detach();
      expect(removeEventListenerSpy).toHaveBeenCalledWith('ended', expect.any(Function));
    });
  });

  describe('createPeerConnection', () => {
    it('initialises RTCPeerConnection with iceServers', () => {
      let passedConfig: RTCConfiguration | undefined;
      class MockRTCPeerConnection {
        constructor(config?: RTCConfiguration) {
          passedConfig = config;
        }
      }
      vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection);

      const iceServers = [{ urls: 'stun:stun.example.org:3478' }];
      const pc = createPeerConnection(iceServers);

      expect(pc).toBeInstanceOf(MockRTCPeerConnection);
      expect(passedConfig).toEqual({
        iceServers: [{ urls: 'stun:stun.example.org:3478' }],
      });
    });
  });
});
