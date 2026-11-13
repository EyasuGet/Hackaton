# Decision register

Agreed through the design interview, synthesised 2026-11-14. [spec.md](spec.md) owns product rules; [architecture.md](architecture.md) owns the target technical design. This register records why choices are fixed and which choices remain delegated or externally blocked.

## Locked choices

| ID | Decision | Reason / consequence |
|---|---|---|
| D01 | One institution's installation, multiple isolated learners | Reusability without multi-tenant SaaS administration |
| D02 | Mandatory baseline before optional enhancements | A broad demo cannot substitute for missing required behaviour |
| D03 | Dependency-driven baseline work across phases; strict final release gate | Revised by the user: phases are milestones, not team-wide waiting barriers; record blockers and pick ready work |
| D04 | TypeScript, React/Vite, Fastify, PostgreSQL, pnpm, Compose | One language, portable install, small operational footprint |
| D05 | Feature-first Clean Architecture, OO backend, SOLID, explicit injection | Testable business behaviour without generic frameworks; functional React remains idiomatic |
| D06 | Iframe loaded by script plus standalone lightweight page | Host-style isolation and a defined offline surface |
| D07 | Course evidence only; approved job evidence; real citations | Unsupported answers must fail honestly, not fall back silently |
| D08 | Optional career web research is separate, consented, disabled by default | Preserve grounding and avoid sending private history to search |
| D09 | Provider selection is evidence-led and replaceable; FAQ fallback | 'SOTA' means best verified fit to current constraints, not newest or largest |
| D10 | Institution-controlled identity and explicit channel linking | Browser IDs and Telegram usernames cannot establish authorisation |
| D11 | Durable async help/inbox, optional generic Telegram notices | Learners need not remain online; no always-available staffing claim |
| D12 | Meeting proposals/confirmations in chat only | No scheduling product or automatic reminders in the baseline |
| D13 | Learner-controlled supported-desktop screen sharing | No recording/remote control; mobile alternatives need organiser acceptance |
| D14 | Approved jobs, deterministic opt-in alerts, coordinator-routed accommodations | No inference of sensitive traits or unsolicited employer contact |
| D15 | Durable PostgreSQL delivery queue, safe retries and uncertain-outcome handling | Restart recovery without a new distributed queue platform |
| D16 | External-processing consent, short retention, minimal logs | Seven-day content default; local deletion does not imply provider deletion |
| D17 | 20 active-session validation target | Measure on actual hardware, do not claim untested production scale |
| D18 | Author reviews/merges own PR using template and standards/spec AI reviewers | No teammate PR approval; check current implementations and overall decisions, preserve independent axes and actual repository protections |
| D19 | Smallest correct change; independent check against weakened tests | Explicitly replaces reference project's broad touched-code cleanup rule |
| D20 | Local Markdown issue bodies until explicit GitHub issue migration | Repository is now published at the user's request; issue creation/assignment is still not authorised implicitly |
| D21 | Employer dashboard/outreach are lowest-priority future specs | No implied permission to build a new actor model or send messages |

## Decisions implementation agents may make

Within the locked design, inspect the current project and choose compatible dependency versions, concrete library usage, private class/function names, database query/migration tooling, indexes, and request delivery mechanics. Research consequential unfamiliar choices against current primary sources. Prefer an existing working dependency over adding a new one.

Answer/speech providers, multilingual retrieval technique, and relay/SMS adapters require an early evaluation or contract check. The owning issue records alternatives, costs, data processing, limitations, and actual results before integration. These choices cannot silently add paid resources, disclose new data, eliminate mandatory behaviour, or change application interfaces used by another issue.

Reopen only a concrete unresolved choice or a demonstrated conflict with the approved spec. Bring the smallest decision, a reasonable recommendation, and its evidence. Do not repeat the whole architecture interview for each issue.

## External gates and remaining precision checks

| Gate | Current state | Required evidence / treatment |
|---|---|---|
| Savanna | Starter/auth/CSP contracts not inspected | Run actual starter, verify identity scope and embed permissions; fixture-only integration is insufficient |
| Organiser feature checklist | Public page references a fuller list | Obtain checklist; map discrepancies to issues; ask before expanding scope or claiming complete conformance |
| Hosting | No commitment confirmed | Establish HTTPS/public callbacks, database storage, secrets, and relay/network requirements; Compose remains portable |
| SMS | No provider/sender credentials or destination delivery verified | Obtain approved route; send to consenting Ethiopian test destination; test opt-out; distinguish provider acceptance from receipt |
| Voice/AI | No selected provider has passed evaluation | Human-reviewed bilingual evidence, format support, refusal/citation tests, processing consent, budget authorisation |
| Screen sharing | Android browser limitation known; actual infrastructure untested | Desktop cross-network proof and organiser response on mobile alternative; do not declare requirement waived |
| Co-design devices | No device/OS/browser inventory or gate run recorded | Test real NVDA/TalkBack, keyboard/zoom/sound-off journeys; record device versions and unaided outcome |
| Retention policy precision | Seven-day default agreed; timestamp anchor not specified | Confirm creation-vs-activity anchor with institution before real data; prove purge, shared-copy, backup/provider handling; no silent extension |
| Open licence | Organiser names it at kick-off | Apply specified compatible licence; inspect third-party asset/model licences before publishing |
| Team logistics | No organiser eligibility/attendance confirmation recorded here | Team handles attendance/training/selection questions; software docs do not establish eligibility |

Phase 0 may finish an investigation by recording a named external blocker and the evidence needed to resolve it. This is not completion of the blocked live feature. Follow the [blocked-work procedure](issues.md#when-work-is-blocked): choose ready baseline work across phases without waiting for a whole phase to finish. Explicit dependencies, live acceptance, and the final baseline-before-stretch gate remain binding; changing a real dependency or shared contract still needs agreement.

## Reference workflow provenance

Adapted from the user's local `sophia-verse/sail3-backend` workflow inspected read-only at commit `7cdd83060310b4fffe8c75c09feb826d06f563aa` on branch `SAIL3-318-session-persistence` (not a claim of remote freshness). Retained interview-to-spec, vertical PR slices, fresh review, before/after evidence, independent standards/spec checks, and fix-guard intent.

Approved differences: Jira becomes a local backlog then GitHub; `develop`/staging becomes issue branches into `main` once Git exists; .NET/backend-specific rules become selected-stack rules; broad cleanup becomes minimal change; consequential research becomes explicit; private planning becomes shared docs; fixed vendor model names are removed; developer docs are English while product content is multilingual. Portable reviewer Markdown is an instruction source, not proof of automatic agent registration by any tool.
