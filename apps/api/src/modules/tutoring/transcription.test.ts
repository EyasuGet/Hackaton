// Unit tests for the transcription port utilities and GeminiTranscriptionAdapter (T3-010-A).
// The adapter is verified with a fake HTTP implementation so no live API key is needed.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  base64ByteLength,
  baseMimeType,
  detectTranscriptLang,
  isSupportedMimeType,
  MAX_AUDIO_BYTES,
} from './application/ports/transcription-port.ts';
import { GeminiTranscriptionAdapter } from './infrastructure/gemini-transcription-adapter.ts';

// Minimal valid base64 audio (4 bytes, well within limit)
const MINIMAL_B64 = btoa('test');
const WEBM_MIME = 'audio/webm';
const API_KEY = 'test-key';

function geminiSuccess(transcript: string) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        candidates: [{ content: { parts: [{ text: transcript }] } }],
      }),
  } as unknown as Response;
}

function geminiError(status: number) {
  return { ok: false, status, statusText: 'Error' } as unknown as Response;
}

describe('transcription-port utilities', () => {
  describe('baseMimeType', () => {
    it('strips codec parameters', () => {
      expect(baseMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
    });
    it('lowercases the type', () => {
      expect(baseMimeType('Audio/WebM')).toBe('audio/webm');
    });
    it('returns empty string for empty input', () => {
      expect(baseMimeType('')).toBe('');
    });
  });

  describe('isSupportedMimeType', () => {
    it('accepts audio/webm', () => expect(isSupportedMimeType('audio/webm')).toBe(true));
    it('accepts audio/webm;codecs=opus', () =>
      expect(isSupportedMimeType('audio/webm;codecs=opus')).toBe(true));
    it('accepts audio/ogg', () => expect(isSupportedMimeType('audio/ogg')).toBe(true));
    it('accepts audio/mp4', () => expect(isSupportedMimeType('audio/mp4')).toBe(true));
    it('accepts audio/mpeg', () => expect(isSupportedMimeType('audio/mpeg')).toBe(true));
    it('accepts audio/wav', () => expect(isSupportedMimeType('audio/wav')).toBe(true));
    it('rejects video/mp4', () => expect(isSupportedMimeType('video/mp4')).toBe(false));
    it('rejects application/json', () =>
      expect(isSupportedMimeType('application/json')).toBe(false));
  });

  describe('base64ByteLength', () => {
    it('returns correct byte count for no-padding base64', () => {
      // 4 base64 chars = 3 bytes
      expect(base64ByteLength('AAAA')).toBe(3);
    });
    it('accounts for one padding character', () => {
      // "AA==" = 1 byte
      expect(base64ByteLength('AA==')).toBe(1);
    });
    it('accounts for two padding characters', () => {
      // "AAA=" = 2 bytes
      expect(base64ByteLength('AAA=')).toBe(2);
    });
    it('returns 0 for empty string', () => {
      expect(base64ByteLength('')).toBe(0);
    });
    it('respects MAX_AUDIO_BYTES at the boundary', () => {
      const maxBase64Chars = Math.ceil((MAX_AUDIO_BYTES * 4) / 3);
      const overSizedB64 = 'A'.repeat(maxBase64Chars + 100);
      expect(base64ByteLength(overSizedB64)).toBeGreaterThan(MAX_AUDIO_BYTES);
    });
  });

  describe('detectTranscriptLang', () => {
    it('returns en for Latin-dominant text', () => {
      expect(detectTranscriptLang('Hello, how are you?')).toBe('en');
    });
    it('returns am for Ethiopic-dominant text', () => {
      expect(detectTranscriptLang('ሠላም እንዴት ነዎት')).toBe('am');
    });
    it('returns en for mixed text with more Latin', () => {
      expect(detectTranscriptLang('Hello ሠ world')).toBe('en');
    });
    it('returns unknown for digit-only text', () => {
      expect(detectTranscriptLang('123 456')).toBe('unknown');
    });
  });
});

describe('GeminiTranscriptionAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports unavailable when no API key is provided', () => {
    const adapter = new GeminiTranscriptionAdapter('');
    expect(adapter.isAvailable()).toBe(false);
  });

  it('reports available when an API key is provided', () => {
    const adapter = new GeminiTranscriptionAdapter(API_KEY);
    expect(adapter.isAvailable()).toBe(true);
  });

  it('returns provider_unavailable when no API key is set', async () => {
    const adapter = new GeminiTranscriptionAdapter('');
    const result = await adapter.transcribe({ audioBase64: MINIMAL_B64, mimeType: WEBM_MIME });
    expect(result.status).toBe('provider_unavailable');
  });

  it('returns unsupported_format for a disallowed MIME type', async () => {
    const adapter = new GeminiTranscriptionAdapter(API_KEY);
    const result = await adapter.transcribe({ audioBase64: MINIMAL_B64, mimeType: 'video/mp4' });
    expect(result.status).toBe('unsupported_format');
  });

  it('returns empty_audio when audio is an empty string', async () => {
    const adapter = new GeminiTranscriptionAdapter(API_KEY);
    const result = await adapter.transcribe({ audioBase64: '   ', mimeType: WEBM_MIME });
    expect(result.status).toBe('empty_audio');
  });

  it('returns too_large when audio exceeds MAX_AUDIO_BYTES', async () => {
    const adapter = new GeminiTranscriptionAdapter(API_KEY);
    // Craft a base64 string whose decoded size exceeds the limit
    const oversizedB64 = 'A'.repeat(Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 100);
    const result = await adapter.transcribe({ audioBase64: oversizedB64, mimeType: WEBM_MIME });
    expect(result.status).toBe('too_large');
  });

  it('returns transcribed with English text from a successful Gemini response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      geminiSuccess('Thank you for joining the meeting today.'),
    );

    const adapter = new GeminiTranscriptionAdapter(API_KEY);
    const result = await adapter.transcribe({ audioBase64: MINIMAL_B64, mimeType: WEBM_MIME });

    expect(result.status).toBe('transcribed');
    if (result.status === 'transcribed') {
      expect(result.transcript).toBe('Thank you for joining the meeting today.');
      expect(result.detectedLang).toBe('en');
    }
  });

  it('returns transcribed with Amharic detection for Ethiopic-script transcript', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      geminiSuccess('ሠላም እንዴት ነዎት። ዛሬ ምን ትፈልጋላችሁ?'),
    );

    const adapter = new GeminiTranscriptionAdapter(API_KEY);
    const result = await adapter.transcribe({ audioBase64: MINIMAL_B64, mimeType: WEBM_MIME });

    expect(result.status).toBe('transcribed');
    if (result.status === 'transcribed') {
      expect(result.detectedLang).toBe('am');
    }
  });

  it('returns provider_error when Gemini returns a non-OK HTTP status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(geminiError(429));

    const adapter = new GeminiTranscriptionAdapter(API_KEY);
    const result = await adapter.transcribe({ audioBase64: MINIMAL_B64, mimeType: WEBM_MIME });
    expect(result.status).toBe('provider_error');
  });

  it('returns provider_error when fetch throws (network failure or timeout)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

    const adapter = new GeminiTranscriptionAdapter(API_KEY);
    const result = await adapter.transcribe({ audioBase64: MINIMAL_B64, mimeType: WEBM_MIME });
    expect(result.status).toBe('provider_error');
  });

  it('returns provider_error when Gemini returns an empty transcript', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(geminiSuccess(''));

    const adapter = new GeminiTranscriptionAdapter(API_KEY);
    const result = await adapter.transcribe({ audioBase64: MINIMAL_B64, mimeType: WEBM_MIME });
    expect(result.status).toBe('provider_error');
  });

  it('sends the audio inline data and prompt in the request body', async () => {
    let capturedBody: unknown;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return Promise.resolve(geminiSuccess('Test transcript'));
    });

    const adapter = new GeminiTranscriptionAdapter(API_KEY);
    await adapter.transcribe({ audioBase64: MINIMAL_B64, mimeType: WEBM_MIME });

    const body = capturedBody as {
      contents: Array<{ parts: Array<{ inlineData?: unknown; text?: string }> }>;
    };
    const parts = body.contents[0]?.parts ?? [];
    expect(parts.some((p) => 'inlineData' in p)).toBe(true);
    expect(parts.some((p) => typeof p.text === 'string')).toBe(true);
  });
});
