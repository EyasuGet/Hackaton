// Media stream and WebRTC connection utilities for screen sharing (T3-018-B, T3-018-C).
// Enforces video of chosen screen only (audio: false). No conferencing/recording features.
// Provides bandwidth and bitrate clamping (< 500 kbps, 720p/15fps) for low-bandwidth 3G,
// ICE candidate classification and filtering, and symmetric NAT relay failover helpers.

/**
 * Low-bandwidth 3G video constraints: maximum 720p (1280x720) and 15 fps.
 */
export const LOW_BANDWIDTH_3G_CONSTRAINTS: MediaTrackConstraints = {
  width: { max: 1280 },
  height: { max: 720 },
  frameRate: { max: 15 },
};

/**
 * Maximum video bitrate target for low-bandwidth 3G network conditions (< 500 kbps).
 * Default 450 kbps (450,000 bps) provides headroom for signalling and packet overhead.
 */
export const MAX_3G_BITRATE_BPS = 450_000;

/**
 * Standard display media stream options for screen sharing.
 * Strictly video-only; audio is explicitly false (no microphone prompt/capture).
 */
export const VIDEO_ONLY_DISPLAY_MEDIA_OPTIONS: DisplayMediaStreamOptions = {
  video: {
    width: { max: 1280 },
    height: { max: 720 },
    frameRate: { max: 15 },
  },
  audio: false,
};

/**
 * Requests display media from the browser native picker.
 * Only explicit learner action may invoke this.
 * Captures video only; audio is strictly disabled.
 */
export async function captureScreen(
  constraints: DisplayMediaStreamOptions = { video: true, audio: false },
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('getDisplayMedia is not supported in this environment');
  }
  return navigator.mediaDevices.getDisplayMedia(constraints);
}

/**
 * Cancels all active tracks in a media stream immediately.
 * Inseparable from disconnect/revocation safety.
 */
export function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) return;
  const tracks = stream.getTracks();
  for (const track of tracks) {
    track.stop();
  }
}

/**
 * Safely closes an RTCPeerConnection and detaches all event handlers.
 */
export function closePeerConnection(pc: RTCPeerConnection | null): void {
  if (!pc) return;
  pc.ontrack = null;
  pc.onicecandidate = null;
  pc.onconnectionstatechange = null;
  pc.close();
}

/**
 * Applies 720p / 15fps resolution and framerate constraints to a video track.
 */
export async function clampTrackConstraints(
  track: MediaStreamTrack,
  constraints: MediaTrackConstraints = LOW_BANDWIDTH_3G_CONSTRAINTS,
): Promise<void> {
  if (typeof track.applyConstraints === 'function') {
    await track.applyConstraints(constraints);
  }
}

/**
 * Clamps WebRTC sender video encoding bitrate and framerate for low-bandwidth 3G conditions.
 * Ensures maxBitrate < 500 kbps (default 450 kbps) and maxFramerate <= 15 fps.
 */
export async function clampSenderBitrate(
  sender: RTCRtpSender,
  maxBitrateBps: number = MAX_3G_BITRATE_BPS,
  maxFramerate: number = 15,
): Promise<void> {
  if (typeof sender.getParameters !== 'function' || typeof sender.setParameters !== 'function') {
    return;
  }
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    for (const encoding of params.encodings) {
      encoding.maxBitrate = maxBitrateBps;
      encoding.maxFramerate = maxFramerate;
    }
    await sender.setParameters(params);
  } catch {
    // Graceful fallback if browser implementation restricts setParameters before negotiation
  }
}

export type IceCandidateType = 'host' | 'srflx' | 'relay' | 'prflx' | 'unknown';

/**
 * Parses the candidate type from an RTCIceCandidate or candidate SDP line.
 * Types:
 * - host: direct local interface IP (same LAN or public IP)
 * - srflx: server-reflexive address discovered via STUN
 * - relay: relayed address allocated through TURN server
 * - prflx: peer-reflexive address discovered during connectivity checks
 */
export function getIceCandidateType(
  candidate: RTCIceCandidate | RTCIceCandidateInit | string,
): IceCandidateType {
  const candidateStr = typeof candidate === 'string' ? candidate : (candidate.candidate ?? '');
  const match = /\btyp\s+(host|srflx|relay|prflx)\b/i.exec(candidateStr);
  if (match && match[1]) {
    return match[1].toLowerCase() as IceCandidateType;
  }
  return 'unknown';
}

/**
 * Filters ICE candidates by candidate type (host, srflx from STUN, relay from TURN).
 */
export function filterIceCandidates<T extends RTCIceCandidate | RTCIceCandidateInit | string>(
  candidates: readonly T[],
  allowedTypes: readonly IceCandidateType[],
): T[] {
  return candidates.filter((c) => allowedTypes.includes(getIceCandidateType(c)));
}

/**
 * Creates an RTCPeerConnection configured for symmetric NAT traversal.
 * Accepts optional configuration; defaults to STUN service.
 */
export function createPeerConnection(
  config: RTCConfiguration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  },
): RTCPeerConnection | null {
  if (typeof RTCPeerConnection === 'undefined') return null;
  return new RTCPeerConnection(config);
}

/**
 * Creates a fallback RTCPeerConnection using TURN relay-only transport policy.
 * Used when direct STUN/host connectivity checks fail across symmetric NATs.
 */
export function createRelayFallbackConnection(
  turnServers: readonly RTCIceServer[],
): RTCPeerConnection | null {
  if (typeof RTCPeerConnection === 'undefined') return null;
  return new RTCPeerConnection({
    iceServers: [...turnServers],
    iceTransportPolicy: 'relay',
  });
}
