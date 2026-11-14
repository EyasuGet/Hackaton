# Verification plan and evidence procedure

Status: **Early implementation.** Only the T3-001 foundation (web-to-API slice, PostgreSQL migrations and readiness, lint/format/unit/integration/browser checks), T3-004-A demo identities (principal/grant schema and a fixture-only record table) and T3-005-A lesson import (versioned lesson schema) exist; see the [README runtime section](../README.md#runtime-setup) for actual commands. No learner-feature schema, provider credentials, or device test results exist yet. The contract below is now met by those commands; later issues extend it.

## Command contract

Bootstrap must provide documented, reproducible commands for dependency installation, lint/typecheck, focused unit tests, real-PostgreSQL integration tests, application build, browser tests, and Compose startup/migration/readiness. Use the actual package-script names once implemented; link to their configuration rather than maintaining a second conflicting command list here. CI invokes those same commands before merge once a repository exists.

Live provider checks must be clearly separate from deterministic CI. Missing credentials produce an explicit unverified/blocked result; a mock pass cannot be substituted. Do not put secrets or real learner records in fixtures.

## Test-writing rules

Use these rules when selecting tests and during author-led standards/spec review. The acceptance scenarios below are risk coverage, not instructions to repeat the same assertion at every layer.

1. **Name the risk first.** Each new test must prove a specific acceptance criterion, meaningful failure path, or regression risk. Its name and assertions must describe the same observable behaviour. No tests added solely for test count or a coverage target.
2. **Inspect existing coverage.** Extend a relevant test/fixture when it already exercises the path. Add a new case only for a distinct condition or outcome. Preserve useful existing tests; remove/consolidate a duplicate only after demonstrating that its unique coverage is retained.
3. **Use the lowest sufficient layer.** Unit-test a business rule; use a real-database integration test for transactions/locking; use browser tests for user interaction and accessibility. Repeat across layers only for a separate integration risk, and explain that risk in the PR.
4. **Assert outcomes, not implementation trivia.** Prefer returned results, persisted changes, permitted/denied access, and user-visible effects. Avoid tests of private methods, arbitrary call counts, internal ordering, getters, framework behaviour, or formatting unless the requirement explicitly makes them observable. Outbound send count is meaningful when proving no duplicate delivery.
5. **Cover meaningful boundaries.** Choose realistic valid, invalid, boundary, and failure cases only where behaviour differs. For example, test a duplicate job event or cancelled subscription, not many equivalent strings just to add cases. Parameterise genuinely equivalent logic with distinct inputs instead of copying whole tests.
6. **Make failures sensitive.** A regression test should fail without the fix; verify this where practical and record it. Assert the actual effect, not only that a promise resolved or a mock returned the value configured by the test.
7. **Keep tests deterministic and independent.** Control time, randomness and external responses; isolate fixtures/records. Avoid arbitrary sleeps and execution-order dependencies. Do not mock the behaviour under test; fake external dependencies at real interfaces. Real provider/device evidence remains a separate requirement.
8. **Keep setup proportional.** Reuse current test infrastructure and minimal synthetic fixtures. Add a helper/dependency only when the present test needs it. Large snapshots must not replace targeted behavioural assertions or be blindly regenerated after a failure.
9. **Match checks to the change.** Run focused checks first and documented regression/pre-merge checks afterward. Documentation-only changes need link, diagram, dependency, and instruction-consistency checks as applicable, not artificial application tests. Report unavailable checks honestly.

The PR's test rationale identifies each added/changed test's distinct risk and any deliberate cross-layer overlap. A failed check is a defect to diagnose, not permission to delete assertions, skip a useful case, or label a mock as live evidence.

## Layers of proof

| Layer | Exercises | Expected proof |
|---|---|---|
| Focused unit | Domain invariants and use cases through their interfaces | Deterministic assertions for the changed behaviour; useful regression fails if fix is removed |
| Integration | Real PostgreSQL, transactions, uniqueness, claims, expiry, restart | Effects survive restart, competing workers cannot double-claim, action/outbox commit together |
| HTTP/channel contract | Auth/scopes, schema/errors, replay handling | Cross-user requests rejected, invalid messages safe, repeated events have one logical effect |
| Browser | Real web/iframe/standalone flows | Keyboard paths, focus, errors, privacy disclosures, offline transitions, safe rendering |
| Accessibility automation | axe in important rendered states | Zero critical/serious findings, with scope and tool version recorded |
| Human/device | NVDA, TalkBack, 200% zoom, sound off, co-designer | Main tasks completed unaided, using the [co-designer task script](co-design-task.md); failures documented rather than inferred from automation |
| Provider/live | Amharic speech, Telegram, Ethiopian SMS destination, relay | Actual output/receipt and language review on specified devices/network |
| Adoption | Clean machine and supplied Savanna starter | Stranger follows README, installs within judge's one-hour target, runs the journey |

## Acceptance scenarios

Apply these to the declared delivery scope. T3-027-D requires core evidence; T3-027-C additionally requires written-mandatory Telegram/SMS evidence and required organiser acceptance. Deferred channels are NOT BUILT/UNVERIFIED coverage gaps, not passed or waived requirements. Any enabled time-permitting feature must pass affected safety/privacy/accessibility checks before release; changed shared code requires relevant core retests. Record partial-channel evidence with the owning feature, core gate and applicable conformance report without waiting for unrelated unbuilt channels. T3-023-D/T3-025-D aggregate the complete channel scope for full-brief acceptance, not a prerequisite for each partial release. T3-004-B alone proves later production Savanna identity. No check below has run yet.

### V01 — Grounding and content access

Use two learner accounts with different course access. Ask an answerable question in Amharic and English, follow the returned citation, and confirm the passage supports the answer. Ask an out-of-corpus question and expect an explicit limitation, not internet fallback. Repeat with forged course/source IDs, a malicious instruction inside a source, and an invented citation from a test provider. No unauthorised text or trusted fake source may appear. Include cross-language evidence and model-unavailable/consent-declined cases.

### V02 — Voice and accessible interaction

On actual target devices, grant/deny microphone access, record a short utterance, edit the transcript, then submit. Confirm no question is submitted before review, audio controls work by keyboard, and sound-off users lose no content. Test bad/oversized audio and cancellation. A real Amharic speaker judges recognition and spoken output; language tags in a provider response are not quality evidence.

### V03 — Embed and offline

Load the script in an independent fixture host and the pinned official static Savanna pages served over controlled HTTP(S). Use our server-controlled synthetic sessions and test valid/invalid/expired/replayed demo bootstraps and incorrect message origins. Open/close with keyboard and verify focus return. After explicitly caching FAQ content authorised for non-restricted offline distribution on the standalone page, disconnect and reload it; FAQs remain readable with an offline label, while human help/alerts are not falsely reported as sent. Inspect caches for absence of private content, restricted course sections, and credentials. Log out and switch accounts on the same device; the second learner must not gain access to the first learner's protected sources. Reconnect and perform an intentional retry without duplicate effects. Record sanitisation, approved source/assets, exact origins and deployed headers; reject `null` origins. Do not claim live Savanna authentication from a static-host pass; future host SSO needs its own contract and live evidence.

### V04 — Async help, notifications, and sharing

Create a help request with selected shared context, close the learner's page, restart the backend, and have two staff sessions try to claim it. Exactly one claim succeeds. Reply; the returning learner sees an unread message. If Telegram notices are implemented, an opted-in linked account gets only a generic notice and an opted-out learner gets none. Otherwise show the core return-to-inbox path and record external notices as absent. Unauthorised staff/learners cannot read the request. Propose/confirm an Addis Ababa meeting time in the chat without claiming calendar booking.

Start screen sharing on a supported desktop over separate networks. Stop, disconnect, revoke access, and close the request; capture/session access must end. Reconnection does not silently resume. An unsupported phone clearly reports the limitation and keeps text help usable. Record organiser acceptance separately; do not mark mobile screen sharing passed.

### V05 — Careers, actual alerts, and consent

Core: import known active and expired jobs, answer web job questions with valid sources, and preview/cancel/confirm a request to the authorised coordinator. No employer is automatically contacted.

Time-permitting/full-brief extension: subscribe a consenting learner to category/location matches on Telegram and SMS. Publish a matching job; confirm a real Telegram message and receipt on the consenting SMS destination, preserving provider evidence separately from receipt. Replay the import/event; no second logical alert. Unsubscribe before a queued send and verify suppression. Telegram job questions cite the same authorised active sources. Reuse core accommodation checks rather than duplicating them unnecessarily.

### V06 — Delivery and retention failures

When delivery features are enabled: crash between business commit and delivery, during a lease, and after a provider may have accepted a request. Work recovers, duplicate claims are rejected, and unknown outcomes do not cause blind resend. Force timeout/rate-limit/permanent failure and verify bounded retry plus visible safe status. Never label acceptance as confirmed delivery without provider/recipient evidence.

Core regardless of delivery scope: use a controlled clock to expire content according to the documented seven-day policy anchor. Confirm deletion from conversation/help storage and implemented derivatives; when alerts exist, include sensitive delivery payloads, verify active subscriptions do not preserve expired content, and unsubscribe. Always verify history clearing and temporary audio/cache cleanup. Inspect logs for tokens, audio, contact details, and body leakage. Document backup/provider limitations instead of asserting universal erasure.

### V07 — Accessibility and measured load

Run axe and human checks on core empty/loading/answer/error/refusal/help/unread/job/accommodation states and subscription/channel states when implemented, not only the home page. Test English, Amharic, mixed RTL, keyboard-only, visible focus, 200% zoom, sound off, real NVDA, and real TalkBack. Co-designer observations include whether assistance was required.

Exercise 20 concurrent authenticated learner sessions and exceed the configured AI concurrency limit deliberately. Confirm no cross-user response mix-up, bounded pending work, explicit rejection/waiting states, and continued health. Record actual hardware, provider configuration, throughput, errors, and latency distribution. Choose any pass thresholds before the run; do not invent measured speed or claim unspecified hosting capacity.

### V08 — Clean installation and final handoff

A teammate unfamiliar with the code installs from the README in a clean environment using only documented configuration. Demonstrate migrations, readiness, public embed, OpenAPI, FAQ-only operation without paid keys, and the real-provider requirements. Record install time and failures. Verify supplied static-host integration and core evidence at T3-027-D. After that, T3-027-A/E/F finish the licence/package, reachable hosted MVP and explanatory deck. Test the final URL from a fresh external browser and check deck links/claims against the submitted revision; early secure media testing is not final publication. T3-027-C separately checks all written-mandatory evidence and required organiser acceptance before declaring full-brief completion. A core-only package must disclose its Telegram/SMS and production-integration limits.

## Evidence entry template

Copy into the owning issue/PR, not a second status tracker:

- Issue and reviewed revision/file snapshot:
- Delivery scope / gate (core, full brief or later production integration):
- Scenario / acceptance criterion:
- Exact command or manual steps:
- Environment, device/browser/provider versions and configured limits:
- Expected result:
- Actual result: PASS / FAIL / BLOCKED / NOT RUN:
- Sanitised evidence location:
- Human verifier/co-designer and whether assistance was needed:
- Remaining limitation and responsible owner:

A failure is a product/implementation issue to fix, not permission to weaken the test or report. Re-run affected checks after material fixes and obtain independent standards/spec review of the resulting revision.
