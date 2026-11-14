# Team agent instructions

## Scope and sources

This is the Track 3 multilingual learning/help assistant. Work from the repository root. The approved direction is a TypeScript workspace with React/Vite, Fastify, PostgreSQL, and Docker Compose; application code may not exist yet. Implement in this Hackathon repository; the organiser’s static starter is reference/demo-host material, not a supplied backend or trusted identity service.

- Read [the product spec](docs/spec.md) for required behaviour, [architecture](docs/architecture.md) for module interfaces and dependency rules, and [decisions](docs/decisions.md) before changing a settled choice.
- [The issue index](docs/issues.md) maps stable IDs to authoritative GitHub issue bodies for task scope, dependencies, acceptance criteria, status and evidence. Read the linked issue and parent before work; keep only the ID/link index locally, not competing issue bodies.
- Follow the backlog’s leaf priorities and core/full-brief gates. Core includes web job Q&A/accommodations; Telegram bot/voice and Telegram/SMS alerts are time-permitting, not organiser-waived. Mixed epics do not make deferred siblings prerequisites for core leaves; enabled features still require their safety evidence.
- Read [verification](docs/verification.md) when choosing checks and [conformance](docs/conformance.md) when collecting accessibility evidence. A template or unchecked box is not evidence of a pass.

## Coding preferences

- Apply [the coding standards](docs/coding-standards.md) when implementing/reviewing: Occam's razor, useful file/block/line comments, TypeScript conventions, and efficient execution. Choose the simplest adequate implementation without weakening required behaviour or the agreed module interfaces.
- Make the smallest correct change. Preserve existing formatting and readable one-line expressions; keep unrelated cleanup, renaming, and refactoring out of scope.
- Before editing, inspect current behaviour, callers, tests, and project conventions. Account for meaningful failure paths and compatibility.
- Use feature-first modules and the agreed Clean Architecture dependency direction. Object-oriented use cases and adapters earn their interfaces through actual behaviour or replacement needs. Prefer composition and explicit constructor wiring; avoid generic base classes and speculative frameworks.
- Keep domain/application rules independent of HTTP, database, channel, and AI SDK details. React remains idiomatic functional React. Shared transport contracts contain no business logic.
- Add focused tests using the existing infrastructure. Every test must assert its stated behaviour; regression tests must fail when the fix is removed. Preserve useful tests and never weaken assertions to obtain green checks.
- Follow the [test-writing rules](docs/verification.md#test-writing-rules) before adding tests: identify the distinct risk, reuse existing coverage, and choose the lowest layer that proves it. Test counts and coverage percentages are not a reason to add redundant tests.
- Keep credentials, voice, private conversations, and accommodation text out of source control, routine logs, review packets, and test evidence. Use synthetic/redacted fixtures.

## Workflow

1. Understand the current code and the selected leaf task, including its parent epic's scope and acceptance. Claim a leaf, never an entire epic as one implementation/PR. Read its explicit dependencies and the [blocked-work procedure](docs/issues.md#when-work-is-blocked) before claiming it. Baseline phases are delivery milestones, not team-wide waiting barriers; choose ready baseline work across phases. One human owner claims a leaf; do not take another person's work or mark the whole backlog in progress.
2. For unresolved design-impact decisions, follow [grilling](.agents/skills/grilling/SKILL.md). An approved issue does not need to repeat settled architecture discussions. Escalate changes to scope, shared interfaces, privacy, costs, external dependencies, or acceptance criteria.
3. Write settled scope with [to-spec](.agents/skills/to-spec/SKILL.md); use [to-tickets](.agents/skills/to-tickets/SKILL.md) when more than one independently verifiable PR is needed.
4. On an implementation request, start a fresh session from the issue and follow [implement](.agents/skills/implement/SKILL.md). Research consequential unfamiliar model/library/provider choices against current primary sources. Record the date, alternatives, constraints, and evaluation result in the issue or shared decision record, not a private notebook. Reuse still-valid choices; SOTA means best verified fit, not newest by default.
5. The PR author reviews their own PR using [code-review](.agents/skills/code-review/SKILL.md) and [the PR template](.github/pull_request_template.md), with independent standards and spec AI reviewers; no teammate PR approval is required. Review against existing implementations, affected callers/contracts and the complete applicable decision/spec set, not just the new issue. There is no general/neutral reviewer; required co-designer/device checks remain separate.
6. The author fixes blocking findings, reruns checks, and re-reviews material changes before signing off and merging their own PR. Verify compatibility with current `main`, CI results for the candidate, and actual branch-protection requirements; do not bypass repository protections. An agent merges only when the user's action authorisation permits it. Code/documentation completion requires post-merge integrated acceptance evidence, not only an open PR. Evidence-only leaves follow the [backlog completion rule](docs/issues.md#how-to-use-this-backlog); without a repository change, no empty PR/merge is required.

Skills and reviewer prompts are portable Markdown. If the tool does not discover them, read the linked file explicitly; these files do not automatically register tool-specific agents or hooks.

## Checks and execution limits

- Find actual check commands in the current package scripts, CI configuration, and README. Before scaffolding exists, describe required checks as planned; do not claim commands or results exist. Run focused checks while iterating and documented pre-PR checks before readiness.
- Record exact commands, outcomes, relevant environment, and reviewed revision. Report failed, skipped, unavailable, and unrun checks separately. Automated accessibility checks do not establish full conformance.
- Fakes are useful in deterministic tests, but a mandatory live integration remains unverified/blocked until real evidence exists. Declining paid/cloud processing must not be disguised as full functionality.
- Review the final diff for unnecessary files, helpers, tests, formatting, and scope expansion. Do not revert others' changes.
- Once Git exists, use short-lived issue branches into `main`; never commit application work directly to `main`. CI runs before merge. Do not initialise/publish repositories, install dependencies, commit, push, create/update remote issues, provision paid services, or merge merely because a spec was approved; follow the user's actual action authorisation and tool permissions.
