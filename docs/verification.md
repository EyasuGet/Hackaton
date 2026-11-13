# Verification plan and evidence procedure

Status: **NOT RUN — documentation-only workspace.** No package scripts, application, database schema, credentials, or device test results exist yet. Commands below describe the command contract bootstrap must establish, not commands claimed to work today.

## Command contract

Bootstrap must provide documented, reproducible commands for dependency installation, lint/typecheck, focused unit tests, real-PostgreSQL integration tests, application build, browser tests, and Compose startup/migration/readiness. Use the actual package-script names once implemented; link to their configuration rather than maintaining a second conflicting command list here. CI invokes those same commands before merge once a repository exists.

Live provider checks must be clearly separate from deterministic CI. Missing credentials produce an explicit unverified/blocked result; a mock pass cannot be substituted. Do not put secrets or real learner records in fixtures.

## Layers of proof

| Layer | Exercises | Expected proof |
|---|---|---|
| Focused unit | Domain invariants and use cases through their interfaces | Deterministic assertions for the changed behaviour; useful regression fails if fix is removed |
| Integration | Real PostgreSQL, transactions, uniqueness, claims, expiry, restart | Effects survive restart, competing workers cannot double-claim, action/outbox commit together |
| HTTP/channel contract | Auth/scopes, schema/errors, replay handling | Cross-user requests rejected, invalid messages safe, repeated events have one logical effect |
| Browser | Real web/iframe/standalone flows | Keyboard paths, focus, errors, privacy disclosures, offline transitions, safe rendering |
| Accessibility automation | axe in important rendered states | Zero critical/serious findings, with scope and tool version recorded |
| Human/device | NVDA, TalkBack, 200% zoom, sound off, co-designer | Main tasks completed unaided; failures documented rather than inferred from automation |
| Provider/live | Amharic speech, Telegram, Ethiopian SMS destination, relay | Actual output/receipt and language review on specified devices/network |
| Adoption | Clean machine and supplied Savanna starter | Stranger follows README, installs within judge's one-hour target, runs the journey |

## Acceptance scenarios

### V01 — Grounding and content access

Use two learner accounts with different course access. Ask an answerable question in Amharic and English, follow the returned citation, and confirm the passage supports the answer. Ask an out-of-corpus question and expect an explicit limitation, not internet fallback. Repeat with forged course/source IDs, a malicious instruction inside a source, and an invented citation from a test provider. No unauthorised text or trusted fake source may appear. Include cross-language evidence and model-unavailable/consent-declined cases.

### V02 — Voice and accessible interaction

On actual target devices, grant/deny microphone access, record a short utterance, edit the transcript, then submit. Confirm no question is submitted before review, audio controls work by keyboard, and sound-off users lose no content. Test bad/oversized audio and cancellation. A real Amharic speaker judges recognition and spoken output; language tags in a provider response are not quality evidence.

### V03 — Embed and offline

Load the script in a fixture host and the real Savanna starter. Test valid/invalid/expired/replayed identity handoffs and incorrect message origins. Open/close with keyboard and verify focus return. After explicitly caching FAQ content authorised for non-restricted offline distribution on the standalone page, disconnect and reload it; FAQs remain readable with an offline label, while human help/alerts are not falsely reported as sent. Inspect caches for absence of private content, restricted course sections, and credentials. Log out and switch accounts on the same device; the second learner must not gain access to the first learner's protected sources. Reconnect and perform an intentional retry without duplicate effects.

### V04 — Async help, notifications, and sharing

Create a help request with selected shared context, close the learner's page, restart the backend, and have two staff sessions try to claim it. Exactly one claim succeeds. Reply; the returning learner sees an unread message. An opted-in linked Telegram account gets only a generic notice; an opted-out learner gets none. Unauthorised staff/learners cannot read the request. Propose/confirm an Addis Ababa meeting time in the chat without claiming calendar booking.

Start screen sharing on a supported desktop over separate networks. Stop, disconnect, revoke access, and close the request; capture/session access must end. Reconnection does not silently resume. An unsupported phone clearly reports the limitation and keeps text help usable. Record organiser acceptance separately; do not mark mobile screen sharing passed.

### V05 — Careers, actual alerts, and consent

Import known active and expired jobs. Subscribe a consenting learner to category/location matches on Telegram and SMS. Publish a matching job; confirm a real Telegram message and receipt on the consenting SMS destination, preserving provider evidence separately from receipt. Replay the import/event; no second logical alert. Unsubscribe before a queued send and verify suppression. Job questions cite the correct active source. Preview an accommodation request and recipient; cancel without sending, then explicitly confirm to the authorised coordinator. No employer is automatically contacted.

### V06 — Delivery and retention failures

Crash between business commit and delivery, during a lease, and after a provider may have accepted a request. Work recovers, duplicate claims are rejected, and unknown outcomes do not cause blind resend. Force timeout/rate-limit/permanent failure and verify bounded retry plus visible safe status. Never label acceptance as confirmed delivery without provider/recipient evidence.

Use a controlled clock to expire content according to the documented seven-day policy anchor. Confirm deletion from conversation/help storage and sensitive delivery payloads/derivatives; unrelated active subscriptions continue without preserving expired content. Clear history and unsubscribe. Inspect logs for tokens, audio, contact details, and body leakage. Document backup/provider limitations instead of asserting universal erasure.

### V07 — Accessibility and measured load

Run axe and human checks on empty/loading/answer/error/refusal/help/unread/subscription/accommodation states, not only the home page. Test English, Amharic, mixed RTL, keyboard-only, visible focus, 200% zoom, sound off, real NVDA, and real TalkBack. Co-designer observations include whether assistance was required.

Exercise 20 concurrent authenticated learner sessions and exceed the configured AI concurrency limit deliberately. Confirm no cross-user response mix-up, bounded pending work, explicit rejection/waiting states, and continued health. Record actual hardware, provider configuration, throughput, errors, and latency distribution. Choose any pass thresholds before the run; do not invent measured speed or claim unspecified hosting capacity.

### V08 — Clean installation and final handoff

A teammate unfamiliar with the code installs from the README in a clean environment using only documented configuration. Demonstrate migrations, readiness, public embed, OpenAPI, FAQ-only operation without paid keys, and the real-provider requirements. Record install time and failures. Verify supplied Savanna integration, licence choice, submission contents, and all mandatory evidence before declaring complete.

## Evidence entry template

Copy into the owning issue/PR, not a second status tracker:

- Issue and reviewed revision/file snapshot:
- Scenario / acceptance criterion:
- Exact command or manual steps:
- Environment, device/browser/provider versions and configured limits:
- Expected result:
- Actual result: PASS / FAIL / BLOCKED / NOT RUN:
- Sanitised evidence location:
- Human verifier/co-designer and whether assistance was needed:
- Remaining limitation and responsible owner:

A failure is a product/implementation issue to fix, not permission to weaken the test or report. Re-run affected checks after material fixes and obtain independent standards/spec review of the resulting revision.
