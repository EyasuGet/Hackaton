// Transcription Evaluator engine for T3-010-C.
// Runs bilingual (English + Amharic) test cases against a TranscriptionPort,
// checking transcript accuracy, language detection, and latency.
// Deterministic unit tests use RecordedTranscriptionAdapter.
// Live evaluation against the real Gemini API requires a GEMINI_API_KEY and actual
// audio recordings supplied by the evaluator — see docs/evidence/t3-010-c-transcription-samples.md.
import type {
  TranscriptionCase,
  TranscriptionEvalItem,
  TranscriptionEvalSummary,
  TranscriptionEvalThresholds,
} from './schema.ts';
import type { TranscriptionPort } from '../../modules/tutoring/application/ports/transcription-port.ts';

export const DEFAULT_TRANSCRIPTION_THRESHOLDS: TranscriptionEvalThresholds = {
  supportedAccuracyMin: 0.8,
  latencyMaxMs: 10_000,
};

/** Synthetic MIME type used in recorded-response unit tests. */
const EVAL_MIME_TYPE = 'audio/webm';

/** Runs all test cases against the provided adapter. */
export async function runTranscriptionEval(
  adapter: TranscriptionPort,
  cases: readonly TranscriptionCase[],
  audioBase64ById: ReadonlyMap<string, string>,
  thresholds: TranscriptionEvalThresholds = DEFAULT_TRANSCRIPTION_THRESHOLDS,
): Promise<TranscriptionEvalSummary> {
  const results: TranscriptionEvalItem[] = [];

  for (const tc of cases) {
    const audio = audioBase64ById.get(tc.id);
    if (audio === undefined) {
      results.push({
        case: tc,
        transcript: null,
        detectedLang: null,
        latencyMs: 0,
        passed: false,
        failureReason: 'no_audio_supplied',
      });
      continue;
    }

    const start = Date.now();
    const outcome = await adapter.transcribe({ audioBase64: audio, mimeType: EVAL_MIME_TYPE });
    const latencyMs = Date.now() - start;

    if (outcome.status !== 'transcribed') {
      results.push({
        case: tc,
        transcript: null,
        detectedLang: null,
        latencyMs,
        passed: false,
        failureReason: `adapter_status:${outcome.status}`,
      });
      continue;
    }

    const failureReason = evaluateTranscript(tc, outcome.transcript, outcome.detectedLang, latencyMs, thresholds);
    const item: TranscriptionEvalItem = failureReason !== undefined
      ? { case: tc, transcript: outcome.transcript, detectedLang: outcome.detectedLang, latencyMs, passed: false, failureReason }
      : { case: tc, transcript: outcome.transcript, detectedLang: outcome.detectedLang, latencyMs, passed: true };
    results.push(item);
  }

  const supportedCases = results.filter((r) => r.case.category !== 'adversarial');
  const supportedPassed = supportedCases.filter((r) => r.passed).length;
  const accuracyRate = supportedCases.length === 0 ? 1 : supportedPassed / supportedCases.length;

  return {
    totalCases: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    accuracyRate,
    results,
    meetsThresholds: accuracyRate >= thresholds.supportedAccuracyMin,
    thresholds,
  };
}

function evaluateTranscript(
  tc: TranscriptionCase,
  transcript: string,
  detectedLang: 'en' | 'am' | 'unknown',
  latencyMs: number,
  thresholds: TranscriptionEvalThresholds,
): string | undefined {
  if (latencyMs > thresholds.latencyMaxMs) {
    return `latency_exceeded:${latencyMs}ms`;
  }

  const lower = transcript.toLowerCase();
  for (const sub of tc.expectedSubstrings) {
    if (!lower.includes(sub.toLowerCase())) {
      return `missing_substring:${sub}`;
    }
  }

  if (tc.expectedLang !== 'unknown' && detectedLang !== 'unknown' && detectedLang !== tc.expectedLang) {
    return `lang_mismatch:expected=${tc.expectedLang},got=${detectedLang}`;
  }

  return undefined;
}

/** Formats an evaluation summary as plain text for console output or log records. */
export function formatEvalSummary(summary: TranscriptionEvalSummary): string {
  const lines: string[] = [
    `Transcription Evaluation Results`,
    `================================`,
    `Total: ${summary.totalCases}  Passed: ${summary.passed}  Failed: ${summary.failed}`,
    `Accuracy: ${(summary.accuracyRate * 100).toFixed(1)}%  (threshold: ${(summary.thresholds.supportedAccuracyMin * 100).toFixed(0)}%)`,
    `Meets thresholds: ${summary.meetsThresholds ? 'YES' : 'NO'}`,
    '',
  ];

  for (const r of summary.results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    const lang = r.detectedLang ?? '—';
    const latency = r.latencyMs > 0 ? `${r.latencyMs}ms` : '—';
    const reason = r.failureReason ? `  [${r.failureReason}]` : '';
    lines.push(`  ${status}  ${r.case.id}  lang=${lang}  latency=${latency}${reason}`);
  }

  return lines.join('\n');
}
