#!/usr/bin/env tsx
// Live transcription evaluation runner for T3-010-C.
// Prerequisites:
//   1. Set GEMINI_API_KEY in the environment.
//   2. Record audio clips matching each audioDescription in
//      fixtures/evaluations/transcription/dataset.json.
//   3. Place each clip at fixtures/evaluations/transcription/audio/<id>.webm
//      (or .ogg/.mp4 — any format listed in SUPPORTED_MIME_TYPES).
//      Audio files must NOT be committed to source control.
//   4. Run:  pnpm tsx apps/api/src/evaluations/transcription/run-eval.ts
//
// Output is printed to stdout and can be redirected to the evidence file:
//   pnpm tsx apps/api/src/evaluations/transcription/run-eval.ts \
//     >> docs/evidence/t3-010-c-transcription-samples.md
import { readdir, readFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TranscriptionCase } from './schema.ts';
import { DEFAULT_TRANSCRIPTION_THRESHOLDS, formatEvalSummary, runTranscriptionEval } from './evaluator.ts';
import { GeminiTranscriptionAdapter } from '../../modules/tutoring/infrastructure/gemini-transcription-adapter.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));
const DATASET_PATH = join(REPO_ROOT, 'fixtures/evaluations/transcription/dataset.json');
const AUDIO_DIR = join(REPO_ROOT, 'fixtures/evaluations/transcription/audio');

const MIME_BY_EXT: Record<string, string> = {
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.mp4': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('ERROR: GEMINI_API_KEY is not set. Set it in the environment before running.');
    process.exit(1);
  }

  const datasetJson = await readFile(DATASET_PATH, 'utf-8');
  const cases: TranscriptionCase[] = JSON.parse(datasetJson);

  // Discover audio files in the audio directory (not committed to git).
  let audioFiles: string[] = [];
  try {
    audioFiles = await readdir(AUDIO_DIR);
  } catch {
    console.warn(`WARN: audio directory not found at ${AUDIO_DIR}`);
    console.warn('Place audio recordings at fixtures/evaluations/transcription/audio/<case-id>.<ext>');
    console.warn('Audio files must not be committed to source control.');
    process.exit(1);
  }

  const audioByCase = new Map<string, string>();
  for (const file of audioFiles) {
    const id = basename(file, extname(file));
    const ext = extname(file).toLowerCase();
    const mimeType = MIME_BY_EXT[ext];
    if (!mimeType) continue;

    const fullPath = join(AUDIO_DIR, file);
    const buffer = await readFile(fullPath);
    // Encode to base64 in memory; never persist the encoded form.
    audioByCase.set(id, buffer.toString('base64'));
  }

  const missingAudio = cases.filter((c) => !audioByCase.has(c.id)).map((c) => c.id);
  if (missingAudio.length > 0) {
    console.warn(`WARN: No audio supplied for ${missingAudio.length} case(s): ${missingAudio.join(', ')}`);
  }

  const adapter = new GeminiTranscriptionAdapter(apiKey);
  const summary = await runTranscriptionEval(adapter, cases, audioByCase, DEFAULT_TRANSCRIPTION_THRESHOLDS);

  console.log('');
  console.log('## Transcription Evaluation Evidence — T3-010-C');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Reviewer: (name of human reviewer who recorded and verified the audio)`);
  console.log('');
  console.log(formatEvalSummary(summary));
  console.log('');
  console.log('### Per-case transcripts');
  for (const r of summary.results) {
    console.log(`\n#### ${r.case.id} (${r.case.category}) — ${r.passed ? 'PASS' : 'FAIL'}`);
    console.log(`Audio: "${r.case.audioDescription}"`);
    console.log(`Expected lang: ${r.case.expectedLang}  Detected: ${r.detectedLang ?? '—'}`);
    console.log(`Transcript: ${r.transcript ?? '(none)'}`);
    if (r.failureReason) console.log(`Failure: ${r.failureReason}`);
    console.log(`Rubric: ${r.case.rubric}`);
  }

  process.exit(summary.meetsThresholds ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
