# Track 3 issue index and execution guide

Migrated 2026-11-14: **110 GitHub issues (26 tracking epics, 84 leaf tasks)**, created in dependency order and verified unassigned. [GitHub issue bodies](https://github.com/abnsol/Hackathon/issues?q=is%3Aissue+sort%3Acreated-asc) are now authoritative for task scope, dependencies, acceptance, status and evidence. This file is the stable ID/link index and shared execution guide, not a second copy of issue bodies. No application implementation or completed acceptance is implied.

The approved pre-migration snapshot remains in [Git history at 1251f85](https://github.com/abnsol/Hackathon/blob/1251f85ab101ea744de97c2da86dc130d56130ba/docs/issues.md), for provenance only. Some forward references in original issue bodies use stable-ID issue searches; use the exact issue links below to disambiguate. This migration uses linked bodies and epic child checklists, not native GitHub blocking/sub-issue relationships.

## How to use this backlog

- Product scope is defined in [the spec](spec.md); technical decisions in [the architecture](architecture.md). Use the linked GitHub issue for current task-specific rules; update it rather than recreating a local issue body.
- Preserve each stable `T3-NNN` ID and the mapping below. Check existing IDs before creating future issues. Do not silently change all issues to In Progress or assign them to one person.
- Each implementation leaf is intended to be one independently verifiable PR; epics are not implementation assignments or giant PRs. If current code reveals that a slice cannot fit one PR, propose a split preserving its acceptance criteria and dependencies before implementing it.
- At migration, all leaves were **Planned / unassigned**, except explicitly marked **Needs future spec**; consult GitHub for current state. A team member claims one ready issue before starting; one issue has one implementation owner who also owns its review and merge. Others may pair, but another teammate's PR approval is not a prerequisite.
- Baseline leaf tasks are ready when their explicit dependencies are complete and their own prerequisites are available. Pick the earliest ready baseline issue across phases; phase numbers group delivery milestones, not team-wide start barriers. Time-permitting leaves may proceed when ready only without delaying the core or final packaging. True Phase 5 stretch still requires the full T3-027 epic and any future-spec approval.
- Phase 0 feasibility checks may complete with an evidenced external blocker, an escalation path, and a dependent issue marked blocked. This records risk; it does not pass that dependent feature's live acceptance. A milestone remains incomplete while its required capabilities are unverified, without freezing unrelated baseline issues.
- “Done” requires the stated acceptance evidence, independent standards/spec review of the relevant change/evidence, resolved blocking findings, and required human/device checks. Code or documentation changes also require author-led template sign-off, applicable CI, authorised merge and integrated verification. An evidence-only leaf with no repository change closes when its owner records the actual result, reviewed revision, environment, evidence location and required human verifier in the authoritative issue or relevant PR, with its acceptance met and evidence reviewed as part of that feature/assessment. No empty standalone PR/merge is required. A mock never proves live SMS, screen sharing or Savanna compatibility. An epic closes only after all children and its integrated acceptance pass; the final child owner coordinates and records that epic proof.
- Automated checks in the issue bodies describe **planned verification targets**, not existing command names or tests already run. T3-001 establishes documented commands; each later issue adds the relevant executable checks and records the actual invocation/result.
- `Baseline` means the user-approved core and final packaging. `Time-permitting` means Telegram bot/voice and Telegram/SMS alerts, including their supporting delivery work; omitted written-required capabilities remain submission gaps, not organiser waivers. `Later integration` means real production Savanna identity once a contract exists. T3-027-D proves core readiness; T3-027-C is the distinct full written-brief gate. `Stretch` is genuinely optional Phase 5 work. Employer features remain lowest priority and need a future spec.

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
| 0 — Foundation and risk checks | T3-001–004 | Core runtime/checks, protected synthetic demo sessions, model research and core feasibility findings; production SSO and channel probes tracked separately |
| 1 — Accessible grounded assistant | T3-005–009 | Authorised learner completes an accessible cited text-tutoring journey; insufficient evidence and offline FAQ paths are honest |
| 2 — Voice and messaging | T3-010–015 | Core web speech input/output; Telegram and delivery infrastructure are time-permitting, not core blockers |
| 3 — Human help and careers | T3-016–023 | Core persistent help, controlled sharing, web job answers/accommodations and retention; channel alerts have separate acceptance |
| 4 — Submission readiness | T3-024–027 | Core checks/static-host integration → T3-027-D → final package/hosted MVP/slides; T3-027-C separately audits full written-brief coverage |
| 5 — Optional improvements | T3-028–032 | Each optional feature passes its own checks without regressing the baseline; no stretch feature delays submission |

The original 32 IDs are preserved: large items are epics with stable child IDs (for example `T3-001-A`), while bounded items remain single tasks. Open the parent GitHub issue for scope/acceptance, but claim a **leaf**, not an epic. `Completion depends on` aggregates an epic's children; it is not an extra prerequisite imposed on each child. A dependency on an epic means all its children and parent acceptance are complete; prefer a specific child dependency whenever sufficient. Mixed-priority epics stay open until every child passes, but a core child does not inherit a deferred sibling as a prerequisite. Parent safety/behaviour rules apply to the capability being built; channel-specific parent proof is required when that channel ships and at the full-brief gate, not to complete an unrelated core leaf.

### Task size and visible progress

- One leaf owns one demonstrable outcome and focused verification, not a whole platform or a database/backend/frontend layer in isolation. Foundation interfaces and operational evidence are explicit exceptions with their own proving story.
- Aim for a focused work block (often roughly 30–120 minutes), not a guaranteed duration. If discovery makes a leaf bigger, split it before claiming multiple unrelated outcomes. External access and human scheduling are separate blockers, not hidden estimates.
- Mark each verified leaf complete and demo the small outcome. Epic progress is completed children / total children, never a substitute for its final integrated acceptance. Keep one active implementation per contributor and record any parked blocker.
- Validation leaves do not absorb unlimited fixes. Open a small repair/retest leaf for each distinct blocker; the original acceptance gate remains blocked until the repair is proved. Keep useful tests rather than creating duplicates for each child.
- Evidence-only leaves follow the completion rule above; they do not require an empty standalone PR or duplicate test suite. Evidence work still takes real time.
- Every user-facing leaf owns its Amharic/English controls, errors and consent text using T3-006-C conventions; fixtures may unblock development, but untranslated final paths cannot pass. Every data-owning leaf owns its lifecycle under T3-023-A; only synthetic data is permitted until that policy and applicable consent are resolved.
- More tickets do not create more time. Prioritise the core learner story and external risk checks; all written-mandatory scope still needs evidence for a full-brief completion claim; a submitted core package must disclose any gaps. Stretch work remains gated.

### First parallel picks (not assignments)

| Workstream | Ready starting leaves | What follows when prerequisites land |
|---|---|---|
| Runtime / shared foundations | T3-001-A | T3-001-B/C, identity isolation T3-004-A and protected demo launch T3-004-C |
| Host / learner experience | T3-002, T3-009-A | Learner shell T3-006-A after T3-001-A; synthetic launch T3-004-C, embed T3-006-B and official static-host proof T3-026-B |
| Provider research / core feasibility | T3-003-B/C | Bounded AI/retrieval/speech research, static answer evaluation T3-007-B, speech T3-010-C and HTTPS/relay checks; SMS/Telegram probes are time-permitting, not core blockers |
| Privacy / content preparation | T3-023-A; pair on T3-009-A | Approved fixtures, content T3-005-A/B and jobs T3-019-A after storage/identity |

These are pools of available work, not permanent person silos. Recompute readiness from leaf dependencies after every merge. Shared schema/interface changes are agreed with affected owners first. No hidden whole-phase barrier applies. T3-027-D explicitly checks core leaves without inheriting deferred siblings. T3-027-C checks full written-brief coverage before Phase 5 opens. All application code stays in Hackathon; the supplied starter is reference/demo-host material.

### Dependency-free core starting leaves

These can be investigated or started in parallel after checking GitHub for a claim; they are not assignments.

| Work | GitHub issue |
|---|---|
| Smallest running web/API slice | [T3-001-A · #1](https://github.com/abnsol/Hackathon/issues/1) |
| Static starter and organiser boundaries | [T3-002 · #5](https://github.com/abnsol/Hackathon/issues/5) |
| AI/retrieval/speech research | [T3-003-B · #6](https://github.com/abnsol/Hackathon/issues/6) |
| HTTPS and sharing feasibility | [T3-003-C · #7](https://github.com/abnsol/Hackathon/issues/7) |
| Early co-design task and device plan | [T3-009-A · #26](https://github.com/abnsol/Hackathon/issues/26) |
| Retention policy precision | [T3-023-A · #49](https://github.com/abnsol/Hackathon/issues/49) |

### Capacity and integration checkpoints

This is a scope map, not a promise that a four-person team starting from documentation can finish it in one weekend. See [the independent assessment](assessment.md). At kickoff, each contributor claims a ready leaf, estimates its remaining work and reserves review/integration time. Name a human owner and a same-day check-in for each external gate in [decisions.md](decisions.md#external-gates-and-remaining-precision-checks); unassigned here does not mean someone else will handle it.

- **First working block:** boot T3-001-A while others inspect the static host, research AI/speech, check hosting/relay and run T3-009-A. Then parallelise the fixture shell, storage/identity, static provider evaluation and approved content preparation. These are rotating lanes, not permanent silos or four independent app builds from minute one.
- **First integrated checkpoint:** get the FAQ learner path and actual Savanna launch working; run co-design before polishing. Probe core voice/HTTPS early; probe SMS/Telegram before their own time-permitting integrations, not as core prerequisites. A bounded probe is not final acceptance.
- **Each checkpoint:** compare remaining baseline work plus review time to available person-hours. Agree shared contracts before consumers diverge; merge small slices continuously. If the schedule is not credible, ask for an explicit scope/requirement decision and report the gap. The approved channel deferral is already recorded; further scope changes need a decision, and written requirements remain visible.
- **Final block:** reserve integration, actual device/provider tests, repairs, installation and demo rehearsal before the official submission cutoff. More ticket splitting cannot substitute for this buffer. Finish core evidence before final package/hosting/slides (T3-027-A/E/F). Minimal HTTPS/relay testing earlier is necessary evidence, not premature submission polish. Deferred channels must not consume the protected final block.
- **Optional order:** prefer co-designer-validated T3-029 simple mode over T3-028 web research if full written-brief completion leaves capacity. This is a recommendation, not a new mandatory dependency; employer work remains last and unapproved.

## Agent starting prompt

Use this after choosing a ready, unclaimed leaf. The issue list order is not a sequential team-wide barrier.

```text
Read AGENTS.md and the GitHub issue <URL>, including its parent epic,
explicit dependencies, current spec/architecture/decisions and verification.
Check current main and whether prerequisites are actually complete.
Work only on this leaf; keep the smallest correct implementation and focused tests.
Record blockers instead of guessing shared contracts or weakening acceptance.
Follow the implement and code-review skills, including independent Standards
and Spec reviews. Keep runtime/provider/device evidence distinct from mocks.
Do not assign other tasks, provision paid services or merge without authorisation.
```

## Published issue map

Publication order places explicit prerequisites before dependants. These columns record migration classification, not live status; GitHub owns subsequent changes. The six dependency-free core starting leaves are in the first-parallel-picks table above. All epics are tracking issues, not whole-epic implementation assignments.

| Order / GitHub | Stable ID and task | Kind | Phase | Delivery priority | Parent |
|---|---|---|---|---|---|
| [#1](https://github.com/abnsol/Hackathon/issues/1) | **T3-001-A** — Run the smallest web-to-API slice | Leaf | 0 | Baseline | [T3-001](https://github.com/abnsol/Hackathon/issues/4) |
| [#2](https://github.com/abnsol/Hackathon/issues/2) | **T3-001-B** — Start PostgreSQL with repeatable migrations and readiness | Leaf | 0 | Baseline | [T3-001](https://github.com/abnsol/Hackathon/issues/4) |
| [#3](https://github.com/abnsol/Hackathon/issues/3) | **T3-001-C** — Complete lint, formatting and database/browser checks | Leaf | 0 | Baseline | [T3-001](https://github.com/abnsol/Hackathon/issues/4) |
| [#4](https://github.com/abnsol/Hackathon/issues/4) | **T3-001** — Boot the reproducible workspace and establish checks | Epic | 0 | Baseline | — |
| [#5](https://github.com/abnsol/Hackathon/issues/5) | **T3-002** — Record the static starter boundary and integration questions | Leaf | 0 | Baseline | — |
| [#6](https://github.com/abnsol/Hackathon/issues/6) | **T3-003-B** — Research AI, retrieval and speech choices before integration | Leaf | 0 | Baseline | [T3-003](https://github.com/abnsol/Hackathon/issues/72) |
| [#7](https://github.com/abnsol/Hackathon/issues/7) | **T3-003-C** — Check HTTPS and cross-network sharing prerequisites | Leaf | 0 | Baseline | [T3-003](https://github.com/abnsol/Hackathon/issues/72) |
| [#8](https://github.com/abnsol/Hackathon/issues/8) | **T3-004-A** — Resolve demo principals and enforce resource scope | Leaf | 0 | Baseline | [T3-004](https://github.com/abnsol/Hackathon/issues/103) |
| [#9](https://github.com/abnsol/Hackathon/issues/9) | **T3-004-C** — Establish protected synthetic demo sessions | Leaf | 0 | Baseline | [T3-004](https://github.com/abnsol/Hackathon/issues/103) |
| [#10](https://github.com/abnsol/Hackathon/issues/10) | **T3-005-A** — Import and update approved lesson sections | Leaf | 1 | Baseline | [T3-005](https://github.com/abnsol/Hackathon/issues/12) |
| [#11](https://github.com/abnsol/Hackathon/issues/11) | **T3-005-B** — Resolve permitted passages and citations | Leaf | 1 | Baseline | [T3-005](https://github.com/abnsol/Hackathon/issues/12) |
| [#12](https://github.com/abnsol/Hackathon/issues/12) | **T3-005** — Import approved lessons with resolvable citation targets | Epic | 1 | Baseline | — |
| [#13](https://github.com/abnsol/Hackathon/issues/13) | **T3-006-A** — Build the accessible standalone conversation shell | Leaf | 1 | Baseline | [T3-006](https://github.com/abnsol/Hackathon/issues/17) |
| [#14](https://github.com/abnsol/Hackathon/issues/14) | **T3-006-B** — Embed the learner interface with safe lifecycle handling | Leaf | 1 | Baseline | [T3-006](https://github.com/abnsol/Hackathon/issues/17) |
| [#15](https://github.com/abnsol/Hackathon/issues/15) | **T3-006-C** — Translate the learner shell and establish language selection | Leaf | 1 | Baseline | [T3-006](https://github.com/abnsol/Hackathon/issues/17) |
| [#16](https://github.com/abnsol/Hackathon/issues/16) | **T3-006-D** — Present verified Ethiopian and Addis Ababa dates | Leaf | 1 | Baseline | [T3-006](https://github.com/abnsol/Hackathon/issues/17) |
| [#17](https://github.com/abnsol/Hackathon/issues/17) | **T3-006** — Ship the accessible standalone assistant and script-loaded iframe | Epic | 1 | Baseline | — |
| [#18](https://github.com/abnsol/Hackathon/issues/18) | **T3-007-B** — Evaluate a grounded online answer provider | Leaf | 1 | Baseline | [T3-007](https://github.com/abnsol/Hackathon/issues/22) |
| [#19](https://github.com/abnsol/Hackathon/issues/19) | **T3-007-D** — Persist owned tutoring requests and history | Leaf | 1 | Baseline | [T3-007](https://github.com/abnsol/Hackathon/issues/22) |
| [#20](https://github.com/abnsol/Hackathon/issues/20) | **T3-007-A** — Ship a cited FAQ answer through the learner interface | Leaf | 1 | Baseline | [T3-007](https://github.com/abnsol/Hackathon/issues/22) |
| [#21](https://github.com/abnsol/Hackathon/issues/21) | **T3-007-C** — Add the online answer path with safe fallback | Leaf | 1 | Baseline | [T3-007](https://github.com/abnsol/Hackathon/issues/22) |
| [#22](https://github.com/abnsol/Hackathon/issues/22) | **T3-007** — Answer course questions with evidence or honest refusal | Epic | 1 | Baseline | — |
| [#23](https://github.com/abnsol/Hackathon/issues/23) | **T3-008-A** — Reload approved public FAQs offline | Leaf | 1 | Baseline | [T3-008](https://github.com/abnsol/Hackathon/issues/25) |
| [#24](https://github.com/abnsol/Hackathon/issues/24) | **T3-008-B** — Handle cache refresh and measure the text path on 3G | Leaf | 1 | Baseline | [T3-008](https://github.com/abnsol/Hackathon/issues/25) |
| [#25](https://github.com/abnsol/Hackathon/issues/25) | **T3-008** — Provide lightweight text access and offline approved FAQs | Epic | 1 | Baseline | — |
| [#26](https://github.com/abnsol/Hackathon/issues/26) | **T3-009-A** — Agree the co-designer task and baseline observations | Leaf | 1 | Baseline | [T3-009](https://github.com/abnsol/Hackathon/issues/28) |
| [#27](https://github.com/abnsol/Hackathon/issues/27) | **T3-009-B** — Run the first bilingual accessible tutoring task | Leaf | 1 | Baseline | [T3-009](https://github.com/abnsol/Hackathon/issues/28) |
| [#28](https://github.com/abnsol/Hackathon/issues/28) | **T3-009** — Validate the Phase 1 accessible bilingual journey | Epic | 1 | Baseline | — |
| [#29](https://github.com/abnsol/Hackathon/issues/29) | **T3-010-C** — Prove the transcription adapter on actual bilingual samples | Leaf | 2 | Baseline | [T3-010](https://github.com/abnsol/Hackathon/issues/32) |
| [#30](https://github.com/abnsol/Hackathon/issues/30) | **T3-010-A** — Transcribe bounded audio safely | Leaf | 2 | Baseline | [T3-010](https://github.com/abnsol/Hackathon/issues/32) |
| [#31](https://github.com/abnsol/Hackathon/issues/31) | **T3-010-B** — Record, edit and explicitly send a transcript | Leaf | 2 | Baseline | [T3-010](https://github.com/abnsol/Hackathon/issues/32) |
| [#32](https://github.com/abnsol/Hackathon/issues/32) | **T3-010** — Add consented voice input with review before sending | Epic | 2 | Baseline | — |
| [#33](https://github.com/abnsol/Hackathon/issues/33) | **T3-011** — Read answers aloud without removing text access | Leaf | 2 | Baseline | — |
| [#34](https://github.com/abnsol/Hackathon/issues/34) | **T3-016-A** — Create and cancel an owned private help request | Leaf | 3 | Baseline | [T3-016](https://github.com/abnsol/Hackathon/issues/36) |
| [#35](https://github.com/abnsol/Hackathon/issues/35) | **T3-016-B** — Show a persistent learner help inbox | Leaf | 3 | Baseline | [T3-016](https://github.com/abnsol/Hackathon/issues/36) |
| [#36](https://github.com/abnsol/Hackathon/issues/36) | **T3-016** — Create private asynchronous help requests and a persistent inbox | Epic | 3 | Baseline | — |
| [#37](https://github.com/abnsol/Hackathon/issues/37) | **T3-017-A** — Claim a request from the protected support queue | Leaf | 3 | Baseline | [T3-017](https://github.com/abnsol/Hackathon/issues/87) |
| [#38](https://github.com/abnsol/Hackathon/issues/38) | **T3-017-B** — Exchange replies and resolve a support conversation | Leaf | 3 | Baseline | [T3-017](https://github.com/abnsol/Hackathon/issues/87) |
| [#39](https://github.com/abnsol/Hackathon/issues/39) | **T3-018-A** — Authorise and negotiate a sharing session | Leaf | 3 | Baseline | [T3-018](https://github.com/abnsol/Hackathon/issues/43) |
| [#40](https://github.com/abnsol/Hackathon/issues/40) | **T3-018-B** — Share and stop a chosen desktop screen | Leaf | 3 | Baseline | [T3-018](https://github.com/abnsol/Hackathon/issues/43) |
| [#41](https://github.com/abnsol/Hackathon/issues/41) | **T3-018-D** — Configure the approved HTTPS and relay environment | Leaf | 3 | Baseline | [T3-018](https://github.com/abnsol/Hackathon/issues/43) |
| [#42](https://github.com/abnsol/Hackathon/issues/42) | **T3-018-C** — Verify cross-network sharing and document mobile acceptance | Leaf | 3 | Baseline | [T3-018](https://github.com/abnsol/Hackathon/issues/43) |
| [#43](https://github.com/abnsol/Hackathon/issues/43) | **T3-018** — Share a supported desktop screen under learner control | Epic | 3 | Baseline | — |
| [#44](https://github.com/abnsol/Hackathon/issues/44) | **T3-019-A** — Import active jobs with stable provenance | Leaf | 3 | Baseline | [T3-019](https://github.com/abnsol/Hackathon/issues/89) |
| [#45](https://github.com/abnsol/Hackathon/issues/45) | **T3-019-B** — Answer job questions using approved records | Leaf | 3 | Baseline | [T3-019](https://github.com/abnsol/Hackathon/issues/89) |
| [#46](https://github.com/abnsol/Hackathon/issues/46) | **T3-022-A** — Preview and submit a private accommodation request | Leaf | 3 | Baseline | [T3-022](https://github.com/abnsol/Hackathon/issues/48) |
| [#47](https://github.com/abnsol/Hackathon/issues/47) | **T3-022-B** — Handle accommodation status in the coordinator inbox | Leaf | 3 | Baseline | [T3-022](https://github.com/abnsol/Hackathon/issues/48) |
| [#48](https://github.com/abnsol/Hackathon/issues/48) | **T3-022** — Request interview accommodations through a coordinator | Epic | 3 | Baseline | — |
| [#49](https://github.com/abnsol/Hackathon/issues/49) | **T3-023-A** — Specify expiry semantics before storing real learner data | Leaf | 3 | Baseline | [T3-023](https://github.com/abnsol/Hackathon/issues/97) |
| [#50](https://github.com/abnsol/Hackathon/issues/50) | **T3-023-B** — Clear and expire tutoring history | Leaf | 3 | Baseline | [T3-023](https://github.com/abnsol/Hackathon/issues/97) |
| [#51](https://github.com/abnsol/Hackathon/issues/51) | **T3-023-C** — Audit core web/help/accommodation expiry and deletion | Leaf | 3 | Baseline | [T3-023](https://github.com/abnsol/Hackathon/issues/97) |
| [#52](https://github.com/abnsol/Hackathon/issues/52) | **T3-024-B** — Audit integrated failure recovery and private-data handling | Leaf | 4 | Baseline | [T3-024](https://github.com/abnsol/Hackathon/issues/55) |
| [#53](https://github.com/abnsol/Hackathon/issues/53) | **T3-024-C** — Enforce bounded provider admission and rate limits | Leaf | 4 | Baseline | [T3-024](https://github.com/abnsol/Hackathon/issues/55) |
| [#54](https://github.com/abnsol/Hackathon/issues/54) | **T3-024-A** — Measure 20 active sessions and bounded AI concurrency | Leaf | 4 | Baseline | [T3-024](https://github.com/abnsol/Hackathon/issues/55) |
| [#55](https://github.com/abnsol/Hackathon/issues/55) | **T3-024** — Measure concurrent-user behaviour and recovery | Epic | 4 | Baseline | — |
| [#56](https://github.com/abnsol/Hackathon/issues/56) | **T3-025-A** — Pass final automated accessibility and desktop task checks | Leaf | 4 | Baseline | [T3-025](https://github.com/abnsol/Hackathon/issues/99) |
| [#57](https://github.com/abnsol/Hackathon/issues/57) | **T3-025-B** — Pass the actual Android bilingual and low-bandwidth journey | Leaf | 4 | Baseline | [T3-025](https://github.com/abnsol/Hackathon/issues/99) |
| [#58](https://github.com/abnsol/Hackathon/issues/58) | **T3-025-C** — Compile the assessed WCAG report and co-design evidence | Leaf | 4 | Baseline | [T3-025](https://github.com/abnsol/Hackathon/issues/99) |
| [#59](https://github.com/abnsol/Hackathon/issues/59) | **T3-026-A** — Document and check implemented REST/OpenAPI contracts | Leaf | 4 | Baseline | [T3-026](https://github.com/abnsol/Hackathon/issues/63) |
| [#60](https://github.com/abnsol/Hackathon/issues/60) | **T3-026-B** — Prove early embedding in the official static starter | Leaf | 4 | Baseline | [T3-026](https://github.com/abnsol/Hackathon/issues/63) |
| [#61](https://github.com/abnsol/Hackathon/issues/61) | **T3-026-D** — Prove the completed core journey in the static starter | Leaf | 4 | Baseline | [T3-026](https://github.com/abnsol/Hackathon/issues/63) |
| [#62](https://github.com/abnsol/Hackathon/issues/62) | **T3-026-C** — Prove a stranger can install and embed within an hour | Leaf | 4 | Baseline | [T3-026](https://github.com/abnsol/Hackathon/issues/63) |
| [#63](https://github.com/abnsol/Hackathon/issues/63) | **T3-026** — Prove clean installation, Savanna integration and portable interfaces | Epic | 4 | Baseline | — |
| [#64](https://github.com/abnsol/Hackathon/issues/64) | **T3-027-B** — Verify the core end-to-end learner story | Leaf | 4 | Baseline | [T3-027](https://github.com/abnsol/Hackathon/issues/101) |
| [#65](https://github.com/abnsol/Hackathon/issues/65) | **T3-027-D** — Confirm core-demo readiness and record coverage gaps | Leaf | 4 | Baseline | [T3-027](https://github.com/abnsol/Hackathon/issues/101) |
| [#66](https://github.com/abnsol/Hackathon/issues/66) | **T3-027-A** — Prepare the package, licence and operating-cost evidence | Leaf | 4 | Baseline | [T3-027](https://github.com/abnsol/Hackathon/issues/101) |
| [#67](https://github.com/abnsol/Hackathon/issues/67) | **T3-027-E** — Publish the final hosted core MVP after readiness | Leaf | 4 | Baseline | [T3-027](https://github.com/abnsol/Hackathon/issues/101) |
| [#68](https://github.com/abnsol/Hackathon/issues/68) | **T3-027-F** — Prepare the explanatory slides and final submission links | Leaf | 4 | Baseline | [T3-027](https://github.com/abnsol/Hackathon/issues/101) |
| [#69](https://github.com/abnsol/Hackathon/issues/69) | **T3-003-A** — Confirm an approved Ethiopian SMS route | Leaf | 0 | Time-permitting | [T3-003](https://github.com/abnsol/Hackathon/issues/72) |
| [#70](https://github.com/abnsol/Hackathon/issues/70) | **T3-003-D** — Check Telegram access and callback strategy | Leaf | 0 | Time-permitting | [T3-003](https://github.com/abnsol/Hackathon/issues/72) |
| [#71](https://github.com/abnsol/Hackathon/issues/71) | **T3-003-E** — Resolve the phone-ownership verification route | Leaf | 0 | Time-permitting | [T3-003](https://github.com/abnsol/Hackathon/issues/72) |
| [#72](https://github.com/abnsol/Hackathon/issues/72) | **T3-003** — Prove or explicitly block live integration dependencies | Epic | 0 | Baseline | — |
| [#73](https://github.com/abnsol/Hackathon/issues/73) | **T3-012-A** — Link and revoke a private Telegram identity | Leaf | 2 | Time-permitting | [T3-012](https://github.com/abnsol/Hackathon/issues/75) |
| [#74](https://github.com/abnsol/Hackathon/issues/74) | **T3-012-B** — Answer Telegram text questions through the same tutor | Leaf | 2 | Time-permitting | [T3-012](https://github.com/abnsol/Hackathon/issues/75) |
| [#75](https://github.com/abnsol/Hackathon/issues/75) | **T3-012** — Link Telegram securely and reuse text tutoring | Epic | 2 | Time-permitting | — |
| [#76](https://github.com/abnsol/Hackathon/issues/76) | **T3-013-A** — Review a Telegram voice transcript before asking | Leaf | 2 | Time-permitting | [T3-013](https://github.com/abnsol/Hackathon/issues/78) |
| [#77](https://github.com/abnsol/Hackathon/issues/77) | **T3-013-B** — Return optional Telegram speech with cited text | Leaf | 2 | Time-permitting | [T3-013](https://github.com/abnsol/Hackathon/issues/78) |
| [#78](https://github.com/abnsol/Hackathon/issues/78) | **T3-013** — Support Telegram voice with explicit transcript review | Epic | 2 | Time-permitting | — |
| [#79](https://github.com/abnsol/Hackathon/issues/79) | **T3-014-A** — Commit a delivery intent atomically with its action | Leaf | 2 | Time-permitting | [T3-014](https://github.com/abnsol/Hackathon/issues/82) |
| [#80](https://github.com/abnsol/Hackathon/issues/80) | **T3-014-B** — Claim due work and recover abandoned leases | Leaf | 2 | Time-permitting | [T3-014](https://github.com/abnsol/Hackathon/issues/82) |
| [#81](https://github.com/abnsol/Hackathon/issues/81) | **T3-014-C** — Dispatch safely with bounded retries and unknown outcomes | Leaf | 2 | Time-permitting | [T3-014](https://github.com/abnsol/Hackathon/issues/82) |
| [#82](https://github.com/abnsol/Hackathon/issues/82) | **T3-014** — Persist delivery work and recover safely from failures | Epic | 2 | Time-permitting | — |
| [#83](https://github.com/abnsol/Hackathon/issues/83) | **T3-015-A** — Implement the approved SMS adapter contract | Leaf | 2 | Time-permitting | [T3-015](https://github.com/abnsol/Hackathon/issues/85) |
| [#84](https://github.com/abnsol/Hackathon/issues/84) | **T3-015-B** — Prove real English and Amharic SMS receipt | Leaf | 2 | Time-permitting | [T3-015](https://github.com/abnsol/Hackathon/issues/85) |
| [#85](https://github.com/abnsol/Hackathon/issues/85) | **T3-015** — Verify real outbound SMS through the approved route | Epic | 2 | Time-permitting | — |
| [#86](https://github.com/abnsol/Hackathon/issues/86) | **T3-017-C** — Notify opted-in learners of a support reply | Leaf | 3 | Time-permitting | [T3-017](https://github.com/abnsol/Hackathon/issues/87) |
| [#87](https://github.com/abnsol/Hackathon/issues/87) | **T3-017** — Let support claim, reply and notify asynchronously | Epic | 3 | Baseline | — |
| [#88](https://github.com/abnsol/Hackathon/issues/88) | **T3-019-C** — Reuse approved job answers in Telegram | Leaf | 3 | Time-permitting | [T3-019](https://github.com/abnsol/Hackathon/issues/89) |
| [#89](https://github.com/abnsol/Hackathon/issues/89) | **T3-019** — Import approved jobs and answer job questions with citations | Epic | 3 | Baseline | — |
| [#90](https://github.com/abnsol/Hackathon/issues/90) | **T3-020-A** — Persist job preferences and match new publications | Leaf | 3 | Time-permitting | [T3-020](https://github.com/abnsol/Hackathon/issues/92) |
| [#91](https://github.com/abnsol/Hackathon/issues/91) | **T3-020-B** — Deliver and unsubscribe Telegram job alerts | Leaf | 3 | Time-permitting | [T3-020](https://github.com/abnsol/Hackathon/issues/92) |
| [#92](https://github.com/abnsol/Hackathon/issues/92) | **T3-020** — Subscribe to matching jobs and deliver Telegram alerts | Epic | 3 | Time-permitting | — |
| [#93](https://github.com/abnsol/Hackathon/issues/93) | **T3-021-A** — Verify and manage an SMS job subscription | Leaf | 3 | Time-permitting | [T3-021](https://github.com/abnsol/Hackathon/issues/95) |
| [#94](https://github.com/abnsol/Hackathon/issues/94) | **T3-021-B** — Deliver a real subscribed SMS job alert | Leaf | 3 | Time-permitting | [T3-021](https://github.com/abnsol/Hackathon/issues/95) |
| [#95](https://github.com/abnsol/Hackathon/issues/95) | **T3-021** — Deliver subscribed job alerts by real SMS | Epic | 3 | Time-permitting | — |
| [#96](https://github.com/abnsol/Hackathon/issues/96) | **T3-023-D** — Audit added channel media, delivery references and contacts | Leaf | 3 | Time-permitting | [T3-023](https://github.com/abnsol/Hackathon/issues/97) |
| [#97](https://github.com/abnsol/Hackathon/issues/97) | **T3-023** — Enforce retention and deletion across private records | Epic | 3 | Baseline | — |
| [#98](https://github.com/abnsol/Hackathon/issues/98) | **T3-025-D** — Verify added Telegram/SMS accessibility and update the report | Leaf | 4 | Time-permitting | [T3-025](https://github.com/abnsol/Hackathon/issues/99) |
| [#99](https://github.com/abnsol/Hackathon/issues/99) | **T3-025** — Complete the co-designer accessibility gate and conformance evidence | Epic | 4 | Baseline | — |
| [#100](https://github.com/abnsol/Hackathon/issues/100) | **T3-027-C** — Close the full written-brief acceptance gate | Leaf | 4 | Full-brief gate | [T3-027](https://github.com/abnsol/Hackathon/issues/101) |
| [#101](https://github.com/abnsol/Hackathon/issues/101) | **T3-027** — Finish the core demo, package it, and audit full-brief coverage | Epic | 4 | Baseline | — |
| [#102](https://github.com/abnsol/Hackathon/issues/102) | **T3-004-B** — Later: implement the real Savanna identity handoff | Leaf | 0 | Later integration | [T3-004](https://github.com/abnsol/Hackathon/issues/103) |
| [#103](https://github.com/abnsol/Hackathon/issues/103) | **T3-004** — Enforce learner identity and per-user/course access | Epic | 0 | Baseline | — |
| [#104](https://github.com/abnsol/Hackathon/issues/104) | **T3-028-A** — Fetch sourced career research with explicit consent | Leaf | 5 | Stretch | [T3-028](https://github.com/abnsol/Hackathon/issues/106) |
| [#105](https://github.com/abnsol/Hackathon/issues/105) | **T3-028-B** — Expose the separate disabled-by-default research mode | Leaf | 5 | Stretch | [T3-028](https://github.com/abnsol/Hackathon/issues/106) |
| [#106](https://github.com/abnsol/Hackathon/issues/106) | **T3-028** — Add explicit supplementary career web research | Epic | 5 | Stretch | — |
| [#107](https://github.com/abnsol/Hackathon/issues/107) | **T3-029** — Add learner-selected simple-language mode | Leaf | 5 | Stretch | — |
| [#108](https://github.com/abnsol/Hackathon/issues/108) | **T3-030** — Show anonymous frequently asked topics to authorised teachers | Leaf | 5 | Stretch | — |
| [#109](https://github.com/abnsol/Hackathon/issues/109) | **T3-031** — Future spec: employer dashboard | Leaf | 5 | Lowest-priority stretch | — |
| [#110](https://github.com/abnsol/Hackathon/issues/110) | **T3-032** — Future spec: consented employer outreach | Leaf | 5 | Lowest-priority stretch | — |
