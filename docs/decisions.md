# Decision register

Agreed through the design interview, synthesised 2026-11-14. [spec.md](spec.md) owns product rules; [architecture.md](architecture.md) owns the target technical design. This register records why choices are fixed and which choices remain delegated or externally blocked.

## Locked choices

| ID | Decision | Reason / consequence |
|---|---|---|
| D01 | One institution's installation, multiple isolated learners | Reusability without multi-tenant SaaS administration |
| D02 | Core first; Telegram bot/voice and Telegram/SMS alerts time-permitting | User-approved delivery priority, not a waiver of written requirements; web job Q&A/accommodations remain core; T3-027-D core readiness is distinct from T3-027-C full-brief coverage |
| D03 | Dependency-driven core work across phases; separate core/full-brief gates | Revised by the user: phases are milestones, not team-wide waiting barriers; record blockers and pick ready leaf work; stable parent epics aggregate child acceptance, not giant PRs |
| D04 | TypeScript, React/Vite, Fastify, PostgreSQL, pnpm, Compose | One language, portable install, small operational footprint |
| D05 | Feature-first Clean Architecture, OO backend, SOLID, explicit injection | Testable business behaviour without generic frameworks; functional React remains idiomatic |
| D06 | Separate assistant/backend, iframe loaded by script and standalone page | Keep implementation in Hackathon; supplied static starter is reference/demo host with minimal approved changes, not the application codebase |
| D07 | Course evidence only; approved job evidence; real citations | Unsupported answers must fail honestly, not fall back silently |
| D08 | Optional career web research is separate, consented, disabled by default | Preserve grounding and avoid sending private history to search |
| D09 | Explicit model/retrieval/speech research then evaluations; replaceable providers and FAQ | User confirms no models supplied; T3-003-B starts research. 'SOTA' means best verified fit, not newest; no paid resources or model names assumed |
| D10 | Server-controlled synthetic demo identities now; real host identity adapter later | Static captures supply no identity contract; enforce roles/course grants and protected bootstrap, never trust DOM IDs/tokens; T3-004-B alone owns live SSO proof |
| D11 | Durable async help/inbox, optional generic Telegram notices | Learners need not remain online; no always-available staffing claim |
| D12 | Meeting proposals/confirmations in chat only | No scheduling product or automatic reminders in the baseline |
| D13 | Learner-controlled supported-desktop screen sharing | No recording/remote control; mobile alternatives need organiser acceptance |
| D14 | Approved jobs, deterministic opt-in alerts, coordinator-routed accommodations | No inference of sensitive traits or unsolicited employer contact |
| D15 | When alerts are built, durable PostgreSQL delivery with safe retries/unknown outcomes | Time-permitting delivery work does not block core help/inbox; no queue framework is scaffolded ahead of need |
| D16 | External-processing consent, short retention, minimal logs | Seven-day content default; local deletion does not imply provider deletion |
| D17 | 20 active-session validation target | Measure on actual hardware, do not claim untested production scale |
| D18 | Author reviews/merges own PR using template and standards/spec AI reviewers | No teammate PR approval; check current implementations and overall decisions, preserve independent axes and actual repository protections |
| D19 | Smallest correct change; independent check against weakened tests | Explicitly replaces reference project's broad touched-code cleanup rule |
| D20 | GitHub issue bodies authoritative after the user-authorised 2026-11-14 migration | Local docs/issues.md is the stable ID/link index and execution guide; 110 issues were created unassigned. Future issue creation/assignment still needs actual action authorisation |
| D21 | Employer dashboard/outreach are lowest-priority future specs | No implied permission to build a new actor model or send messages |
| D22 | Final package, hosted MVP and explanatory deck after core completion | T3-027-D → T3-027-A/E/F; earlier HTTPS/relay test setup remains necessary for core proof. Final submission action and paid provisioning still need authorisation |

## Decisions implementation agents may make

Within the locked design, inspect the current project and choose compatible dependency versions, concrete library usage, private class/function names, database query/migration tooling, indexes, and request delivery mechanics. Research consequential unfamiliar choices against current primary sources. Prefer an existing working dependency over adding a new one.

Answer/speech providers, multilingual retrieval technique, and relay/SMS adapters require an early evaluation or contract check. The owning issue records alternatives, costs, data processing, limitations, and actual results before integration. These choices cannot silently add paid resources, disclose new data, eliminate mandatory behaviour, or change application interfaces used by another issue.

Reopen only a concrete unresolved choice or a demonstrated conflict with the approved spec. Bring the smallest decision, a reasonable recommendation, and its evidence. Do not repeat the whole architecture interview for each issue.

## Recorded implementation evaluations

### Retrieval method — T3-005-B, 2026-11-14

**Selected:** PostgreSQL full-text search over the current, non-withdrawn lesson versions in the learner's granted courses, plus a reviewed Amharic↔English glossary that expands the question. English sources use the `english` configuration (stemming); Amharic sources use `simple` with prefix matching, because PostgreSQL has no Amharic dictionary. Headings are weighted above bodies and any matching term counts. No embedding model, vector store or external processing.

**Alternatives:** `gemini-embedding-001` (the [T3-003-B shortlist](ai-feasibility.md)'s conditional option) was not needed and would send lesson text to an external provider; English-only search fails Amharic questions by construction.

**Evaluation** ([`fixtures/evaluations/retrieval-cases.json`](../fixtures/evaluations/retrieval-cases.json), run as a real-PostgreSQL test). Thresholds fixed before the first run: expected section in the top 3 for at least 9 of 11 supported questions with a hit in every direction (en→en, am→en, am→am, en→am), and no passages for out-of-corpus questions. **Result: 11/11, both out-of-corpus questions returned nothing.** Without the glossary: 7/11 — all four cross-language questions failed, and one Amharic question matched the wrong lesson through the shared word `ሥራ`.

**Limits:** two lessons (10 sections); the glossary and the evaluation questions were written together by the same author, so the result shows the method works on this corpus, not that it generalises. Before relying on it for new content: extend the glossary with the content, have a competent Amharic speaker review terms and questions, and add held-out questions written by someone else. Revisit embeddings only if such a measured evaluation fails.

## External gates and remaining precision checks

| Gate | Current state | Required evidence / treatment |
|---|---|---|
| Savanna | Static source inspected at `9e83ac7` and served locally; organisers want a plug-in script with minimal host changes (team-relayed, 2026-11-14); production contracts unverified ([T3-002 record](static-starter-boundary.md)) | Run pinned supplied pages with protected synthetic sessions; test deployed headers/media permissions. Obtain judging acceptance for the separate module/static demo (the script answer covers integration form only); live SSO needs a separate supplied contract |
| Organiser feature checklist | Public page references a fuller list | Obtain checklist; map discrepancies to issues; ask before expanding scope or claiming complete conformance |
| Hosting | No commitment confirmed | Establish HTTPS/public callbacks, database storage, secrets, and relay/network requirements; Compose remains portable |
| SMS | No provider/sender credentials or destination delivery verified | Obtain approved route; send to consenting Ethiopian test destination; test opt-out; distinguish provider acceptance from receipt |
| SMS ownership | No verified-phone claim or alternative verification flow confirmed | T3-003-E resolves and records approval before T3-021-A; a typed number is not proof of ownership |
| Voice/AI | [T3-003-B selections and feasibility tests](ai-feasibility.md) recorded 2026-11-14; API integration unverified | Obtain approved access/processing/budget, then feature-specific bilingual evidence and format/citation tests; shortlist recommendations do not pass downstream quality gates. **Capacity blocker:** the recorded free-tier caps (answers 500/day, transcription 25/day, speech 10/day, shared across users) cannot support the 20-session test (T3-024-A), rehearsals and the live demo; paid quota needs explicit budget authorisation, otherwise voice stays a limited path with typed input and FAQ fallback |
| Screen sharing | Android browser limitation known; actual infrastructure untested | Desktop cross-network proof and organiser response on mobile alternative; do not declare requirement waived |
| Co-design devices | Meetings describe shared consultation availability; no gate run recorded | Reserve early/retest slots; record participant continuity and real NVDA/TalkBack, keyboard/zoom/sound-off device/unaided outcomes |
| Retention policy precision | Seven-day default agreed; timestamp anchor not specified | Confirm creation-vs-activity anchor with institution before real data; prove purge, shared-copy, backup/provider handling; no silent extension |
| Open licence / assets | Written brief and verbal ownership wording need written reconciliation; starter has no repository-level licence | Lesson-text extraction, translation, offline caching and redistribution approved (team-relayed, 2026-11-14; [T3-002 record](static-starter-boundary.md#contracts-and-open-questions)). Still obtain written licence terms and image/asset approval; library notices do not license the full capture |
| Submission | Meetings request a functional MVP URL and explanatory slides; final form/template not verified | Finish core first, then final hosting/deck/package; obtain current template, links, schedule and private channel for team contact details |
| Team logistics | No organiser eligibility/attendance confirmation recorded here | Team handles attendance/training/selection questions; software docs do not establish eligibility |

Phase 0 may finish an investigation by recording a named external blocker and the evidence needed to resolve it. This is not completion of the blocked live feature. Follow the [blocked-work procedure](issues.md#when-work-is-blocked): choose ready baseline work across phases without waiting for a whole phase to finish. Explicit dependencies, live acceptance, and the full-brief-before-stretch gate remain binding; changing a real dependency or shared contract still needs agreement.

## Reference workflow provenance

Adapted from the user's local `sophia-verse/sail3-backend` workflow inspected read-only at commit `7cdd83060310b4fffe8c75c09feb826d06f563aa` on branch `SAIL3-318-session-persistence` (not a claim of remote freshness). Retained interview-to-spec, vertical PR slices, fresh review, before/after evidence, independent standards/spec checks, and fix-guard intent.

Approved differences: Jira becomes a local backlog then GitHub; `develop`/staging becomes issue branches into `main` once Git exists; .NET/backend-specific rules become selected-stack rules; broad cleanup becomes minimal change; consequential research becomes explicit; private planning becomes shared docs; fixed vendor model names are removed; developer docs are English while product content is multilingual. Portable reviewer Markdown is an instruction source, not proof of automatic agent registration by any tool.
