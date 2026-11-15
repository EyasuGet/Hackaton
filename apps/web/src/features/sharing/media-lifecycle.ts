// Media stream and track lifecycle controller for screen sharing (T3-018-B).
// Enforces video-only capture, clean track shutdown, and browser-native permission.
import type { IceServerConfig } from './sharing-api.ts';

export interface ScreenCaptureOptions {
  /** Video-only capture by specification constraint (spec R05 / T3-018-B). */
  readonly video?: boolean;
  readonly audio?: boolean;
}

/**
 * Invokes the browser-native screen picker.
 * MUST only be invoked from direct learner user interaction (e.g. click).
 * Enforces video of chosen screen only; conferencing audio is disabled.
 */
export async function requestScreenMedia(options: ScreenCaptureOptions = {}): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Screen capture is not supported in this browser environment');
  }

  // Explicitly enforce video only, audio: false (spec R05: video of the chosen screen only, no conferencing)
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: options.video ?? true,
    audio: options.audio ?? false,
  });

  return stream;
}

/**
 * Ends all media tracks on a stream immediately.
 * Called on stop, disconnect, or session revocation.
 */
export function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Ignore errors on already-stopped tracks
    }
  }
}

/**
 * Attaches a listener to the video track so that when the learner clicks the browser's
 * native floating stop-sharing bar, the cleanup callback is invoked.
 */
export function attachTrackEndedHandler(stream: MediaStream, onEnded: () => void): () => void {
  const tracks = stream.getVideoTracks();
  const handlers: Array<{ track: MediaStreamTrack; handler: () => void }> = [];

  for (const track of tracks) {
    const handler = () => {
      onEnded();
    };
    track.addEventListener('ended', handler);
    handlers.push({ track, handler });
  }

  return () => {
    for (const { track, handler } of handlers) {
      track.removeEventListener('ended', handler);
    }
  };
}

/**
 * Constructs an RTCPeerConnection with configured ICE servers.
 */
export function createPeerConnection(iceServers?: readonly IceServerConfig[]): RTCPeerConnection {
  const rtcConfig: RTCConfiguration = {};
  if (iceServers) {
    rtcConfig.iceServers = iceServers as RTCIceServer[];
  }
  return new RTCPeerConnection(rtcConfig);
}
