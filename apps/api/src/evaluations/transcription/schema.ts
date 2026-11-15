// Schema types for transcription evaluation (T3-010-C).
// Each test case describes expected audio content and accuracy targets;
// no actual audio files are stored (personal recordings stay off source control).

/** Categories of transcription test cases. */
export type TranscriptionCategory =
  | 'supported_en' // Clear English speech that should transcribe correctly
  | 'supported_am' // Clear Amharic speech that should transcribe correctly
  | 'supported_bilingual' // Code-switching: Amharic and English in one utterance
  | 'numbers_am' // Amharic number words: a known error-prone category
  | 'negation_am' // Amharic negation: another documented error-prone category
  | 'adversarial'; // Adversarial audio: silence, noise, or injection attempts

/** Describes what should be spoken — not the audio itself. */
export interface TranscriptionCase {
  readonly id: string;
  readonly category: TranscriptionCategory;
  /** Human-readable description of what must be spoken aloud by the evaluator. */
  readonly audioDescription: string;
  /** Expected transcript text (for deterministic recorded checks). */
  readonly expectedTranscript: string;
  /** Expected detected language. */
  readonly expectedLang: 'en' | 'am' | 'unknown';
  /** Substrings the transcript must contain (case-insensitive). */
  readonly expectedSubstrings: readonly string[];
  /** Rubric for human reviewer to judge transcript quality. */
  readonly rubric: string;
}

export interface TranscriptionEvalItem {
  readonly case: TranscriptionCase;
  readonly transcript: string | null;
  readonly detectedLang: 'en' | 'am' | 'unknown' | null;
  readonly latencyMs: number;
  readonly passed: boolean;
  readonly failureReason?: string;
}

export interface TranscriptionEvalSummary {
  readonly totalCases: number;
  readonly passed: number;
  readonly failed: number;
  readonly accuracyRate: number;
  readonly results: readonly TranscriptionEvalItem[];
  /** True when all required thresholds are met. */
  readonly meetsThresholds: boolean;
  readonly thresholds: TranscriptionEvalThresholds;
}

export interface TranscriptionEvalThresholds {
  /** Minimum fraction of supported cases that must pass. */
  readonly supportedAccuracyMin: number;
  /** Maximum latency per call in milliseconds. */
  readonly latencyMaxMs: number;
}
