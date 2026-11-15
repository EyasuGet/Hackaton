// Media stream and WebRTC connection utilities for screen sharing (T3-018-B).
// Enforces video of chosen screen only (audio: false). No conferencing/recording features.

/**
 * Requests display media from the browser native picker.
 * Only explicit learner action may invoke this.
 * Captures video only; audio is strictly disabled.
 */
export async function captureScreen(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('getDisplayMedia is not supported in this environment');
  }
  return navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });
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
