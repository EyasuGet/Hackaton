// Network profile definition and text transfer measurement (T3-008-B).
// Asserts that FAQ and assistant interactions remain strictly lightweight text transfers
// without unrequested audio/video payloads or heavy background downloads.

export interface NetworkProfile {
  readonly name: string;
  readonly downloadKbps: number;
  readonly uploadKbps: number;
  readonly latencyMs: number;
}

/** Standard throttled 3G profile used for network resilience verification. */
export const PROFILE_3G: NetworkProfile = {
  name: 'Regular 3G',
  downloadKbps: 750,
  uploadKbps: 250,
  latencyMs: 100,
};

/** Budget for a lightweight text question/answer exchange (5 KB). */
export const MAX_LIGHTWEIGHT_TEXT_BYTES = 5 * 1024;

export interface TextTransferMetrics {
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly totalBytes: number;
  readonly hasMedia: boolean;
}

export function measureTextTransfer(
  requestBody: string,
  responseBody: string,
  mediaDetected = false,
): TextTransferMetrics {
  const encoder = new TextEncoder();
  const requestBytes = encoder.encode(requestBody).length;
  const responseBytes = encoder.encode(responseBody).length;
  return {
    requestBytes,
    responseBytes,
    totalBytes: requestBytes + responseBytes,
    hasMedia: mediaDetected,
  };
}

export function isLightweightText(metrics: TextTransferMetrics): boolean {
  return metrics.totalBytes <= MAX_LIGHTWEIGHT_TEXT_BYTES && !metrics.hasMedia;
}
