# Team agent instructions

## Scope and sources

This is the Track 3 multilingual learning/help assistant. Work from the repository root. The approved direction is a TypeScript workspace with React/Vite, Fastify, PostgreSQL, and Docker Compose; application code may not exist yet.

- Read [the product spec](docs/spec.md) for required behaviour, [architecture](docs/architecture.md) for module interfaces and dependency rules, and [decisions](docs/decisions.md) before changing a settled choice.
- [The local backlog](docs/issues.md) is authoritative for issue-specific scope, dependencies, acceptance criteria, and verification until the user explicitly authorises migration to GitHub. Do not maintain two competing issue bodies after migration.
- Read [verification](docs/verification.md) when choosing checks and [conformance](docs/conformance.md) when collecting accessibility evidence. A template or unchecked box is not evidence of a pass.

## Coding preferences

- Make the smallest correct change. Preserve existing formatting and readable one-line expressions; keep unrelated cleanup, renaming, and refactoring out of scope.
- Before editing, inspect current behaviour, callers, tests, and project conventions. Account for meaningful failure paths and compatibility.
- Use feature-first modules and the agreed Clean Architecture dependency direction. Object-oriented use cases and adapters earn their interfaces through actual behaviour or replacement needs. Prefer composition and explicit constructor wiring; avoid generic base classes and speculative frameworks.
- Keep domain/application rules independent of HTTP, database, channel, and AI SDK details. React remains idiomatic functional React. Shared transport contracts contain no business logic.
- Add focused tests using the existing infrastructure. Every test must assert its stated behaviour; regression tests must fail when the fix is removed. Preserve useful tests and never weaken assertions to obtain green checks.
- Keep credentials, voice, private conversations, and accommodation text out of source control, routine logs, review packets, and test evidence. Use synthetic/redacted fixtures.

## Workflow

1. Understand the current code and the selected issue. Read its dependencies and phase gate before claiming it. One human owner claims an issue; do not take another person's work or mark the whole backlog in progress.
2. For unresolved design-impact decisions, follow [grilling](.agents/skills/grilling/SKILL.md). An approved issue does not need to repeat settled architecture discussions. Escalate changes to scope, shared interfaces, privacy, costs, external dependencies, or acceptance criteria.
3. Write settled scope with [to-spec](.agents/skills/to-spec/SKILL.md); use [to-tickets](.agents/skills/to-tickets/SKILL.md) when more than one independently verifiable PR is needed.
4. On an implementation request, start a fresh session from the issue and follow [implement](.agents/skills/implement/SKILL.md). Research consequential unfamiliar model/library/provider choices against current primary sources. Record the date, alternatives, constraints, and evaluation result in the issue or shared decision record, not a private notebook. Reuse still-valid choices; SOTA means best verified fit, not newest by default.
5. Run [code-review](.agents/skills/code-review/SKILL.md) with independent standards and spec reviewers. There is no general/neutral reviewer. Target accessibility/security checks to the changed behaviour within those reviews; human/device checks remain separate.
6. Fix blocking findings, rerun affected checks, and re-review material changes. A PR uses [the template](.github/pull_request_template.md); a human approves merge. Completion requires integrated acceptance evidence, not only an open PR.

Skills and reviewer prompts are portable Markdown. If the tool does not discover them, read the linked file explicitly; these files do not automatically register tool-specific agents or hooks.

## Checks and execution limits

- Find actual check commands in the current package scripts, CI configuration, and README. Before scaffolding exists, describe required checks as planned; do not claim commands or results exist. Run focused checks while iterating and documented pre-PR checks before readiness.
- Record exact commands, outcomes, relevant environment, and reviewed revision. Report failed, skipped, unavailable, and unrun checks separately. Automated accessibility checks do not establish full conformance.
- Fakes are useful in deterministic tests, but a mandatory live integration remains unverified/blocked until real evidence exists. Declining paid/cloud processing must not be disguised as full functionality.
- Review the final diff for unnecessary files, helpers, tests, formatting, and scope expansion. Do not revert others' changes.
- Once Git exists, use short-lived issue branches into `main`; never commit application work directly to `main`. CI runs before merge. Do not initialise/publish repositories, install dependencies, commit, push, create/update remote issues, provision paid services, or merge merely because a spec was approved; follow the user's actual action authorisation and tool permissions.
