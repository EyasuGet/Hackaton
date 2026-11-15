// Gemini-based speech transcription adapter (T3-010-A).
// Uses the Gemini generateContent API with inline audio data.
// Raw audio is held only in memory for the duration of the API call; it is never
// written to disk or logged.
import {
  base64ByteLength,
  detectTranscriptLang,
  isSupportedMimeType,
  MAX_AUDIO_BYTES,
  type TranscriptionInput,
  type TranscriptionOutcome,
  type TranscriptionPort,
} from '../application/ports/transcription-port.ts';

const TRANSCRIPTION_MODEL = 'gemini-2.5-flash';
const TIMEOUT_MS = 30_000;

const TRANSCRIPTION_PROMPT =
  'Transcribe the audio exactly as spoken. Return only the transcription text with no commentary, labels, or formatting. Preserve the original language (Amharic or English).';

export class GeminiTranscriptionAdapter implements TranscriptionPort {
  readonly #apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.#apiKey = apiKey ?? process.env.GEMINI_API_KEY;
  }

  isAvailable(): boolean {
    return this.#apiKey !== undefined && this.#apiKey.length > 0;
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionOutcome> {
    if (!this.isAvailable()) {
      return { status: 'provider_unavailable' };
    }

    if (!isSupportedMimeType(input.mimeType)) {
      return { status: 'unsupported_format' };
    }

    if (!input.audioBase64 || input.audioBase64.trim().length === 0) {
      return { status: 'empty_audio' };
    }

    if (base64ByteLength(input.audioBase64) > MAX_AUDIO_BYTES) {
      return { status: 'too_large' };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${TRANSCRIPTION_MODEL}:generateContent`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.#apiKey!,
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inlineData: { mimeType: input.mimeType, data: input.audioBase64 } },
                { text: TRANSCRIPTION_PROMPT },
              ],
            },
          ],
          generationConfig: { temperature: 0.0, maxOutputTokens: 2048 },
        }),
      });

      if (!response.ok) {
        return { status: 'provider_error' };
      }

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };

      const transcript = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
      if (!transcript) {
        return { status: 'provider_error' };
      }

      return {
        status: 'transcribed',
        transcript,
        detectedLang: detectTranscriptLang(transcript),
      };
    } catch {
      return { status: 'provider_error' };
    } finally {
      clearTimeout(timer);
    }
  }
}
