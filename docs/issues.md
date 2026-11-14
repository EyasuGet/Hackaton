# Track 3 implementation backlog

Status: local draft of the agreed design, prepared 2026-11-14. No application implementation, assignments, completed checks, GitHub issues, or PRs are implied by this document.

## How to use this backlog

- Product scope is defined in [the spec](spec.md); technical decisions in [the architecture](architecture.md). This file is the authoritative local issue body until an explicitly requested GitHub migration.
- Keep each `T3-NNN` ID when migrating. Create issues in dependency order, then resolve dependency links and retain an ID-to-GitHub mapping. Do not silently change all issues to In Progress or assign them to one person.
- Each implementation leaf is intended to be one independently verifiable PR; epics are not implementation assignments or giant PRs. If current code reveals that a slice cannot fit one PR, propose a split preserving its acceptance criteria and dependencies before implementing it.
- All leaves below start **Planned / unassigned**, except explicitly marked **Needs future spec**. A team member claims one ready issue before starting; one issue has one implementation owner who also owns its review and merge. Others may pair, but another teammate's PR approval is not a prerequisite.
- Baseline leaf tasks are ready when their explicit dependencies are complete and their own prerequisites are available. Pick the earliest ready baseline issue across phases; phase numbers group delivery milestones, not team-wide start barriers. Optional Phase 5 still requires T3-027 and any future-spec approval.
- Phase 0 feasibility checks may complete with an evidenced external blocker, an escalation path, and a dependent issue marked blocked. This records risk; it does not pass that dependent feature's live acceptance. A milestone remains incomplete while its required capabilities are unverified, without freezing unrelated baseline issues.
- “Done” requires the stated acceptance evidence, independent standards/spec review of the relevant change/evidence, resolved blocking findings, and required human/device checks. Code or documentation changes also require author-led template sign-off, applicable CI, authorised merge and integrated verification. An evidence-only leaf with no repository change closes when its owner records the actual result, reviewed revision, environment, evidence location and required human verifier in the authoritative issue or relevant PR, with its acceptance met and evidence reviewed as part of that feature/assessment. No empty standalone PR/merge is required. A mock never proves live SMS, screen sharing or Savanna compatibility. An epic closes only after all children and its integrated acceptance pass; the final child owner coordinates and records that epic proof.
- Automated checks below describe **planned verification targets**, not existing command names or tests already run. T3-001 establishes documented commands; each later issue adds the relevant executable checks and records the actual invocation/result.
- `Baseline` is required scope. `Stretch` is not a blocker for submission. Employer features are lowest priority and require a separate future spec before becoming ready.

## When work is blocked

1. Record `Blocked`, the specific dependency or external capability, the owner/contact, the next action, and a concrete next check-in time in the issue. Notify its owner immediately; do not wait silently or repeatedly poll an unchanged blocker.
2. Pick another unclaimed ready **baseline** issue, even in a later phase. Keep the blocked branch/PR clearly labelled and avoid accumulating multiple active implementations. Example: blocked live SMS T3-015-B does not prevent ready help T3-016-A or job import T3-019-A; their own dependencies still apply.
3. If no independent issue is ready, pair with the prerequisite owner, investigate a named external blocker, or improve required evidence/docs/tests for an existing issue. Do not manufacture low-value tests or start optional scope simply to stay busy.
4. If only a shared interface is blocking useful work, agree its request/result/error contract with the prerequisite owner and record it. Prefer a small, genuinely needed contract slice merged first. Split/update issue IDs and dependencies before treating the consumer as ready. A labelled fixture can support isolated development, but cannot complete real integration acceptance. Never invent a competing interface or merge code that depends on an unavailable implementation.
5. Resume by syncing the now-completed prerequisite, inspecting its actual contract, and rerunning the affected integration checks. If an unavoidable critical-path blocker remains, surface the concrete decision to the team rather than waiving it.

An independently safe partial slice may be proposed as a separately scoped issue; the original live feature remains blocked. Phase/release milestones report missing work honestly, but do not freeze unrelated baseline work.

## Delivery milestones and issue map

| Phase | Issues | Exit gate |
|---|---|---|
| 0 — Foundation and risk checks | T3-001–004 | Reproducible runtime/checks, enforceable identity isolation, recorded external dependency findings and escalations |
| 1 — Accessible grounded assistant | T3-005–009 | Authorised learner completes an accessible cited text-tutoring journey; insufficient evidence and offline FAQ paths are honest |
| 2 — Voice and messaging | T3-010–015 | Editable speech input, readable/spoken output, linked Telegram, durable delivery and verified outbound SMS transport |
| 3 — Human help and careers | T3-016–023 | Persistent support workflow, controlled screen sharing, job answers/alerts/accommodation requests, and retention enforcement |
| 4 — Submission readiness | T3-024–027 | Measured load/security/accessibility evidence, clean installation and Savanna integration, complete submission package |
| 5 — Optional improvements | T3-028–032 | Each optional feature passes its own checks without regressing the baseline; no stretch feature delays submission |

The original 32 IDs are preserved: large items are epics with stable child IDs (for example `T3-001-A`), while bounded items remain single tasks. Read parent scope/acceptance for context, but claim a **leaf**, not an epic. `Completion depends on` aggregates an epic's children; it is not an extra prerequisite imposed on each child. A dependency on an epic means all its children and parent acceptance are complete; prefer a specific child dependency whenever sufficient.

### Task size and visible progress

- One leaf owns one demonstrable outcome and focused verification, not a whole platform or a database/backend/frontend layer in isolation. Foundation interfaces and operational evidence are explicit exceptions with their own proving story.
- Aim for a focused work block (often roughly 30–120 minutes), not a guaranteed duration. If discovery makes a leaf bigger, split it before claiming multiple unrelated outcomes. External access and human scheduling are separate blockers, not hidden estimates.
- Mark each verified leaf complete and demo the small outcome. Epic progress is completed children / total children, never a substitute for its final integrated acceptance. Keep one active implementation per contributor and record any parked blocker.
- Validation leaves do not absorb unlimited fixes. Open a small repair/retest leaf for each distinct blocker; the original acceptance gate remains blocked until the repair is proved. Keep useful tests rather than creating duplicates for each child.
- Evidence-only leaves follow the completion rule above; they do not require an empty standalone PR or duplicate test suite. Evidence work still takes real time.
- Every user-facing leaf owns its Amharic/English controls, errors and consent text using T3-006-C conventions; fixtures may unblock development, but untranslated final paths cannot pass. Every data-owning leaf owns its lifecycle under T3-023-A; only synthetic data is permitted until that policy and applicable consent are resolved.
- More tickets do not create more time. Prioritise the core learner story and external risk checks; all mandatory scope still needs evidence before submission. Stretch work remains gated.

### First parallel picks (not assignments)

| Workstream | Ready starting leaves | What follows when prerequisites land |
|---|---|---|
| Runtime / shared foundations | T3-001-A | T3-001-B/C, demo identity T3-004-A, durable intent T3-014-A |
| Host / learner experience | T3-002, T3-009-A | Learner shell T3-006-A immediately after T3-001-A; host handoff T3-004-B, embed T3-006-B and early real Savanna T3-026-B |
| Provider feasibility | T3-003-A/B/C/D | Early static answer evaluation T3-007-B; SMS adapter T3-015-A after runtime/contract agreement; provider-specific leaves depend only on their own probe, not unrelated credentials |
| Privacy / content preparation | T3-023-A; pair on T3-009-A | Approved fixtures, content T3-005-A/B and jobs T3-019-A after storage/identity |

These are pools of available work, not permanent person silos. Recompute readiness from leaf dependencies after every merge. Shared schema/interface changes are agreed with affected owners first. No hidden whole-phase barrier applies. T3-027-C explicitly checks every baseline epic/leaf before optional work opens.

### Capacity and integration checkpoints

This is a scope map, not a promise that a four-person team starting from documentation can finish it in one weekend. See [the independent assessment](assessment.md). At kickoff, each contributor claims a ready leaf, estimates its remaining work and reserves review/integration time. Name a human owner and a same-day check-in for each external gate in [decisions.md](decisions.md#external-gates-and-remaining-precision-checks); unassigned here does not mean someone else will handle it.

- **First working block:** boot T3-001-A while others inspect Savanna/SMS/voice/hosting and run T3-009-A. Then parallelise the fixture shell, storage/identity, static provider evaluation and approved content preparation. These are rotating lanes, not permanent silos or four independent app builds from minute one.
- **First integrated checkpoint:** get the FAQ learner path and actual Savanna launch working; run co-design before polishing. Probe real SMS/voice/HTTPS early, not after building a full feature around an unverified provider. A bounded probe is not final acceptance.
- **Each checkpoint:** compare remaining baseline work plus review time to available person-hours. Agree shared contracts before consumers diverge; merge small slices continuously. If the schedule is not credible, ask for an explicit scope/requirement decision and report the gap. Do not quietly reclassify a mandatory item as stretch.
- **Final block:** reserve integration, actual device/provider tests, repairs, installation and demo rehearsal before the official submission cutoff. More ticket splitting cannot substitute for this buffer. No new optional feature enters that block while baseline evidence is missing.
- **Optional order:** prefer co-designer-validated T3-029 simple mode over T3-028 web research if baseline completion leaves capacity. This is a recommendation, not a new mandatory dependency; employer work remains last and unapproved.

## Phase 0 — Foundation and risk checks

### T3-001 — Boot the reproducible workspace and establish checks

**Phase:** 0 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-001-A, T3-001-B, T3-001-C · **Type:** Epic

**Build:** A minimal running TypeScript workspace: Fastify health/readiness endpoint, React/Vite entry point, PostgreSQL with an initial migration path, pnpm workspace, and Docker Compose. Establish actual build, type-check, unit/integration-test and browser-test commands. Use the agreed module layout only where a running slice needs it.

**Done when:**
- A clean checkout starts using documented commands and placeholder-only environment configuration; database readiness is checked rather than assumed from startup order.
- Configuration rejects missing required values clearly; secrets are not bundled into browser assets or committed.
- Commands fail on a deliberately broken focused check. PR CI configuration is prepared for the future repository without claiming it ran on GitHub.
- README records exact commands and supported versions chosen from current compatible stable documentation.
- Establish the [coding-standard tooling](coding-standards.md#enforcement-and-review): TypeScript strict checks, compatible ESLint/typescript-eslint rules and shared Prettier format checking, using documented package commands in CI. Do not introduce speculative plugins or rewrite unrelated files.

**Epic verification:** Run the documented build/type-check/test commands; verify readiness changes appropriately when the database is unavailable.\
**Epic demonstration:** Follow the README on a clean environment and load the web page and health endpoint without undocumented setup.

#### T3-001-A — Run the smallest web-to-API slice

**Parent:** T3-001 · **Phase:** 0 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** None · **Type:** Implementation

**Deliver:** Create the pnpm workspace with a Fastify health route and a React/Vite page that displays its response. Include minimal CI for this slice so its own PR can pass before merge; no feature scaffolding or database yet.

**Done when:**
- One documented command path starts both surfaces; the page distinguishes API success from unavailable API.
- Pin compatible versions, enable TypeScript strict checking and reject invalid required configuration without exposing secrets. The initial CI runs build/type-check and the focused health checks for this slice.

**Automated verification:** Build/type-check the slice and test healthy/unavailable API states.\
**Human verify:** Start from the README and see the page report API health.

#### T3-001-B — Start PostgreSQL with repeatable migrations and readiness

**Parent:** T3-001 · **Phase:** 0 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-001-A · **Type:** Implementation

**Deliver:** Add Compose, PostgreSQL connectivity and the migration/readiness path to the running slice.

**Done when:**
- A fresh database and a repeat start both work without manual schema edits.
- Readiness fails when the database is unavailable; configuration examples contain no credentials.

**Automated verification:** Run migration twice and stop/restart the database; assert readiness transitions.\
**Human verify:** Bring up Compose on a clean local environment and observe recovery.

#### T3-001-C — Complete lint, formatting and database/browser checks

**Parent:** T3-001 · **Phase:** 0 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-001-A, T3-001-B · **Type:** Implementation

**Deliver:** Extend T3-001-A CI with the agreed lint, formatting, unit and browser test entry points, keeping existing strict/build checks and documented commands. Add real-database test setup once T3-001-B is available; that final check is part of this task before completion.

**Done when:**
- Use the coding standards without speculative plugins; one focused failing check makes the appropriate command fail.
- Record actual local/CI results, including database-test execution; no empty test suite is called behaviour coverage.

**Automated verification:** Run the configured checks and a temporary deliberate failure, then restore it.\
**Human verify:** Another contributor can discover and run the commands without asking for hidden setup.

### T3-002 — Record the actual Savanna integration contract

**Phase:** 0 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** None · **Type:** Operational evidence, no app feature

**Deliver:** Inspect the supplied starter and document the authoritative authentication, learner/course scope, embedding/CSP, microphone/screen-capture permissions, source-content access, and launch/run contracts. Identify available browser/device testing resources and the organiser's required submission format/licence.

**Done when:**
- Findings distinguish observed starter behaviour, organiser-confirmed requirements, and unresolved questions; no invented Savanna API is recorded as fact.
- The iframe/short-lived identity handoff design is checked against the starter; incompatibilities are escalated before integration code is committed.
- Unavailable starter/resources are recorded as external blockers with a next action and dependent acceptance gate, not reported as successful integration.
- The required accessibility checklist and any mobile screen-sharing exception are requested; absence remains visible.

**Automated verification:** None unless the supplied starter has runnable documented checks; record any actual invocation/result.\
**Human verify:** Another team member can distinguish confirmed contracts from unresolved integration blockers using the evidence record alone.

### T3-003 — Prove or explicitly block live integration dependencies

**Phase:** 0 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-003-A, T3-003-B, T3-003-C, T3-003-D, T3-003-E · **Type:** Epic

**Deliver:** Time-boxed feasibility checks for approved Ethiopian SMS access, Amharic/English speech candidates, Telegram access, HTTPS hosting, and desktop screen-sharing connectivity/relay infrastructure. Do not provision paid services without approval.

**Done when:**
- Record the usable SMS sender/provider, credentials-access owner without secret values, route restrictions, and real delivery evidence if available; otherwise mark T3-015/T3-021 externally blocked.
- Speech candidates are checked for language, formats, consent, cost/retention and practical access; provider quality is not inferred from a marketing language list.
- Desktop capture and relay needs are distinguished from unsupported Android web capture. Record organiser acceptance status for the mobile fallback separately.
- Hosting is confirmed or remains unconfirmed; a local Compose run is not called a public HTTPS deployment.
- Any incomplete check has a concrete escalation/next action and downstream gate. This evidence issue may finish while a live capability remains blocked.

**Epic verification:** Only available sandbox/capability probes; label sandbox results.\
**Epic demonstration:** Review evidence and identify which later live acceptance checks are currently possible, blocked, or untested.

#### T3-003-A — Confirm an approved Ethiopian SMS route

**Parent:** T3-003 · **Phase:** 0 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** None · **Type:** Feasibility evidence

**Deliver:** Check sender access, destination/cost/Unicode restrictions and a consenting test recipient. Agree the minimal delivery result/idempotency/status contract with the outbox owner so adapter work can start without a worker. Do not provision or send without authorisation.

**Done when:**
- Record observed route constraints and receipt evidence if a probe is authorised.
- Otherwise name the external blocker, owner/contact and next check; this does not complete live SMS delivery.

**Automated verification:** No new code required; record any authorised provider probe verbatim with secrets redacted.\
**Human verify:** The team can tell whether the live SMS leaf is runnable or blocked.

#### T3-003-B — Check bilingual answer and speech candidates

**Parent:** T3-003 · **Phase:** 0 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** None · **Type:** Feasibility evidence

**Deliver:** Check practical access, language/format support, data retention and costs for candidate answer, transcription and speech-output providers.

**Done when:**
- Record current primary sources and a small realistic Amharic/English sample if access is authorised.
- Do not infer quality from a language list; flag missing access, evaluation or processing consent separately.

**Automated verification:** Run only available consented probes; no production adapter is required.\
**Human verify:** Identify a viable candidate and fallback, or the exact blocker for each capability.

#### T3-003-C — Check HTTPS and cross-network sharing prerequisites

**Parent:** T3-003 · **Phase:** 0 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** None · **Type:** Feasibility evidence

**Deliver:** Identify a possible public HTTPS deployment and desktop screen-sharing/relay route; document unsupported mobile capture.

**Done when:**
- Distinguish a local demonstration from public callback/relay reachability.
- Request organiser clarification on the mobile limitation and record the response or unresolved question.

**Automated verification:** Record available networking/capability probes; a same-LAN result is not cross-network proof.\
**Human verify:** The team knows which host/relay setup or organiser answer is missing.

#### T3-003-D — Check Telegram access and callback strategy

**Parent:** T3-003 · **Phase:** 0 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** None · **Type:** Feasibility evidence

**Deliver:** Confirm a team-controlled bot and a development webhook or polling strategy without exposing its token.

**Done when:**
- Record credential ownership and the selected incoming-update authentication mechanism.
- Document test-account consent and any unavailable public endpoint; do not equate bot creation with linked learner access.

**Automated verification:** Only authorised bot probes; no application feature yet.\
**Human verify:** Identify the exact prerequisites for implementing the Telegram adapter.

#### T3-003-E — Resolve the phone-ownership verification route

**Parent:** T3-003 · **Phase:** 0 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-002, T3-003-A · **Type:** Decision evidence

**Deliver:** Record the actual phone-verification contract and its approval before T3-021-A is ready. Recommendation: reuse a trustworthy host-verified phone claim if Savanna actually supplies one; otherwise propose a short-lived, rate-limited SMS code through the approved route, with cost/consent approval.

**Done when:**
- Distinguish an authenticated verified claim from a typed number; never mark arbitrary entered numbers verified.
- If the host cannot supply a verified destination, obtain explicit approval for the alternative, its expiry/attempt limits and recovery. An unresolved decision blocks T3-021-A, not unrelated work.

**Automated verification:** No application implementation; document accepted/rejected ownership examples and the chosen contract or named blocker.\
**Human verify:** The implementer can identify the approved ownership proof without inventing an authentication flow.

### T3-004 — Enforce learner identity and per-user/course access

**Phase:** 0 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-004-A, T3-004-B · **Type:** Epic

**Build:** Institution-scoped authentication/authorisation with a small host identity adapter and separate learner/support permissions. Provide clearly separated demo accounts for local checks, not a new registration/password-reset product.

**Done when:**
- The server derives learner and permitted course scope from validated credentials, never an arbitrary browser-supplied learner/course ID.
- Invalid, expired or wrong-audience handoff credentials fail safely; long-lived secrets do not appear in browser configuration, URLs or logs.
- Learner A cannot access learner B's records; support permissions cannot be obtained through learner input.
- Demo authentication is explicitly identified and disabled outside its configured demo mode. Unverified Savanna integration remains disabled, pending T3-026.
- Interfaces and failure responses are documented for feature developers; avoid relying on third-party cookies alone for embed identity.

**Epic verification:** Authentication tests using two learners and one support account, including forged scope and expired credential cases.\
**Epic demonstration:** Sign in as each demo role and attempt the documented forbidden cross-user action; observe denial without leaked content.

#### T3-004-A — Resolve demo principals and enforce resource scope

**Parent:** T3-004 · **Phase:** 0 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-001-A, T3-001-B · **Type:** Implementation

**Deliver:** Introduce the identity application interface with explicitly isolated demo identities and learner/support permissions.

**Done when:**
- Protected fixture operations reject forged roles and cross-user/course scope; list and object access follow the same policy.
- Demo mode is visibly labelled and cannot silently enable real deployment authentication.

**Automated verification:** Use two learners and one staff principal to exercise allowed and denied operations.\
**Human verify:** Switch demo identities and demonstrate a forbidden operation without revealing the other record.

#### T3-004-B — Implement the validated host handoff

**Parent:** T3-004 · **Phase:** 0 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-004-A, T3-002 · **Type:** Implementation

**Deliver:** Implement the host identity adapter from the confirmed contract, including short-lived handoff verification. If the contract is unavailable, this leaf remains blocked; demo work can continue.

**Done when:**
- Reject expired, replayed, wrong-origin/audience and forged-scope credentials; keep long-lived secrets server-side.
- Document exact bootstrap/error contracts for embed consumers; never trust DOM learner IDs or rely only on third-party cookies.

**Automated verification:** Contract tests cover valid exchange and hostile/replayed inputs.\
**Human verify:** Use the approved host fixture to authenticate and reject an invalid handoff; real Savanna proof remains T3-026-B.


## Phase 1 — Accessible grounded learning assistant

### T3-005 — Import approved lessons with resolvable citation targets

**Phase:** 1 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-005-A, T3-005-B · **Type:** Epic

**Build:** A small repeatable import path for approved lesson content, its course permissions, stable source/section IDs, language, and displayable citation targets. Begin with non-sensitive Amharic/English fixtures; no crawler or content-management dashboard.

**Done when:**
- Reimporting the same source does not duplicate records; updated/removed content cannot silently remain the authoritative answer source.
- Retrieved content is scoped to the learner's permitted course and has a valid supporting section link.
- Missing/malformed sources fail visibly without corrupting existing approved content.
- Citation destinations enforce the same content access rules; import provenance distinguishes demo from organiser-provided material.

**Epic verification:** Import/reimport, invalid-source, cross-course retrieval and citation-resolution tests using approved fixtures.\
**Epic demonstration:** Import a sample lesson, open its cited section, and verify another learner without course permission cannot retrieve it.

#### T3-005-A — Import and update approved lesson sections

**Parent:** T3-005 · **Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-001-B, T3-004-A · **Type:** Implementation

**Deliver:** Implement repeatable import of versioned lesson sections, language and access scope from non-sensitive fixtures.

**Done when:**
- Reimport/update does not duplicate content or leave withdrawn sections authoritative.
- Malformed imports fail visibly without corrupting the existing approved version.

**Automated verification:** Real-database import/reimport/update/rejection checks.\
**Human verify:** Import then revise a lesson and inspect the exact stored version.

#### T3-005-B — Resolve permitted passages and citations

**Parent:** T3-005 · **Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-005-A · **Type:** Implementation

**Deliver:** Expose the small permission-filtered content retrieval/citation interface needed by tutoring; include accessible source-section display.

**Done when:**
- Authorised learners can open the referenced section; other learners cannot retrieve or resolve it.
- Amharic/English source IDs and provenance survive retrieval; missing/withdrawn IDs return an honest unavailable result.

**Automated verification:** Two-course retrieval and citation-resolution tests with updated/withdrawn sources.\
**Human verify:** Follow a citation as an authorised learner, then repeat with a forbidden course identity.

### T3-006 — Ship the accessible standalone assistant and script-loaded iframe

**Phase:** 1 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-006-A, T3-006-B, T3-006-C, T3-006-D · **Type:** Epic

**Build:** An independently testable learner-interface foundation plus a small script loader that inserts the assistant iframe into a plain host page. Share the learner UI with a standalone route; isolate host styling without duplicating business logic. Use explicitly labelled deterministic message/error fixtures for this issue; the real grounded conversation is delivered and verified by T3-007.

**Done when:**
- Keyboard users can open, navigate and close the assistant with visible focus and predictable return focus; controls have accessible names.
- New messages are announced without stealing focus or repeatedly reading partial/duplicate content; RTL/LTR messages and Ethiopic text remain legible.
- Cross-frame messages validate sender, exact origin and schema; credentials are not blindly accepted from loader attributes.
- Permission denial, expired identity, slow requests and network failure have readable recovery states; user text is rendered safely.
- Embedding requirements, teardown/reinitialisation behaviour and standalone fallback are documented.

**Epic verification:** Browser tests on standalone and two distinct-origin host fixtures, including forged messages, focus handling and axe scans.\
**Epic demonstration:** Load the standalone page and embedded host with the authorised test handoff, open/close by keyboard, inspect labelled synthetic message/error states, and verify focus restoration and announcements. This proves the interface/embedding foundation, not a live tutor.

#### T3-006-A — Build the accessible standalone conversation shell

**Parent:** T3-006 · **Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-001-A · **Type:** Implementation

**Deliver:** Implement the learner interface against explicitly labelled deterministic message/error fixtures, not a fake live tutor. Agree the small message/auth-error fixture contract with the identity/tutoring owners; this leaf neither implements nor bypasses production authentication.

**Done when:**
- Keyboard labels/focus, Amharic/Ethiopic text, RTL/LTR and new-message announcements work without stealing focus.
- Loading, denied identity and failed request states remain readable; unsafe text is not executed.

**Automated verification:** Focused browser/axe checks on synthetic success/error/mixed-direction states.\
**Human verify:** Navigate and read the fixture interaction by keyboard at 200% zoom with sound off.

#### T3-006-B — Embed the learner interface with safe lifecycle handling

**Parent:** T3-006 · **Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-006-A, T3-004-B · **Type:** Implementation

**Deliver:** Add the small script loader and isolated iframe with approved host handoff, open/close and teardown.

**Done when:**
- Validate message origin/source/schema; loading twice or closing restores predictable focus and does not leak listeners.
- Document host permissions/CSP and test two distinct-origin host fixtures without requiring their UI framework.

**Automated verification:** Browser tests for valid/forged postMessage, focus return and teardown.\
**Human verify:** Open and close the embedded fixture from a separate host; do not claim Savanna acceptance yet.

#### T3-006-C — Translate the learner shell and establish language selection

**Parent:** T3-006 · **Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-006-A · **Type:** Implementation

**Deliver:** Add Amharic/English language selection and translated shell actions, status, validation and consent labels using the smallest shared dictionary approach. No general localisation platform.

**Done when:**
- Language tags, Ethiopic-capable rendering and accessible language switching work without losing unsent in-memory input.
- Record translated-key conventions; each later feature supplies its own strings and has competent-speaker review before completion.

**Automated verification:** Exercise language switching, fallback/missing-key visibility and accessible names without duplicating every label test.\
**Human verify:** A competent speaker completes the fixture task in each language and identifies untranslated or misleading controls.

#### T3-006-D — Present verified Ethiopian and Addis Ababa dates

**Parent:** T3-006 · **Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-006-A · **Type:** Implementation

**Deliver:** Provide the date presentation used by messages and job validity: a verified Ethiopian-calendar rendering, with clearly labelled Gregorian equivalent and Addis Ababa time where relevant. Keep storage timestamps unchanged; no calendar scheduling service.

**Done when:**
- Check known conversion fixtures, day boundaries and calendar labels using a documented supported library/runtime capability rather than inventing arithmetic.
- Expose the same narrow formatter to consuming features; meeting proposals remain explicit text, not parsed bookings.

**Automated verification:** Focused known-date and timezone-boundary fixtures; verify readable language/calendar labels.\
**Human verify:** Compare a message timestamp and fixture job deadline with known dates in the intended languages.

### T3-007 — Answer course questions with evidence or honest refusal

**Phase:** 1 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-007-A, T3-007-B, T3-007-C, T3-007-D · **Type:** Epic

**Build:** The AskQuestion use case with authorised retrieval, course-grounded answers/citations, and a replaceable answer-provider interface demonstrated by an online provider and curated FAQ provider. Select the online provider through a bounded current evaluation, not a universal SOTA claim.

**Done when:**
- Representative Amharic/English supported questions return source-backed answers and resolvable citations; missing evidence produces a clear limitation, not invented content.
- External-processing consent is obtained before sending any query/context to a provider; refusal/unavailability selects the labelled FAQ capability, not disguised model output.
- Course scope is enforced before provider invocation. Retrieved prompt-injection text cannot authorise actions or override course grounding.
- Timeout/provider failure returns an actionable state; rejected/failed messages do not appear as successfully answered.
- Record evaluation inputs, expected behaviour and actual results for grounding, refusal, language quality, latency and cost. A provider swap preserves the use-case interface.

**Epic verification:** Deterministic behaviour tests with controlled provider responses plus a separately labelled live evaluation using approved fixtures.\
**Epic demonstration:** Ask one supported and one unsupported question in each language, follow citations, then decline cloud processing and observe the honest fallback.

#### T3-007-D — Persist owned tutoring requests and history

**Parent:** T3-007 · **Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-004-A, T3-001-B · **Type:** Implementation

**Deliver:** Implement the minimal conversation/history API and atomic request-id claim used by the tutor. This is a foundation slice with inspectable persisted states, not a working answer service.

**Done when:**
- Only the owner can create/read the conversation; repeated request IDs do not create duplicate messages or cross-user results.
- Pending, completed and recoverable-failure records have explicit states and policy timestamps; no database transaction remains open across a provider call.

**Automated verification:** Real-database ownership, duplicate-request and restart/state tests; later answer tests reuse this coverage.\
**Human verify:** Create an owned synthetic request, retry it, reload its history and reject another learner; show that no answer has been generated.

#### T3-007-A — Ship a cited FAQ answer through the learner interface

**Parent:** T3-007 · **Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-005-B, T3-006-A, T3-007-D · **Type:** Implementation

**Deliver:** Connect a deterministic approved FAQ answer provider through the tutoring use case and UI, reusing T3-007-D persistence. This is a real narrow text-answer slice, not a cloud substitute claim.

**Done when:**
- Supported Amharic/English entries return accessible authorised citations; missing evidence returns a limitation.
- Reuse the verified own-history/retry contract and show consent-aware FAQ capability labels; do not rebuild persistence in this leaf.

**Automated verification:** Interface tests for supported/unsupported evidence, scope, persistence and duplicate submission.\
**Human verify:** Ask an approved question, open its source, then ask one absent from the FAQ.

#### T3-007-B — Evaluate a grounded online answer provider

**Parent:** T3-007 · **Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-003-B · **Type:** Evaluation evidence

**Deliver:** Create a compact approved evaluation set and compare an online candidate against the stated grounding/language criteria before selecting it. Use approved static passages with the agreed content/citation shape; production import/retrieval is not a prerequisite. T3-007-C repeats the relevant cases against actual retrieval.

**Done when:**
- Include supported, missing-evidence, cross-language and malicious-source cases; assess claim support, not only citation existence.
- Record thresholds before running, actual results, latency/cost/consent and rejected alternatives; inaccessible evaluation stays blocked.

**Automated verification:** Run the separately labelled provider evaluation with synthetic/approved data.\
**Human verify:** Review bilingual answers and their passages with a competent speaker.

#### T3-007-C — Add the online answer path with safe fallback

**Parent:** T3-007 · **Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-007-A, T3-007-B · **Type:** Implementation

**Deliver:** Integrate the selected provider behind the existing answer interface, with authorised retrieval and explicit external-processing consent.

**Done when:**
- Reject invented citation IDs and unsupported output; show truthful refusal/timeout/error states, not success-shaped failures.
- Declined consent or unavailable provider leaves the labelled FAQ path usable; no internet search or implicit actions.
- Repeat supported/missing/cross-language evidence cases against actual permission-filtered retrieval; static provider evaluation alone does not prove this integration.

**Automated verification:** Controlled-provider cases plus one live supported/unsupported question per language.\
**Human verify:** Switch between consented online answers and the FAQ provider without changing the learner flow.

### T3-008 — Provide lightweight text access and offline approved FAQs

**Phase:** 1 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-008-A, T3-008-B · **Type:** Epic

**Build:** The standalone low-bandwidth text route and a same-origin cache of approved FAQ/content explicitly authorised for non-restricted offline distribution. Do not claim an arbitrary embedding host can reload offline. Course approval alone does not make restricted material eligible for the shared-device cache.

**Done when:**
- After an explicit initial content load, the standalone page can reopen offline and show/search approved Amharic/English FAQ content.
- The UI distinguishes offline/local content from live tutor, human-help and delivery capabilities that are unavailable offline.
- Private conversations, credentials, accommodation content and personal responses are excluded from persistent offline caches.
- Restricted course sections are also excluded. On logout/account switch, another learner can access only the explicitly offline-distributable material, never the previous learner's protected sources. Restricted offline course access requires a separate approved design.
- Cache updates/invalidations do not continue presenting withdrawn approved content as current when online; first-time offline users see an honest unavailable state.
- Record measured download behaviour on the chosen low-bandwidth profile and avoid mandatory audio/video downloads for text use.

**Epic verification:** Browser offline/reload/cache-inspection, shared-device logout/account-switch, restricted-source exclusion and online recovery checks.\
**Epic demonstration:** Load FAQ content, disconnect, reopen, read an answer, then reconnect without being misled about live assistance.

#### T3-008-A — Reload approved public FAQs offline

**Parent:** T3-008 · **Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-007-A · **Type:** Implementation

**Deliver:** Prepare a same-origin offline pack for the standalone page containing only explicitly non-restricted, offline-distributable FAQ content.

**Done when:**
- Offline reload works after preparation and is clearly labelled; first-time offline access is honestly unavailable.
- No private responses, credentials or restricted course sections enter cache; account switching cannot leak protected content.

**Automated verification:** Browser offline/reload and shared-device cache-inspection checks.\
**Human verify:** Prepare the pack, disconnect, reopen and read a cited FAQ.

#### T3-008-B — Handle cache refresh and measure the text path on 3G

**Parent:** T3-008 · **Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-008-A · **Type:** Implementation

**Deliver:** Make reconnect/update behaviour safe and record actual lightweight text download behaviour on a defined constrained-network profile.

**Done when:**
- Online refresh stops presenting withdrawn FAQ versions as current; private data stays excluded.
- No forced audio/video downloads or false sent-help/delivery claims; retry after reconnect has one logical effect.

**Automated verification:** Version-update/reconnect browser cases and a reproducible network profile.\
**Human verify:** Read offline, reconnect after a source update, and inspect the measured text-transfer result.

### T3-009 — Validate the Phase 1 accessible bilingual journey

**Phase:** 1 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-009-A, T3-009-B · **Type:** Epic

**Deliver:** A co-designer-led check of the complete text-tutoring journey with focused regression fixes. Establish reusable evidence capture; this is not a substitute for Phase 4's complete final gate.

**Done when:**
- A learner can ask, read/hear the new-message announcement, open a citation, encounter missing evidence and use the FAQ path without assistance on the relevant test setups.
- Keyboard-only, 200% zoom, sound-off, NVDA and TalkBack results are recorded honestly, including unavailable devices and unresolved issues.
- Amharic/Ethiopic rendering, mixed-direction content and displayed local date/time conventions are reviewed with the co-designer; calendar/localisation gaps are recorded against the spec rather than guessed.
- Zero critical/serious axe findings on the tested baseline views; automated results are not represented as a WCAG certification.

**Epic verification:** Run the Phase 1 end-to-end/axe suite and focused regression tests for fixes.\
**Epic demonstration:** Co-designer attempts the agreed main task unaided; record task, device, assistive technology, outcome and observations.

#### T3-009-A — Agree the co-designer task and baseline observations

**Parent:** T3-009 · **Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** None · **Type:** Co-design evidence

**Deliver:** With the co-designer, choose the primary learner task and record initial pain points, intended devices and relevant organiser feedback.

**Done when:**
- Record consented, non-identifying observations and success criteria before judging the new interface.
- Separate observed task completion/assistance from assumptions; obtain missing organiser findings rather than inventing them.

**Automated verification:** No application test yet; produce an executable human task script.\
**Human verify:** Another team member can run the same task and record assistance/completion consistently.

#### T3-009-B — Run the first bilingual accessible tutoring task

**Parent:** T3-009 · **Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-009-A, T3-006-C, T3-006-D, T3-007-A, T3-008-A · **Type:** Validation evidence

**Deliver:** Run the standalone cited FAQ journey with the co-designer and required available assistive setups; capture before/after observations. Reuse this script in T3-025 for the integrated online/embed/voice/help/career paths; early feedback does not certify them.

**Done when:**
- Record actual device, language, assistance and completion outcomes, including NVDA/TalkBack/keyboard/zoom/sound-off coverage.
- Blocking defects get separate small repair/retest tasks; this success gate stays blocked until the affected journey passes, not an unlimited fix-everything ticket.

**Automated verification:** Run existing Phase 1 browser/axe checks rather than duplicating them.\
**Human verify:** Co-designer completes the selected task unaided and explains what changed.


## Phase 2 — Voice and messaging

### T3-010 — Add consented voice input with review before sending

**Phase:** 2 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-010-A, T3-010-B, T3-010-C · **Type:** Epic

**Build:** Amharic/English microphone input through a replaceable transcription adapter; evaluate actual language quality using approved speech fixtures. Recording creates an editable transcript, not an automatic submission.

**Done when:**
- Learner explicitly starts/stops recording, reviews/edits the transcript, and separately sends or discards it.
- Microphone and external speech-processing consent are understandable; denial, unsupported format, empty audio, oversize/overlong input and timeout preserve a usable text path.
- Cap recording size/duration, validate actual supported formats, and remove local temporary audio after success, cancellation and failure.
- No claim of on-device/offline transcription unless actually demonstrated; provider retention/cost limitations are documented.

**Epic verification:** Recording-state/adapter tests for send-after-review, consent denial, format/limit rejection and temporary-file cleanup.\
**Epic demonstration:** Speak both languages on the target device, correct a transcription error, discard another recording, and confirm only the explicitly submitted text reaches the tutor.

#### T3-010-C — Prove the transcription adapter on actual bilingual samples

**Parent:** T3-010 · **Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-003-B, T3-001-A · **Type:** Implementation

**Deliver:** Implement only the chosen transcription port adapter and prove actual supported audio formats/languages with approved samples; no upload endpoint or capture UI yet.

**Done when:**
- Record consented Amharic/English sample results reviewed by a competent speaker and the quality threshold agreed before evaluation.
- Map unsupported format, timeout and provider errors honestly; minimise data and document external retention without recording private audio in evidence.

**Automated verification:** Provider-contract fixtures plus separately labelled authorised live samples; fixtures cannot pass language quality.\
**Human verify:** Review the actual transcript beside the approved sample and mark unacceptable quality or missing access blocked.

#### T3-010-A — Transcribe bounded audio safely

**Parent:** T3-010 · **Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-010-C, T3-004-A · **Type:** Implementation

**Deliver:** Connect the verified adapter to an authenticated consent-checked processing endpoint for bounded audio; reuse adapter evaluation instead of reimplementing it.

**Done when:**
- Validate actual formats/limits; errors, cancellation and completion remove temporary audio.
- Exercise accepted/unsupported input through this endpoint; retain T3-010-C quality evidence and do not claim unsupported formats/languages.

**Automated verification:** Adapter/ingress tests for limits, consent denial, failure and cleanup, plus labelled live samples.\
**Human verify:** Submit a consented short sample in each language and inspect its transcript.

#### T3-010-B — Record, edit and explicitly send a transcript

**Parent:** T3-010 · **Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-010-A, T3-006-A, T3-007-A · **Type:** Implementation

**Deliver:** Add accessible browser capture and transcript review to the existing text-question flow.

**Done when:**
- Start/stop are explicit; edit/approve/discard cannot submit a question before approval.
- Microphone denial, unsupported capture and transcription errors preserve a usable typed path.

**Automated verification:** Browser state tests for review/send/discard and denied microphone.\
**Human verify:** Record, correct a word, submit once, then discard a second recording.

### T3-011 — Read answers aloud without removing text access

**Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-003-B, T3-006-A, T3-007-A · **Type:** Implementation

**Build:** Optional Amharic/English spoken answers with a replaceable speech-output adapter and accessible playback controls. Keep the cited text answer authoritative and usable without sound.

**Done when:**
- Playback starts only on learner action; pause/stop are keyboard accessible, and speech does not obscure new-message announcements.
- Cloud synthesis is consented; failure, missing language support or muted sound leaves the complete text/citation path available.
- Sample output is checked for intelligibility with an appropriate speaker; unsupported quality is not presented as verified Amharic support.
- Audio output does not add uncited claims or speak unrelated private content; relevant temporary resources are cleaned up.

**Automated verification:** Playback-control, consent, output/text association and speech-provider-failure tests.\
**Human verify:** Read and listen to the same answer in each language, stop playback by keyboard, then complete the task with sound off.

### T3-012 — Link Telegram securely and reuse text tutoring

**Phase:** 2 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-012-A, T3-012-B · **Type:** Epic

**Build:** A Telegram adapter that securely links a learner and invokes the same tutoring use case rather than implementing a second assistant.

**Done when:**
- Short-lived single-use account linking cannot be replayed or used to link another learner; usernames alone are never identity proof.
- Sender/chat identity and inbound update authenticity are validated; duplicate updates do not create duplicate requests or side effects.
- Private course content is not posted to unapproved group chats. Consent is channel-appropriate and checked before external AI processing.
- Text answers preserve language, citations and missing-evidence behaviour; unlinking prevents subsequent access through the old association.
- No bot tokens or raw conversation bodies appear in logs or fixture files.

**Epic verification:** Linking/replay, cross-user, group-chat restriction, duplicate-update and adapter/use-case consistency tests.\
**Epic demonstration:** Link a real test Telegram account, ask a supported question, follow its citation, unlink, and confirm protected course access is denied.

#### T3-012-A — Link and revoke a private Telegram identity

**Parent:** T3-012 · **Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-003-D, T3-004-A · **Type:** Implementation

**Deliver:** Implement single-use expiring account linking and unlinking for private Telegram accounts.

**Done when:**
- Replay/cross-user link attempts fail; usernames and unapproved group chats never establish learner access.
- Verify incoming update authenticity; unlinking revokes subsequent protected access and tokens stay out of logs.

**Automated verification:** Link expiry/replay/ownership/unlink tests.\
**Human verify:** Link a real consented test account, unlink and prove protected access is gone.

#### T3-012-B — Answer Telegram text questions through the same tutor

**Parent:** T3-012 · **Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-012-A, T3-007-C · **Type:** Implementation

**Deliver:** Translate authenticated Telegram text updates into the existing tutoring use case and return readable cited responses.

**Done when:**
- Duplicate updates cause one logical question; consent, course scope and language/refusal rules match web.
- A real test account receives the answer and can follow an authorised citation; no raw bodies or tokens in logs.

**Automated verification:** Adapter/update replay tests and one separately recorded live exchange.\
**Human verify:** Ask a supported and unsupported question in Telegram and compare behaviour with web.

### T3-013 — Support Telegram voice with explicit transcript review

**Phase:** 2 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-013-A, T3-013-B · **Type:** Epic

**Build:** Telegram voice input/output using the existing speech use cases and adapters, with an explicit approve/edit/discard transcript interaction before asking the tutor.

**Done when:**
- Validate retrieved media and limits rather than trusting sender-supplied MIME metadata; normalize only when the chosen provider needs it.
- Duplicate updates/callbacks cannot submit the transcript twice; an old transcript cannot be approved as another user's request.
- Unsupported or inaccessible media returns a text alternative. Temporary audio is removed on every terminal outcome.
- Spoken output is optional, consented, supported by the current Telegram API, and accompanied by the complete cited text.

**Epic verification:** Media validation, transcript ownership/review, duplicate-callback and cleanup regression tests.\
**Epic demonstration:** Send a voice note, review/correct the transcript, approve it, and receive readable text with optional supported audio; repeat with a discarded transcript.

#### T3-013-A — Review a Telegram voice transcript before asking

**Parent:** T3-013 · **Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-012-B, T3-010-A · **Type:** Implementation

**Deliver:** Handle bounded Telegram voice media with explicit transcript approve/edit/discard interaction.

**Done when:**
- Validate downloaded content rather than trust MIME claims; remove temporary audio on every terminal outcome.
- Transcript/callback ownership and replay checks prevent another user or repeated callback from submitting it.

**Automated verification:** Media/ownership/replay cases through the Telegram adapter.\
**Human verify:** Send a real voice note, edit its transcript and approve once; discard another.

#### T3-013-B — Return optional Telegram speech with cited text

**Parent:** T3-013 · **Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-012-B, T3-011 · **Type:** Implementation

**Deliver:** Support speech requested for a Telegram text answer independently of voice input; the epic still proves the combined voice journey. Reuse the speech-output adapter for user-requested Telegram audio without removing readable answers.

**Done when:**
- Current supported format/size is verified; full text/citations accompany audio.
- Consent denial or synthesis/send failure preserves text, and temporary output resources are cleaned.

**Automated verification:** Audio/text association, format and failure mapping tests.\
**Human verify:** Request speech in both languages and verify the readable answer remains complete.

### T3-014 — Persist delivery work and recover safely from failures

**Phase:** 2 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-014-A, T3-014-B, T3-014-C · **Type:** Epic

**Build:** A small PostgreSQL-backed delivery queue/worker with transactional enqueue, deduplication keys, bounded retries, claim/recovery rules and visible terminal or uncertain states. No Redis, Kafka or general workflow engine.

**Done when:**
- A committed action and its required delivery work are not silently separated by a process crash; work survives restart.
- Multiple worker attempts cannot concurrently own the same live claim; abandoned claims recover using a documented policy.
- Known retryable failures are bounded; unsubscribe/authorisation is rechecked before dispatch.
- Provider idempotency is used when available. Timeout after possible provider acceptance is tracked as uncertain and not blindly resent where duplicates cannot be excluded.
- Logs/statuses expose failure metadata without message bodies or contact details; the implementation has a documented reconciliation path.

**Epic verification:** Database-backed crash/restart, concurrent-claim, duplicate-enqueue, cancelled-subscription and ambiguous-send tests with controlled adapters.\
**Epic demonstration:** Interrupt a test delivery, restart, and inspect its recovered/uncertain state without claiming a mock proves real transport.

#### T3-014-A — Commit a delivery intent atomically with its action

**Parent:** T3-014 · **Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-001-B, T3-004-A · **Type:** Implementation

**Deliver:** Introduce the minimal durable outbox interface and persistence using a synthetic test action; no delivery provider or general workflow engine.

**Done when:**
- Rollback removes both action and intent; commit persists both across restart.
- A logical deduplication key prevents repeated intent creation without storing sensitive text in logs.
- Keep protected references minimal and implement policy-bound scrubbing/dedup expiry; stale/expired references cannot re-expose deleted content when a worker resumes.

**Automated verification:** Real-database commit/rollback/replay tests.\
**Human verify:** Inspect a committed versus rolled-back synthetic action and its delivery intent.

#### T3-014-B — Claim due work and recover abandoned leases

**Parent:** T3-014 · **Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-014-A · **Type:** Implementation

**Deliver:** Implement the small worker claim/lease lifecycle with no external sends yet.

**Done when:**
- Concurrent workers do not own the same live claim; expired claims recover after a crash.
- Use bounded batches and safe status metadata; no network call holds an open database transaction.

**Automated verification:** Controlled-clock, two-worker and restart tests against PostgreSQL.\
**Human verify:** Stop a worker with leased work and see another recover it after expiry.

#### T3-014-C — Dispatch safely with bounded retries and unknown outcomes

**Parent:** T3-014 · **Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-014-B · **Type:** Implementation

**Deliver:** Drive a controlled delivery adapter with eligibility checks, bounded retry and explicit permanent/unknown states.

**Done when:**
- Recheck current permission/consent/cancellation before sending; a revoked recipient is suppressed.
- Possible provider acceptance is not blindly resent; document reconciliation and distinguish accepted from delivered.

**Automated verification:** Fault injection for timeout-after-acceptance, permanent failure, retry exhaustion and cancellation.\
**Human verify:** Inspect recoverable, terminal and uncertain deliveries without calling a fake real transport.

### T3-015 — Verify real outbound SMS through the approved route

**Phase:** 2 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-015-A, T3-015-B · **Type:** Epic

**Build:** An SMS adapter for the actually approved Ethiopian sending route, integrated with durable delivery and explicit recipient consent. Inbound SMS tutoring is out of scope; the standalone text route satisfies that channel need.

**Done when:**
- Sender/account access and carrier constraints are verified; record live receipt on a consented test handset, not merely HTTP acceptance.
- Validate destination and text limits; test Amharic/Unicode handling and document segmentation/cost implications without promising free delivery.
- Map provider acceptance, delivery, failure and uncertain outcomes honestly; credentials remain server-side.
- A test double is clearly labelled and cannot enable production sending or satisfy this acceptance check.
- Without approved credentials/route or live evidence, this issue and the Phase 2 gate remain blocked.

**Epic verification:** Adapter contract tests for payload validation, response mapping, failures and safe retry behaviour.\
**Epic demonstration:** Send a consented English and Amharic test message through the real route and record handset receipt and actual delivery status.

#### T3-015-A — Implement the approved SMS adapter contract

**Parent:** T3-015 · **Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-003-A, T3-001-A · **Type:** Implementation

**Deliver:** Implement payload validation and response mapping for the observed approved SMS route; this leaf is code/contract proof, not live delivery acceptance. Use the T3-003-A agreed contract, also consumed by T3-014-C; no competing provider interface.

**Done when:**
- Validate destination, Unicode/length limits and provider-specific status semantics.
- Use idempotency/status lookup where available and retain unknown outcomes otherwise; credentials stay server-side.

**Automated verification:** Contract tests with documented provider-shaped fixtures and safe failures.\
**Human verify:** Inspect a sanitised payload/status mapping and identify the unverified live step.

#### T3-015-B — Prove real English and Amharic SMS receipt

**Parent:** T3-015 · **Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-015-A, T3-014-C · **Type:** Live evidence

**Deliver:** Send only authorised test messages through the worker and actual route and collect consenting handset receipt evidence.

**Done when:**
- Record both languages, segmentation/cost implications and observed delivery results without personal identifiers.
- Missing credentials, sender approval or receipt keeps this leaf and the SMS epic blocked.

**Automated verification:** Reuse adapter checks; a provider acceptance response alone does not pass.\
**Human verify:** Read the actual English and Amharic messages on the test handset.


## Phase 3 — Human help and careers

### T3-016 — Create private asynchronous help requests and a persistent inbox

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-016-A, T3-016-B · **Type:** Epic

**Build:** One-click entry to human help, a clear review of context shared with support, and persistent request/reply history with unread indicators. Requesting help never starts screen capture.

**Done when:**
- The learner sees waiting/assigned/resolved/cancelled state and can leave, return, and cancel without losing the recorded request.
- Only the explicitly shared context enters the support request; unrelated private chat history is not visible to support.
- Repeated clicks/network retries do not create duplicate requests; learner A cannot inspect or cancel learner B's request.
- If no person is available, show an honest waiting state without a response-time promise. Without notification opt-in, explain that the learner must return to check replies.

**Epic verification:** Persistence/reload, duplicate-submit, state transition and cross-user/context-disclosure tests.\
**Epic demonstration:** Request help, leave the page, reopen it, inspect the same pending request and cancel it; confirm no screen-sharing permission prompt appeared.

#### T3-016-A — Create and cancel an owned private help request

**Parent:** T3-016 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-004-A, T3-006-A, T3-007-A · **Type:** Implementation

**Deliver:** Offer one-click help after clear context-sharing disclosure, persisting only the learner-approved context.

**Done when:**
- Repeated submissions produce one request; another learner cannot read/cancel it.
- Waiting/cancelled states survive reload and do not start screen capture or promise staff availability.
- Implement help/context expiry under T3-023-A, including inaccessible expired content and shared-copy removal. Use only synthetic data while the policy is unresolved.

**Automated verification:** Persistence, ownership, duplicate-submit and cancellation cases.\
**Human verify:** Request help, close/reopen the page and cancel the same request.

#### T3-016-B — Show a persistent learner help inbox

**Parent:** T3-016 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-016-A · **Type:** Implementation

**Deliver:** List the learner's own requests and thread/unread state; use explicitly labelled message fixtures until the staff reply leaf integrates it.

**Done when:**
- Request/thread access is owner-scoped and safe across reload; no notification channel is assumed.
- Without opt-in, explain that the learner must return; prepare the small reply/read interface for support consumers.

**Automated verification:** List/object ownership and unread/read-state fixture checks.\
**Human verify:** Reopen the inbox, read a labelled fixture reply and verify it is no longer unread.

### T3-017 — Let support claim, reply and notify asynchronously

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-017-A, T3-017-B, T3-017-C · **Type:** Epic

**Build:** A protected support console for authorised queue access, exclusive claims, replies and resolution. Add optional linked-Telegram reply notifications and lightweight meeting coordination within the conversation.

**Done when:**
- Concurrent claims assign a request once; unauthorised staff/learners cannot access request contents or act as the assigned responder.
- Replies persist and mark unread for the learner; delivery failures do not erase the reply or falsely report a notification as delivered.
- Telegram notices require opt-in and linking, contain only a generic reply notification, and open an authorised return path without exposing private content.
- Learner and staff can propose/confirm a meeting time in conversation using clearly labelled Addis Ababa time. No booking engine, calendar sync, call platform or reminder guarantee is implied.
- Cancellation/resolution and staff reconnects produce coherent states without silent reopening or duplicate replies.

**Epic verification:** Concurrent claim, role restrictions, notification consent/privacy, reply recovery and state-transition tests.\
**Epic demonstration:** Close the learner browser, claim/reply as staff, receive an opted-in generic Telegram notice, then reopen and read the actual reply; coordinate a meeting by text.

#### T3-017-A — Claim a request from the protected support queue

**Parent:** T3-017 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-016-A · **Type:** Implementation

**Deliver:** Add staff queue/claim behaviour and its minimal UI, showing only the information needed to choose authorised work.

**Done when:**
- Two staff claims produce exactly one assignee; learners cannot acquire staff permissions.
- Only authorised staff can inspect/handle request content; unrelated learner history stays hidden.

**Automated verification:** Concurrent claim and role/request-access tests.\
**Human verify:** Claim the same waiting request from two staff sessions; exactly one succeeds.

#### T3-017-B — Exchange replies and resolve a support conversation

**Parent:** T3-017 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-017-A, T3-016-B · **Type:** Implementation

**Deliver:** Connect persisted staff/learner replies, unread state and resolution/cancellation in the actual two-sided interface.

**Done when:**
- Replies survive restart and retries do not duplicate them; closed/revoked requests reject new unauthorised actions.
- Learner and staff can propose/confirm an explicitly labelled Addis Ababa meeting time in text without claiming a calendar booking.
- New replies follow the help expiry policy; resolution/cancellation cannot silently extend retention or resurrect expired context. Reuse help lifecycle tests and add only reply-specific risks.

**Automated verification:** Reply/reload/read-state and terminal-state checks.\
**Human verify:** Close the learner browser, reply as staff, reopen/read the message and coordinate a meeting by text.

#### T3-017-C — Notify opted-in learners of a support reply

**Parent:** T3-017 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-017-B, T3-012-A, T3-014-C · **Type:** Implementation

**Deliver:** Send generic Telegram reply notices through durable delivery after explicit channel opt-in.

**Done when:**
- No message/accommodation body is exposed; notice opens an authorised return path.
- Unlink/opt-out/cancellation suppresses pending notices; failed notification never erases the persisted reply.

**Automated verification:** Consent/eligibility/transactional enqueue tests and a live generic notice.\
**Human verify:** Receive a generic notice while away, then authenticate to read the actual reply.

### T3-018 — Share a supported desktop screen under learner control

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-018-A, T3-018-B, T3-018-C, T3-018-D · **Type:** Epic

**Build:** Screen sharing attached to an authorised help session, with authenticated signalling and verified connectivity/relay configuration. Remote control and recording are excluded.

**Done when:**
- Only the learner explicitly initiates capture and chooses the browser-provided source; staff cannot force capture or join another request's session.
- A persistent sharing indicator and accessible stop control are present. Cancel, request closure, permission revocation or disconnection ends the stream; reconnect needs fresh permission.
- Demonstrate a real supported desktop connection across different networks, not only on one machine/LAN.
- Unsupported mobile browsers retain text help and disclose the limitation. Any organiser-approved alternative is recorded; no unapproved fallback is called equivalent screen sharing.
- Media is not recorded; credentials and relay configuration are not hard-coded or leaked.

**Epic verification:** Authorisation, session lifecycle/stop, denied-permission and unsupported-browser behaviour with controlled media/signalling tests.\
**Epic demonstration:** Share a chosen desktop tab to authorised staff across networks, stop, disconnect and attempt rejoin; verify no capture resumes automatically.

#### T3-018-A — Authorise and negotiate a sharing session

**Parent:** T3-018 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-017-A, T3-003-C · **Type:** Implementation

**Deliver:** Implement the small authenticated signalling/session capability restricted to the learner and authorised support participant.

**Done when:**
- Foreign/expired/revoked session access fails; request cancellation/resolution invalidates capabilities.
- This leaf proves signalling permissions only, not remote screen delivery or capture.

**Automated verification:** Session ownership, expiry and revocation contract tests.\
**Human verify:** Connect two authorised signalling clients and reject a third unrelated participant.

#### T3-018-B — Share and stop a chosen desktop screen

**Parent:** T3-018 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-018-A, T3-017-B · **Type:** Implementation

**Deliver:** Connect browser capture/media using the validated signalling path with a persistent accessible stop control. Keep this to one learner and one support viewer, video of the chosen screen only, browser-native permission UI and no conferencing features. Stop/disconnect/revocation safety is inseparable from this slice; if discovery still exceeds a focused PR, propose a safe split before coding.

**Done when:**
- Only learner action invokes the browser picker; stop/disconnect/revocation ends tracks and reconnection needs fresh action.
- No recording/remote control; unsupported mobile browsers disclose the limitation and retain text help.

**Automated verification:** Controlled media lifecycle/permissions plus a real supported-desktop session.\
**Human verify:** Share a chosen source, stop it, disconnect and confirm capture cannot resume silently.

#### T3-018-C — Verify cross-network sharing and document mobile acceptance

**Parent:** T3-018 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-018-B, T3-018-D · **Type:** Live evidence

**Deliver:** Test the actual deployment/relay across distinct networks and reconcile the mobile fallback with organisers.

**Done when:**
- Record real connectivity/stop results, not a same-LAN approximation.
- Missing relay proof or unresolved required organiser acceptance keeps the affected acceptance gate blocked.

**Automated verification:** Reuse lifecycle checks; record actual network configuration without secrets.\
**Human verify:** Share across two networks and read the organiser limitation/alternative decision.

#### T3-018-D — Configure the approved HTTPS and relay environment

**Parent:** T3-018 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-003-C, T3-001-B · **Type:** Deployment

**Deliver:** Deploy the minimal runtime to explicitly authorised infrastructure, configure public HTTPS and secret injection, and configure a relay only if needed for the selected sharing route. This leaf owns setup, not just investigation; do not provision paid resources without approval.

**Done when:**
- Record the actual endpoint, health/readiness and public callback reachability without secrets; unauthenticated/demo fixture access cannot expose real learner data.
- Document the approved network/relay configuration, credential lifecycle and restart procedure. Missing host, DNS, permissions or necessary relay leaves deployment blocked.

**Automated verification:** Actual HTTPS/readiness and required network/relay connectivity probes; local Compose is not public deployment proof.\
**Human verify:** Reach the deployed service from another network and inspect its documented safe configuration.

### T3-019 — Import approved jobs and answer job questions with citations

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-019-A, T3-019-B · **Type:** Epic

**Build:** Repeatable approved job-record ingestion with stable job IDs, category, location, publication/expiry metadata and a valid source link. Route job questions to this approved collection, separate from course tutoring.

**Done when:**
- Reimports/updates do not duplicate jobs; malformed records and missing required publication data are rejected visibly.
- Web and Telegram can answer supported job questions using approved records and citations; missing facts are acknowledged rather than fabricated.
- Expired/withdrawn roles are not presented as currently open or eligible for new alerts; availability/status changes are reflected consistently.
- The interface distinguishes job evidence from course evidence; external web search is not introduced by this issue.

**Epic verification:** Import/reimport, expiry/withdrawal, cited job answer and course/job routing tests.\
**Epic demonstration:** Import one open and one expired job, ask about both through web/Telegram, then update the open job and verify the answer uses current approved data.

#### T3-019-A — Import active jobs with stable provenance

**Parent:** T3-019 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-001-B, T3-004-A · **Type:** Implementation

**Deliver:** Add repeatable approved job ingestion with category/location, publication/expiry and source links.

**Done when:**
- Updates/reimports do not duplicate jobs; malformed records fail without corrupting approved data.
- Expired/withdrawn status is consistently queryable and a new-publication event has a stable identity.

**Automated verification:** Import/update/expiry and stable-publication tests.\
**Human verify:** Import an open and expired job, update one and inspect current status.

#### T3-019-B — Answer job questions using approved records

**Parent:** T3-019 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-019-A, T3-007-C, T3-012-B · **Type:** Implementation

**Deliver:** Route job questions through the grounding interface in web/Telegram without mixing course evidence or adding web search.

**Done when:**
- Supported answers cite current job records; missing/expired facts are acknowledged.
- Approved-source permissions and safe output apply in both channels.

**Automated verification:** Job/course routing, expiry and answer/citation checks.\
**Human verify:** Ask about active, expired and unknown jobs in web and Telegram.

### T3-020 — Subscribe to matching jobs and deliver Telegram alerts

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-020-A, T3-020-B · **Type:** Epic

**Build:** Explicit per-channel job subscriptions using category/location filters, deterministic matching for newly published jobs, durable enqueue and Telegram delivery. No AI ranking or disability-profile inference.

**Done when:**
- Only opted-in, securely linked learners receive matching alerts; filter changes affect future eligibility according to the documented rule.
- Reimporting or processing the same job event twice does not enqueue duplicate learner/job/channel alerts.
- Expired jobs and unsubscribed recipients are excluded again at dispatch time, including already queued work.
- Each alert identifies the job and offers an accessible unsubscribe path; alert data does not expose private support information.
- Known failures and uncertain outcomes remain inspectable without falsely claiming exactly-once delivery across external systems.

**Epic verification:** Match/non-match, duplicate publication, expiry-before-send, unsubscribe-before-send and ownership tests.\
**Epic demonstration:** Subscribe a real test Telegram user, publish matching/non-matching fixtures, receive only the eligible alert, then unsubscribe before another queued send.

#### T3-020-A — Persist job preferences and match new publications

**Parent:** T3-020 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-019-A, T3-004-A, T3-014-A · **Type:** Implementation

**Deliver:** Implement learner-owned category/location preferences and channel-neutral matching with transactional alert intents.

**Done when:**
- Only explicit active subscriptions match; no sensitive-profile inference.
- A repeated publication yields one logical learner/job/channel intent; filters and job validity govern eligibility.
- Implement consent/destination lifecycle under T3-023-A: cancel ineligible queued intents and remove no-longer-needed contacts while preserving unrelated active subscriptions and bounded non-content dedup records.

**Automated verification:** Match/non-match, ownership, duplicate-publication and atomic enqueue tests.\
**Human verify:** Change filters and publish matching/non-matching fixture jobs; inspect only eligible intents.

#### T3-020-B — Deliver and unsubscribe Telegram job alerts

**Parent:** T3-020 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-020-A, T3-012-A, T3-014-C · **Type:** Implementation

**Deliver:** Bind the Telegram subscription to a verified linked account and deliver through the shared worker.

**Done when:**
- Opt-in, unlink/unsubscribe and job expiry are rechecked before send; an accessible unsubscribe path is supplied.
- A real test account receives a matching alert; retries and unknown outcomes retain shared delivery semantics.

**Automated verification:** Channel-binding/dispatch suppression checks and live Telegram receipt.\
**Human verify:** Subscribe, receive an eligible job, then unsubscribe before another queued dispatch.

### T3-021 — Deliver subscribed job alerts by real SMS

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-021-A, T3-021-B · **Type:** Epic

**Build:** SMS job subscriptions and alert delivery using the approved transport, shared matching/deduplication policy and durable queue. Bind a phone destination through a safe verified/explicitly established ownership route; do not let one learner silently subscribe someone else's number.

**Done when:**
- SMS subscription consent is separate from Telegram consent; recipients can unsubscribe without requiring Telegram.
- Eligible jobs produce readable size-bounded alerts with a usable job reference/link; Amharic content survives the actual route.
- Deduplication, expiry, cancellation and uncertain-send handling are preserved rather than reimplemented inconsistently in the SMS adapter.
- A real subscribed test handset receives an eligible job alert and receives no new dispatch after unsubscribe; screenshots/logs used as evidence redact personal data.
- Missing credentials or real delivery evidence blocks this issue; a simulated inbox is not acceptance.

**Epic verification:** Destination ownership/consent, shared matching, Unicode payload, deduplication and unsubscribe-before-send checks.\
**Epic demonstration:** Subscribe a consented handset, publish a matching job, receive the real alert, unsubscribe, and verify no dispatch occurs for a subsequent job.

#### T3-021-A — Verify and manage an SMS job subscription

**Parent:** T3-021 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-020-A, T3-015-A, T3-003-E · **Type:** Implementation

**Deliver:** Add the approved T3-003-E phone-ownership route and separate SMS consent/preferences. If a new SMS-code flow is selected instead of an existing verified claim, first split its verification/expiry/attempt-limit behaviour from subscription UI into approved child slices; do not hide that additional work in this estimate.

**Done when:**
- One learner cannot silently subscribe another person; no Telegram account is required for SMS opt-out.
- Unsubscribe changes eligibility immediately and queues no new delivery; any external verification prerequisite remains visible.
- Phone verification/contact records have the approved expiry and deletion rules; opt-out cannot leave a reusable queued destination behind.

**Automated verification:** Ownership/consent/opt-out cases using controlled verification fixtures, not live-delivery claims.\
**Human verify:** Verify an authorised test destination, subscribe and revoke consent.

#### T3-021-B — Deliver a real subscribed SMS job alert

**Parent:** T3-021 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-021-A, T3-015-B, T3-014-C · **Type:** Implementation

**Deliver:** Send a matching approved job through the real SMS route using shared matching/delivery logic.

**Done when:**
- Readable bounded Unicode payload includes a usable job reference; actual handset receipt is recorded.
- Unsubscribed or expired queued work is suppressed; no duplicate logical alert on publication replay.

**Automated verification:** Payload/eligibility checks plus recorded live receipt.\
**Human verify:** Receive a matching job on the consenting handset, unsubscribe, and verify no later dispatch.

### T3-022 — Request interview accommodations through a coordinator

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-022-A, T3-022-B · **Type:** Epic

**Build:** A learner-controlled accommodation request associated with an approved job and routed to an authorised support coordinator. Employer dashboards and automatic employer outreach are excluded.

**Done when:**
- The learner selects a job, describes the support needed, and reviews the exact request and intended recipient before submitting.
- Diagnosis, medical documents and disability disclosure are not mandatory; unrelated tutoring history is not attached.
- Only the learner and authorised coordinator can read/change the request; repeat submits do not duplicate it.
- Submission, cancellation and response states are clear and persist across reload; no employer transmission occurs as a hidden side effect.
- Notifications contain only generic status information, not accommodation text.

**Epic verification:** Explicit-confirmation, access-control, duplicate-submit, cancellation and no-unapproved-outreach tests.\
**Epic demonstration:** Draft, edit and submit a request without medical information, review it as the coordinator, and confirm another learner cannot access it.

#### T3-022-A — Preview and submit a private accommodation request

**Parent:** T3-022 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-019-A, T3-016-A · **Type:** Implementation

**Deliver:** Let a learner choose a job, describe requested support and explicitly confirm the exact recipient/content.

**Done when:**
- No diagnosis/medical proof or unrelated history is required; only learner and authorised coordinator have access.
- Cancel before confirmation sends nothing; retries create one request and no employer contact occurs.
- Apply T3-023-A to accommodation content and recipient-visible copies; expire/purge with controlled-clock proof without leaking text into notices/logs.

**Automated verification:** Preview/confirm/cancel, scope and duplicate-submit tests.\
**Human verify:** Submit a reviewed request without medical details and deny another learner access.

#### T3-022-B — Handle accommodation status in the coordinator inbox

**Parent:** T3-022 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-022-A, T3-017-B · **Type:** Implementation

**Deliver:** Reuse the authorised support flow to respond to and track the accommodation request.

**Done when:**
- State/replies survive reload and are visible only to intended participants.
- Any notifications are generic; nothing automatically transmits to an employer.

**Automated verification:** Coordinator access and status/reply persistence checks.\
**Human verify:** Respond as coordinator and read the response as the requesting learner.

### T3-023 — Enforce retention and deletion across private records

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-023-A, T3-023-B, T3-023-C · **Type:** Epic

**Build:** Actual cleanup and learner history-clearing behaviour for the agreed seven-day default conversation/help-content retention. Keep policy/configuration explicit; settle any unspecified retention clock/operational exception before introducing real data rather than silently extending retention.

**Done when:**
- The documented policy specifies the retention anchor, included records, approved institution overrides and how cleanup runs after process downtime.
- Expired/private content is removed from stored messages, help context and pending delivery payloads as applicable; no worker resurrects deleted content.
- Learners can clear their own conversation history but cannot delete another learner's data. Unsubscribed contact data is removed once no longer needed for authorised remaining use.
- Voice temporary files are cleaned on all terminal paths; private data is not retained in offline caches or routine logs.
- Provider-side retention is disclosed separately; local deletion is never claimed to delete third-party copies automatically.

**Epic verification:** Controlled-clock expiry, explicit history clearing, restart cleanup, queued-payload deletion, cross-user denial and audio cleanup tests.\
**Epic demonstration:** Age test records using the documented test fixture, run cleanup, and verify private content disappears while unaffected authorised records remain usable.

#### T3-023-A — Specify expiry semantics before storing real learner data

**Parent:** T3-023 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** None · **Type:** Policy evidence

**Deliver:** Confirm the agreed seven-day policy anchor and shared-copy/backup/provider handling; record it as an implementation contract, not an invented legal promise.

**Done when:**
- Institution confirmation or an explicit unresolved decision is recorded; only synthetic fixtures are used while policy is unresolved.
- Define expiry timestamps, cleanup after downtime and contact/dedup retention purpose without silently extending storage.

**Automated verification:** No production code required; list clock-based expected outcomes for later cleanup tests.\
**Human verify:** The team can apply one unambiguous expiry rule or identify the exact approval still needed.

#### T3-023-B — Clear and expire tutoring history

**Parent:** T3-023 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-023-A, T3-007-D · **Type:** Implementation

**Deliver:** Implement owned-history clearing and expiry/purge for conversations using the specified clock policy.

**Done when:**
- Another learner cannot delete/read history; purge resumes after downtime.
- Expired private data cannot reappear through responses/caches; policy must be resolved before real records are accepted.

**Automated verification:** Controlled-clock purge, restart and ownership tests.\
**Human verify:** Age a synthetic conversation, purge it, and confirm unrelated permitted history remains.

#### T3-023-C — Audit cross-module expiry and deletion without carrier dependencies

**Parent:** T3-023 · **Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-023-B, T3-017-C, T3-021-A, T3-022-B, T3-010-B, T3-013-A, T3-013-B, T3-008-B · **Type:** Validation evidence

**Deliver:** Audit lifecycle implementations owned by T3-014-A, T3-016-A/T3-017-B, T3-020-A/T3-021-A and T3-022-A, together with history clearing. This is cross-module proof, not a deferred privacy implementation sprint; carrier receipt is irrelevant. File a bounded repair leaf for each defect and keep this gate blocked.

**Done when:**
- Purge/cancellation cannot resurrect deleted content or destroy unrelated active subscriptions.
- Check media cleanup/log/cache exclusions from existing voice/channel tests; document external-provider/backup limits honestly.

**Automated verification:** Controlled-clock cross-module purge and stale-worker-reference tests; reuse existing audio-cleanup cases.\
**Human verify:** Expire shared synthetic content and inspect inbox, queue and subscription outcomes.


## Phase 4 — Submission readiness

### T3-024 — Measure concurrent-user behaviour and recovery

**Phase:** 4 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-024-A, T3-024-B, T3-024-C · **Type:** Epic

**Deliver:** Reproducible measurement with 20 simultaneous active learner sessions and a configurable limit on concurrent AI requests. Separate deterministic load tests from consented/cost-approved live provider checks.

**Done when:**
- Record workload, duration, hardware, provider mode, concurrency configuration, latency/error observations and actual results; do not claim capacity for thousands of concurrent users.
- No cross-user leakage, duplicate side effects or lost durable requests occur in the tested workload; one user's rate cannot bypass shared/per-user limits.
- Provider slowness/outage, database interruption and worker restart produce understandable failure/recovery states without unbounded retry growth.
- Security regressions exercise forged scopes, linked-channel replay and sensitive-data logging risks using the implemented interfaces.
- Any unresolved failure has an issue and blocks the affected acceptance gate; fixes get focused regression checks rather than weakening assertions.

**Epic verification:** Run the documented load/fault scenario and relevant integration/security suites; retain sanitized measurements.\
**Epic demonstration:** Observe simultaneous learner/support flows while slowing the provider and restarting the worker; compare UI states to recorded backend outcomes.

#### T3-024-A — Measure 20 active sessions and bounded AI concurrency

**Parent:** T3-024 · **Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-024-C, T3-017-B, T3-020-B · **Type:** Validation evidence

**Deliver:** Run a defined workload through implemented interfaces; choose pass thresholds before measurement, not after seeing results.

**Done when:**
- Record hardware/provider mode, limits, errors and latency; no capacity claim beyond the tested setup.
- No cross-user response mix-up or unbounded pending work; one learner cannot bypass shared/per-user limits.

**Automated verification:** Document and execute the reproducible load scenario; use approved cost/consent for live providers.\
**Human verify:** Observe concurrent learner/support sessions and compare UI states to measurements.

#### T3-024-B — Audit integrated failure recovery and private-data handling

**Parent:** T3-024 · **Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-014-C, T3-023-C, T3-012-B · **Type:** Validation evidence

**Deliver:** Exercise the actual combined system under restart/provider/database failures and review sensitive-data handling.

**Done when:**
- Reuse focused checks and add only missing cross-module risks; no broad rewrite/fix-all scope.
- A failed mandatory check becomes a small repair/retest leaf and keeps this gate blocked until resolved.

**Automated verification:** Run relevant fault/security suites and inspect sanitised evidence/logs.\
**Human verify:** Interrupt a delivery and inspect recovered/unknown status without exposing private data.

#### T3-024-C — Enforce bounded provider admission and rate limits

**Parent:** T3-024 · **Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-007-C, T3-010-A, T3-011 · **Type:** Implementation

**Deliver:** Implement the configured shared/per-learner limits across existing answer and speech invocations in the single API process. Reuse current identity/timeout paths; no generic distributed limiter or new queue service.

**Done when:**
- Concurrent excess requests receive an accessible recoverable busy/rate-limit result; pending work and input sizes are bounded, including web/Telegram callers of shared use cases.
- Timeout, failure and cancellation release capacity; per-user fairness prevents one learner monopolising all slots. Record configured values and retry behaviour for T3-024-A.

**Automated verification:** Controlled concurrent requests prove limits and capacity release on success/failure/cancellation without live-provider costs.\
**Human verify:** Saturate the configured limit with synthetic work, observe a truthful busy result, then complete a later request.

### T3-025 — Complete the co-designer accessibility gate and conformance evidence

**Phase:** 4 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-025-A, T3-025-B, T3-025-C · **Type:** Epic

**Deliver:** A final main-task test covering tutoring and the agreed help/career journey, plus a truthful WCAG 2.2 AA conformance report with evidence, limitations and unresolved findings.

**Done when:**
- Co-designer successfully completes the agreed mandatory main tasks unaided using the required NVDA, TalkBack, keyboard-only, 200% zoom and sound-off setups; record device/browser/assistive technology and task outcomes. An attempt without successful completion does not satisfy this criterion.
- Tested views have zero critical/serious axe findings. Automated scans complement rather than replace human/device tests.
- Review Amharic/Ethiopic rendering, RTL mixed text, local date/time/calendar expectations and low-bandwidth phone behaviour against the spec; no unsupported locale claim appears in the report.
- Unsupported mobile capture and its organiser acceptance status are explicitly reported; absent approval is not rewritten as full conformance.
- Fixes are rechecked by the affected test/user journey; unavailable testing resources are marked unverified, not passed.
- A truthful draft report may contain failures or unavailable checks, but this issue and its phase gate remain blocked until all required checks pass or an explicit organiser-approved change to the requirement is recorded.

**Epic verification:** Run final browser/axe suite and relevant regression checks.\
**Epic demonstration:** Co-designer repeats the main task independently; another team member reconciles the report with actual evidence and open findings.

#### T3-025-A — Pass final automated accessibility and desktop task checks

**Parent:** T3-025 · **Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-009-B, T3-006-B, T3-007-C, T3-010-B, T3-011, T3-017-C, T3-018-B, T3-019-B, T3-020-B, T3-021-A, T3-022-B, T3-023-B, T3-024-C · **Type:** Human/device evidence

**Deliver:** Assess all implemented primary states with axe, keyboard, NVDA, 200% zoom and sound off.

**Done when:**
- Zero critical/serious axe findings and successful required unaided desktop task outcomes are recorded.
- Defects are separate repair/retest leaves, not silently waived or hidden inside an unlimited audit task.

**Automated verification:** Run the existing final browser/axe suite; avoid redundant tests of already covered states.\
**Human verify:** Co-designer completes the desktop main task unaided on recorded devices.

#### T3-025-B — Pass the actual Android bilingual and low-bandwidth journey

**Parent:** T3-025 · **Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-006-B, T3-006-C, T3-006-D, T3-007-C, T3-008-B, T3-010-B, T3-011, T3-013-A, T3-013-B, T3-017-C, T3-018-B, T3-019-B, T3-020-B, T3-021-B, T3-022-B, T3-023-B, T3-024-C · **Type:** Human/device evidence

**Deliver:** Test actual TalkBack/cheap-Android text, voice and career/help paths under defined network conditions.

**Done when:**
- Record Amharic/Ethiopic/RTL, calendar/time presentation, offline and unaided completion results; do not substitute browser emulation for the device.
- Disclose mobile capture limitation and organiser acceptance separately; missing required evidence keeps the gate blocked.

**Automated verification:** Reuse relevant browser/network checks; record device-specific manual results.\
**Human verify:** Co-designer completes the selected phone task and reports remaining friction.

#### T3-025-C — Compile the assessed WCAG report and co-design evidence

**Parent:** T3-025 · **Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-025-A, T3-025-B, T3-018-C, T3-013-B · **Type:** Assessment documentation

**Deliver:** Reconcile actual test outcomes with the organiser checklist and applicable WCAG criteria.

**Done when:**
- No untested criterion is marked passed; required unaided tasks and accessibility gate must pass before completion.
- Link the original pain point, change and retest outcome without identifying the co-designer; incomplete evidence remains a blocker.

**Automated verification:** Document/evidence consistency checks, not a new redundant application test suite.\
**Human verify:** Another reader can trace each conformance statement to actual evidence.

### T3-026 — Prove clean installation, Savanna integration and portable interfaces

**Phase:** 4 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-026-A, T3-026-B, T3-026-C, T3-026-D · **Type:** Epic

**Deliver:** A clean-install path a stranger can follow, real Savanna launch/identity integration, a script-tag installation on another site and accurate REST/OpenAPI documentation generated or maintained from actual implemented contracts.

**Done when:**
- A teammate installs the submitted version from README/Compose within the judging target of one hour; record elapsed time and fixes, not a guessed duration.
- Savanna's actual identity/course restrictions and embed permission/CSP rules are tested; a standalone demo is not called Savanna integration.
- Script-tag installation works on an independent host without requiring its application stack; documented permissions and identity setup are sufficient.
- OpenAPI describes implemented validation, authentication, errors and relevant endpoints; examples do not contain secrets or bypass access controls.
- Installation documents distinguish local FAQ mode from live services requiring credentials, HTTPS, approved SMS route and relay infrastructure; missing dependencies stay visible.

**Epic verification:** Clean-environment startup/smoke checks, contract validation and cross-origin integration tests using the real supported launch contract.\
**Epic demonstration:** A teammate unfamiliar with setup follows only the submission docs, loads the assistant inside Savanna and a separate host, and completes the core journey.

#### T3-026-A — Document and check implemented REST/OpenAPI contracts

**Parent:** T3-026 · **Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-007-C, T3-010-B, T3-011, T3-017-C, T3-021-A, T3-022-B, T3-018-A, T3-023-B, T3-024-C · **Type:** Implementation

**Deliver:** Publish accurate schema/auth/error examples for the implemented HTTP interfaces and script configuration.

**Done when:**
- Examples contain no secrets or authentication bypass; documentation matches actual validated routes.
- Document offline/live limitations and provider configuration instead of invented endpoints.

**Automated verification:** Run schema/route contract consistency and example smoke checks.\
**Human verify:** Call one documented protected operation correctly and observe its documented invalid-input response.

#### T3-026-B — Prove early launch and identity inside real Savanna

**Parent:** T3-026 · **Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-002, T3-004-B, T3-006-B · **Type:** Integration evidence

**Deliver:** Run the module in the supplied starter and verify actual launch/identity/course/CSP with the labelled fixture shell. Do this before waiting for voice or screen sharing; T3-026-D owns the completed feature/media journey.

**Done when:**
- Actual permitted and forbidden contexts behave correctly inside Savanna.
- A fixture host is not substituted for this proof; unavailable starter or unresolved incompatibility blocks the leaf.

**Automated verification:** Run available real-host integration checks and record the exact setup.\
**Human verify:** Launch the actual embedded shell as an allowed learner and reject a forbidden course/identity; do not call fixture answers live tutoring.

#### T3-026-C — Prove a stranger can install and embed within an hour

**Parent:** T3-026 · **Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-001, T3-008-B, T3-026-A, T3-026-D, T3-023-C · **Type:** Adoption evidence

**Deliver:** Have someone follow only the actual README/Compose setup on a clean environment and add the script to a separate host.

**Done when:**
- Record elapsed install time and missing steps; meet the one-hour target before this proof completes.
- FAQ mode works without paid keys; actual live credentials/HTTPS/relay prerequisites are explicit and not promised as included.

**Automated verification:** Run clean-install/migration/readiness smoke checks.\
**Human verify:** An unfamiliar installer runs the documented journey without verbal setup instructions.

#### T3-026-D — Prove the completed learner journey inside Savanna

**Parent:** T3-026 · **Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-026-B, T3-007-C, T3-010-B, T3-011, T3-018-B, T3-018-D · **Type:** Integration evidence

**Deliver:** Rerun the real host after feature integration, including authenticated course questions, microphone permission and authorised help/screen sharing.

**Done when:**
- CSP/iframe permissions allow the intended audio/capture flows without loosening origin or identity rules; denied permissions remain accessible.
- Record actual host/version/device evidence; the early shell proof does not substitute for the completed journey.

**Automated verification:** Run supported real-host contract/browser checks and targeted permission-denial cases.\
**Human verify:** Ask a cited question, review voice text, enter help and start/stop a permitted desktop share from Savanna.

### T3-027 — Assemble and audit the submission package

**Phase:** 4 · **Priority:** Baseline · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-027-A, T3-027-B, T3-027-C · **Type:** Epic

**Deliver:** Code, README, Docker Compose, conformance report, approved licence, requirement-to-issue/evidence mapping, sanitized evaluation results and the end-to-end demonstration plan. Final packaging must reflect the actual submitted revision.

**Done when:**
- Every mandatory requirement maps to completed acceptance evidence. An honest draft package may list unresolved blockers, but it cannot complete this issue, pass the baseline gate, or unlock Phase 5 until required live and human/device checks pass (or an explicit approved requirement change is recorded).
- T3-027-C verifies every baseline epic/leaf T3-001–026 and all children; a passed validation subset does not substitute for missing baseline work.
- Adopt the open licence actually specified by ALX; do not invent licensing permission. Document attribution and third-party dependency/provider requirements.
- Rerun documented checks for the submitted revision and record passed/failed/unverified accurately; do not copy stale evidence from an earlier build.
- The demo includes cited Amharic tutoring, a limitation/fallback, asynchronous help, learner-controlled sharing on supported hardware, and the job/accommodation journey.
- No real credentials, private chats, handset identifiers or medical information are included. Standards/spec reviewers and human acceptance checks are recorded.

**Epic verification:** Run the complete documented release-check command set; inspect the final package for accidental secrets/private fixtures.\
**Epic demonstration:** Rehearse the demonstration from the submission instructions and verify the package against the organiser's actual submission instructions.

#### T3-027-A — Prepare the package, licence and operating-cost evidence

**Parent:** T3-027 · **Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-001, T3-003, T3-007-B · **Type:** Release documentation

**Deliver:** Prepare submission instructions, specified licence/attribution and a small cost/portability worksheet using selected providers and actual operating assumptions.

**Done when:**
- Distinguish measured/quoted costs from estimates or unknowns; include SMS segmentation, speech, hosting and relay where applicable.
- Explain FAQ/provider replacement and required secrets without including them; no paid-access or open-licence claim is invented.

**Automated verification:** Check package references and scan submission inputs for private fixtures/secrets.\
**Human verify:** A teammate can explain what running the module costs and what remains externally blocked.

#### T3-027-B — Rehearse the single end-to-end learner demonstration

**Parent:** T3-027 · **Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-007-C, T3-008-B, T3-010-B, T3-011, T3-017-C, T3-018-C, T3-019-B, T3-021-B, T3-022-B · **Type:** Demonstration evidence

**Deliver:** Run one concise learner story linking course help, a truthful fallback, asynchronous support and careers; prepare an honest recovery path for demo failures.

**Done when:**
- Use the submitted candidate and real required integrations, not unrelated feature screenshots.
- Record observable learner outcomes and limitations; do not claim a predicted judge score or guaranteed win.

**Automated verification:** Reuse the end-to-end checks for the chosen story.\
**Human verify:** Rehearse the actual demonstration and answer how evidence supports each claim.

#### T3-027-C — Close the complete baseline acceptance gate

**Parent:** T3-027 · **Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-001, T3-002, T3-003, T3-004, T3-005, T3-006, T3-007, T3-008, T3-009, T3-010, T3-011, T3-012, T3-013, T3-014, T3-015, T3-016, T3-017, T3-018, T3-019, T3-020, T3-021, T3-022, T3-023, T3-024, T3-025, T3-026, T3-027-A, T3-027-B · **Type:** Release gate

**Deliver:** Reconcile all baseline leaf acceptance, independent reviews and actual mandatory evidence against the final candidate.

**Done when:**
- All baseline epics/leaves and required live/device checks pass; a truthful incomplete draft is not a completed gate.
- Record exact revision and unresolved items; optional work opens only after this leaf and its epic complete.

**Automated verification:** Run documented release checks and the requirement-to-evidence audit.\
**Human verify:** Verify the final package against organiser requirements; disclose rather than conceal any missing capability.


## Phase 5 — Optional work after baseline acceptance

### T3-028 — Add explicit supplementary career web research

**Phase:** 5 · **Priority:** Stretch · **Status:** Planned (epic; claim a child) · **Owner:** Unassigned\
**Completion depends on:** T3-028-A, T3-028-B · **Type:** Epic

**Build:** A separate, disabled-by-default career web-research mode. It is optional for both delivery and learner use, not a silent fallback when the course tutor lacks evidence.

**Done when:**
- The learner explicitly selects the mode and approves external processing before a minimal query leaves the host; private history and accommodation text are excluded.
- Results show genuine external source links and a clear distinction from approved course/job records; unsupported claims are not dressed up as citations.
- Retrieved web text cannot override instructions, modify approved content, create subscriptions or trigger actions.
- Provider failure returns to a clear unavailable state; course mode stays strictly course-grounded regardless of search availability.

**Epic verification:** Mode separation, consent, query minimization, external-source rendering, injection and no-side-effect tests.\
**Epic demonstration:** Ask an unsupported course question and confirm no search occurs; explicitly enter career-research mode and inspect its external citations.

#### T3-028-A — Fetch sourced career research with explicit consent

**Parent:** T3-028 · **Phase:** 5 · **Priority:** Stretch · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-027 · **Type:** Implementation

**Deliver:** Add an optional search provider behind a narrow career-research interface; not a fallback for course answers.

**Done when:**
- Only explicitly consented minimal queries leave the host; exclude private chat/accommodation context.
- Results have genuine sources, are untrusted, and cannot change records or trigger actions; failure is explicit.

**Automated verification:** Consent/query-minimisation/source/action-isolation checks.\
**Human verify:** Inspect a consented search result and an unavailable-provider response.

#### T3-028-B — Expose the separate disabled-by-default research mode

**Parent:** T3-028 · **Phase:** 5 · **Priority:** Stretch · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-028-A · **Type:** Implementation

**Deliver:** Add the accessible learner-controlled mode and clear external-source presentation.

**Done when:**
- Course mode never searches implicitly; leaving research mode restores approved-source behaviour.
- The learner can inspect sources and processing disclosure without losing the text/accessibility path.

**Automated verification:** Mode-switch/consent and UI regression checks.\
**Human verify:** Ask an unsupported course question, observe no search, then deliberately enter career research.

### T3-029 — Add learner-selected simple-language mode

**Phase:** 5 · **Priority:** Stretch · **Status:** Planned · **Owner:** Unassigned\
**Depends on:** T3-027 · **Type:** Implementation

**Build:** A learner-controlled simple-language presentation/answer mode using short, understandable language without changing approved factual scope or making sensitive literacy assumptions.

**Done when:**
- Learner can enable/disable it accessibly; the mode does not remove citations, consent detail or necessary limitations.
- Simplified answers remain supported by the same evidence and do not invent meaning; unsupported content still receives an honest limitation.
- Amharic/English examples are evaluated with intended users rather than asserting that shorter text automatically improves comprehension.

**Automated verification:** Preference handling, grounding/citation preservation and accessibility regression checks.\
**Human verify:** Co-designer compares the same task in both modes and records whether comprehension improves without losing essential information.

### T3-030 — Show anonymous frequently asked topics to authorised teachers

**Phase:** 5 · **Priority:** Stretch · **Status:** Needs future spec · **Owner:** Unassigned\
**Depends on:** T3-027 · **Type:** Needs privacy-focused detail before implementation

**Build:** A minimal authorised teacher view of aggregate frequently asked topics, without names or raw question/conversation exports. Agree a suppression/aggregation policy before implementing; hiding names alone is not anonymisation.

**Done when:**
- The approved policy prevents displaying identifiable free text, rare/sensitive questions and accommodation content; personal transcripts are not retained simply to serve analytics.
- Access is authorised and course-scoped; aggregates cannot be drilled down to a learner.
- Retention/deletion policies and low-count behaviour are explicit and covered by tests.

**Automated verification:** Role/course isolation, suppression and no-personal-fields tests against synthetic inputs.\
**Human verify:** Seed synthetic common and uniquely identifying questions, then verify the teacher view shows only approved aggregate output.

### T3-031 — Future spec: employer dashboard

**Phase:** 5 · **Priority:** Lowest-priority stretch · **Status:** Needs future spec · **Owner:** Unassigned\
**Depends on:** T3-027 · **Type:** Parked planning issue, not implementation-ready

**Scope boundary:** User explicitly deferred an employer dashboard. Before implementation, grill and approve employer identity/verification, job ownership, accommodation-request access, consent, moderation and retention. Existing learner/support roles do not imply employer authorisation.

**Done when:** A separately approved bounded spec identifies the actual employer journey, data access and testable acceptance criteria, then splits any implementation into focused PR issues. This issue's completion means the spec is approved, not that a dashboard exists.

**Automated verification:** None for this planning issue; the future spec must define actual behaviour checks.\
**Human verify:** Review that proposed employer access cannot expose learner records or accommodation details without explicit authorised consent.

### T3-032 — Future spec: consented employer outreach

**Phase:** 5 · **Priority:** Lowest-priority stretch · **Status:** Needs future spec · **Owner:** Unassigned\
**Depends on:** T3-027 · **Type:** Parked planning issue, not implementation-ready

**Scope boundary:** User explicitly deferred automatic employer outreach. No sending is authorised by this backlog entry. Before implementation, approve verified recipient ownership, exact learner review/consent, channel policy, abuse prevention, cancellation, uncertain delivery and data-retention rules. A dashboard is not assumed to be a prerequisite unless the approved design needs it.

**Done when:** A separately approved bounded spec and dependency-aware implementation slices exist, with explicit prevention of unapproved disclosure or repeated external messages. Completion means planning approval, not outreach capability.

**Automated verification:** None for this planning issue; future acceptance must exercise consent, recipient verification, deduplication and delivery failures.\
**Human verify:** Walk through the proposed send/cancel/error journey and confirm that neither a support request nor a model answer can silently contact an employer.
