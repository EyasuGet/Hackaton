// Sniffs audio container magic bytes to prevent MIME-type spoofing (D17 / V04).
// Validates raw audio bytes before passing to transcription, rejecting HTML/text
// payloads, scripts, or unsupported containers.

/**
 * Sniffs the magic bytes of raw audio payloads and returns a validated MIME type,
 * or null if unrecognized or unsupported.
 */
export function detectAudioMimeType(bytes: Uint8Array): string | null {
  if (!bytes || bytes.length < 4) {
    return null;
  }

  // 1. Ogg container (Opus / Vorbis): "OggS" (0x4F, 0x67, 0x67, 0x53)
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return 'audio/ogg';
  }

  // 2. RIFF container (WAV): "RIFF" .... "WAVE"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return 'audio/wav';
  }

  // 3. WebM / Matroska: EBML container ID 0x1A 0x45 0xDF 0xA3
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'audio/webm';
  }

  // 4. MP4 / M4A: bytes 4..7 contain "ftyp" (0x66, 0x74, 0x79, 0x70)
  if (
    bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return 'audio/mp4';
  }

  // 5. MP3: starts with "ID3" (0x49, 0x44, 0x33) or sync word (0xFF, 0xEx)
  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  if (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) {
    return 'audio/mpeg';
  }
  if (b0 === 0xff && b1 !== undefined && (b1 & 0xe0) === 0xe0) {
    return 'audio/mpeg';
  }

  return null;
}
