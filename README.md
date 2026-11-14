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

Current scope: an API with liveness and database readiness, a PostgreSQL migration path, a React/Vite page that reports API health, and lint/format/unit/integration/browser checks ([T3-001](https://github.com/EyasuGet/Hackaton/issues/4)), plus synthetic demo identities with learner/support access rules ([T3-004-A](https://github.com/EyasuGet/Hackaton/issues/8); see [Demo identities](#demo-identities)), and versioned lesson import ([T3-005-A](https://github.com/EyasuGet/Hackaton/issues/10); see [Lesson content](#lesson-content)). FAQ-only mode and live-provider requirements are added by their own issues.

### Requirements

- Node.js 22.18 or newer (the API runs TypeScript directly via Node's built-in type stripping in development). Tested with 22.23.1.
- pnpm 11.21.0 (pinned in `package.json` `packageManager`; `corepack enable` provides it).
- Docker with Compose v2 for PostgreSQL. Tested with Docker 29.8.0 and Compose 5.5.1.
- TypeScript is pinned to 6.0.x because typescript-eslint does not yet support the TypeScript 7 native compiler.

### Start

```sh
pnpm install
cp .env.example .env          # then set DATABASE_PASSWORD to any local-only value
docker compose up -d --wait   # PostgreSQL 18, reachable on 127.0.0.1 only
pnpm db:migrate               # safe to repeat; applies only pending migrations
pnpm dev
```

Open http://localhost:5173. The page shows the accessible conversation shell in **demo mode**: replies come from labelled test fixtures chosen with *Demo reply scenario* (English, Amharic, mixed-direction, HTML markup, slow, session expired, network failure), not from a tutor. The footer reports **API available** when the API answers `GET /api/health`, and **API unavailable** when it is stopped or failing. The Vite dev server proxies `/api` to the API.

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
| `DEMO_MODE` | No | `true` enables synthetic demo identities; default `false`. Any other value stops startup. Never enable it for a real deployment |

Compose, the API and the migration command all refuse to start with a missing value, and messages name the variable, never its value. The web bundle does not include these server values.

### Demo identities

**Demo mode is not real authentication.** With `DEMO_MODE=true`, the API accepts bearer tokens for three synthetic principals and logs a `DEMO MODE` warning at startup; with `DEMO_MODE=false` every token is rejected. Browser sign-in uses short-lived demo sessions ([T3-004-C](https://github.com/EyasuGet/Hackaton/issues/9), below); real Savanna sign-in is [T3-004-B](https://github.com/EyasuGet/Hackaton/issues/102).

```sh
# in .env: DEMO_MODE=true
pnpm db:migrate
pnpm demo:provision   # prints a new token for learner-a, learner-b and support; earlier tokens stop working
```

| Principal | Role | Course grants |
|---|---|---|
| `learner-a` | learner | `course-1` |
| `learner-b` | learner | `course-1`, `course-2` |
| `support` | support | none |

Roles and grants come only from the database. Role, owner or course values in headers, query strings or bodies are ignored. Tokens are stored only as SHA-256 digests.

**Contract for feature developers** (`apps/api/src/modules/identity`):

- Protect a route with the `authenticate(resolvePrincipal)` preHandler, then `requireRole('learner' | 'support')` where needed; read the caller with `principalOf(request)`.
- Restrict learner-owned data with `ownedScope(principal)`: a learner sees only their own records in courses they are granted; support staff get no scope. Apply it inside the storage query for both lists and single records.
- Responses: `401 {"error":"unauthenticated"}` for a missing, unknown or demo-disabled token; `403 {"error":"forbidden"}` for the wrong role; `404 {"error":"not_found"}` for a record that is missing **or** outside the caller's scope, so its existence is not revealed; `500 {"error":"internal"}` for unexpected failures, without driver details.

| Route | Who | Result |
|---|---|---|
| `GET /api/me` | any principal | Identity, role, course grants, `demo: true` and a demo notice |
| `GET /api/demo/records`, `GET /api/demo/records/:id` | learners | Fixture records in scope; removed once real learner data exists |
| `GET /api/demo/support-check` | support | `{"ok":true}`; shows learners cannot reach staff operations |

Try it with the API running (`pnpm dev`), using tokens from `pnpm demo:provision`:

```sh
curl -H "Authorization: Bearer $A" localhost:3000/api/me            # demo: true, learner A
curl -H "Authorization: Bearer $A" localhost:3000/api/demo/records  # only A's course-1 record
curl -H "Authorization: Bearer $B" localhost:3000/api/demo/records  # copy one of B's ids
curl -H "Authorization: Bearer $A" -H "x-role: support" localhost:3000/api/demo/records/<B's id>  # 404
curl -H "Authorization: Bearer $A" localhost:3000/api/demo/support-check  # 403
```

### Lesson content

Approved lesson sources are JSON files in [`fixtures/courses`](fixtures/courses/README.md): one approved Savanna lesson (English, `course-1`, pinned to starter commit `9e83ac7`) and one synthetic Amharic demo lesson (`course-2`).

```sh
pnpm db:migrate
pnpm content:import                  # every file in fixtures/courses
pnpm content:import path/to/x.json   # specific files; relative paths are from the repository root
```

All files are validated before anything is imported: if any file is invalid, every error is printed with its file and field and nothing is stored. Each valid source is then imported in its own transaction, so a later refused source (such as a reused version label) does not undo earlier ones. Each source then reports `imported`, `unchanged` (identical content, even under a new label) or `withdrawn`. A changed source is stored as a new immutable version that becomes current in the same transaction; sections missing from it stop being authoritative, and earlier versions stay stored for inspection. Reusing a version label for different content is refused, so restoring earlier content needs a new label. Retrieval and citations for learners come in [T3-005-B](https://github.com/EyasuGet/Hackaton/issues/11).

Inspect what is stored:

```sh
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -c "SELECT v.source_id, v.version, v.is_demo, s.current_version_id = v.id AS current, v.imported_at FROM lesson_source_versions v JOIN lesson_sources s ON s.id = v.source_id ORDER BY v.source_id, v.imported_at"'
```

### Job vacancies and career records

Approved job records live in [`fixtures/jobs`](fixtures/jobs/README.md): an active Virtual Assistant position (`demo-va-specialist.json`) and an expired record (`demo-expired-data-clerk.json`) for verifying status queries.

```sh
pnpm db:migrate
pnpm jobs:import                  # every file in fixtures/jobs
pnpm jobs:import path/to/x.json   # specific files; relative paths are from the repository root
```

All files are validated before anything is imported. Re-importing identical content is a no-op that does not duplicate rows. Each valid change creates an immutable version that becomes current, while preserving the job's stable publication identity. Expired (`expiresAt <= now`) and withdrawn vacancies are consistently queryable.

Inspect stored jobs:

```sh
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -c "SELECT j.id, j.publication_id, v.version, v.category, v.location, v.expires_at, v.withdrawn FROM jobs j JOIN job_versions v ON v.id = j.current_version_id ORDER BY j.id"'
```

### Course search and citations

Signed-in learners can search their granted courses and open a cited section in place (the page's *Your course material* panel). Search uses PostgreSQL full-text search plus the draft Amharic↔English glossary (pending competent-speaker review) in [`fixtures/retrieval/bilingual-glossary.json`](fixtures/retrieval/bilingual-glossary.json); the method and its evaluation are recorded in [decisions](docs/decisions.md#retrieval-method--t3-005-b-2026-11-14). Run `pnpm content:import` first.

| Request (learner session token) | Result |
|---|---|
| `GET /api/content/search?q=…` (1–500 characters) | `{"passages": [{sourceId, sectionId, sourceTitle, heading, excerpt, language, courseId}]}`, up to 5, best first, from current non-withdrawn versions in granted courses only |
| `GET /api/content/sources/:sourceId/sections/:sectionId` | The section with `text`, `language`, `version`, `anchor` and `provenance` (`demo`, or `organiser` with repository, commit and path). `404 not_found` for a missing source **or** a course you are not granted (indistinguishable); `410 {"error":"unavailable","reason":"withdrawn"\|"removed"}` for a granted source that was withdrawn or no longer has that section; `403` for support staff |

Tutoring code uses `ContentAccess` (`apps/api/src/modules/content/application/content-access.ts`) rather than these routes or the tables.

### Demo sign-in for the browser

The assistant page signs in with a **single-use sign-in link** minted by whoever runs the demo; nothing the browser sends chooses a role or course.

```sh
# in .env: DEMO_MODE=true and DEMO_ALLOWED_ORIGINS=http://localhost:5173
pnpm db:migrate
pnpm demo:provision            # once, creates the demo principals
pnpm demo:handoff learner-a    # prints a link for the first allowed origin, valid 2 minutes, usable once
```

Open the printed link (`…/#handoff=…`; the code is in the fragment, which browsers never send to servers, so it stays out of access logs). The page removes the code from the address bar, exchanges it for a **2-hour session**, and shows "Signed in as Demo learner A (learner). Synthetic demo identity — not real authentication." **Sign out** ends the session on the server. The session token lives only in page memory (never cookies, storage or URLs), so reloading needs a new link and the future iframe embed does not depend on third-party cookies.

**Session contract** for page and embed consumers:

| Request | Result |
|---|---|
| `POST /api/demo/session` with JSON `{"code": "…"}` from the allowed page origin the code was minted for | `201 {"token", "expiresAt"}`; other body properties are ignored. `401 {"error":"invalid_handoff"}` for an unknown, used or expired code, a code minted for another origin (not used up), or when demo mode is off; `403 {"error":"origin_not_allowed"}` for a missing, `null` or unlisted `Origin` (the code is not used up); `400` for a malformed body |
| Any protected route with `Authorization: Bearer <token>` | Same rules as above; `401` once the session expires or is signed out |
| `DELETE /api/demo/session` with the session token | `204`; the session stops working immediately. `400 {"error":"not_a_session"}` for a bearer that is not a session (for example a provisioned operator token, which keeps working) |

Handoff codes and session tokens are stored only as SHA-256 digests. `DEMO_ALLOWED_ORIGINS` lists exact `http(s)` origins (no paths, `null` or `file:`); each code is bound to one of them (`pnpm demo:handoff learner-a http://127.0.0.1:8765` for another page). Hosted demos where visitors sign themselves in need a separate decision (T3-027-E); links are operator-minted today.

### Migrations

SQL files live in [`apps/api/src/infrastructure/database/migrations`](apps/api/src/infrastructure/database/migrations/README.md). `pnpm db:migrate` applies pending files in name order, each in a transaction with its history record, under a lock so concurrent runs cannot apply a file twice. It refuses to run if an already-applied file was edited.

### Checks

| Command | Runs |
|---|---|
| `pnpm typecheck` | Strict TypeScript checks for every app |
| `pnpm build` | API compile to `apps/api/dist`, web production build to `apps/web/dist` |
| `pnpm test` | Unit tests: API routes and configuration; web available/unavailable states. No database needed |
| `pnpm test:integration` | Real-PostgreSQL tests for migrations, readiness, demo identity/access rules and lesson import. Needs the Compose database; each run creates and drops its own temporary database |
| `pnpm lint` | ESLint with type-aware typescript-eslint recommended rules ([eslint.config.js](eslint.config.js)) |
| `pnpm format:check` | Prettier check ([.prettierrc.json](.prettierrc.json)); `pnpm format` rewrites files. Markdown is excluded |
| `pnpm test:e2e` | Playwright in Chromium against the real API and the Vite dev server, with axe scans failing on critical/serious WCAG 2.2 A/AA violations. First run once: `pnpm --filter @track3/web exec playwright install chromium` (on Linux add `--with-deps` if system libraries are missing). Reuses servers already running on ports 3000/5173 locally |

Automated accessibility checks do not establish conformance; NVDA, TalkBack and co-designer checks remain separate ([verification](docs/verification.md)).

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs install, format check, lint, typecheck, build, unit tests, `db:migrate`, integration tests against a PostgreSQL service, and the browser tests on pull requests and pushes to `main`. After `pnpm build`, `pnpm --filter @track3/api start` runs the compiled API. Dependency versions are pinned exactly in each `package.json` and `pnpm-lock.yaml`.
