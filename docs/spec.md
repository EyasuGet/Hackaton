# Track 3 implementation specification

Status: agreed product/design decisions translated into an implementation specification on 2026-11-14. No application has been built or verified. The approved decomposition is published as GitHub issues linked from the local index, not completed work.

## Goal

Build an accessible learning-and-career assistant that one institution can install for many learners. A learner asks a course question in Amharic or English, receives a supported answer, and can get human assistance without remaining online. The same installation supports approved job information, opt-in alerts, and interview-accommodation requests.

Success is a working learner journey with evidence, not a set of screens, a model benchmark, or a simulated integration. Reserve early and retest sessions with the available co-designer pool; do not assume a dedicated participant is continuously available. Product behaviour lives here; technical design lives in [architecture.md](architecture.md); PR-sized acceptance criteria live in the GitHub issues linked from [issues.md](issues.md).

## External brief and scope

The [official brief](https://digitalbridge.et/#apply) requires a cited Amharic/English voice/text tutor grounded in course material; web and Telegram access; a low-bandwidth SMS/text route; accessible announcements and RTL; human escalation with learner-controlled screen sharing; replaceable AI; Telegram/SMS job alerts, accommodation requests, and job answers. Integration must work in the supplied Savanna starter and be reusable. The accessibility gate includes NVDA, TalkBack, keyboard, 200% zoom, sound off, zero critical/serious axe findings, and a WCAG 2.2 AA report. Submission includes code, README, Docker Compose, and conformance evidence. The public page mentions a larger required-feature checklist; obtain it from organisers rather than claiming this document reproduces an unseen checklist.

We target script embedding and documented REST/OpenAPI. Additional standards integration is not baseline work. The supplied starter is a static capture, not a live identity/content API; see [source and meeting evidence](savanna-reconciliation.md). Hosting, production Savanna contracts, SMS access, speech-provider suitability and relay infrastructure remain unconfirmed.

### Approved delivery scope — 2026-11-14

- **Core / Baseline:** accessible web text/voice tutor, cited approved content, standalone/embedded paths, public-only offline FAQ, asynchronous help and supported desktop sharing, **web job Q&A and coordinator-routed accommodation requests**, isolation, privacy, accessibility and measured reliability.
- **Time-permitting:** Telegram tutor/text/voice and Telegram/SMS alerts, including generic Telegram help notices and the delivery infrastructure they need. The user approved this prioritisation, not an organiser waiver. Omitted written-required capabilities remain explicit submission gaps. The requirements below still define their behaviour if built.
- **Implementation home:** keep application code in Hackathon. Use the pinned official static pages as the integration host with minimal documented, sanitised changes and approved asset/content reuse. Keep the assistant/backend separate; no stack rewrite or upstream fork is required.
- **Identity:** use clearly labelled, server-controlled synthetic demo sessions with learner/staff roles and course grants. Captured profile names, DOM IDs and tokens never authenticate anyone. Real production Savanna identity integration is a later adapter (T3-004-B); its absence cannot be described as production-ready SSO. Organiser acceptance of this demonstration boundary remains unresolved.
- **AI choices:** the user confirms no models are provided. T3-003-B explicitly researches available answer/retrieval/speech candidates, followed by measured bilingual evaluations in the owning issues. No model, framework, paid access or local-model deployment is selected by this update.
- **Sequence:** finish core and its evidence at T3-027-D, then final packaging, hosted MVP and explanatory slides at T3-027-A/E/F. Minimal secure hosting/relay tests happen earlier where core media evidence requires them. Full written-brief readiness is a separate T3-027-C gate, blocked by missing mandatory capabilities or required organiser acceptance.

True Phase 5 enhancements (web search, simple mode, insights and employer work) remain behind the full-brief gate. Time-permitting leaves may run when ready without delaying core completion or final packaging; no whole-phase waiting barrier is introduced.

## Actors and access

- **Learner:** accesses their own conversations, subscriptions, notifications, and help requests within their permitted course context.
- **Support person:** institution-authorised; sees minimal waiting-request information needed to claim work and content of requests they are authorised to handle. Cannot browse unrelated learner conversations.
- **Content operator:** imports institution-approved lessons/jobs through a controlled import path. No content-management dashboard in the baseline.
- **Institution/host:** establishes identity/course access and configures deployment and providers. A browser-supplied learner or course ID is never proof of access.

One installation supports multiple users, not multiple independently administered institutions. Cross-user isolation is required from the first persisted learner feature. Demonstration identities must be visibly separated from real identity configuration.

## Product requirements

### R01 — Grounded tutoring

1. Select a permitted course/context and language. Ask by text; voice enters this same flow after transcript review.
2. Retrieve only authorised, approved source material. Pass the relevant evidence to the selected answer provider, not an unrestricted corpus or a user's entire history.
3. Return an answer with source identifiers/sections which the application resolves to accessible citations. The model does not invent arbitrary citation URLs.
4. If the evidence does not support the answer, say so, identify the limitation, and offer human help. A valid citation ID alone is not proof that its passage supports the claim; evaluate support as well as existence.
5. Course answers never silently fall back to internet search. Job answers use approved job records and clearly disclose unavailable or expired information.
6. Treat source content and user text as untrusted data, not system instructions. No model-generated tool action may subscribe, contact employers, or disclose information without the relevant explicit user flow.
7. Render answers as safe text or sanitised supported formatting. Preserve readable Ethiopic characters and mixed-script text.

### R02 — Voice and languages

- Amharic and English are baseline answer/interface paths. RTL handling must work for mixed-direction messages; this does not promise full translation into every language named in the brief.
- Record only after consent and a user action. Show capture state and a stop control. Validate actual audio format, duration, and size before provider processing.
- Display the recognised transcript for editing before it is sent as a question. If recognition fails, preserve a usable typed path.
- Spoken answers supplement readable answers; playback is user-controlled and never the only way to receive information.
- Local raw audio is temporary and removed after success, failure, or cancellation. Provider-side retention/processing disclosures are separate from local deletion.
- Choose speech providers through the evaluation procedure, including real Amharic speakers; browser speech support alone is not evidence of acceptable Amharic quality.

### R03 — Web, embed, Telegram, and offline

- A small script loads an isolated assistant iframe; a standalone lightweight assistant page uses the same application behaviour.
- Host handoff validates origin, identity, intended audience, expiry, and course scope. The static demo uses our protected synthetic-session bootstrap; a future production Savanna adapter follows a verified host contract once supplied.
- Telegram uses the same application use cases. Secure one-time linking associates a channel account with a learner; names/usernames do not authenticate a learner. Duplicate events do not duplicate effects.
- The standalone page offers an approved, versioned FAQ cache after an explicit online preparation step. Only content explicitly authorised for non-restricted offline distribution is eligible; approval for a restricted course is not permission to cache it for everyone using the device. On offline reload it labels itself as offline and does not claim to contact a person, send alerts, or generate fresh cloud answers.
- Cache no private conversations, restricted course sections, credentials, accommodation text, or contact details by default. Account switching/logout must not expose the previous learner's protected content. Restricted offline course access needs a separate approved design. An embedded script does not make arbitrary host pages work offline.
- The lightweight web text path fulfils the selected low-bandwidth interaction route. Outbound job SMS remains a distinct written-brief requirement, now time-permitting for team delivery; inbound SMS tutoring is not baseline work.

### R04 — Asynchronous human help

1. The learner chooses what relevant context to share, sees that preview, and submits a help request in one action after the disclosure is clear. Avoid a questionnaire before assistance.
2. The server persists the request and shared context. Closing the page or restarting the application does not lose it.
3. Display `waiting`, `assigned`, `resolved`, or `cancelled`. A support person claims a waiting request atomically; concurrent claims cannot create two active owners.
4. Learner and authorised support person exchange persisted messages. Show unread replies on return without sharing unrelated conversations.
5. When the time-permitting notification feature is enabled and the learner opts in and links Telegram, send a generic notification that a reply is available. Do not include message bodies or accommodation details. Without that feature or external notification opt-in, explain that they must return to the inbox.
6. Do not promise a response time or always-online staffing. Cancellation prevents new handling; any queued notice must check whether it is still appropriate.
7. Meeting coordination is a proposal and confirmation in the conversation, with time expressed unambiguously in Addis Ababa time. No calendar booking, availability engine, automatic reminders, or built-in video meeting feature.

### R05 — Learner-controlled screen sharing

- Only an authorised participant in an active support interaction can request a sharing session. Requesting human help does not automatically capture a screen.
- The learner explicitly starts sharing using the browser picker, sees sharing status, and can stop immediately. No recording, remote control, or silent reconnection.
- Stop tracks and invalidate the session when sharing is stopped, access is revoked, the request closes, or the connection is lost. Reconnection requires fresh learner action/permission.
- Test across distinct networks, not only on one development laptop. A TURN/relay configuration may be necessary.
- Unsupported phone browsers keep the asynchronous help path usable and state the limitation. This is not equivalent to mobile screen sharing; organiser acceptance of the limitation/alternative remains an external gate.

### R06 — Careers and accommodation requests

Web job answers and coordinator accommodation requests are core. The subscription/matching/delivery requirements below belong to time-permitting alerts, without weakening their safety when enabled.

- Approved jobs include a stable source ID, title, category, location, source link, and validity information sufficient to distinguish active/expired records. Preserve provenance and record updates; do not fabricate vacancies.
- Answer job questions from those records, with sources. Keep job evidence separate from course evidence and authorised appropriately.
- Learners explicitly subscribe by channel and selected category/location filters. Match deterministically on newly published jobs; do not infer disability or use opaque AI profiling.
- Support both Telegram and actual outbound SMS delivery. Verify the intended destination and consent before enabling delivery; record opt-out independently of any conversation history.
- A learner/job/channel combination produces at most one logical alert. Delivery retries and unknown provider outcomes are handled as specified in the architecture, without falsely promising exactly-once external delivery.
- Recheck subscription, cancellation, and job validity before sending. Make unsubscribe accessible without requiring an SMS reply where the route is one-way.
- A learner selects a job and writes the support requested, reviews the recipient and exact content, then confirms submission. The baseline recipient is an authorised support coordinator. No diagnosis or proof is required.
- Direct employer delivery is excluded from baseline. A verified employer destination and separate learner confirmation are prerequisites if later implemented.

### R07 — Privacy, lifecycle, and consent

- Explain external processing and offer the approved FAQ path when consent is declined or the external provider is unavailable. Do not pretend the fallback has the same abilities.
- Minimise the data leaving the host. A hosted AI choice requires real agreement to that processing; browser/Telegram/provider infrastructure are not implicitly private.
- Default conversation/help content retention is seven days. The retention implementation must explicitly document the expiration anchor, apply it consistently, and demonstrate expiry with a controlled clock; confirm the anchor with the institution before real data use rather than silently extending storage for unresolved requests.
- Allow learners to clear their conversation history. Remove expired/deleted content from derivatives such as notification payloads and private caches; content needed by an authorised shared help request must have an explicit lifecycle, not an accidental hidden copy.
- Retain alert contact details only while needed for the subscription; unsubscribe cancels queued sends. Minimal non-content deduplication/audit records must have a documented purpose and bounded retention.
- Keep tokens, audio, bodies, personal contact information, and accommodation details out of routine logs. Document provider retention separately; deleting a local copy does not prove deletion elsewhere.

### R08 — Accessibility and Ethiopia-fit

- All primary actions work by keyboard, with meaningful labels/errors, visible focus, logical focus restoration, and non-disruptive new-message announcements.
- Readable layout at 200% zoom; sound-off use retains all information; RTL and mixed-direction text remain understandable. Announcements must not repeatedly read streamed partial output or steal focus.
- Test real desktop NVDA and Android TalkBack paths with the co-designer. Automation assists but does not replace the unaided-task gate.
- Treat a slow/failed connection as normal: keep input where safe, show pending/error states, allow intentional retry, and avoid duplicate submissions. Avoid persisting sensitive drafts by default.
- Use appropriate language tags and Ethiopic-capable fonts, with legible fallback. Where dates are displayed, retain unambiguous Addis Ababa scheduling and verify Ethiopian-calendar presentation against known fixtures; do not invent a calendar conversion.

### R09 — Reliability, capacity, and adoption

- When notification features are implemented, business actions and their pending notification work commit atomically. A backend restart does not erase pending deliveries.
- Bound attempts and provider timeouts, recover abandoned work, and expose unresolved failures to authorised operators without leaking payloads.
- Validate 20 simultaneously active learner sessions with configurable AI concurrency limits. This is an initial measured test target, not a capacity claim for unspecified hosting.
- A clean install must start with documented configuration, migrations, readiness checks, and non-sensitive fixtures. Provide an operational FAQ-only mode without paid keys and clearly identify which live acceptance checks need credentials.
- Document REST/OpenAPI and script integration. Static Savanna integration requires the actual supplied starter, not a lookalike host page; it does not prove live platform identity integration.

## Optional backlog, after the full written-brief gate

- Explicit opt-in career web research with source links and a visibly different provenance label. Never send private history/accommodation details in search context; fetched text is untrusted and cannot trigger actions. No silent course fallback.
- Plain-language simple mode and anonymous FAQ insights, only with an approved privacy-safe design.
- Employer dashboard and automatic employer outreach are lowest priority, deferred for a separate approved spec. They are not authorised to contact anyone merely because a backlog item exists.

## Out of scope

Multi-institution SaaS administration, billing, microservices, Kubernetes, new general-purpose authentication platform, universal document-management UI, inbound SMS tutoring, automated calendar scheduling, remote desktop control, screen recording, universal mobile browser capture, unbounded web agents, and unsupported scale claims.

## Implementation sequence and done

Use phases 0–4 as delivery milestones and prioritise ready baseline work by explicit dependencies in [issues.md](issues.md), not a blanket previous-phase barrier. When blocked, record/escalate the blocker and pick another ready baseline issue, agree a needed contract slice, or pair on the prerequisite. Risk discovery can be complete with a named unresolved dependency, but the affected live capability cannot be marked complete. The core gate remains strict for core behaviour; the separate full written-brief gate includes mandatory deferred channels and required organiser acceptance. Optional Phase 5 waits for the latter.

An issue is done only when its acceptance criteria have evidence, relevant automated and human checks are reported honestly, and independent standards/spec AI findings are resolved. Evidence-only leaves follow the [backlog completion rule](issues.md#how-to-use-this-backlog); a reviewed result without a repository change does not need an empty PR. The following PR/merge requirements apply to code or documentation changes. The PR author reviews against the current implementation and applicable overall decisions using the template, signs off/merges their own PR within action authorisation and repository protections, and verifies integration afterward. No separate teammate PR approval is required; co-designer/device acceptance remains mandatory. A simulated provider is useful test infrastructure, never proof of a real provider's delivery or language quality.

The core demonstration follows one learner from cited lesson answer, through reviewed voice input and asynchronous human help, to a sourced web job answer and a reviewed accommodation request. Show supported sharing, the offline limitation and at least one failure recovery. Show real Telegram/SMS interactions only if implemented and verified; otherwise disclose those gaps. Final hosting/slides follow core completion; a full-brief completion claim additionally requires real channel evidence. See [verification.md](verification.md).

## Requirement-to-issue map

The original IDs below resolve to epics or bounded tasks in [issues.md](issues.md); epics retain integrated acceptance and contain claimable child tasks. This is a coverage index, not a second issue-status tracker; leaf priorities and the delivery-scope section distinguish core from deferred channels.

| Requirement | Principal implementing / proving issues |
|---|---|
| R01 Grounded tutoring | T3-005, T3-007, T3-019 |
| R02 Voice and languages | T3-010, T3-011, T3-013 |
| R03 Web, embed, Telegram, offline | T3-002, T3-004, T3-006, T3-008, T3-012, T3-026 |
| R04 Async help | T3-016, T3-017 |
| R05 Screen sharing | T3-003, T3-018 |
| R06 Careers and accommodations | T3-019, T3-020, T3-021, T3-022 |
| R07 Privacy/lifecycle | T3-007, T3-010, T3-014, T3-023 |
| R08 Accessibility/Ethiopia-fit | T3-006, T3-009, T3-025 |
| R09 Reliability/adoption/capacity | T3-001, T3-014, T3-015, T3-024, T3-026, T3-027 |
| Optional enhancements | T3-028–032; never prerequisites for the mandatory release |
