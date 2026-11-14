# Track 3 — Accessible learning and career assistant

Specification and implementation backlog for the Digital Bridge Accessibility Hackathon, shared in [the team repository](https://github.com/abnsol/Hackathon). **Planning pack only: no application, package commands, or runtime verification exists yet.** Issue bodies remain local Markdown; no GitHub issues have been created.

## Start here

1. [Product specification](docs/spec.md): what must work and what is excluded.
2. [Architecture](docs/architecture.md): stack, detailed target folders, module interfaces, identity/answer/delivery flows.
3. [Decision register](docs/decisions.md): settled choices, implementation discretion, and external blockers.
4. [Issue backlog](docs/issues.md): original IDs retained as epics or bounded tasks, small claimable children, dependencies, blocked-work procedure, acceptance and verification.
5. [Verification](docs/verification.md) and [conformance template](docs/conformance.md): what evidence is required; neither claims tests have passed.
6. [Agent instructions](AGENTS.md): how to take an issue through implementation and independent reviews.
7. [Coding standards](docs/coding-standards.md): Occam's razor, comments, TypeScript style and efficient implementation.

The [Savanna/meeting reconciliation](docs/savanna-reconciliation.md) records source evidence and the user-approved updates. **Implement in this Hackathon repository**; the organiser’s static starter is reference material and the integration demo host, not a supplied backend, authentication service or model platform.

The [independent delivery assessment](docs/assessment.md) records competitive potential, schedule risk and unresolved external gates; this is not a claim of hackathon readiness.

## How implementation starts

Read the backlog's first-parallel-picks table, claim one ready leaf task and read its parent scope before editing. Epics group outcomes; they are not giant PRs. Establish the runnable workspace while others inspect the static host, run the explicit model/retrieval/speech research step (T3-003-B), and investigate core provider/device risks. No models are provided; selection remains evidence-led, not fixed here. Do not build a giant empty skeleton first. The first learner increment is a narrow authorised, source-backed text interaction; later slices extend the same use cases across core voice/help/careers and, if time permits, channels.

Delivery milestones are foundation/risk checks → accessible tutor → voice/channels → help/careers → submission verification. Work follows explicit dependencies, not a whole-phase waiting barrier. When blocked, [record the blocker and pick other ready baseline work](docs/issues.md#when-work-is-blocked). Core includes web tutoring/voice, offline FAQ, help/sharing, **web job Q&A and accommodation requests**. Telegram bot/voice and Telegram/SMS alerts are time-permitting. T3-027-D checks core readiness, then T3-027-A/E/F finish the package, hosted MVP and slides. T3-027-C separately requires full written-brief coverage; omitted mandatory channels remain disclosed gaps. Optional web research and employer features still wait for that full gate.

Each author reviews and merges their own PR using the [review skill](.agents/skills/code-review/SKILL.md) and [PR template](.github/pull_request_template.md), with standards/spec AI reviewers. No other teammate's PR approval is required; CI, repository protections, applicable overall decisions, existing-implementation compatibility and required device/co-designer evidence still apply. Follow the [focused test-writing rules](docs/verification.md#test-writing-rules), not a test-count target.

## Fresh-session starter

```text
Read AGENTS.md, docs/spec.md, docs/architecture.md, docs/decisions.md,
and the first-parallel-picks section of docs/issues.md. Inspect the workspace.
Identify the unclaimed leaf-task frontier, propose a leaf and read its parent
epic, then follow the implement skill for that approved task. Reopen only unresolved
design-impact decisions. Do not create GitHub resources or provision paid
services without explicit authorisation. Report actual verification evidence.
```

## Local backlog and later GitHub migration

The local issue bodies are authoritative until explicitly migrated. Preserve their stable IDs and dependencies when GitHub issue numbers are assigned. After migration, designate the remote issue bodies as authoritative and keep a local ID/link index rather than two diverging specs. Do not automatically assign the entire backlog or mark it in progress.

The skill files and reviewer prompts are portable Markdown instructions. Their presence does not prove a particular agent tool has automatically registered them; [AGENTS.md](AGENTS.md) points to the instructions to read explicitly.

## Runtime setup

Not available yet. The bootstrap issue must replace this section with verified install/start/test instructions, environment variables, migrations, FAQ-only mode, live-provider requirements, and a clean-install procedure. Do not fabricate commands, credentials, deployment URLs, or a licence before their owning decision is resolved.
