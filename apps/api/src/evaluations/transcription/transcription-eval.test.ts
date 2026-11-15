// Transcription evaluation tests (T3-010-C).
// All tests use a RecordedTranscriptionAdapter with synthetic recorded responses —
// no live API key or real audio is needed. These tests prove the evaluation harness
// logic and adapter contract, not the live Gemini model.
//
// Live-gate requirement (not covered here):
//   A human evaluator must record bilingual audio clips matching the descriptions in
//   fixtures/evaluations/transcription/dataset.json, run run-eval.ts against the real
//   GeminiTranscriptionAdapter, and document the results in
//   docs/evidence/t3-010-c-transcription-samples.md. See that file for the script.
import { describe, expect, it } from 'vitest';
import type { TranscriptionCase } from './schema.ts';
import {
  DEFAULT_TRANSCRIPTION_THRESHOLDS,
  formatEvalSummary,
  runTranscriptionEval,
} from './evaluator.ts';
import type {
  TranscriptionInput,
  TranscriptionOutcome,
  TranscriptionPort,
} from '../../modules/tutoring/application/ports/transcription-port.ts';

// ---------------------------------------------------------------------------
// Recorded adapter: returns pre-defined transcripts by case ID, encoded in the
// audio base64 field (the evaluator uses the case id as the lookup key so the
// base64 value itself is arbitrary in unit tests).
// ---------------------------------------------------------------------------

class RecordedTranscriptionAdapter implements TranscriptionPort {
  readonly #recordings: ReadonlyMap<string, TranscriptionOutcome>;

  constructor(recordings: ReadonlyMap<string, TranscriptionOutcome>) {
    this.#recordings = recordings;
  }

  isAvailable(): boolean {
    return true;
  }

  transcribe(input: TranscriptionInput): Promise<TranscriptionOutcome> {
    // The evaluator passes the case ID as the base64 audio value in unit tests.
    const outcome = this.#recordings.get(input.audioBase64);
    return Promise.resolve(outcome ?? { status: 'provider_error' });
  }
}

// ---------------------------------------------------------------------------
// Synthetic cases
// ---------------------------------------------------------------------------

const ENGLISH_CASE: TranscriptionCase = {
  id: 'tc-tx-001-en-greeting',
  category: 'supported_en',
  audioDescription:
    'Speak clearly in English: "Good morning. My name is Sarah and I am looking for a customer service job."',
  expectedTranscript: 'Good morning. My name is Sarah and I am looking for a customer service job.',
  expectedLang: 'en',
  expectedSubstrings: ['good morning', 'customer service'],
  rubric: 'Transcript must contain the greeting and job type.',
};

const AMHARIC_CASE: TranscriptionCase = {
  id: 'tc-tx-004-am-greeting',
  category: 'supported_am',
  audioDescription: 'Speak in Amharic: ሰላም። ስሜ ሰሎሞን ነው። ሥራ እፈልጋለሁ።',
  expectedTranscript: 'ሰላም። ስሜ ሰሎሞን ነው። ሥራ እፈልጋለሁ።',
  expectedLang: 'am',
  expectedSubstrings: ['ሰላም', 'ሥራ'],
  rubric: 'Transcript must contain Ethiopic greeting and word for work.',
};

const BILINGUAL_CASE: TranscriptionCase = {
  id: 'tc-tx-006-bilingual-mixed',
  category: 'supported_bilingual',
  audioDescription: 'Mix Amharic and English: ሰላም, I want to apply for the job.',
  expectedTranscript: 'ሰላም, I want to apply for the job.',
  expectedLang: 'am',
  expectedSubstrings: ['ሰላም', 'apply', 'job'],
  rubric: 'Both scripts must appear in the transcript.',
};

const AMHARIC_NEGATION_CASE: TranscriptionCase = {
  id: 'tc-tx-009-negation-am',
  category: 'negation_am',
  audioDescription: 'Speak in Amharic: አልፈልግም። ይህ ሥራ ለእኔ አይሆንም።',
  expectedTranscript: 'አልፈልግም። ይህ ሥራ ለእኔ አይሆንም።',
  expectedLang: 'am',
  expectedSubstrings: ['አልፈልግም', 'አይሆንም'],
  rubric: 'Negation suffixes must be preserved.',
};

const AMHARIC_NUMBERS_CASE: TranscriptionCase = {
  id: 'tc-tx-008-numbers-am',
  category: 'numbers_am',
  audioDescription: 'Speak in Amharic: ደሞዙ በወር አምስት ሺህ ብር ነው።',
  expectedTranscript: 'ደሞዙ በወር አምስት ሺህ ብር ነው።',
  expectedLang: 'am',
  expectedSubstrings: ['አምስት', 'ሺህ', 'ብር'],
  rubric: 'Number words must appear in Ethiopic script.',
};

// ---------------------------------------------------------------------------
// Recorded responses keyed by case ID
// ---------------------------------------------------------------------------

const RECORDINGS = new Map<string, TranscriptionOutcome>([
  [
    ENGLISH_CASE.id,
    {
      status: 'transcribed',
      transcript: 'Good morning. My name is Sarah and I am looking for a customer service job.',
      detectedLang: 'en',
    },
  ],
  [
    AMHARIC_CASE.id,
    {
      status: 'transcribed',
      transcript: 'ሰላም። ስሜ ሰሎሞን ነው። ሥራ እፈልጋለሁ።',
      detectedLang: 'am',
    },
  ],
  [
    BILINGUAL_CASE.id,
    {
      status: 'transcribed',
      transcript: 'ሰላም, I want to apply for the job.',
      detectedLang: 'am',
    },
  ],
  [
    AMHARIC_NEGATION_CASE.id,
    {
      status: 'transcribed',
      transcript: 'አልፈልግም። ይህ ሥራ ለእኔ አይሆንም።',
      detectedLang: 'am',
    },
  ],
  [
    AMHARIC_NUMBERS_CASE.id,
    {
      status: 'transcribed',
      transcript: 'ደሞዙ በወር አምስት ሺህ ብር ነው።',
      detectedLang: 'am',
    },
  ],
]);

// The evaluator uses base64 field as the lookup key in these tests.
function audioMapFromCases(cases: readonly TranscriptionCase[]): Map<string, string> {
  return new Map(cases.map((c) => [c.id, c.id]));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runTranscriptionEval', () => {
  it('passes English case with correct transcript', async () => {
    const adapter = new RecordedTranscriptionAdapter(RECORDINGS);
    const summary = await runTranscriptionEval(
      adapter,
      [ENGLISH_CASE],
      audioMapFromCases([ENGLISH_CASE]),
    );
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.results[0]?.detectedLang).toBe('en');
  });

  it('passes Amharic case with correct Ethiopic transcript', async () => {
    const adapter = new RecordedTranscriptionAdapter(RECORDINGS);
    const summary = await runTranscriptionEval(
      adapter,
      [AMHARIC_CASE],
      audioMapFromCases([AMHARIC_CASE]),
    );
    expect(summary.passed).toBe(1);
    expect(summary.results[0]?.detectedLang).toBe('am');
  });

  it('passes bilingual case preserving both scripts', async () => {
    const adapter = new RecordedTranscriptionAdapter(RECORDINGS);
    const summary = await runTranscriptionEval(
      adapter,
      [BILINGUAL_CASE],
      audioMapFromCases([BILINGUAL_CASE]),
    );
    expect(summary.passed).toBe(1);
    const transcript = summary.results[0]?.transcript ?? '';
    // Must contain both Ethiopic and Latin characters
    expect(/[ሀ-፿]/.test(transcript)).toBe(true);
    expect(/[a-zA-Z]/.test(transcript)).toBe(true);
  });

  it('passes Amharic negation case with negation markers intact', async () => {
    const adapter = new RecordedTranscriptionAdapter(RECORDINGS);
    const summary = await runTranscriptionEval(
      adapter,
      [AMHARIC_NEGATION_CASE],
      audioMapFromCases([AMHARIC_NEGATION_CASE]),
    );
    expect(summary.passed).toBe(1);
    expect(summary.results[0]?.transcript).toContain('አልፈልግም');
    expect(summary.results[0]?.transcript).toContain('አይሆንም');
  });

  it('passes Amharic numbers case with number words intact', async () => {
    const adapter = new RecordedTranscriptionAdapter(RECORDINGS);
    const summary = await runTranscriptionEval(
      adapter,
      [AMHARIC_NUMBERS_CASE],
      audioMapFromCases([AMHARIC_NUMBERS_CASE]),
    );
    expect(summary.passed).toBe(1);
    const transcript = summary.results[0]?.transcript ?? '';
    expect(transcript).toContain('አምስት');
    expect(transcript).toContain('ሺህ');
  });

  it('fails a case with missing expected substring', async () => {
    // Inject a recording that is missing the required 'customer service' substring
    const recordings = new Map(RECORDINGS);
    recordings.set(ENGLISH_CASE.id, {
      status: 'transcribed',
      transcript: 'Good morning. My name is Sarah.',
      detectedLang: 'en',
    });
    const adapter = new RecordedTranscriptionAdapter(recordings);
    const summary = await runTranscriptionEval(
      adapter,
      [ENGLISH_CASE],
      audioMapFromCases([ENGLISH_CASE]),
    );
    expect(summary.passed).toBe(0);
    expect(summary.results[0]?.failureReason).toContain('missing_substring');
  });

  it('fails a case when adapter returns provider_error', async () => {
    const recordings = new Map(RECORDINGS);
    recordings.set(ENGLISH_CASE.id, { status: 'provider_error' });
    const adapter = new RecordedTranscriptionAdapter(recordings);
    const summary = await runTranscriptionEval(
      adapter,
      [ENGLISH_CASE],
      audioMapFromCases([ENGLISH_CASE]),
    );
    expect(summary.passed).toBe(0);
    expect(summary.results[0]?.failureReason).toBe('adapter_status:provider_error');
  });

  it('marks a case as failed with no_audio_supplied when no audio entry exists', async () => {
    const adapter = new RecordedTranscriptionAdapter(RECORDINGS);
    const summary = await runTranscriptionEval(
      adapter,
      [ENGLISH_CASE],
      new Map(), // empty audio map — no audio supplied
    );
    expect(summary.passed).toBe(0);
    expect(summary.results[0]?.failureReason).toBe('no_audio_supplied');
  });

  it('computes accuracy rate across all supported cases', async () => {
    // Run all five cases; expect all to pass
    const adapter = new RecordedTranscriptionAdapter(RECORDINGS);
    const cases = [
      ENGLISH_CASE,
      AMHARIC_CASE,
      BILINGUAL_CASE,
      AMHARIC_NEGATION_CASE,
      AMHARIC_NUMBERS_CASE,
    ];
    const summary = await runTranscriptionEval(adapter, cases, audioMapFromCases(cases));
    expect(summary.totalCases).toBe(5);
    expect(summary.passed).toBe(5);
    expect(summary.accuracyRate).toBe(1.0);
    expect(summary.meetsThresholds).toBe(true);
  });

  it('reports meetsThresholds false when accuracy falls below minimum', async () => {
    // Three cases, two fail
    const recordings = new Map(RECORDINGS);
    recordings.set(AMHARIC_CASE.id, { status: 'provider_error' });
    recordings.set(BILINGUAL_CASE.id, { status: 'provider_error' });
    const adapter = new RecordedTranscriptionAdapter(recordings);
    const cases = [ENGLISH_CASE, AMHARIC_CASE, BILINGUAL_CASE];
    const summary = await runTranscriptionEval(adapter, cases, audioMapFromCases(cases), {
      supportedAccuracyMin: 0.8,
      latencyMaxMs: 10_000,
    });
    expect(summary.meetsThresholds).toBe(false);
    expect(summary.accuracyRate).toBeCloseTo(1 / 3);
  });

  it('fails a case that exceeds the latency threshold', async () => {
    // The recorded adapter returns instantly; set threshold to -1 to force a failure
    const adapter = new RecordedTranscriptionAdapter(RECORDINGS);
    const summary = await runTranscriptionEval(
      adapter,
      [ENGLISH_CASE],
      audioMapFromCases([ENGLISH_CASE]),
      { supportedAccuracyMin: 0.8, latencyMaxMs: -1 }, // -1ms: any real call exceeds this
    );
    expect(summary.passed).toBe(0);
    expect(summary.results[0]?.failureReason).toMatch(/latency_exceeded/);
  });
});

describe('formatEvalSummary', () => {
  it('includes accuracy rate and pass/fail counts', async () => {
    const adapter = new RecordedTranscriptionAdapter(RECORDINGS);
    const cases = [ENGLISH_CASE, AMHARIC_CASE];
    const summary = await runTranscriptionEval(adapter, cases, audioMapFromCases(cases));
    const text = formatEvalSummary(summary);
    expect(text).toContain('100.0%');
    expect(text).toContain('Passed: 2');
    expect(text).toContain('YES');
  });

  it('reports each case result with its ID', async () => {
    const adapter = new RecordedTranscriptionAdapter(RECORDINGS);
    const cases = [ENGLISH_CASE];
    const summary = await runTranscriptionEval(adapter, cases, audioMapFromCases(cases));
    const text = formatEvalSummary(summary);
    expect(text).toContain(ENGLISH_CASE.id);
    expect(text).toContain('PASS');
  });
});

describe('DEFAULT_TRANSCRIPTION_THRESHOLDS', () => {
  it('requires at least 80% accuracy', () => {
    expect(DEFAULT_TRANSCRIPTION_THRESHOLDS.supportedAccuracyMin).toBe(0.8);
  });

  it('allows up to 10 seconds per call', () => {
    expect(DEFAULT_TRANSCRIPTION_THRESHOLDS.latencyMaxMs).toBe(10_000);
  });
});
