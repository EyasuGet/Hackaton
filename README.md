# Track 3 — Accessible learning and career assistant

Specification and implementation backlog for the Digital Bridge Accessibility Hackathon, shared in [the team repository](https://github.com/EyasuGet/Hackaton). **Early implementation: only the web-to-API health slice exists (see [Runtime setup](#runtime-setup)); no learner features yet.** The backlog has been migrated to **110 unassigned GitHub issues (26 epics and 84 leaf tasks)**; [the local index](docs/issues.md) links to the authoritative issue bodies. Check GitHub for current ownership and status.

## Start here

1. [Product specification](docs/spec.md): what must work and what is excluded.
2. [Architecture](docs/architecture.md): stack, detailed target folders, module interfaces, identity/answer/delivery flows.
3. [Decision register](docs/decisions.md): settled choices, implementation discretion, and external blockers.
4. [Issue index and execution guide](docs/issues.md): stable IDs, direct GitHub links, first parallel picks and blocked-work rules. Each remote issue contains its scope, dependencies, acceptance, verification and agent handoff.
5. [Verification](docs/verification.md) and [conformance template](docs/conformance.md): what evidence is required; neither claims tests have passed.
6. [Agent instructions](AGENTS.md): how to take an issue through implementation and independent reviews.
7. [Coding standards](docs/coding-standards.md): Occam's razor, comments, TypeScript style and efficient implementation.

The [Savanna/meeting reconciliation](docs/savanna-reconciliation.md) records source evidence and the user-approved updates; the [static starter boundary record](docs/static-starter-boundary.md) adds runtime observations, the safe script mount point and open organiser questions. **Implement in this Hackathon repository**; the organiser’s static starter is reference material and the integration demo host, not a supplied backend, authentication service or model platform.

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

## GitHub issues and local index

GitHub issue bodies are authoritative after the 2026-11-14 migration. Use the local ID/link index to find one ready leaf and its parent; check live dependencies and ownership before starting. Preserve stable IDs, check for duplicates before adding tasks, and update scope/evidence in GitHub rather than maintaining a second local body. No one was assigned and no work was marked in progress by migration.

The skill files and reviewer prompts are portable Markdown instructions. Their presence does not prove a particular agent tool has automatically registered them; [AGENTS.md](AGENTS.md) points to the instructions to read explicitly.

## Runtime setup

Current scope: an API with liveness and database readiness, a PostgreSQL migration path, and a React/Vite page that reports API health ([T3-001-A](https://github.com/EyasuGet/Hackaton/issues/1), [T3-001-B](https://github.com/EyasuGet/Hackaton/issues/2)). Lint/format/browser checks ([T3-001-C](https://github.com/EyasuGet/Hackaton/issues/3)), FAQ-only mode and live-provider requirements are added by their own issues.

### Requirements

- Node.js 22.18 or newer (the API runs TypeScript directly via Node's built-in type stripping in development). Tested with 22.23.1.
- pnpm 11.21.0 (pinned in `package.json` `packageManager`; `corepack enable` provides it).
- Docker with Compose v2 for PostgreSQL. Tested with Docker 29.8.0 and Compose 5.5.1.

### Start

```sh
pnpm install
cp .env.example .env          # then set DATABASE_PASSWORD to any local-only value
docker compose up -d --wait   # PostgreSQL 18, reachable on 127.0.0.1 only
pnpm db:migrate               # safe to repeat; applies only pending migrations
pnpm dev
```

Open http://localhost:5173. The page reports **API available** when the API answers `GET /api/health`, and **API unavailable** when it is stopped or failing. The Vite dev server proxies `/api` to the API.

`GET /api/health` is liveness: it answers whenever the API process runs. `GET /api/ready` returns `200 {"status":"ready"}` only when PostgreSQL answers and every migration is applied; otherwise `503` with `reason` `database_unavailable` or `migrations_pending`. The API starts even while the database is down and becomes ready once it recovers. Stop the database with `docker compose stop`; `docker compose down -v` also deletes its data.

### Configuration

| Variable | Required | Meaning |
|---|---|---|
| `API_HOST` | Yes | Interface the API listens on, for example `127.0.0.1` |
| `API_PORT` | Yes | Integer port 1–65535, for example `3000` |
| `DATABASE_HOST` | Yes | PostgreSQL host, `127.0.0.1` for Compose |
| `DATABASE_PORT` | Yes | PostgreSQL port, `5432` for Compose |
| `DATABASE_NAME` | Yes | Database name; Compose creates it |
| `DATABASE_USER` | Yes | Database user; Compose creates it |
| `DATABASE_PASSWORD` | Yes | Local-only password you choose; empty in `.env.example` on purpose |

Compose, the API and the migration command all refuse to start with a missing value, and messages name the variable, never its value. The web bundle does not include these server values.

### Migrations

SQL files live in [`apps/api/src/infrastructure/database/migrations`](apps/api/src/infrastructure/database/migrations/README.md). `pnpm db:migrate` applies pending files in name order, each in a transaction with its history record, under a lock so concurrent runs cannot apply a file twice. It refuses to run if an already-applied file was edited.

### Checks

| Command | Runs |
|---|---|
| `pnpm typecheck` | Strict TypeScript checks for every app |
| `pnpm build` | API compile to `apps/api/dist`, web production build to `apps/web/dist` |
| `pnpm test` | Unit tests: API routes and configuration; web available/unavailable states. No database needed |
| `pnpm test:integration` | Real-PostgreSQL tests for migrations and readiness. Needs the Compose database; each run creates and drops its own temporary database |

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs install, typecheck, build, unit tests, `db:migrate` and integration tests against a PostgreSQL service on pull requests and pushes to `main`. After `pnpm build`, `pnpm --filter @track3/api start` runs the compiled API. Dependency versions are pinned exactly in each `package.json` and `pnpm-lock.yaml`.
