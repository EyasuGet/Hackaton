# AI feasibility — T3-003-B

2026-11-14 · Owner: abnsol · [Issue #6](https://github.com/EyasuGet/Hackaton/issues/6), [parent #72](https://github.com/EyasuGet/Hackaton/issues/72). Amharic and English; no third language selected.

## Selected for integration

| Capability | Model | Free requests/min | Free requests/day | Input tokens/min |
|---|---|---:|---:|---:|
| Answers | `gemini-3.5-flash-lite` | 15 | 500 | 250,000 |
| Transcription | `gemini-3.5-transcribe` | 3 | 25 | 10,000 |
| Spoken output | `gemini-3.8-flash-tts`, Fola voice | 3 | 10 | 10,000 |

Limits observed in the existing project's **Free tier** [quota dashboard](https://aistudio.google.com/rate-limit) on the date above, shared across users. One call per stage permits at most 10 complete voice exchanges/day before retries/token limits. Google AI Pro playground benefits do not automatically upgrade API quotas. [Quota rules](https://aistudio.google.com/docs/rate-limits), [subscription distinction](https://aistudio.google.com/docs/google-ai-plans).

**Tested in Google AI Studio:** text matched expected outcomes in a 12-case synthetic bilingual batch (supported answers, cross-language evidence, citations, refusals, numbers, expired jobs and injected instructions). Speech output generated a 17-second bilingual clip; abnsol said “The audio is great.” Transcription was reported working by abnsol; no reference transcript or accuracy score was independently captured. No personal recording/transcript is committed.

These are feasibility results, **not application API or full language/device acceptance**. No paid calls, billing activation, model installation or production adapter was performed. The originally researched Flash-Lite TTS was absent from the inspected playground selector; the tested choice is Flash TTS above.

## Access, rights and alternatives

Google models are proprietary hosted services, not open-source weights. Free-tier processing may improve Google products; use approved synthetic data only until institutional processing consent is settled. Uploads may persist in Drive even in temporary chats. API access, actual retention settings and reliable capacity remain unverified. Keep credentials server-side, temporary audio out of logs, and retain readable text/typed input/approved FAQ fallbacks. [Pricing and free tiers](https://aistudio.google.com/docs/pricing), [terms](https://aistudio.google.com/docs/terms).

| Capability | Alternative and constraint |
|---|---|
| Answers | [`CohereLabs/aya-101`](https://huggingface.co/CohereLabs/aya-101): Apache-2.0 checkpoints, Amharic/English, 13B parameters. About 26 GB for 16-bit weights alone exceeds this Mac's 24 GiB RAM; quantisation/runtime suitability untested. |
| Retrieval | Start with PostgreSQL lexical search plus reviewed bilingual aliases; no model/API fee beyond hosting. Conditional alternative [`gemini-embedding-001`](https://aistudio.google.com/docs/embeddings) only if measured lexical misses justify external processing/vector storage. [PostgreSQL 18 dictionaries](https://www.postgresql.org/docs/18/textsearch-dictionaries.html), [licence](https://www.postgresql.org/about/licence/). Neither retrieval path tested. |
| Transcription | [`openai/whisper-large-v3-turbo`](https://github.com/openai/whisper): MIT code/weights, Amharic/English; Python/PyTorch/FFmpeg, upstream approximately 6 GB VRAM. No API charge locally; hardware, installation and speed untested. |
| Spoken output | [`facebook/mms-tts-amh`](https://huggingface.co/facebook/mms-tts-amh) / [`facebook/mms-tts-eng`](https://huggingface.co/facebook/mms-tts-eng): CC-BY-NC-4.0 weights, not unrestricted open source. Amharic requires uroman; Python/PyTorch, both checkpoints and runtime storage needed. Licence fit and performance untested. |

Selected models accept text→text, audio→text and text→audio respectively; browser codec handling and output delivery must be tested in the adapter. [Answer model](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite), [transcription formats](https://aistudio.google.com/docs/transcribe), [speech formats](https://aistudio.google.com/docs/speech-generation). Free does not mean unlimited or zero infrastructure cost. Pin resolved model/runtime revisions during integration; no local deployment is approved by this report.

## Remaining gates

Owner abnsol coordinates API access/consent and human-reviewed samples with the owning leaves: retrieval [#11](https://github.com/EyasuGet/Hackaton/issues/11), grounding [#18](https://github.com/EyasuGet/Hackaton/issues/18), transcription [#29](https://github.com/EyasuGet/Hackaton/issues/29), speech output [#33](https://github.com/EyasuGet/Hackaton/issues/33). Before testing, fix sample counts, latency/budget thresholds and language rubric; check source support/refusal, transcription errors (especially numbers/negation), pronunciation, real devices, cancellation and failures. Directly supplied passages do not prove retrieval or authorisation. No local alternative was downloaded or compared.

Next check-in proposed: 2026-11-15 09:00 Africa/Addis_Ababa, not a scheduled reminder. Research can close with documented blockers after review/merge requirements; dependent live gates remain unverified.
