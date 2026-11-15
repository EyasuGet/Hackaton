// Browser capability detection for screen capture (T3-018-B, T3-018-C).
// Display capture requires a secure context, getDisplayMedia support, and desktop environment.
// Unsupported mobile browsers (e.g. Chrome Android, iOS Safari) gracefully disclose the limitation.

/**
 * Detects whether the user agent string represents a mobile browser.
 */
export function isMobileUserAgent(userAgent?: string): boolean {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

/**
 * Checks if screen sharing capture is supported in the current environment.
 * Requires:
 * 1. Window defined and secure context (HTTPS or localhost).
 * 2. Non-mobile user agent (display capture is desktop-only for Track 3 per D13).
 * 3. navigator.mediaDevices.getDisplayMedia function available.
 */
export function isScreenShareSupported(userAgent?: string): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.isSecureContext) return false;
  if (isMobileUserAgent(userAgent)) return false;
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return false;
  return typeof navigator.mediaDevices.getDisplayMedia === 'function';
}
