# T3-010-C: Bilingual Transcription Evidence

**Issue:** #29 — Prove the transcription adapter on actual bilingual samples

## Live-gate requirement

This leaf requires human-recorded bilingual audio and a live Gemini API call.
The automated unit tests in `transcription-eval.test.ts` use a `RecordedTranscriptionAdapter`
and prove the evaluation harness logic only. This document must be populated with actual
evidence before T3-010-C can be marked complete.

## How to collect evidence

1. Set `GEMINI_API_KEY` in your environment.
2. Record audio clips matching each `audioDescription` in
   `fixtures/evaluations/transcription/dataset.json`.
   - Use a real microphone, not text-to-speech synthesis.
   - Record a native or fluent Amharic speaker for the Amharic cases.
   - File naming: `<case-id>.webm` (or `.ogg`, `.mp4`, `.mp3`, `.wav`).
   - Place files in `fixtures/evaluations/transcription/audio/`.
   - **Do not commit audio files** — they are listed in `.gitignore` and must stay off source control.
3. Run the evaluator:
   ```
   pnpm tsx apps/api/src/evaluations/transcription/run-eval.ts
   ```
4. Copy the output below, fill in the reviewer name and date, and open a PR that updates
   this file. The PR is the evidence commit.

## Required thresholds

| Metric | Threshold |
|--------|-----------|
| Supported-case accuracy | ≥ 80% |
| Latency per call | ≤ 10 000 ms |

## Results

> **Status: PENDING** — Live evaluation not yet run.
>
> Replace this block with the output of `run-eval.ts` once real bilingual audio
> has been recorded and the Gemini API has been called.
>
> Include:
> - Date and reviewer name
> - Exact output from `run-eval.ts`
> - Observations on numbers/negation accuracy (categories `numbers_am` and `negation_am`)
> - Observations on pronunciation and code-switching quality
> - Confirmation that no audio files were committed to this repository

## Rubric for human reviewer

For each test case, the human reviewer must verify:

- **English cases**: transcript matches the spoken text; no hallucinated words.
- **Amharic cases**: Ethiopic script is preserved; no Latin substitutions for Amharic words.
- **Bilingual cases**: both scripts appear; language boundary is respected.
- **Numbers (Amharic)**: number words (`አምስት`, `ሺህ`, `ብር`) are not replaced by Latin digits.
- **Negation (Amharic)**: negation suffixes (`አልፈልግም`, `አይሆንም`) are not silently dropped.

## Decisions

- Model: `gemini-2.5-flash` (multimodal, free tier; `gemini-3.5-transcribe` was noted in
  feasibility research but is not yet publicly available via the generateContent API as of
  the implementation date — upgrade when available).
- Audio never persisted: the adapter holds audio in memory only for the duration of the API
  call; it is never written to disk or logged.
- Sampling decision date: 2026-11-15.
