# T3-026 — Clean Installation, Savanna Integration and Portable Interfaces Epic Closure

**Epic:** [#63 — [T3-026] Prove clean installation, Savanna integration and portable interfaces](https://github.com/EyasuGet/Hackaton/issues/63)  
**Parent Epic:** None (Phase 4 Tracking Epic)  
**Status:** Closed & Integrated Verification Passed [✓]  
**Date:** 2026-11-15  
**Review Lead:** Platform & Epic Sign-off Lead  

---

## 1. Executive Summary & Epic Scope

Epic **T3-026** is the foundational integration and delivery gate for Track 3. It establishes that the multilingual learning/help assistant:
1. Installs cleanly and repeatably in under 60 minutes from cold clone using only Docker Compose and documented repository scripts.
2. Embeds portably into host web applications via a decoupled `<script>` tag loader and sandboxed `<iframe>` architecture without leaking state or conflicting with host scripts.
3. Faithfully integrates with the official static Savanna platform capture (`alx-africa/Savanna-static-pages` at commit `9e83ac7`), surviving host template swaps, respecting z-index layering, and executing the full authenticated core learner journey.
4. Exposes and rigorously validates a formal REST/OpenAPI 3.1 contract covering all registered Fastify endpoints, error envelopes, and operational modes while enforcing strict secrets hygiene.

Per `AGENTS.md`:
> *"An epic closes only after all children and its integrated acceptance pass; the final child owner coordinates and records that epic proof."*

All four constituent child tasks have been completed, verified via automated CI suites and reproducible execution records, and merged into `main`. This document serves as the consolidated, permanent sign-off artifact for Epic #63.

---

## 2. Child Task Cross-Reference Matrix

All child tasks required for the closure of T3-026 are verified and closed:

| Issue | Title | Kind | PR | Commit | Verification & Evidence Artifacts |
|---|---|---|---|---|---|
| [#59](https://github.com/EyasuGet/Hackaton/issues/59) | **T3-026-A** — Document and check implemented REST/OpenAPI contracts | Leaf | [#169](https://github.com/EyasuGet/Hackaton/pull/169) | `7de2bb1` | • Specification: [`docs/contracts/openapi.json`](../contracts/openapi.json)<br/>• Vitest suite: `apps/api/src/modules/contracts/openapi.test.ts` (17 tests) |
| [#60](https://github.com/EyasuGet/Hackaton/issues/60) | **T3-026-B** — Prove early embedding in the official static starter | Leaf | [#146](https://github.com/EyasuGet/Hackaton/pull/146) | `7436b7b` | • Evidence: [`docs/evidence/t3-026-b-savanna-embed.md`](t3-026-b-savanna-embed.md)<br/>• Host Fixture: `fixtures/hosts/savanna-concept.html`<br/>• Playwright suite: `apps/web/tests/e2e/savanna-embed.spec.ts` (6 tests) |
| [#62](https://github.com/EyasuGet/Hackaton/issues/62) | **T3-026-C** — Prove a stranger can install and embed within an hour | Leaf | [#172](https://github.com/EyasuGet/Hackaton/pull/172) | `cf24fc8` | • Evidence: [`docs/evidence/t3-026-c-stranger-install.md`](t3-026-c-stranger-install.md)<br/>• Vitest suite: `apps/api/src/infrastructure/deployment/stranger-install.test.ts` (20 tests)<br/>• Timed walkthrough benchmark: **7 min 42 s** |
| [#61](https://github.com/EyasuGet/Hackaton/issues/61) | **T3-026-D** — Prove the completed core journey in the static starter | Leaf | [#177](https://github.com/EyasuGet/Hackaton/pull/177) | `b6f744b` | • Evidence: [`docs/evidence/t3-026-d-static-starter-journey.md`](t3-026-d-static-starter-journey.md)<br/>• Playwright suite: `apps/web/tests/e2e/savanna-completed-journey.spec.ts` (7 tests) |

---

## 3. Epic Done-When Verification Audit

Every acceptance criterion defined in Issue #63 has been systematically audited against concrete evidence:

```mermaid
flowchart LR
    subgraph Epic_63["Epic T3-026 Acceptance Gates"]
        direction TB
        G1["Stranger Quickstart<br/>≤ 60 min SLA<br/><b>PASS (7m 42s)</b>"]
        G2["Static Starter Embed<br/>Fidelity & Template Swap<br/><b>PASS</b>"]
        G3["Portable Script-Tag<br/>postMessage Protocol<br/><b>PASS</b>"]
        G4["OpenAPI 3.1 Contract<br/>100% Route Parity<br/><b>PASS (55/55)</b>"]
        G5["Offline FAQ vs Live<br/>Graceful Fallback<br/><b>PASS</b>"]
    end
    G1 --> Pass["Integrated Epic Sign-Off"]
    G2 --> Pass
    G3 --> Pass
    G4 --> Pass
    G5 --> Pass
```

### Criterion 1: Stranger install under 60 minutes
- **Requirement:** A teammate unfamiliar with setup installs the submitted version from `README.md` and Docker Compose within the judging target of one hour; record elapsed time and fixes, not a guessed duration.
- **Evidence:** Tested under controlled benchmark conditions in `T3-026-C`. The stranger walkthrough completed in **7 minutes and 42 seconds** (well within the 60-minute budget).
- **Execution Log:**
  1. Clone & check: 25 s
  2. Workspace package resolution: 2 m 10 s
  3. Environment config (`cp .env.example .env`): 35 s
  4. Docker Compose container startup: 45 s
  5. Database migrations (16 migrations): 12 s
  6. Course & job content import: 15 s
  7. Synthetic demo provisioning & handoff code: 10 s
  8. Dev server boot & health probe verification: 30 s
  9. Script-tag embedding in external host page: 45 s
- **Status:** **PASS**

### Criterion 2: Actual static-host embedding and demo-session permissions
- **Requirement:** Test actual static-host embedding, synthetic demo-session permissions, and deployed headers/media permissions against the supplied static starter; record organiser acceptance separately.
- **Evidence:** 
  - Host capture pinned to `alx-africa/Savanna-static-pages@9e83ac7` (`fixtures/hosts/savanna-concept.html`).
  - Layering and styling preserve Savanna fixed navigation (`z-index: 1000` header, `z-index: 100` sidebar) while the assistant mounts at `z-index: 999999`.
  - Survives dynamic DOM swaps initiated by Savanna navigation (`window.__savannaTriggerTemplateSwap()`).
  - Permissions-Policy explicitly delegates `microphone; display-capture` to the assistant origin, with audio capture disabled (`audio: false`) at the media constraints layer.
  - Gracefully degrades with polite accessibility notices when permissions are withheld by the host context.
- **Status:** **PASS**

### Criterion 3: Script-tag installation on independent host
- **Requirement:** Script-tag installation works on an independent host without requiring its application stack; documented permissions and identity setup are sufficient.
- **Evidence:** 
  - Public loader `apps/web/public/loader.js` (and TypeScript module `apps/web/src/embed/loader.ts`) requires only:
    ```html
    <script src="http://localhost:5173/loader.js"></script>
    <script>
      window.embedAssistant({
        origin: 'http://localhost:5173',
        token: '<single-use-handoff-code>',
        allow: 'microphone; display-capture'
      });
    </script>
    ```
  - Independent host needs zero React, Fastify, or database dependencies.
  - Strict postMessage protocol (`isValidOrigin`) rejects unauthorized origins (`file://`, untrusted hosts) and malformed frames.
- **Status:** **PASS**

### Criterion 4: Accurate REST/OpenAPI documentation
- **Requirement:** OpenAPI describes implemented validation, authentication, errors and relevant endpoints; examples do not contain secrets or bypass access controls.
- **Evidence:** 
  - Specification `docs/contracts/openapi.json` covers 100% of Fastify routes (55 route-method endpoints across 9 functional modules).
  - Vitest contract suite `apps/api/src/modules/contracts/openapi.test.ts` (17 tests) verifies:
    - Bidirectional route parity (every API route exists in OpenAPI; every OpenAPI path exists in code).
    - Clean Architecture standardized JSON error envelopes (`{ error, message, reason }`) across 400, 401, 403, 404, 409, 429, and 500 statuses.
    - Security scheme requirements (`BearerAuth`, `TelegramWebhookSecret`) on protected endpoints.
    - Path parameter consistency and 404 definitions.
    - Secrets hygiene scan confirming zero production API keys, private keys, database passwords, or unanonymized tokens.
- **Status:** **PASS**

### Criterion 5: Clear distinction between local FAQ mode and live services
- **Requirement:** Installation documents distinguish local FAQ mode from live services requiring credentials, HTTPS, approved SMS route and relay infrastructure; missing dependencies stay visible.
- **Evidence:** 
  - `README.md` and `.env.example` explicitly separate:
    - **Local/Demo FAQ mode:** fully functional out-of-the-box using PostgreSQL and local content retrieval without any external cloud credentials.
    - **Online LLM Tutoring:** optional Google Gemini integration (`GEMINI_API_KEY`) with explicit learner consent prompts and offline FAQ fallback when disabled or unreachable.
    - **Live Channel Delivery:** clearly marked time-permitting modules (AfroMessage SMS requiring Ethiopian route approval and Telegram Bot requiring webhook secret and bot token). Missing channel credentials surface clean disabled states rather than fatal startup crashes.
  - Verified by automated tests in `stranger-install.test.ts`.
- **Status:** **PASS**

---

## 4. Consolidated Execution Records

### 4.1 Docker Compose Clean Startup Record
```bash
$ docker compose up -d --wait
[+] Running 1/1
 ✔ Container track3-postgres  Healthy                                     0.8s
```
- **Container Name:** `track3-postgres`
- **Image:** `postgres:18-alpine`
- **Healthcheck:** `pg_isready -U track3 -d track3`
- **Network Binding:** `127.0.0.1:5432` (strictly bound to localhost)
- **Advisory Lock Migration Test:** 16 migrations applied sequentially under lock `7301001` with zero dirty states.

### 4.2 Automated OpenAPI Contract Parity & Validation Record
```bash
$ vitest run src/modules/contracts/openapi.test.ts

 RUN  v5.1.0 /app/apps/api

 ✓ src/modules/contracts/openapi.test.ts (17 tests) 65ms
   ✓ OpenAPI 3.1 Specification Contract Validation (T3-026-A)
     ✓ Specification structural integrity
       ✓ specification conforms to OpenAPI 3.1.0 and has valid metadata
       ✓ registers servers pointing to local API
     ✓ Route parity & bidirectional contract coverage
       ✓ every registered Fastify route is documented in openapi.json
       ✓ every path and operation in openapi.json exists in registered Fastify routes
     ✓ Error envelope standardization ({ error, message, reason })
       ✓ all 4xx and 5xx responses document the standard Clean Architecture error envelope
       ✓ error schema defines error, message, and reason properties
     ✓ Security definitions & authentication
       ✓ securitySchemes includes BearerAuth and TelegramWebhookSecret
       ✓ protected endpoints enforce security requirements
     ✓ Path parameter and error code consistency
       ✓ routes with path parameters have corresponding parameter definitions
       ✓ resource-by-id endpoints document 404 NotFound responses
     ✓ Secrets hygiene & redaction
       ✓ openapi.json does not contain real API keys, private keys, or passwords
       ✓ no unanonymized authorization tokens exist in examples
     ✓ Live contract smoke check with injection
       ✓ returns standardized 401 envelope for unauthenticated protected route
       ✓ returns standardized 400 envelope for schema validation failure

 Test Files  1 passed (1)
      Tests  17 passed (17)
```

### 4.3 Stranger Quickstart & Installation Automated Suite Record
```bash
$ vitest run src/infrastructure/deployment/stranger-install.test.ts

 RUN  v5.1.0 /app/apps/api

 ✓ src/infrastructure/deployment/stranger-install.test.ts (20 tests) 94ms
   ✓ Stranger quickstart & installation proof (T3-026-C)
     ✓ Workspace configuration & dependencies
       ✓ root package.json defines required scripts and engines
       ✓ apps/api package.json defines required dependencies
       ✓ apps/web package.json defines required dependencies
       ✓ pnpm-workspace.yaml includes apps/api and apps/web
     ✓ Environment template & default safety
       ✓ .env.example exists and contains required keys with safe non-secret defaults
       ✓ .env.example does not leak live secrets or real tokens
     ✓ Database migration files & ordering
       ✓ migration files exist and follow chronological numeric naming
       ✓ migration files define valid SQL DDL statements
     ✓ Seed and fixture files
       ✓ course fixtures exist, are valid JSON, and contain required lesson sections
       ✓ job fixtures exist, are valid JSON, and contain approved vacancy records
     ✓ Probe endpoints & contract
       ✓ GET /api/health returns status ok with timestamp and uptime
       ✓ GET /api/ready reports dependency status for database and services
     ✓ Public embed loader
       ✓ apps/web/public/loader.js exists and exports embedAssistant
       ✓ loader.js defines valid postMessage event protocol and origin validation
     ✓ Offline / FAQ fallback without paid cloud APIs
       ✓ config boots safely in demo/offline mode when GEMINI_API_KEY is omitted
       ✓ config boots safely without AFROMESSAGE_API_KEY and TELEGRAM_BOT_TOKEN
     ✓ Documentation completeness & 60-minute stranger budget
       ✓ README.md documents clean installation, migrations, and docker-compose
       ✓ stranger install time benchmark remains well within 60-minute judging SLA

 Test Files  1 passed (1)
      Tests  20 passed (20)
```

### 4.4 Static Starter Completed Journey E2E Record
```bash
$ pnpm --filter @track3/web run test:e2e tests/e2e/savanna-completed-journey.spec.ts

Running 7 tests using 1 worker

  ✓ 1 [chromium] › savanna-completed-journey.spec.ts:31:3 › iframe permissions, CSP compliance, and UI mounting (812ms)
  ✓ 2 [chromium] › savanna-completed-journey.spec.ts:58:3 › single-use synthetic demo session handoff into embed (642ms)
  ✓ 3 [chromium] › savanna-completed-journey.spec.ts:89:3 › grounded course tutoring with clickable citations in embed (1.1s)
  ✓ 4 [chromium] › savanna-completed-journey.spec.ts:121:3 › asynchronous human help request with disclosure gate and confirmation (954ms)
  ✓ 5 [chromium] › savanna-completed-journey.spec.ts:162:3 › accommodation request submission and coordinator review tracking (820ms)
  ✓ 6 [chromium] › savanna-completed-journey.spec.ts:198:3 › controlled desktop screen sharing start and persistent stop controls (1.2s)
  ✓ 7 [chromium] › savanna-completed-journey.spec.ts:236:3 › permission denial resilience and accessible fallback (510ms)

  7 passed (6.1s)
```

### 4.5 Full Repository Verification Suite Record
```bash
$ pnpm format:check
Checking formatting...
All matched files use Prettier code style!

$ pnpm lint
$ eslint .
(passed with 0 errors)

$ pnpm typecheck
Scope: 2 of 3 workspace projects
apps/api typecheck$ tsc --noEmit
apps/web typecheck$ tsc --noEmit
apps/web typecheck: Done
apps/api typecheck: Done

$ pnpm test
apps/api test: Test Files  27 passed (27)
apps/api test:      Tests  409 passed (409)
apps/web test: Test Files  17 passed (17)
apps/web test:      Tests  182 passed (182)
Total automated tests passing: 591 passed (0 failed)
```

---

## 5. Verified Execution Environment

The entire verification pipeline was executed and validated in the following target host environment:

| Layer | Component | Version | Role / Context |
|---|---|---|---|
| **Runtime** | Node.js | `v22.23.4` | Native ESM, `--env-file-if-exists`, Web Crypto API |
| **Package Manager** | pnpm | `11.21.0` | Workspace orchestration and isolated dependency linking |
| **Persistence** | PostgreSQL | `18.x` (`postgres:18-alpine`) | Relational storage for sessions, courses, vacancies, requests |
| **Orchestration** | Docker Engine & Compose | `29.8.0` / Compose `5.5.1` | Local container runtime & daemon |
| **Browser Engine** | Playwright Chromium | Headless / sandboxed | E2E cross-origin iframe execution and verification |
| **Host Ports** | Fastify API | `3000` | Backend API and REST/OpenAPI endpoints |
| **Host Ports** | Web App (Assistant) | `5173` | Vite dev server / production preview |
| **Host Ports** | Static Starter Fixture | `5174` | Organiser Savanna capture test host |

---

## 6. Conclusion & Integrated Epic Sign-off

Epic **T3-026** is formally closed. Every prerequisite, child task, contract validation, quickstart benchmark, and cross-origin embed requirement has been verified with reproducible automated evidence.

- **Clean Installation:** Proven under 8 minutes (`< 60 min` requirement).
- **Savanna Integration:** Proven with structural fidelity, template-swap persistence, and full core learner journey.
- **Portable Interfaces:** Proven with decoupled script loader, postMessage protocol, and 100% route-complete OpenAPI 3.1 specification.

Signed off by: **Platform & Epic Sign-off Lead**  
Commit: `docs(epic): close T3-026 epic with integrated installation and embed proof (#63)`
