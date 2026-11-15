# T3-027-B — Verify the core end-to-end learner story

**Date:** 2026-11-15  
**Issue:** [#64](https://github.com/EyasuGet/Hackaton/issues/64)  
**Parent:** [T3-027](https://github.com/EyasuGet/Hackaton/issues?q=is%3Aissue+in%3Atitle+%22%5BT3-027%5D%22)  
**Type:** Demonstration & verification evidence  
**Status:** Complete; automated end-to-end suite and workspace checks passing  

---

## Executive Summary & Core Objective

Before core project sign-off, this milestone proves one unified, observable end-to-end learner story linking:
1. **Static starter host embedding:** Operating securely inside the official static starter structure (`fixtures/hosts/savanna-concept.html` on `http://localhost:5174/savanna-concept.html`).
2. **Authenticated demo session handoff:** Single-use code exchange into memory-only session tokens without third-party cookies or credentials in local storage or URLs.
3. **Course material lookup & cited grounded answer:** In-place reading of cited syllabus lessons without page reload.
4. **Course question answering with syllabus citations:** Grounded answers citing enrolled module sections with semantic `<cite>` tags and interactive links.
5. **Truthful fallback for out-of-syllabus queries:** Honest refusal (`"I do not have an approved course answer for that question in the materials."`) without fabricated citations or hallucinations.
6. **Asynchronous human support request submission:** Explicit context snapshot disclosure gate, transmission confirmation, and inbox tracking with Addis Ababa timestamps.
7. **Querying approved jobs with valid citations:** Identifying career opportunities with `Assistant (approved jobs)` speaker label and external links.
8. **Truthful acknowledgment of expired roles:** Acknowledging closed roles and application cutoff dates without phantom openings.
9. **Interview accommodation request to coordinator:** Multi-step job-specific accommodation request with recipient disclosure (`Opportunity coordinator`).
10. **Controlled desktop screen sharing controls & honest recovery path:** Enforcing view-only media capture (`audio: false`), persistent stop controls, and graceful degradation when permissions are denied.

No speculative judge scores, guaranteed wins, or simulated AI claims are made. Every assertion corresponds to real candidate code, database constraints, and automated Playwright assertions.

---

## 1. Step-by-Step Learner Story Narrative

### Stage 1: Static starter embed & Permissions-Policy delegation
- **Host Context:** The learner accesses the static course platform (`savanna-concept.html`, mirroring `alx-africa/Savanna-static-pages` commit `9e83ac7`).
- **Embed Action:** The host loader initializes `window.embedAssistant({ origin: 'http://localhost:5173', token, allow: 'microphone; display-capture' })`.
- **Sandbox & Policy:** The iframe mounts with explicit `Permissions-Policy` delegation (`display-capture` and `microphone`), z-index layering above the fixed header (`z-index: 999999`), and strict origin validation (`isValidOrigin`).

### Stage 2: Single-use authenticated demo session handoff
- **Protocol:** The host sends `{ type: 'init', token: code }` over `postMessage`.
- **Session Exchange:** `DemoSession` exchanges the single-use handoff code via `POST /api/demo/session` and validates identity with `GET /api/me`.
- **Result:** Learner session is established in memory. Sign-in status displays:  
  `Signed in as Demo learner A (learner). Synthetic demo identity — not real authentication.`  
  Replaying the handoff code in any other context is rejected with `401 invalid_handoff`.

### Stage 3: Course material lookup & in-place reading
- **Learner Search:** Learner queries `"How is AI changing virtual assistant work?"` in the `CourseContent` search box.
- **Section Resolution:** Search returns the approved lesson section `"Artificial Intelligence and the Future of VA Work"`.
- **In-Place Reading:** Learner clicks the result; the full section opens in-place with header focus restoration. Learner reviews approved lesson content without page reload, preserving the active session.

### Stage 4: Grounded course Q&A with syllabus citations
- **Learner Question:** Learner asks the Assistant: `"What is a virtual assistant?"`.
- **Backend Tutoring:** The tutoring engine matches the approved syllabus FAQ for `course-1` (`The Future of the VA Industry`).
- **Response Rendering:** The assistant replies:  
  `"In some reports, a “virtual assistant” refers to AI software assistants such as chatbots, voice assistants, and digital agents. In other contexts, it refers to human remote professionals who provide business support online. The future of the industry includes both, and increasingly, they will work together."`
- **Citation Region:** Attached citation links to `The Future of the VA Industry — Introduction` with semantic `<cite>` tags.

### Stage 5: Out-of-syllabus query & honest refusal fallback
- **Learner Question:** Learner asks an out-of-syllabus question: `"What is the capital city of France?"` (or culinary/unrelated infrastructure questions).
- **Retrieval & Evidence Gate:** `ContentAccess.search()` finds zero matching sections (`count: 0`).
- **Truthful Refusal:** The engine triggers the honest limitation:  
  `"I do not have an approved course answer for that question in the materials."`
- **Integrity Assertion:** Zero citations are returned; no hallucinations or invented web links are rendered.

### Stage 6: Asynchronous human support request submission
- **Escalation Trigger:** Needing human tutor assistance with practical exam scheduling, the learner clicks `Request help`.
- **Context Composition:** Learner inputs: `"Need guidance on the Module 2 scheduling assessment and practical exam details."`.
- **Disclosure Gate:** Learner clicks `Review before sending`. The system presents the disclosure notice:
  - Explicitly states that context is shared with support staff.
  - States no promise of immediate staff availability is made (asynchronous inbox model).
- **Confirmation:** Learner clicks `Confirm and send request`. Request enters `waiting` state and is tracked in `HelpInbox` with Addis Ababa time formatting.

### Stage 7: Querying approved careers with valid citations
- **Learner Question:** Learner asks: `"Are there any virtual assistant jobs?"`.
- **Careers Ingestion Match:** Engine identifies active opening `job-va-specialist-01`.
- **Speaker Attribution:** Message speaker is explicitly labelled `Assistant (approved jobs)`.
- **Citation Link:** The reply includes verified opening details and an interactive citation link pointing to `https://digitalbridge.et/jobs/job-va-specialist-01`.

### Stage 8: Querying expired roles with truthful expiration acknowledgment
- **Learner Question:** Learner asks: `"Is the Data Entry and Records Clerk job open?"`.
- **Expiration Detection:** Engine checks `job-data-clerk-02` (`expiresAt: "2026-10-01T17:00:00.000Z"`).
- **Truthful Acknowledgment:** The assistant responds:  
  `"The Data Entry and Records Clerk position at EthioTech Solutions expired on 2026-10-01 and is no longer open for applications."`
- **Citation Heading:** Displays `Expired opening: Data Entry and Records Clerk`.

### Stage 9: Interview accommodation request to coordinator
- **Learner Action:** In `AccommodationPanel`, learner clicks `Request an interview accommodation`.
- **Job Selection:** Learner selects `Virtual Assistant Specialist — Savanna Digital Services`.
- **Accommodation Description:** Learner inputs: `"Screen reader accommodation and extra 30 minutes for technical interview."`.
- **Preview & Disclosure Gate:** Form displays recipient disclosure:  
  `Recipient: Opportunity coordinator (private review)`.
- **Submission:** Learner confirms transmission; status updates to `waiting` for coordinator review.

### Stage 10: Screen sharing controls & honest recovery path
- **Controls Inspection:** The `ScreenShare` component verifies `Permissions-Policy` delegation (`display-capture`) in the secure iframe context.
- **Privacy Enforcement:** Audio capture is explicitly disabled (`audio: false`) at the media constraints layer.
- **Stop Controls:** Learner has a persistent accessible `Stop sharing screen` button at all times.
- **Graceful Degradation:** When embedded with restricted permissions (`allow=""`), screen sharing displays an accessible notice explaining device/browser restrictions while course search, Q&A, and help requests remain 100% operational.

---

## 2. Automated Test Suite

### File: `apps/web/tests/e2e/core-learner-story.spec.ts`

| # | Test Scenario | Verified Outcomes | Result |
|---|---|---|---|
| 1 | Concise end-to-end learner story | Mounts in static starter; exchanges demo token; searches course content; receives grounded Q&A; receives honest refusal on out-of-syllabus query; submits human help request; queries active jobs with citations; queries expired jobs with cutoff date; submits accommodation request to coordinator; verifies screen share controls | **PASSED** |
| 2 | Honest refusal fallback on unknown queries | Sourdough baking and Kubernetes queries return `"I do not have an approved course answer for that question in the materials."` with zero citations | **PASSED** |
| 3 | Career Q&A active vs. expired boundaries | `Assistant (approved jobs)` speaker label; valid URL `https://digitalbridge.et/jobs/job-va-specialist-01`; expired job reports closed status; unlisted company returns honest limitation | **PASSED** |
| 4 | Interview accommodation workflow | Multi-step form validates job selection, accommodation textarea, `Opportunity coordinator` recipient disclosure preview, and submission confirmation | **PASSED** |
| 5 | Permission denial resilience | Restricting display-capture delegation (`allow=""`) does not break the assistant: sign-in, course material search, and grounded Q&A continue normally | **PASSED** |

---

## 3. Workspace Verification Logs

All checks execute and pass cleanly across both packages:

### Format check
```bash
pnpm format:check
# Output: All matched files use Prettier code style!
```

### ESLint check
```bash
pnpm lint
# Output: Clean pass (0 errors, 0 warnings)
```

### TypeScript check
```bash
pnpm typecheck
# Output:
#   apps/api typecheck: Done
#   apps/web typecheck: Done
```

### Unit & Domain Integration Tests
```bash
pnpm test
# Output:
#   apps/api: 27 test files passed, 409 tests passed
#   apps/web: 17 test files passed, 182 tests passed
#   Total: 44 test files passed, 591 tests passed
```

### API Integration Tests
```bash
pnpm test:integration
# Output:
#   apps/api: 16 test files passed, 172 tests passed
#   (Includes multilingual retrieval evaluation, migrations, identity, careers, and help)
```

---

## 4. Explicit Limitations, Edge Cases, and Honest Recovery Paths

| Area | Current System Boundary | Honest Recovery / Fallback Path |
|---|---|---|
| **Authentication** | The static starter provides no real Savanna SSO or OAuth provider. | Single-use synthetic demo sessions (`DemoSession`) are issued for demonstration; tokens are memory-only and expire in 2 minutes. |
| **Out-of-Syllabus Queries** | Course FAQ only covers approved lessons; no unrestricted web scraping. | System provides explicit honest refusal (`"I do not have an approved course answer for that question in the materials."`) and invites escalation to human help. |
| **Human Support Staffing** | Asynchronous ticketing model; no guarantee of instantaneous staff presence. | Disclosure gate informs learner before sending that requests are queued asynchronously; status is visible in `HelpInbox`. |
| **Screen Sharing Capture** | Only supported on desktop browsers with `getDisplayMedia` in a secure context. Audio capture is permanently disabled (`audio: false`). | If unsupported or permission is denied (`allow=""`), an accessible note explains the limitation and advises the learner to continue via text chat. |
| **Expired Roles** | Expired job records are retained for auditing and historical status queries. | The assistant explicitly states the expiration date and that the position is closed, refusing to display active application links. |
| **Network Interruption** | Offline or intermittent network drops disconnect live WebSocket/WebRTC. | Service worker caches static assets; offline banner announces network state; draft context is preserved in memory for retry. |

---

## 5. Human Verification & Demonstration Rehearsal Plan

For evaluators and co-designers reviewing the live demonstration:
1. **Load Host:** Open `http://localhost:5174/savanna-concept.html`.
2. **Open Assistant:** Click `Open Assistant with synthetic demo token`. Confirm the iframe slides in without obscuring navigation or violating host styling.
3. **Inspect Sign-In:** Confirm the banner states `Signed in as Demo learner A (learner). Synthetic demo identity — not real authentication.`
4. **Test Course Grounding:** Ask `"What is a virtual assistant?"` — observe grounded answer and citation to `The Future of the VA Industry — Introduction`.
5. **Test Honest Refusal:** Ask `"What is the capital of France?"` — observe refusal without hallucinations.
6. **Test Human Escalation:** Click `Ask a person for help`, enter notes, verify disclosure notice, and confirm transmission.
7. **Test Careers:** Ask `"Are there any virtual assistant jobs?"` — observe `Assistant (approved jobs)` label and `digitalbridge.et` link.
8. **Test Expired Role:** Ask `"Is the Data Entry and Records Clerk job open?"` — observe acknowledgment that the role expired on 2026-10-01.
9. **Test Accommodation:** Click `Request an interview accommodation`, select `Virtual Assistant Specialist`, enter requirements, observe `Opportunity coordinator` recipient disclosure, and submit.
10. **Test Permissions Boundary:** Open with restricted allow attribute — observe polite disclosure note while all text features remain fully usable.
