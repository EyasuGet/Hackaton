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
| D23 | AfroMessage VAS aggregator for Ethiopian SMS delivery with GSM-7 / UCS-2 character budgeting | Direct SMPP requires prohibitive telco enterprise contracts and setup fees; international aggregators (Twilio) are unreliable into Ethio Telecom and costly ($0.05+/msg); AfroMessage provides a licensed local VAS route at ~0.35–0.40 ETB/segment, supporting English GSM-7 (160/153) and Amharic Ge'ez UCS-2 (70/67) with webhooks for delivery status |
| D24 | Phone-ownership verification contract requires salted SHA-256 OTP (6-digit, 10m TTL, 3 attempts max, 60s cooldown) before SMS subscriptions | Savanna static host does not provide verified phone claims; arbitrary typed numbers cannot be trusted; prevents harassment, broadcast spam, and unauthorized number registration |

## Decisions implementation agents may make

Within the locked design, inspect the current project and choose compatible dependency versions, concrete library usage, private class/function names, database query/migration tooling, indexes, and request delivery mechanics. Research consequential unfamiliar choices against current primary sources. Prefer an existing working dependency over adding a new one.

Answer/speech providers, multilingual retrieval technique, and relay/SMS adapters require an early evaluation or contract check. The owning issue records alternatives, costs, data processing, limitations, and actual results before integration. These choices cannot silently add paid resources, disclose new data, eliminate mandatory behaviour, or change application interfaces used by another issue.

Reopen only a concrete unresolved choice or a demonstrated conflict with the approved spec. Bring the smallest decision, a reasonable recommendation, and its evidence. Do not repeat the whole architecture interview for each issue.

## Recorded implementation evaluations

### Retrieval method — T3-005-B, 2026-11-14

**Selected:** PostgreSQL full-text search over the current, non-withdrawn lesson versions in the learner's granted courses, plus a **draft** Amharic↔English glossary (pending competent-speaker review) that expands the question. English sources use the `english` configuration (stemming); Amharic sources use `simple` with prefix matching, because PostgreSQL has no Amharic dictionary. Headings are weighted above bodies and any matching term counts. No embedding model, vector store or external processing.

**Alternatives:** `gemini-embedding-001` (the [T3-003-B shortlist](ai-feasibility.md)'s conditional option) was not needed and would send lesson text to an external provider; English-only search fails Amharic questions by construction.

**Evaluation** ([`fixtures/evaluations/retrieval-cases.json`](../fixtures/evaluations/retrieval-cases.json), run as a real-PostgreSQL test). Thresholds fixed before the first run: expected section in the top 3 for at least 9 of 11 supported questions with a hit in every direction (en→en, am→en, am→am, en→am), and no passages for out-of-corpus questions. **Result: 11/11, both out-of-corpus questions returned nothing.** Without the glossary: 7/11 — all four cross-language questions failed, and one Amharic question matched the wrong lesson through the shared word `ሥራ`.

**Limits:** two lessons (10 sections); the glossary and the evaluation questions were written together by the same author, so the result shows the method works on this corpus, not that it generalises. Before relying on it for new content: extend the glossary with the content, have a competent Amharic speaker review terms and questions, and add held-out questions written by someone else. Revisit embeddings only if such a measured evaluation fails.

### Ethiopian SMS route & character encoding — T3-003-A, 2026-11-15

**Selected:** AfroMessage (licensed Ethiopian VAS aggregator with direct Ethio Telecom interconnect, https://afromessage.com/developers). Wholesale/standard tariff of ~0.35–0.40 ETB per message segment paid locally in ETB (via Telebirr or local bank transfer), with REST API, alphanumeric sender ID registration, and delivery report (DLR) webhooks.

**Alternatives evaluated:**
- *Ethio Telecom Direct SMPP:* Requires high-barrier corporate telecom enterprise contract, INSA registration, minimum monthly spend commitments (often tens of thousands ETB), dedicated VPN/leased line infrastructure, and prolonged onboarding (weeks/months). Disqualified for hackathon MVP timeline and budget.
- *International aggregators (Twilio, Infobip):* Prohibitive per-segment cost ($0.05–$0.08 / msg ≈ 6.00–9.60 ETB at 120 ETB/USD, >17× more expensive than AfroMessage), frequent carrier-level firewall filtering/blocking of foreign A2P routes into Ethio Telecom, and hard foreign currency credit card requirements. Disqualified due to cost, foreign exchange restrictions, and delivery failure risk.

**Sender ID registration rules:**
Alphanumeric sender ID (up to 11 characters, e.g. `Track3`) registered with Ethio Telecom via AfroMessage and compliant with Ethiopian Communications Authority (ECA) / INSA regulations. Unregistered or pending dispatches use the aggregator's shared numeric shortcode (e.g. `8008` pool) as fallback.

**Character encoding & segmentation budgeting:**
- *English / Latin text:* 3GPP TS 23.038 GSM-7 standard alphabet. Single segment: 160 characters. Concatenated segments: 153 characters per segment (7 characters reserved for 6-byte UDH). GSM extension characters (`^`, `{`, `}`, `\`, `[`, `~`, `]`, `|`, `€`, `\f`) consume 2 septets.
- *Amharic (Ethiopic / Ge'ez script, U+1200..U+137F):* UCS-2 (UTF-16 Big Endian). Single segment: 70 characters. Concatenated segments: 67 characters per segment (3 characters / 6 bytes reserved for UDH). Any message containing Ge'ez characters automatically demotes the entire message to UCS-2.
- *Guardrails:* Max 4 segments (612 GSM-7 characters or 268 UCS-2 characters). Bodies exceeding this cap or empty strings are rejected with actionable domain errors prior to gateway transmission.

**Delivery report (DLR) webhook contract:**
AfroMessage issues asynchronous HTTP POST callbacks to `/api/delivery/sms/webhook` (or configured callback URL). Raw states map deterministically to domain delivery states:
- `"Send in progress..."`, `"SENT"`, `"QUEUED"`, `"PROCESSING"`, `"ACCEPTED"` → `'queued'`
- `"DELIVRD"`, `"Delivered"` → `'delivered'`
- `"UNDELIV"`, `"Undelivered"` → `'undelivered'`
- `"EXPIRED"` → `'expired'`
- `"REJECTD"`, `"Rejected"` → `'rejected'`
- `"FAILED"` → `'failed'`
- Transient HTTP errors (429 rate limit, 5xx gateway errors, network timeouts) → `'unknown'` for safe retry/reconciliation.

**Evaluation & verification:**
Documented in [t3-003-a-sms-route.md](evidence/t3-003-a-sms-route.md). Contract fixtures in `fixtures/sms/README.md`. Domain segmentation math, cost projection functions, and adapter error mappings verified by automated tests in `apps/api/src/modules/delivery/domain/sms-route-decision.test.ts`.

**Limits & downstream gates:**
Synthetic fixtures verify payload formatting, encoding calculation, and error normalization without unconsented live dispatches. Physical handset delivery to a consenting Ethiopian destination number (`+2519...`) with provisioned credentials belongs to downstream **T3-015-B** (#84).

### Phone-ownership verification route — T3-003-E, 2026-11-15

**Boundary & Context:** The Savanna static starter capture (`alx-africa/Savanna-static-pages` @ `9e83ac7`) is a static DOM capture that provides no trusted identity assertions, no phone verification claims, and no authenticated SMS contact attributes. Entering an arbitrary phone number in a web UI cannot be treated as evidence of ownership. Allowing unverified numbers would enable harassment, SMS spam exhaustion, unconsented broadcast delivery, and privacy violations across learners.

**Selected Contract:** A server-mediated, cryptographic One-Time Password (OTP) verification route:
1. **Cryptographic OTP:** 6-digit cryptographically secure numeric code generated via `crypto.randomInt(0, 1000000)`.
2. **Digest & Salt:** SHA-256 digest computed with a per-record 16-byte random salt (`crypto.randomBytes(16)`). Plaintext OTP is never stored in the database or logged. Constant-time comparison (`crypto.timingSafeEqual`) prevents timing side-channels.
3. **Time-To-Live (TTL):** 10 minutes (600,000 ms). Expired tokens cannot be verified and must be re-requested.
4. **Attempt Limits & Lockout:** Maximum 3 verification attempts per token. A 3rd failed attempt marks the token permanently `exhausted` (lockout); a 4th invalid attempt permanently rejects the code.
5. **Rate Limiting & Cooldown:** Minimum 60-second cooldown between code dispatch requests for the same destination phone number.
6. **Strict Learner Isolation:** Phone numbers are strictly scoped to the authenticated learner (`Principal.id`); support principals and other learners cannot view, query, or verify numbers belonging to another learner. Numbers receive only explicit opt-in alerts (T3-021-A/B), never unconsented broadcasts.
7. **Safe Display:** Masked presentation (`+2519****1234` or `+2517****1234`) in logs and UI responses.

**Approval:** This contract authorizes implementation of SMS job subscriptions (T3-021-A) and delivery (T3-021-B) without reopening verification architecture. See [`docs/evidence/t3-003-e-phone-verification.md`](evidence/t3-003-e-phone-verification.md).

## External gates and remaining precision checks

| Gate | Current state | Required evidence / treatment |
|---|---|---|
| Savanna | Static source inspected at `9e83ac7` and served locally; organisers want a plug-in script with minimal host changes (team-relayed, 2026-11-14); production contracts unverified ([T3-002 record](static-starter-boundary.md)) | Run pinned supplied pages with protected synthetic sessions; test deployed headers/media permissions. Obtain judging acceptance for the separate module/static demo (the script answer covers integration form only); live SSO needs a separate supplied contract |
| Organiser feature checklist | Public page references a fuller list | Obtain checklist; map discrepancies to issues; ask before expanding scope or claiming complete conformance |
| Hosting | No commitment confirmed | Establish HTTPS/public callbacks, database storage, secrets, and relay/network requirements; Compose remains portable |
| SMS | AfroMessage route confirmed (T3-003-A); live credentials and physical handset probe pending (T3-015-B) | Route selected and character budgeting specified; AfroMessage adapter implemented with synthetic fixtures (T3-015-A); live delivery requires team provisioned AfroMessage token and consenting Ethiopian test destination (+251) in T3-015-B |
| SMS ownership | Resolved by Decision D24 and `docs/evidence/t3-003-e-phone-verification.md` | Cryptographic salted SHA-256 OTP contract (6-digit, 10m TTL, 3 attempts max, 60s cooldown) approved before T3-021-A |
| Voice/AI | [T3-003-B selections and feasibility tests](ai-feasibility.md) recorded 2026-11-14; API integration unverified | Obtain approved access/processing/budget, then feature-specific bilingual evidence and format/citation tests; shortlist recommendations do not pass downstream quality gates. **Capacity blocker:** the recorded free-tier caps (answers 500/day, transcription 25/day, speech 10/day, shared across users) cannot support the 20-session test (T3-024-A), rehearsals and the live demo; paid quota needs explicit budget authorisation, otherwise voice stays a limited path with typed input and FAQ fallback |
| Screen sharing | Android browser limitation known; actual infrastructure untested | Desktop cross-network proof and organiser response on mobile alternative; do not declare requirement waived |
| Co-design devices | Meetings describe shared consultation availability; no gate run recorded | Reserve early/retest slots; record participant continuity and real NVDA/TalkBack, keyboard/zoom/sound-off device/unaided outcomes |
| Retention policy precision | Seven-day default agreed; [provisional contract](retention.md) anchors expiry at each item's creation (strictest); institution confirmation not yet obtained | Confirm the anchor and the [open decisions](retention.md#open-decisions-approval-still-needed) with the institution before real data; prove purge, shared-copy, backup/provider handling; no silent extension |
| Open licence / assets | Written brief and verbal ownership wording need written reconciliation; starter has no repository-level licence | Lesson-text extraction, translation, offline caching and redistribution approved (team-relayed, 2026-11-14; [T3-002 record](static-starter-boundary.md#contracts-and-open-questions)). Still obtain written licence terms and image/asset approval; library notices do not license the full capture |
| Submission | Meetings request a functional MVP URL and explanatory slides; final form/template not verified | Finish core first, then final hosting/deck/package; obtain current template, links, schedule and private channel for team contact details |
| Team logistics | No organiser eligibility/attendance confirmation recorded here | Team handles attendance/training/selection questions; software docs do not establish eligibility |

Phase 0 may finish an investigation by recording a named external blocker and the evidence needed to resolve it. This is not completion of the blocked live feature. Follow the [blocked-work procedure](issues.md#when-work-is-blocked): choose ready baseline work across phases without waiting for a whole phase to finish. Explicit dependencies, live acceptance, and the full-brief-before-stretch gate remain binding; changing a real dependency or shared contract still needs agreement.

## Reference workflow provenance

Adapted from the user's local `sophia-verse/sail3-backend` workflow inspected read-only at commit `7cdd83060310b4fffe8c75c09feb826d06f563aa` on branch `SAIL3-318-session-persistence` (not a claim of remote freshness). Retained interview-to-spec, vertical PR slices, fresh review, before/after evidence, independent standards/spec checks, and fix-guard intent.

Approved differences: Jira becomes a local backlog then GitHub; `develop`/staging becomes issue branches into `main` once Git exists; .NET/backend-specific rules become selected-stack rules; broad cleanup becomes minimal change; consequential research becomes explicit; private planning becomes shared docs; fixed vendor model names are removed; developer docs are English while product content is multilingual. Portable reviewer Markdown is an instruction source, not proof of automatic agent registration by any tool.
