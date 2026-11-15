// Device and browser capability checks for desktop screen sharing (T3-018-B).
// Detects unsupported mobile browsers to disclose the limitation while retaining text help.

export function isMobileBrowser(userAgent?: string): boolean {
  if (typeof navigator === 'undefined' && userAgent === undefined) return false;
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
}

export function canCaptureScreen(userAgent?: string): boolean {
  if (isMobileBrowser(userAgent)) return false;
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return false;
  return typeof navigator.mediaDevices.getDisplayMedia === 'function';
}
