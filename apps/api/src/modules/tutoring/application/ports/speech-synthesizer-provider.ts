// Port interface for speech synthesis providers (T3-011 & T3-024-C).
// Synthesizes speech audio from text with cancellation and bounded input support.

export interface SpeechSynthesisRequest {
  readonly text: string;
  readonly language: string;
  readonly signal?: AbortSignal | undefined;
}

export interface SpeechSynthesizerProvider {
  readonly name: string;
  isAvailable(): boolean;
  synthesize(request: SpeechSynthesisRequest): Promise<Buffer>;
}
