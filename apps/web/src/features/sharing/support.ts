// Browser capability detection for screen capture (T3-018-B).
// Display capture requires a secure context and getDisplayMedia support.
// Unsupported mobile browsers (e.g. Chrome Android) gracefully disclose the limitation.

export function isScreenShareSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.isSecureContext) return false;
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return false;
  return typeof navigator.mediaDevices.getDisplayMedia === 'function';
}
