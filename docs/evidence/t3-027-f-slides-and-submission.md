# T3-027-F — Explanatory Slides & Submission Package Evidence

**Date:** 2026-11-15  
**Issue:** [#68 — [T3-027-F] Prepare the explanatory slides and final submission links](https://github.com/EyasuGet/Hackaton/issues/68)  
**Parent Epic:** [#101 — [T3-027] Finish the core demo, package it, and audit full-brief coverage](https://github.com/EyasuGet/Hackaton/issues/101)  
**Deliverables:**
1. Structured Markdown Slide Deck: [`docs/submission/presentation-slides.md`](../submission/presentation-slides.md)
2. Standalone Accessible HTML Presentation Deck: [`docs/submission/presentation.html`](../submission/presentation.html)
3. Submission Evidence & Demonstration Script: [`docs/evidence/t3-027-f-slides-and-submission.md`](t3-027-f-slides-and-submission.md)
**Status:** **AUDITED & VERIFIED (Ready for PR & Epic Closure)** [✓]  

---

## 1. Executive Summary & Purpose

Milestone **T3-027-F** completes the explanatory slide deck, centralized submission matrix, and rehearsed demonstration walkthrough for the **Track 3 Multilingual Learning & Career Help Assistant**.

Per `AGENTS.md` and Issue #68:
> *"After the core is finished, create the concise slide deck using the organiser template if available. Explain the user problem, observed improvement, implementation/integration, demo steps, operating needs and honest coverage gaps; collect final links and rehearse the presentation. A reader understands the project without the team explaining it live; deck and demo agree about what works, what is deferred and what is synthetic."*

As the final leaf deliverable of tracking Epic #101, this milestone unifies all engineering artifacts, accessibility evaluations, cost models, and deployment configurations into an executive submission package suitable for hackathon judges, platform evaluators, and co-design stakeholders.

---

## 2. Centralized Submission Matrix

All authoritative project assets, live runtime endpoints, formal specifications, and evaluation records are indexed below:

| Submission Asset | Resource / Link | Description & Verification Evidence |
|---|---|---|
| **Official Repository** | [`github.com/EyasuGet/Hackaton`](https://github.com/EyasuGet/Hackaton) | Root repository containing full source code, commit history, and tests. |
| **Hosted Core MVP** | `http://localhost/` (Staging: `https://track3.demo.et`) | Hardened production Docker Compose deployment behind Caddy reverse proxy. ([Evidence](t3-027-e-hosted-mvp.md)) |
| **Savanna Static Embed** | `fixtures/hosts/savanna-concept.html` | Decoupled 2KB script-tag loader embedding assistant in official Savanna capture. ([Evidence](t3-026-b-savanna-embed.md)) |
| **OpenAPI 3.1 Contract** | [`docs/contracts/openapi.json`](../contracts/openapi.json) | Complete REST API contract (55 verified schemas, 100% route parity). ([Evidence](t3-026-epic-closure.md)) |
| **WCAG 2.2 AA Audit** | [`docs/conformance.md`](../conformance.md) | Verified accessibility audit (0 axe-core violations, NVDA, TalkBack, 200% zoom). ([Evidence](t3-025-a-accessibility-desktop.md)) |
| **Packaging & Costs** | [`docs/evidence/t3-027-a-package-and-operating-costs.md`](t3-027-a-package-and-operating-costs.md) | MIT license audit and real-world $35–$60/mo operating cost worksheet for 1,000 learners. |
| **Full-Brief Gate** | [`docs/evidence/t3-027-c-full-brief-gate.md`](t3-027-c-full-brief-gate.md) | Trace-level reconciliation of all written-brief requirements and disclosures. |
| **Stranger Quickstart** | [`docs/evidence/t3-026-c-stranger-install.md`](t3-026-c-stranger-install.md) | Cold-clone setup executed in **7 minutes and 42 seconds** via Docker Compose. |
| **Slide Deck (Markdown)** | [`docs/submission/presentation-slides.md`](../submission/presentation-slides.md) | 11-slide presentation deck covering problem, architecture, journey, a11y, and costs. |
| **Slide Deck (HTML)** | [`docs/submission/presentation.html`](../submission/presentation.html) | Self-contained, responsive, WCAG-accessible interactive HTML slide presentation. |

---

## 3. Rehearsal Walkthrough Protocol & Demonstration Script

A self-guided evaluator or judge can rehearse the full 7-step core learner journey in **under 10 minutes** using the following step-by-step demonstration protocol:

### Step 0: Boot the Production Deployment Stack
```bash
# Clone and enter workspace:
git clone https://github.com/EyasuGet/Hackaton.git track3-assistant
cd track3-assistant

# Configure local password and launch stack:
cp .env.example .env
sed -i 's/DATABASE_PASSWORD=/DATABASE_PASSWORD=demo-pass-2026/' .env
pnpm install --frozen-lockfile && pnpm build

DATABASE_NAME=track3 DATABASE_USER=track3 DATABASE_PASSWORD=demo-pass-2026 \
  docker compose -f compose.deployment.yaml up -d --wait

# Apply migrations, seed course content, and provision demo principals:
docker compose -f compose.deployment.yaml exec api node apps/api/dist/migrate.js
docker compose -f compose.deployment.yaml exec api node apps/api/dist/import-content.js
docker compose -f compose.deployment.yaml exec api node apps/api/dist/import-jobs.js
docker compose -f compose.deployment.yaml exec -e DEMO_MODE=true api node apps/api/dist/provision-demo.js
```

### Step 1: Grounded Bilingual Course Tutoring & Citations
1. Open `http://localhost/` in a browser.
2. Generate an authenticated session for **Learner A** (`VA Industry` course):
   ```bash
   docker compose -f compose.deployment.yaml exec -e DEMO_MODE=true api node apps/api/dist/demo-handoff.js learner-a
   ```
3. In the assistant input box, ask:
   *"What are the key skills of a virtual assistant?"*
4. **Observe:** The assistant returns a grounded response citing *Section 1: Core Competencies* of the course syllabus. Click the citation badge to inspect the linked syllabus source.
5. In the header, toggle language to **Amharic (አማርኛ)** and observe:
   - Full interface translates to Amharic.
   - Date formats display in Ethiopic Calendar (e.g. `ኅዳር 6 ቀን 2017 ዓ.ም.`).

### Step 2: Truthful Refusal & Out-of-Scope Fallback
1. While still in tutoring mode, ask an unlisted question outside the course material:
   *"How do I bake Ethiopian Injera?"*
2. **Observe:** The assistant truthfully refuses to fabricate an answer:
   *"This topic is outside the approved course syllabus. Would you like to ask human support?"*
   No ungrounded internet search or false claims are produced.

### Step 3: Reviewed Voice Input & Audio Synthesis
1. Click the microphone icon next to the chat input (browser requests microphone consent).
2. Speak a short question: *"Explain remote work tools."*
3. **Observe:** The audio is captured, transcribed, and displayed in an editable textarea for review *before* being submitted. The learner can edit typos or cancel.
4. Click **Play Audio** on the assistant response.
5. **Observe:** Audio plays smoothly via browser Web Speech API with speed adjustment controls (0.75x to 1.5x), while the full text transcript remains visible.

### Step 4: Asynchronous Human Help Ticket & Persistent Inbox
1. Click **Get Human Help** in the assistant menu.
2. Notice the pre-submission privacy disclosure: *"Only authorized staff will see this question and the selected quote preview."*
3. Enter a question: *"I need clarification on the client communication module."* Click **Submit Request**.
4. Refresh the browser page or simulate browser closure.
5. **Observe:** Open the **Help Inbox** tab. The request is persisted in PostgreSQL with status `waiting`.
6. Claim and reply as Support:
   - In a second browser window (or via curl), log in as principal `support`.
   - Support claims the ticket atomically and sends a reply: *"Review Chapter 3, page 12 for communication protocols."*
7. Return to Learner A's inbox: Notice the polite unread indicator badge and the persisted reply.

### Step 5: Learner-Controlled WebRTC Screen Sharing
1. Within an active support session, click **Request Screen Share**.
2. **Observe:** The learner is presented with an explicit browser screen capture picker.
3. Upon selecting a window/screen, a prominent, high-contrast red **Stop Sharing** button appears.
4. Verify that clicking **Stop Sharing** immediately kills the media tracks, clears active peer connections, and notifies the peer.
5. On mobile viewports (simulated via responsive devtools at 375px), observe that the screen share button gracefully provides an informational banner routing the user to asynchronous text help.

### Step 6: Approved Career Q&A & Interview Accommodations
1. Navigate to the **Careers & Jobs** tab.
2. Ask: *"What remote data entry jobs are available?"*
3. **Observe:** Sourced job listing for *Remote Data Specialist* appears with verified vacancy citations and direct link.
4. Select the job and click **Request Interview Accommodation**.
5. Fill out the accommodation form:
   - Type: *Screen Reader Accessibility & Extended Time*
   - Description: *Require JAWS/NVDA compatibility and 15 extra minutes for assessment.*
6. **Observe:** Notice the privacy disclosure: *"This request is confidential and sent only to the interview coordinator. No medical diagnosis or proof is required."*
7. Submit and verify confirmation with 7-day retention expiry note.

### Step 7: Offline PWA FAQ Resilience
1. In Chrome DevTools, open the **Network** tab and toggle **Offline**.
2. Reload `http://localhost/`.
3. **Observe:** The PWA Service Worker serves the application shell and the cached public FAQ database.
4. An accessible banner announces: *"You are currently offline. Viewing cached FAQs."*
5. Search FAQ for *"How do I reset my password?"* — Instant local response with zero errors.

---

## 4. Slide Deck Verification & Message Fidelity Audit

The presentation slides ([`presentation-slides.md`](../submission/presentation-slides.md) and [`presentation.html`](../submission/presentation.html)) were audited against the repository implementation and actual evidence:

```
+---------------------------------------------------------------------------------------------------------+
| Slide Topic            | Script / Deck Claim                        | Verified Implementation Truth    |
+---------------------------------------------------------------------------------------------------------+
| 1. Title & Team        | Track 3 Assistant for ALX Savanna          | Verified in spec.md & repo root |
|                        | MIT License, Lead: Eyasu Getaneh           | 100% Permissive dependencies     |
|                        |                                            |                                  |
| 2. The Problem         | 3G bandwidth, Amharic isolation,           | Verified via co-design feedback, |
|                        | screen reader barriers, sync bottlenecks   | NVDA/TalkBack test evidence      |
|                        |                                            |                                  |
| 3. Architecture        | Fastify, React 19, PostgreSQL 18, Caddy    | Verified in compose.deployment   |
|                        | Zero-secret parameterization, clean ports  | 0 secrets in git; unprivileged   |
|                        |                                            |                                  |
| 4. Savanna Embed       | 2KB loader.js, iframe, postMessage         | Verified against static capture  |
|                        | Tested with official starter at 9e83ac7    | fixtures/hosts/savanna-concept   |
|                        |                                            |                                  |
| 5. Tutoring & Offline  | Strict course citations, truthful refusal  | 100% grounded in lesson units;   |
|                        | Ethiopic dual calendar, SW FAQ cache       | Service worker offline tested    |
|                        |                                            |                                  |
| 6. Voice & Async Help  | Consented voice with transcript review     | Editable transcript before send; |
|                        | Web Speech API + persistent staff queue    | Atomic support claim in Postgres |
|                        |                                            |                                  |
| 7. Media & Careers     | WebRTC screen share with stop button       | Tested across networks;          |
|                        | Sourced jobs & confidential accommodations | No medical diagnosis required    |
|                        |                                            |                                  |
| 8. Accessibility       | WCAG 2.1/2.2 AA, 0 axe-core violations     | 20 automated a11y tests passing; |
|                        | NVDA, TalkBack 3G, 200% zoom reflow        | docs/conformance.md confirmed    |
|                        |                                            |                                  |
| 9. Economics & Costs   | $35–$60/mo for 1,000 learners (~ETB 5,000) | Calibrated AfroMessage tariffs,  |
|                        | VPS $15–$25, Gemini Flash $0.41/mo         | Hetzner VPS & Coturn bandwidth   |
|                        |                                            |                                  |
| 10. Submission Matrix  | Core MVP 100% complete; secondary SMS      | Honest Capability Ledger;        |
|                        | alerts built; Telegram bot deferred        | Telegram bot honestly disclosed  |
|                        |                                            |                                  |
| 11. Conclusion         | Accessible, sustainable, bilingual AI      | Summary & repo links verified    |
+---------------------------------------------------------------------------------------------------------+
```

### Truth-in-Reporting Guarantees:
1. **Zero Invented Metrics:** No fabricated user counts, simulated uptime statistics, or unmeasured latency numbers.
2. **Honest Scope Boundary:** Explicitly discloses that full-brief Telegram bot chat is deferred as a time-permitting secondary channel, while the core baseline web platform and SMS alerts are 100% complete.
3. **Synthetic Session Boundary:** Honestly notes that the Hackathon organizers provided a static frontend capture (`alx-africa/Savanna-static-pages`) but no live identity backend; tested using cryptographically verified synthetic session handoff codes.

---

## 5. Automated Verification & Artifact Integrity Checks

All workspace linting, formatting, static typechecks, and automated tests have been executed:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
```

### Verification Outcomes:
- **Linting (`eslint .`):** **Passed** with 0 errors and 0 warnings.
- **Formatting (`prettier --check .`):** **Passed**; all files match Prettier code style.
- **Static Typing (`tsc --noEmit`):** **Passed** across both `@track3/api` and `@track3/web` with 0 errors.
- **Automated Tests (`vitest run`):** **Passed** (364 tests passed across 31 test files).
- **Accessibility Tests (`final-accessibility.test.tsx`):** **Passed** (20/20 tests passed; 0 axe-core violations).

---

## 6. Milestone Sign-Off & Recommendation

Milestone **T3-027-F (#68)** is completely implemented, verified, and audited:
- [✓] Structured presentation slides created at [`docs/submission/presentation-slides.md`](../submission/presentation-slides.md).
- [✓] Self-contained, responsive, accessible interactive HTML presentation created at [`docs/submission/presentation.html`](../submission/presentation.html).
- [✓] Centralized submission matrix and rehearsal demonstration script documented.
- [✓] Slide claims audited for 100% fidelity with the actual codebase and evidence records.
- [✓] Zero leaked secrets or credentials in any submission artifacts.
- [✓] All automated lint, format, typecheck, and unit test suites passing cleanly.

**Final Result:** **T3-027-F READY FOR PR MERGE & EPIC #101 CLOSURE** [✓]
