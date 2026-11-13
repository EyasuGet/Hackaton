# Track 3 implementation backlog

Status: local draft of the agreed design, prepared 2026-11-14. No application implementation, assignments, completed checks, GitHub issues, or PRs are implied by this document.

## How to use this backlog

- Product scope is defined in [the spec](spec.md); technical decisions in [the architecture](architecture.md). This file is the authoritative local issue body until an explicitly requested GitHub migration.
- Keep each `T3-NNN` ID when migrating. Create issues in dependency order, then resolve dependency links and retain an ID-to-GitHub mapping. Do not silently change all issues to In Progress or assign them to one person.
- Each implementation issue is intended to be one independently verifiable PR. If current code reveals that a slice cannot fit one PR, propose a split preserving its acceptance criteria and dependencies before implementing it.
- All issues below start **Planned / unassigned**, except explicitly marked **Needs future spec**. A team member claims one ready issue before starting; one issue has one implementation owner. Others may review or pair.
- An issue is ready when its listed dependencies and its phase-entry gate are complete. Within the active phase, independent ready issues may run in parallel. All baseline work in the previous phase must pass its exit gate before the next phase starts.
- Phase 0 feasibility checks may complete with an evidenced external blocker, an escalation path, and a dependent issue marked blocked. This records risk; it does not pass that dependent feature's live acceptance. Later phase gates remain blocked if their required live capabilities are unverified.
- “Done” requires the stated acceptance evidence, standards/spec reviews, resolved blocking findings, and human acceptance. Once Git exists, it also requires merge and integrated verification. A mock only proves test behaviour, never live SMS, screen sharing, or Savanna compatibility.
- Automated checks below describe **planned verification targets**, not existing command names or tests already run. T3-001 establishes documented commands; each later issue adds the relevant executable checks and records the actual invocation/result.
- `Baseline` is required scope. `Stretch` is not a blocker for submission. Employer features are lowest priority and require a separate future spec before becoming ready.

## Phase gates and issue map

| Phase | Issues | Exit gate |
|---|---|---|
| 0 — Foundation and risk checks | T3-001–004 | Reproducible runtime/checks, enforceable identity isolation, recorded external dependency findings and escalations |
| 1 — Accessible grounded assistant | T3-005–009 | Authorised learner completes an accessible cited text-tutoring journey; insufficient evidence and offline FAQ paths are honest |
| 2 — Voice and messaging | T3-010–015 | Editable speech input, readable/spoken output, linked Telegram, durable delivery and verified outbound SMS transport |
| 3 — Human help and careers | T3-016–023 | Persistent support workflow, controlled screen sharing, job answers/alerts/accommodation requests, and retention enforcement |
| 4 — Submission readiness | T3-024–027 | Measured load/security/accessibility evidence, clean installation and Savanna integration, complete submission package |
| 5 — Optional improvements | T3-028–032 | Each optional feature passes its own checks without regressing the baseline; no stretch feature delays submission |

The initial parallel frontier is T3-001, T3-002, and T3-003. Subsequent frontiers follow the dependencies below; the phase-entry rule applies even when an issue does not list every previous-phase ID.

## Phase 0 — Foundation and risk checks

### T3-001 — Boot the reproducible workspace and establish checks

**Phase:** 0 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** None · **Type:** Implementation

**Build:** A minimal running TypeScript workspace: Fastify health/readiness endpoint, React/Vite entry point, PostgreSQL with an initial migration path, pnpm workspace, and Docker Compose. Establish actual build, type-check, unit/integration-test and browser-test commands. Use the agreed module layout only where a running slice needs it.

**Done when:**
- A clean checkout starts using documented commands and placeholder-only environment configuration; database readiness is checked rather than assumed from startup order.
- Configuration rejects missing required values clearly; secrets are not bundled into browser assets or committed.
- Commands fail on a deliberately broken focused check. PR CI configuration is prepared for the future repository without claiming it ran on GitHub.
- README records exact commands and supported versions chosen from current compatible stable documentation.

**Automated verification:** Run the documented build/type-check/test commands; verify readiness changes appropriately when the database is unavailable.  
**Human verify:** Follow the README on a clean environment and load the web page and health endpoint without undocumented setup.

### T3-002 — Record the actual Savanna integration contract

**Phase:** 0 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** None · **Type:** Operational evidence, no app feature

**Deliver:** Inspect the supplied starter and document the authoritative authentication, learner/course scope, embedding/CSP, microphone/screen-capture permissions, source-content access, and launch/run contracts. Identify available browser/device testing resources and the organiser's required submission format/licence.

**Done when:**
- Findings distinguish observed starter behaviour, organiser-confirmed requirements, and unresolved questions; no invented Savanna API is recorded as fact.
- The iframe/short-lived identity handoff design is checked against the starter; incompatibilities are escalated before integration code is committed.
- Unavailable starter/resources are recorded as external blockers with a next action and dependent acceptance gate, not reported as successful integration.
- The required accessibility checklist and any mobile screen-sharing exception are requested; absence remains visible.

**Automated verification:** None unless the supplied starter has runnable documented checks; record any actual invocation/result.  
**Human verify:** Another team member can distinguish confirmed contracts from unresolved integration blockers using the evidence record alone.

### T3-003 — Prove or explicitly block live integration dependencies

**Phase:** 0 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** None · **Type:** Operational feasibility evidence

**Deliver:** Time-boxed feasibility checks for approved Ethiopian SMS access, Amharic/English speech candidates, Telegram access, HTTPS hosting, and desktop screen-sharing connectivity/relay infrastructure. Do not provision paid services without approval.

**Done when:**
- Record the usable SMS sender/provider, credentials-access owner without secret values, route restrictions, and real delivery evidence if available; otherwise mark T3-015/T3-021 externally blocked.
- Speech candidates are checked for language, formats, consent, cost/retention and practical access; provider quality is not inferred from a marketing language list.
- Desktop capture and relay needs are distinguished from unsupported Android web capture. Record organiser acceptance status for the mobile fallback separately.
- Hosting is confirmed or remains unconfirmed; a local Compose run is not called a public HTTPS deployment.
- Any incomplete check has a concrete escalation/next action and downstream gate. This evidence issue may finish while a live capability remains blocked.

**Automated verification:** Only available sandbox/capability probes; label sandbox results.  
**Human verify:** Review evidence and identify which later live acceptance checks are currently possible, blocked, or untested.

### T3-004 — Enforce learner identity and per-user/course access

**Phase:** 0 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-001, T3-002 · **Type:** Implementation

**Build:** Institution-scoped authentication/authorisation with a small host identity adapter and separate learner/support permissions. Provide clearly separated demo accounts for local checks, not a new registration/password-reset product.

**Done when:**
- The server derives learner and permitted course scope from validated credentials, never an arbitrary browser-supplied learner/course ID.
- Invalid, expired or wrong-audience handoff credentials fail safely; long-lived secrets do not appear in browser configuration, URLs or logs.
- Learner A cannot access learner B's records; support permissions cannot be obtained through learner input.
- Demo authentication is explicitly identified and disabled outside its configured demo mode. Unverified Savanna integration remains disabled, pending T3-026.
- Interfaces and failure responses are documented for feature developers; avoid relying on third-party cookies alone for embed identity.

**Automated verification:** Authentication tests using two learners and one support account, including forged scope and expired credential cases.  
**Human verify:** Sign in as each demo role and attempt the documented forbidden cross-user action; observe denial without leaked content.

## Phase 1 — Accessible grounded learning assistant

### T3-005 — Import approved lessons with resolvable citation targets

**Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-001, T3-004 · **Type:** Implementation

**Build:** A small repeatable import path for approved lesson content, its course permissions, stable source/section IDs, language, and displayable citation targets. Begin with non-sensitive Amharic/English fixtures; no crawler or content-management dashboard.

**Done when:**
- Reimporting the same source does not duplicate records; updated/removed content cannot silently remain the authoritative answer source.
- Retrieved content is scoped to the learner's permitted course and has a valid supporting section link.
- Missing/malformed sources fail visibly without corrupting existing approved content.
- Citation destinations enforce the same content access rules; import provenance distinguishes demo from organiser-provided material.

**Automated verification:** Import/reimport, invalid-source, cross-course retrieval and citation-resolution tests using approved fixtures.  
**Human verify:** Import a sample lesson, open its cited section, and verify another learner without course permission cannot retrieve it.

### T3-006 — Ship the accessible standalone assistant and script-loaded iframe

**Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-001, T3-004 · **Type:** Implementation

**Build:** An independently testable learner-interface foundation plus a small script loader that inserts the assistant iframe into a plain host page. Share the learner UI with a standalone route; isolate host styling without duplicating business logic. Use explicitly labelled deterministic message/error fixtures for this issue; the real grounded conversation is delivered and verified by T3-007.

**Done when:**
- Keyboard users can open, navigate and close the assistant with visible focus and predictable return focus; controls have accessible names.
- New messages are announced without stealing focus or repeatedly reading partial/duplicate content; RTL/LTR messages and Ethiopic text remain legible.
- Cross-frame messages validate sender, exact origin and schema; credentials are not blindly accepted from loader attributes.
- Permission denial, expired identity, slow requests and network failure have readable recovery states; user text is rendered safely.
- Embedding requirements, teardown/reinitialisation behaviour and standalone fallback are documented.

**Automated verification:** Browser tests on standalone and two distinct-origin host fixtures, including forged messages, focus handling and axe scans.  
**Human verify:** Load the standalone page and embedded host with the authorised test handoff, open/close by keyboard, inspect labelled synthetic message/error states, and verify focus restoration and announcements. This proves the interface/embedding foundation, not a live tutor.

### T3-007 — Answer course questions with evidence or honest refusal

**Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-005, T3-006 · **Type:** Implementation

**Build:** The AskQuestion use case with authorised retrieval, course-grounded answers/citations, and a replaceable answer-provider interface demonstrated by an online provider and curated FAQ provider. Select the online provider through a bounded current evaluation, not a universal SOTA claim.

**Done when:**
- Representative Amharic/English supported questions return source-backed answers and resolvable citations; missing evidence produces a clear limitation, not invented content.
- External-processing consent is obtained before sending any query/context to a provider; refusal/unavailability selects the labelled FAQ capability, not disguised model output.
- Course scope is enforced before provider invocation. Retrieved prompt-injection text cannot authorise actions or override course grounding.
- Timeout/provider failure returns an actionable state; rejected/failed messages do not appear as successfully answered.
- Record evaluation inputs, expected behaviour and actual results for grounding, refusal, language quality, latency and cost. A provider swap preserves the use-case interface.

**Automated verification:** Deterministic behaviour tests with controlled provider responses plus a separately labelled live evaluation using approved fixtures.  
**Human verify:** Ask one supported and one unsupported question in each language, follow citations, then decline cloud processing and observe the honest fallback.

### T3-008 — Provide lightweight text access and offline approved FAQs

**Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-005, T3-006, T3-007 · **Type:** Implementation

**Build:** The standalone low-bandwidth text route and a same-origin cache of approved FAQ/content explicitly authorised for non-restricted offline distribution. Do not claim an arbitrary embedding host can reload offline. Course approval alone does not make restricted material eligible for the shared-device cache.

**Done when:**
- After an explicit initial content load, the standalone page can reopen offline and show/search approved Amharic/English FAQ content.
- The UI distinguishes offline/local content from live tutor, human-help and delivery capabilities that are unavailable offline.
- Private conversations, credentials, accommodation content and personal responses are excluded from persistent offline caches.
- Restricted course sections are also excluded. On logout/account switch, another learner can access only the explicitly offline-distributable material, never the previous learner's protected sources. Restricted offline course access requires a separate approved design.
- Cache updates/invalidations do not continue presenting withdrawn approved content as current when online; first-time offline users see an honest unavailable state.
- Record measured download behaviour on the chosen low-bandwidth profile and avoid mandatory audio/video downloads for text use.

**Automated verification:** Browser offline/reload/cache-inspection, shared-device logout/account-switch, restricted-source exclusion and online recovery checks.  
**Human verify:** Load FAQ content, disconnect, reopen, read an answer, then reconnect without being misled about live assistance.

### T3-009 — Validate the Phase 1 accessible bilingual journey

**Phase:** 1 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-005, T3-006, T3-007, T3-008 · **Type:** Validation and focused fixes

**Deliver:** A co-designer-led check of the complete text-tutoring journey with focused regression fixes. Establish reusable evidence capture; this is not a substitute for Phase 4's complete final gate.

**Done when:**
- A learner can ask, read/hear the new-message announcement, open a citation, encounter missing evidence and use the FAQ path without assistance on the relevant test setups.
- Keyboard-only, 200% zoom, sound-off, NVDA and TalkBack results are recorded honestly, including unavailable devices and unresolved issues.
- Amharic/Ethiopic rendering, mixed-direction content and displayed local date/time conventions are reviewed with the co-designer; calendar/localisation gaps are recorded against the spec rather than guessed.
- Zero critical/serious axe findings on the tested baseline views; automated results are not represented as a WCAG certification.

**Automated verification:** Run the Phase 1 end-to-end/axe suite and focused regression tests for fixes.  
**Human verify:** Co-designer attempts the agreed main task unaided; record task, device, assistive technology, outcome and observations.

## Phase 2 — Voice and messaging

### T3-010 — Add consented voice input with review before sending

**Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-003, T3-006, T3-007 · **Type:** Implementation

**Build:** Amharic/English microphone input through a replaceable transcription adapter; evaluate actual language quality using approved speech fixtures. Recording creates an editable transcript, not an automatic submission.

**Done when:**
- Learner explicitly starts/stops recording, reviews/edits the transcript, and separately sends or discards it.
- Microphone and external speech-processing consent are understandable; denial, unsupported format, empty audio, oversize/overlong input and timeout preserve a usable text path.
- Cap recording size/duration, validate actual supported formats, and remove local temporary audio after success, cancellation and failure.
- No claim of on-device/offline transcription unless actually demonstrated; provider retention/cost limitations are documented.

**Automated verification:** Recording-state/adapter tests for send-after-review, consent denial, format/limit rejection and temporary-file cleanup.  
**Human verify:** Speak both languages on the target device, correct a transcription error, discard another recording, and confirm only the explicitly submitted text reaches the tutor.

### T3-011 — Read answers aloud without removing text access

**Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-003, T3-006, T3-007 · **Type:** Implementation

**Build:** Optional Amharic/English spoken answers with a replaceable speech-output adapter and accessible playback controls. Keep the cited text answer authoritative and usable without sound.

**Done when:**
- Playback starts only on learner action; pause/stop are keyboard accessible, and speech does not obscure new-message announcements.
- Cloud synthesis is consented; failure, missing language support or muted sound leaves the complete text/citation path available.
- Sample output is checked for intelligibility with an appropriate speaker; unsupported quality is not presented as verified Amharic support.
- Audio output does not add uncited claims or speak unrelated private content; relevant temporary resources are cleaned up.

**Automated verification:** Playback-control, consent, output/text association and speech-provider-failure tests.  
**Human verify:** Read and listen to the same answer in each language, stop playback by keyboard, then complete the task with sound off.

### T3-012 — Link Telegram securely and reuse text tutoring

**Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-003, T3-004, T3-007 · **Type:** Implementation

**Build:** A Telegram adapter that securely links a learner and invokes the same tutoring use case rather than implementing a second assistant.

**Done when:**
- Short-lived single-use account linking cannot be replayed or used to link another learner; usernames alone are never identity proof.
- Sender/chat identity and inbound update authenticity are validated; duplicate updates do not create duplicate requests or side effects.
- Private course content is not posted to unapproved group chats. Consent is channel-appropriate and checked before external AI processing.
- Text answers preserve language, citations and missing-evidence behaviour; unlinking prevents subsequent access through the old association.
- No bot tokens or raw conversation bodies appear in logs or fixture files.

**Automated verification:** Linking/replay, cross-user, group-chat restriction, duplicate-update and adapter/use-case consistency tests.  
**Human verify:** Link a real test Telegram account, ask a supported question, follow its citation, unlink, and confirm protected course access is denied.

### T3-013 — Support Telegram voice with explicit transcript review

**Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-010, T3-011, T3-012 · **Type:** Implementation

**Build:** Telegram voice input/output using the existing speech use cases and adapters, with an explicit approve/edit/discard transcript interaction before asking the tutor.

**Done when:**
- Validate retrieved media and limits rather than trusting sender-supplied MIME metadata; normalize only when the chosen provider needs it.
- Duplicate updates/callbacks cannot submit the transcript twice; an old transcript cannot be approved as another user's request.
- Unsupported or inaccessible media returns a text alternative. Temporary audio is removed on every terminal outcome.
- Spoken output is optional, consented, supported by the current Telegram API, and accompanied by the complete cited text.

**Automated verification:** Media validation, transcript ownership/review, duplicate-callback and cleanup regression tests.  
**Human verify:** Send a voice note, review/correct the transcript, approve it, and receive readable text with optional supported audio; repeat with a discarded transcript.

### T3-014 — Persist delivery work and recover safely from failures

**Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-001, T3-004 · **Type:** Implementation

**Build:** A small PostgreSQL-backed delivery queue/worker with transactional enqueue, deduplication keys, bounded retries, claim/recovery rules and visible terminal or uncertain states. No Redis, Kafka or general workflow engine.

**Done when:**
- A committed action and its required delivery work are not silently separated by a process crash; work survives restart.
- Multiple worker attempts cannot concurrently own the same live claim; abandoned claims recover using a documented policy.
- Known retryable failures are bounded; unsubscribe/authorisation is rechecked before dispatch.
- Provider idempotency is used when available. Timeout after possible provider acceptance is tracked as uncertain and not blindly resent where duplicates cannot be excluded.
- Logs/statuses expose failure metadata without message bodies or contact details; the implementation has a documented reconciliation path.

**Automated verification:** Database-backed crash/restart, concurrent-claim, duplicate-enqueue, cancelled-subscription and ambiguous-send tests with controlled adapters.  
**Human verify:** Interrupt a test delivery, restart, and inspect its recovered/uncertain state without claiming a mock proves real transport.

### T3-015 — Verify real outbound SMS through the approved route

**Phase:** 2 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-003, T3-014 · **Type:** Implementation plus live evidence

**Build:** An SMS adapter for the actually approved Ethiopian sending route, integrated with durable delivery and explicit recipient consent. Inbound SMS tutoring is out of scope; the standalone text route satisfies that channel need.

**Done when:**
- Sender/account access and carrier constraints are verified; record live receipt on a consented test handset, not merely HTTP acceptance.
- Validate destination and text limits; test Amharic/Unicode handling and document segmentation/cost implications without promising free delivery.
- Map provider acceptance, delivery, failure and uncertain outcomes honestly; credentials remain server-side.
- A test double is clearly labelled and cannot enable production sending or satisfy this acceptance check.
- Without approved credentials/route or live evidence, this issue and the Phase 2 gate remain blocked.

**Automated verification:** Adapter contract tests for payload validation, response mapping, failures and safe retry behaviour.  
**Human verify:** Send a consented English and Amharic test message through the real route and record handset receipt and actual delivery status.

## Phase 3 — Human help and careers

### T3-016 — Create private asynchronous help requests and a persistent inbox

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-004, T3-006, T3-007 · **Type:** Implementation

**Build:** One-click entry to human help, a clear review of context shared with support, and persistent request/reply history with unread indicators. Requesting help never starts screen capture.

**Done when:**
- The learner sees waiting/assigned/resolved/cancelled state and can leave, return, and cancel without losing the recorded request.
- Only the explicitly shared context enters the support request; unrelated private chat history is not visible to support.
- Repeated clicks/network retries do not create duplicate requests; learner A cannot inspect or cancel learner B's request.
- If no person is available, show an honest waiting state without a response-time promise. Without notification opt-in, explain that the learner must return to check replies.

**Automated verification:** Persistence/reload, duplicate-submit, state transition and cross-user/context-disclosure tests.  
**Human verify:** Request help, leave the page, reopen it, inspect the same pending request and cancel it; confirm no screen-sharing permission prompt appeared.

### T3-017 — Let support claim, reply and notify asynchronously

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-012, T3-014, T3-016 · **Type:** Implementation

**Build:** A protected support console for authorised queue access, exclusive claims, replies and resolution. Add optional linked-Telegram reply notifications and lightweight meeting coordination within the conversation.

**Done when:**
- Concurrent claims assign a request once; unauthorised staff/learners cannot access request contents or act as the assigned responder.
- Replies persist and mark unread for the learner; delivery failures do not erase the reply or falsely report a notification as delivered.
- Telegram notices require opt-in and linking, contain only a generic reply notification, and open an authorised return path without exposing private content.
- Learner and staff can propose/confirm a meeting time in conversation using clearly labelled Addis Ababa time. No booking engine, calendar sync, call platform or reminder guarantee is implied.
- Cancellation/resolution and staff reconnects produce coherent states without silent reopening or duplicate replies.

**Automated verification:** Concurrent claim, role restrictions, notification consent/privacy, reply recovery and state-transition tests.  
**Human verify:** Close the learner browser, claim/reply as staff, receive an opted-in generic Telegram notice, then reopen and read the actual reply; coordinate a meeting by text.

### T3-018 — Share a supported desktop screen under learner control

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-002, T3-003, T3-016, T3-017 · **Type:** Implementation plus live evidence

**Build:** Screen sharing attached to an authorised help session, with authenticated signalling and verified connectivity/relay configuration. Remote control and recording are excluded.

**Done when:**
- Only the learner explicitly initiates capture and chooses the browser-provided source; staff cannot force capture or join another request's session.
- A persistent sharing indicator and accessible stop control are present. Cancel, request closure, permission revocation or disconnection ends the stream; reconnect needs fresh permission.
- Demonstrate a real supported desktop connection across different networks, not only on one machine/LAN.
- Unsupported mobile browsers retain text help and disclose the limitation. Any organiser-approved alternative is recorded; no unapproved fallback is called equivalent screen sharing.
- Media is not recorded; credentials and relay configuration are not hard-coded or leaked.

**Automated verification:** Authorisation, session lifecycle/stop, denied-permission and unsupported-browser behaviour with controlled media/signalling tests.  
**Human verify:** Share a chosen desktop tab to authorised staff across networks, stop, disconnect and attempt rejoin; verify no capture resumes automatically.

### T3-019 — Import approved jobs and answer job questions with citations

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-005, T3-007, T3-012 · **Type:** Implementation

**Build:** Repeatable approved job-record ingestion with stable job IDs, category, location, publication/expiry metadata and a valid source link. Route job questions to this approved collection, separate from course tutoring.

**Done when:**
- Reimports/updates do not duplicate jobs; malformed records and missing required publication data are rejected visibly.
- Web and Telegram can answer supported job questions using approved records and citations; missing facts are acknowledged rather than fabricated.
- Expired/withdrawn roles are not presented as currently open or eligible for new alerts; availability/status changes are reflected consistently.
- The interface distinguishes job evidence from course evidence; external web search is not introduced by this issue.

**Automated verification:** Import/reimport, expiry/withdrawal, cited job answer and course/job routing tests.  
**Human verify:** Import one open and one expired job, ask about both through web/Telegram, then update the open job and verify the answer uses current approved data.

### T3-020 — Subscribe to matching jobs and deliver Telegram alerts

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-012, T3-014, T3-019 · **Type:** Implementation

**Build:** Explicit per-channel job subscriptions using category/location filters, deterministic matching for newly published jobs, durable enqueue and Telegram delivery. No AI ranking or disability-profile inference.

**Done when:**
- Only opted-in, securely linked learners receive matching alerts; filter changes affect future eligibility according to the documented rule.
- Reimporting or processing the same job event twice does not enqueue duplicate learner/job/channel alerts.
- Expired jobs and unsubscribed recipients are excluded again at dispatch time, including already queued work.
- Each alert identifies the job and offers an accessible unsubscribe path; alert data does not expose private support information.
- Known failures and uncertain outcomes remain inspectable without falsely claiming exactly-once delivery across external systems.

**Automated verification:** Match/non-match, duplicate publication, expiry-before-send, unsubscribe-before-send and ownership tests.  
**Human verify:** Subscribe a real test Telegram user, publish matching/non-matching fixtures, receive only the eligible alert, then unsubscribe before another queued send.

### T3-021 — Deliver subscribed job alerts by real SMS

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-015, T3-019, T3-020 · **Type:** Implementation plus live evidence

**Build:** SMS job subscriptions and alert delivery using the approved transport, shared matching/deduplication policy and durable queue. Bind a phone destination through a safe verified/explicitly established ownership route; do not let one learner silently subscribe someone else's number.

**Done when:**
- SMS subscription consent is separate from Telegram consent; recipients can unsubscribe without requiring Telegram.
- Eligible jobs produce readable size-bounded alerts with a usable job reference/link; Amharic content survives the actual route.
- Deduplication, expiry, cancellation and uncertain-send handling are preserved rather than reimplemented inconsistently in the SMS adapter.
- A real subscribed test handset receives an eligible job alert and receives no new dispatch after unsubscribe; screenshots/logs used as evidence redact personal data.
- Missing credentials or real delivery evidence blocks this issue; a simulated inbox is not acceptance.

**Automated verification:** Destination ownership/consent, shared matching, Unicode payload, deduplication and unsubscribe-before-send checks.  
**Human verify:** Subscribe a consented handset, publish a matching job, receive the real alert, unsubscribe, and verify no dispatch occurs for a subsequent job.

### T3-022 — Request interview accommodations through a coordinator

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-016, T3-017, T3-019 · **Type:** Implementation

**Build:** A learner-controlled accommodation request associated with an approved job and routed to an authorised support coordinator. Employer dashboards and automatic employer outreach are excluded.

**Done when:**
- The learner selects a job, describes the support needed, and reviews the exact request and intended recipient before submitting.
- Diagnosis, medical documents and disability disclosure are not mandatory; unrelated tutoring history is not attached.
- Only the learner and authorised coordinator can read/change the request; repeat submits do not duplicate it.
- Submission, cancellation and response states are clear and persist across reload; no employer transmission occurs as a hidden side effect.
- Notifications contain only generic status information, not accommodation text.

**Automated verification:** Explicit-confirmation, access-control, duplicate-submit, cancellation and no-unapproved-outreach tests.  
**Human verify:** Draft, edit and submit a request without medical information, review it as the coordinator, and confirm another learner cannot access it.

### T3-023 — Enforce retention and deletion across private records

**Phase:** 3 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-010, T3-013, T3-017, T3-021, T3-022 · **Type:** Implementation

**Build:** Actual cleanup and learner history-clearing behaviour for the agreed seven-day default conversation/help-content retention. Keep policy/configuration explicit; settle any unspecified retention clock/operational exception before introducing real data rather than silently extending retention.

**Done when:**
- The documented policy specifies the retention anchor, included records, approved institution overrides and how cleanup runs after process downtime.
- Expired/private content is removed from stored messages, help context and pending delivery payloads as applicable; no worker resurrects deleted content.
- Learners can clear their own conversation history but cannot delete another learner's data. Unsubscribed contact data is removed once no longer needed for authorised remaining use.
- Voice temporary files are cleaned on all terminal paths; private data is not retained in offline caches or routine logs.
- Provider-side retention is disclosed separately; local deletion is never claimed to delete third-party copies automatically.

**Automated verification:** Controlled-clock expiry, explicit history clearing, restart cleanup, queued-payload deletion, cross-user denial and audio cleanup tests.  
**Human verify:** Age test records using the documented test fixture, run cleanup, and verify private content disappears while unaffected authorised records remain usable.

## Phase 4 — Submission readiness

### T3-024 — Measure concurrent-user behaviour and recovery

**Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-007, T3-014, T3-017, T3-020, T3-023 · **Type:** Validation and focused fixes

**Deliver:** Reproducible measurement with 20 simultaneous active learner sessions and a configurable limit on concurrent AI requests. Separate deterministic load tests from consented/cost-approved live provider checks.

**Done when:**
- Record workload, duration, hardware, provider mode, concurrency configuration, latency/error observations and actual results; do not claim capacity for thousands of concurrent users.
- No cross-user leakage, duplicate side effects or lost durable requests occur in the tested workload; one user's rate cannot bypass shared/per-user limits.
- Provider slowness/outage, database interruption and worker restart produce understandable failure/recovery states without unbounded retry growth.
- Security regressions exercise forged scopes, linked-channel replay and sensitive-data logging risks using the implemented interfaces.
- Any unresolved failure has an issue and blocks the affected acceptance gate; fixes get focused regression checks rather than weakening assertions.

**Automated verification:** Run the documented load/fault scenario and relevant integration/security suites; retain sanitized measurements.  
**Human verify:** Observe simultaneous learner/support flows while slowing the provider and restarting the worker; compare UI states to recorded backend outcomes.

### T3-025 — Complete the co-designer accessibility gate and conformance evidence

**Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-009, T3-010, T3-011, T3-016, T3-017, T3-018, T3-022 · **Type:** Human/device validation and focused fixes

**Deliver:** A final main-task test covering tutoring and the agreed help/career journey, plus a truthful WCAG 2.2 AA conformance report with evidence, limitations and unresolved findings.

**Done when:**
- Co-designer successfully completes the agreed mandatory main tasks unaided using the required NVDA, TalkBack, keyboard-only, 200% zoom and sound-off setups; record device/browser/assistive technology and task outcomes. An attempt without successful completion does not satisfy this criterion.
- Tested views have zero critical/serious axe findings. Automated scans complement rather than replace human/device tests.
- Review Amharic/Ethiopic rendering, RTL mixed text, local date/time/calendar expectations and low-bandwidth phone behaviour against the spec; no unsupported locale claim appears in the report.
- Unsupported mobile capture and its organiser acceptance status are explicitly reported; absent approval is not rewritten as full conformance.
- Fixes are rechecked by the affected test/user journey; unavailable testing resources are marked unverified, not passed.
- A truthful draft report may contain failures or unavailable checks, but this issue and its phase gate remain blocked until all required checks pass or an explicit organiser-approved change to the requirement is recorded.

**Automated verification:** Run final browser/axe suite and relevant regression checks.  
**Human verify:** Co-designer repeats the main task independently; another team member reconciles the report with actual evidence and open findings.

### T3-026 — Prove clean installation, Savanna integration and portable interfaces

**Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-002, T3-006, T3-007, T3-012, T3-018, T3-022, T3-023 · **Type:** Integration and installation validation

**Deliver:** A clean-install path a stranger can follow, real Savanna launch/identity integration, a script-tag installation on another site and accurate REST/OpenAPI documentation generated or maintained from actual implemented contracts.

**Done when:**
- A teammate installs the submitted version from README/Compose within the judging target of one hour; record elapsed time and fixes, not a guessed duration.
- Savanna's actual identity/course restrictions and embed permission/CSP rules are tested; a standalone demo is not called Savanna integration.
- Script-tag installation works on an independent host without requiring its application stack; documented permissions and identity setup are sufficient.
- OpenAPI describes implemented validation, authentication, errors and relevant endpoints; examples do not contain secrets or bypass access controls.
- Installation documents distinguish local FAQ mode from live services requiring credentials, HTTPS, approved SMS route and relay infrastructure; missing dependencies stay visible.

**Automated verification:** Clean-environment startup/smoke checks, contract validation and cross-origin integration tests using the real supported launch contract.  
**Human verify:** A teammate unfamiliar with setup follows only the submission docs, loads the assistant inside Savanna and a separate host, and completes the core journey.

### T3-027 — Assemble and audit the submission package

**Phase:** 4 · **Priority:** Baseline · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-024, T3-025, T3-026 · **Type:** Release/documentation evidence

**Deliver:** Code, README, Docker Compose, conformance report, approved licence, requirement-to-issue/evidence mapping, sanitized evaluation results and the end-to-end demonstration plan. Final packaging must reflect the actual submitted revision.

**Done when:**
- Every mandatory requirement maps to completed acceptance evidence. An honest draft package may list unresolved blockers, but it cannot complete this issue, pass the baseline gate, or unlock Phase 5 until required live and human/device checks pass (or an explicit approved requirement change is recorded).
- Adopt the open licence actually specified by ALX; do not invent licensing permission. Document attribution and third-party dependency/provider requirements.
- Rerun documented checks for the submitted revision and record passed/failed/unverified accurately; do not copy stale evidence from an earlier build.
- The demo includes cited Amharic tutoring, a limitation/fallback, asynchronous help, learner-controlled sharing on supported hardware, and the job/accommodation journey.
- No real credentials, private chats, handset identifiers or medical information are included. Standards/spec reviewers and human acceptance checks are recorded.

**Automated verification:** Run the complete documented release-check command set; inspect the final package for accidental secrets/private fixtures.  
**Human verify:** Rehearse the demonstration from the submission instructions and verify the package against the organiser's actual submission instructions.

## Phase 5 — Optional work after baseline acceptance

### T3-028 — Add explicit supplementary career web research

**Phase:** 5 · **Priority:** Stretch · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-027 · **Type:** Implementation; provider choice requires bounded evaluation

**Build:** A separate, disabled-by-default career web-research mode. It is optional for both delivery and learner use, not a silent fallback when the course tutor lacks evidence.

**Done when:**
- The learner explicitly selects the mode and approves external processing before a minimal query leaves the host; private history and accommodation text are excluded.
- Results show genuine external source links and a clear distinction from approved course/job records; unsupported claims are not dressed up as citations.
- Retrieved web text cannot override instructions, modify approved content, create subscriptions or trigger actions.
- Provider failure returns to a clear unavailable state; course mode stays strictly course-grounded regardless of search availability.

**Automated verification:** Mode separation, consent, query minimization, external-source rendering, injection and no-side-effect tests.  
**Human verify:** Ask an unsupported course question and confirm no search occurs; explicitly enter career-research mode and inspect its external citations.

### T3-029 — Add learner-selected simple-language mode

**Phase:** 5 · **Priority:** Stretch · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-027 · **Type:** Implementation

**Build:** A learner-controlled simple-language presentation/answer mode using short, understandable language without changing approved factual scope or making sensitive literacy assumptions.

**Done when:**
- Learner can enable/disable it accessibly; the mode does not remove citations, consent detail or necessary limitations.
- Simplified answers remain supported by the same evidence and do not invent meaning; unsupported content still receives an honest limitation.
- Amharic/English examples are evaluated with intended users rather than asserting that shorter text automatically improves comprehension.

**Automated verification:** Preference handling, grounding/citation preservation and accessibility regression checks.  
**Human verify:** Co-designer compares the same task in both modes and records whether comprehension improves without losing essential information.

### T3-030 — Show anonymous frequently asked topics to authorised teachers

**Phase:** 5 · **Priority:** Stretch · **Status:** Planned · **Owner:** Unassigned  
**Depends on:** T3-027 · **Type:** Needs privacy-focused detail before implementation

**Build:** A minimal authorised teacher view of aggregate frequently asked topics, without names or raw question/conversation exports. Agree a suppression/aggregation policy before implementing; hiding names alone is not anonymisation.

**Done when:**
- The approved policy prevents displaying identifiable free text, rare/sensitive questions and accommodation content; personal transcripts are not retained simply to serve analytics.
- Access is authorised and course-scoped; aggregates cannot be drilled down to a learner.
- Retention/deletion policies and low-count behaviour are explicit and covered by tests.

**Automated verification:** Role/course isolation, suppression and no-personal-fields tests against synthetic inputs.  
**Human verify:** Seed synthetic common and uniquely identifying questions, then verify the teacher view shows only approved aggregate output.

### T3-031 — Future spec: employer dashboard

**Phase:** 5 · **Priority:** Lowest-priority stretch · **Status:** Needs future spec · **Owner:** Unassigned  
**Depends on:** T3-027 · **Type:** Parked planning issue, not implementation-ready

**Scope boundary:** User explicitly deferred an employer dashboard. Before implementation, grill and approve employer identity/verification, job ownership, accommodation-request access, consent, moderation and retention. Existing learner/support roles do not imply employer authorisation.

**Done when:** A separately approved bounded spec identifies the actual employer journey, data access and testable acceptance criteria, then splits any implementation into focused PR issues. This issue's completion means the spec is approved, not that a dashboard exists.

**Automated verification:** None for this planning issue; the future spec must define actual behaviour checks.  
**Human verify:** Review that proposed employer access cannot expose learner records or accommodation details without explicit authorised consent.

### T3-032 — Future spec: consented employer outreach

**Phase:** 5 · **Priority:** Lowest-priority stretch · **Status:** Needs future spec · **Owner:** Unassigned  
**Depends on:** T3-027 · **Type:** Parked planning issue, not implementation-ready

**Scope boundary:** User explicitly deferred automatic employer outreach. No sending is authorised by this backlog entry. Before implementation, approve verified recipient ownership, exact learner review/consent, channel policy, abuse prevention, cancellation, uncertain delivery and data-retention rules. A dashboard is not assumed to be a prerequisite unless the approved design needs it.

**Done when:** A separately approved bounded spec and dependency-aware implementation slices exist, with explicit prevention of unapproved disclosure or repeated external messages. Completion means planning approval, not outreach capability.

**Automated verification:** None for this planning issue; future acceptance must exercise consent, recipient verification, deduplication and delivery failures.  
**Human verify:** Walk through the proposed send/cancel/error journey and confirm that neither a support request nor a model answer can silently contact an employer.
