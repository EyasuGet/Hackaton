// Port interface for speech-to-text transcription (T3-010-A).
// The adapter lives in infrastructure; application code depends only on this interface.
// Audio is never persisted: the caller supplies in-memory base64 data, and the
// adapter discards it after the call completes or fails.

export const SUPPORTED_MIME_TYPES = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
] as const;

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

/** Maximum audio payload accepted by the transcription route: 10 MB of raw audio bytes. */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export interface TranscriptionInput {
  /** Raw audio encoded as base64. */
  readonly audioBase64: string;
  /** MIME type of the audio stream. */
  readonly mimeType: string;
}

export type TranscriptionOutcome =
  | {
      readonly status: 'transcribed';
      readonly transcript: string;
      /** Best-effort detected language from the transcript content. */
      readonly detectedLang: 'en' | 'am' | 'unknown';
    }
  | { readonly status: 'unsupported_format' }
  | { readonly status: 'too_large' }
  | { readonly status: 'empty_audio' }
  | { readonly status: 'provider_unavailable' }
  | { readonly status: 'provider_error' };

export interface TranscriptionPort {
  transcribe(input: TranscriptionInput): Promise<TranscriptionOutcome>;
  isAvailable(): boolean;
}

/** Normalises a MIME type string for comparison (strips parameters). */
export function baseMimeType(mimeType: string): string {
  return mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
}

/** True when the MIME type is accepted for transcription. */
export function isSupportedMimeType(mimeType: string): boolean {
  const base = baseMimeType(mimeType);
  return SUPPORTED_MIME_TYPES.some((t) => baseMimeType(t) === base);
}

/** Approximate byte length from a base64 string (3 bytes per 4 chars, ignoring padding). */
export function base64ByteLength(b64: string): number {
  const paddingChars = (b64.match(/=/g) ?? []).length;
  return Math.floor((b64.length * 3) / 4) - paddingChars;
}

/** Best-effort language detection: Ethiopic Unicode block → Amharic; Latin dominant → English. */
export function detectTranscriptLang(text: string): 'en' | 'am' | 'unknown' {
  const ethiopicMatches = (text.match(/[ሀ-፿]/g) ?? []).length;
  const latinMatches = (text.match(/[a-zA-Z]/g) ?? []).length;
  if (ethiopicMatches > latinMatches) return 'am';
  if (latinMatches > 0) return 'en';
  return 'unknown';
}
