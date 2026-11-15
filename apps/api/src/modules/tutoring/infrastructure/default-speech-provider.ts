// Default deterministic speech synthesizer provider (T3-024-C).
// Produces valid WAV audio without live provider costs or cloud credentials.

import type {
  SpeechSynthesisRequest,
  SpeechSynthesizerProvider,
} from '../application/ports/speech-synthesizer-provider.ts';

export class DefaultSpeechSynthesizerProvider implements SpeechSynthesizerProvider {
  readonly name = 'synthetic-default';

  isAvailable(): boolean {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async synthesize(request: SpeechSynthesisRequest): Promise<Buffer> {
    if (request.signal?.aborted) {
      throw request.signal.reason instanceof Error
        ? request.signal.reason
        : new Error('Synthesis aborted');
    }

    // 44-byte valid WAV header for 8kHz 8-bit mono silence (500ms)
    const sampleRate = 8000;
    const numSamples = Math.floor(sampleRate * 0.5);
    const buffer = Buffer.alloc(44 + numSamples);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + numSamples, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate, 28);
    buffer.writeUInt16LE(1, 32);
    buffer.writeUInt16LE(8, 34); // 8-bit
    buffer.write('data', 36);
    buffer.writeUInt32LE(numSamples, 40);
    buffer.fill(128, 44); // 128 is center silence for 8-bit PCM

    return buffer;
  }
}
