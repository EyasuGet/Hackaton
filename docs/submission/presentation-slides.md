# Track 3: Multilingual Learning & Career Help Assistant
## Explanatory Slide Deck & Submission Package for ALX Savanna

**Hackathon Track:** Track 3 — Multilingual Learning / Help Assistant  
**Repository:** [https://github.com/EyasuGet/Hackaton](https://github.com/EyasuGet/Hackaton)  
**Lead Engineer:** Eyasu Getaneh & Co-Design Contributors  
**Date:** November 2026  
**License:** Permissive MIT License  

---

## Slide 1: Title & Team

### Track 3: Multilingual Learning & Career Help Assistant
#### An Offline-Resilient, Bilingual, WCAG 2.2 AA Accessible Assistant for ALX Savanna

- **Mission:** Empower technical learners in Ethiopia and East Africa with grounded bilingual tutoring, resilient asynchronous human help, and inclusive career tools.
- **Track:** Track 3 (Multilingual Learning / Help Assistant)
- **Primary Host:** ALX Savanna Technical Learning Platform
- **Engineering Lead:** Eyasu Getaneh ([@EyasuGet](https://github.com/EyasuGet))
- **Co-Design Partners:** Ethiopian tech learners, screen reader evaluators, and academic mentors.
- **Repository:** `https://github.com/EyasuGet/Hackaton`
- **License:** Open Source MIT License (100% permissive runtime dependencies)

> *"Bridging the gap between high-demand technical curricula and low-bandwidth, multilingual realities in East Africa."*

---

## Slide 2: The Problem

### Four Structural Barriers in East African Technical Education

1. **Bandwidth & Connectivity Constraints:**
   - Mobile cellular data (Ethio Telecom, Safaricom) is expensive, high-latency, and frequently interrupted by packet loss or blackouts.
   - Heavy synchronous video streaming and continuous streaming AI chats fail under unstable 3G networks.

2. **Linguistic & Cultural Isolation:**
   - Technical curricula are predominantly English-only.
   - Learners require conceptual clarification in Amharic (አማርኛ) with proper Ge'ez typography and alignment with the Ethiopian Dual Calendar (2017 ዓ.ም. + Gregorian) and local time (EAT, UTC+3).

3. **Assistive Technology Inequity:**
   - Visually impaired learners using screen readers (NVDA on Windows, TalkBack on Android) encounter unlabelled code blocks, missing ARIA live regions, broken tab orders, and untrapped modal focus.

4. **The Synchronous Help Bottleneck:**
   - Synchronous office hours fail when internet connections drop. Learners require durable, asynchronous human support escalation that preserves context without forcing learners to remain constantly online.

---

## Slide 3: The Solution & Architecture

### Clean Architecture, Defense-in-Depth & Zero-Secret Deployment

- **Clean Architecture Principles:**
  - Strict isolation between Domain Rules, Application Use Cases, and Infrastructure Adapters.
  - Domain rules and schemas remain 100% agnostic of HTTP frameworks, database drivers, and external AI SDKs.

- **Production Technology Stack:**
  - **Backend:** Node.js 22-alpine + Fastify 5.12.8 (schema-validated, low memory footprint, unprivileged `node` user).
  - **Frontend:** React 19.3.1 + Vite 8.3.8 SPA (accessible semantic HTML, zero heavy CSS framework bloat, fast load).
  - **Persistence:** PostgreSQL 18.7-alpine (strictly isolated on private `internal_net`, zero host ports exposed).
  - **Reverse Proxy:** Caddy 2.9.1-alpine (automatic ACME HTTPS, HSTS, CSP `frame-ancestors *`, Permissions-Policy).
  - **Media Relay:** Coturn 4.6.3-alpine (optional `--profile relay` STUN/TURN traversal with SSRF protection).

- **Zero-Secret Hygiene & Privacy:**
  - `.env.example` contains only empty string placeholders; mandatory environment parameter substitution.
  - Reverse proxy access logs automatically strip `Authorization` and `Cookie` headers.
  - Zero private credentials, personal student records, or handsets committed to git or built into containers.

```
       +-------------------------------------------------------------+
       |               Caddy Reverse Proxy (HTTPS :443)              |
       +------------------------------+------------------------------+
                                      |
                 +--------------------+--------------------+
                 |                                         |
                 v                                         v
       +--------------------+                    +--------------------+
       |   Static Assets    |                    | Fastify API Server |
       | (/srv/web SPA)     |                    |  (internal_net)    |
       +--------------------+                    +---------+----------+
                                                           |
                                                           v
                                                 +--------------------+
                                                 | PostgreSQL 18 DB   |
                                                 | (no host ports)    |
                                                 +--------------------+
```

---

## Slide 4: Portable Host Integration

### The Decoupled Savanna Static Embed

- **Decoupled `<script>` Loader:**
  - Independent 2KB loader script (`loader.js`) injects a sandboxed `<iframe>` into any host web application with a single call to `window.embedAssistant()`.
  - Zero NPM package installation, React version conflicts, or build-time coupling required on the host.

- **Verified Against Official Savanna Starter:**
  - Tested against the official `alx-africa/Savanna-static-pages` repository pinned at commit `9e83ac7` (`fixtures/hosts/savanna-concept.html`).
  - Assistant mounts gracefully at `z-index: 999999`, preserving Savanna's fixed header (`z-index: 1000`) and sidebar (`z-index: 100`).
  - Survives dynamic DOM template swaps (`window.__savannaTriggerTemplateSwap()`) without losing learner session state.

- **Origin-Restricted postMessage Security:**
  - Bidirectional communication uses a strict message protocol with `isValidOrigin` validation.
  - Rejects untrusted origins, null origins, and rogue parent frames.
  - Standalone application and embedded iframe share identical core capabilities.

---

## Slide 5: Core Journey (1/3) — Grounded Tutoring & Offline Resilience

### Truth-First Course Tutoring with Local Context

1. **Strict Source Grounding & Citations:**
   - All tutoring answers are strictly grounded in institution-approved course lesson units (e.g. *Future of the Virtual Assistant Industry*).
   - Every factual claim generates an accessible citation link mapping directly to the syllabus section.
   - Transparent limitation: If a question falls outside approved course materials, the assistant refuses to hallucinate and offers human support escalation.

2. **Ethiopic Dual Calendar & Addis Ababa Time:**
   - Formats scheduling and lesson milestones with dual calendar representation:
     - Ethiopian Calendar in Ge'ez typography (e.g. `ኅዳር 6 ቀን 2017 ዓ.ም.`)
     - Gregorian counterpart (e.g. `November 15, 2026`)
   - Unambiguous Addis Ababa Time (EAT, UTC+3) ensures clear deadlines across regional cohorts.

3. **Offline Resilience & Curated FAQ Cache:**
   - Progressive Web App (PWA) Service Worker pre-caches approved, non-restricted FAQ units.
   - When offline, a prominent, accessible badge confirms offline state.
   - Transparent honesty: Offline mode answers curated FAQs locally without falsely claiming live cloud AI connectivity or human staff reachability.

---

## Slide 6: Core Journey (2/3) — Voice Review & Asynchronous Human Help

### Accessible Voice Input & Reliable Human Escalation

1. **Consented Voice Input with Review-Before-Send:**
   - Microphone capture requires explicit learner initiation via accessible button.
   - Recorded audio is transcribed into Amharic or English and presented in an editable text box.
   - Learner can inspect, correct, or cancel the transcript before sending.
   - Raw audio data is purged immediately after processing.

2. **Dual-Engine Speech Playback:**
   - Primary: Zero-marginal-cost native browser Web Speech API with accessible speed controls (0.75x to 1.5x).
   - Secondary: High-fidelity cloud TTS adapter with explicit consent dialog.
   - Sound-off parity: Full visual text transcript and citations remain visible on screen at all times.

3. **Asynchronous Human Support Queue:**
   - When AI cannot answer or complex help is needed, learners compose a support ticket.
   - Pre-submission quote preview and privacy disclosure ensure learners control what gets shared.
   - Persistent unread inbox: Replies from authorized staff are stored in PostgreSQL; learners return anytime to view answers.
   - Atomic staff claim queue: Prevents dual-assignment collisions between support agents.

---

## Slide 7: Core Journey (3/3) — Screen Sharing & Career Accommodations

### Controlled Desktop Collaboration & Inclusive Career Tools

1. **Learner-Controlled WebRTC Desktop Screen Sharing:**
   - Screen sharing is initiated solely by the learner from an active support session.
   - Displays a persistent high-contrast red "Stop Sharing" button at all times.
   - Cross-network media traversal powered by STUN/TURN Coturn relay.
   - Mobile Fallback: Automatically detects mobile browsers lacking `getDisplayMedia` support and gracefully routes learners to asynchronous help with pre-filled context.

2. **Approved Career Q&A & Sourced Vacancies:**
   - Answers job-seeking questions strictly from verified active vacancies (e.g. Bilingual Virtual Assistant, Remote Data Specialist).
   - Direct links to verified application portals; refuses to fabricate nonexistent positions.

3. **Confidential Interview Accommodation Requests:**
   - Learners request interview accommodations (e.g. screen reader compatibility, extended time, sign language interpretation) for specific jobs.
   - Submitted privately to authorized coordinators; zero medical diagnostic proof demanded.
   - Strict 7-day retention TTL with automated ephemeral purging.

---

## Slide 8: Co-Design & Accessibility Conformance

### Assessed WCAG 2.1 & 2.2 AA Compliance

- **Automated Accessibility Audit:**
  - Automated testing with `axe-core` v4.14.0 asserting **zero violations** (critical, serious, moderate, minor).
  - 20 comprehensive automated accessibility tests in `apps/web/src/features/assistant/final-accessibility.test.tsx`.

- **Desktop Screen Reader Evaluation (NVDA & JAWS):**
  - Full keyboard accessibility: 100% of interactive controls reachable via `Tab` / `Shift+Tab`.
  - Visible focus rings with >= 3:1 contrast against all backgrounds.
  - Skip navigation link to jump directly to assistant dialogue.
  - Dynamic updates announced via polite ARIA live regions (`aria-live="polite"`), preventing focus disruption.

- **Mobile Screen Reader Evaluation (Android TalkBack):**
  - Tested on entry-level Android handset (3GB RAM) under throttled 3G connectivity (300ms RTT, 750 kbps).
  - All 7 core mobile tasks completed unaided: language toggle, audio playback, FAQ lookup, ticket creation, inbox review, job Q&A, accommodation filing.

- **Visual & Motor Ergonomics:**
  - 200% text zoom reflow without clipping, overlap, or horizontal scroll.
  - Responsive reflow at 320 CSS px width.
  - Contrast ratios >= 4.5:1 for body copy and >= 3:1 for graphical boundaries.
  - Minimum touch target sizes of 44x44 CSS px.

---

## Slide 9: Operating Economics & Sustainability

### Realistic Monthly Operating Cost for 1,000 Active Learners/Month

| Category | Provider / Architecture | Sizing & Activity | Monthly Cost (USD) | Cost in ETB (@ 120 ETB/$) |
|---|---|---|---|---|
| **Linux VPS Hosting** | Hetzner / DigitalOcean | 2 vCPU, 4GB RAM, 50GB NVMe | 5.00 – 5.00 | ETB 1,800 – 3,000 |
| **Relational Database** | Co-located PostgreSQL 18 | NVMe storage, automated backups | bash.00 (colocated) | ETB 0.00 |
| **SMS Notifications** | AfroMessage (Ethiopian Gateway) | ~2,500 Amharic UCS-2 segments | .30 – .50 | ETB 875 – 1,020 |
| **WebRTC TURN Bandwidth** | Coturn Media Relay | ~100 screen sessions (~5.6 GB egress) | .00 – 0.00 | ETB 600 – 1,200 |
| **AI Tutor Inference** | Google Gemini 1.5 Flash *(or Local Gemma)* | ~3,000 queries (2.4M in / 750k out tokens) | bash.41 – .00 | ETB 50 – 120 |
| **Speech Synthesis (TTS)** | Native Web Speech API | Client-side native synthesis | bash.00 | ETB 0.00 |
| **TOTAL ESTIMATED COST** | **Self-Hosted Hybrid Stack** | **1,000 Active Learners / Month** | **5.00 – 0.00** | **~ETB 4,200 – 7,200** |

#### Cost Sustainability Highlights:
- **Per-Learner Cost:** Under **bash.06 per active learner per month** (~7 ETB).
- **Replaceable AI Strategy:** Complete port-and-adapter seam enables zero-marginal-cost local inference (Gemma 2 9B via Ollama) or sub-dollar cloud inference (Gemini 1.5 Flash @ bash.41/mo).
- **Ethiopic Character Budgeting:** Explicit accounting for UCS-2 encoding (70 chars/single, 67 chars/concatenated segment) for local telecom billing via AfroMessage.

---

## Slide 10: Submission Matrix & Honest Coverage Disclosure

### Centralized Artifact Matrix & Capability Ledger

#### 1. Centralized Submission Links
- **GitHub Repository:** [https://github.com/EyasuGet/Hackaton](https://github.com/EyasuGet/Hackaton)
- **Hosted Core MVP:** `http://localhost/` (Staging: `https://track3.demo.et`)
- **Savanna Static Embed Demo:** `fixtures/hosts/savanna-concept.html`
- **OpenAPI 3.1 Specification:** [`docs/contracts/openapi.json`](../contracts/openapi.json)
- **WCAG 2.2 AA Conformance Report:** [`docs/conformance.md`](../conformance.md)
- **Packaging & Cost Worksheet:** [`docs/evidence/t3-027-a-package-and-operating-costs.md`](../evidence/t3-027-a-package-and-operating-costs.md)
- **Full-Brief Gate Reconciliation:** [`docs/evidence/t3-027-c-full-brief-gate.md`](../evidence/t3-027-c-full-brief-gate.md)
- **Stranger Quickstart Guide:** Cold-clone installation in **7 minutes and 42 seconds** via Docker Compose.

#### 2. Honest Capability Ledger

| Functional Area | Delivered Scope | Evidence & Status |
|---|---|---|
| **Core Baseline MVP** | Grounded Tutoring, Offline FAQ, Voice Review, Speech Synthesis, Async Help Queue, Screen Sharing, Job Q&A, Accommodation Workflow | **100% COMPLETE & VERIFIED** (All Phase 1–4 issues closed; 364 tests passing) |
| **Built Secondary Channels** | Subscribed SMS Job Alerts via AfroMessage with HMAC challenge phone verification and `STOP`/`ማቆም` opt-out | **BUILT & VERIFIED** (T3-021 closed; integration tests passing) |
| **Environmental Boundaries** | Savanna SSO simulated via cryptographically signed synthetic demo tokens; Mobile screen sharing routes gracefully to async help | **HONESTLY DISCLOSED** (No organizer backend identity API was provided) |
| **Deferred Secondary Scope** | Interactive Telegram bot tutoring & Telegram voice synthesis | **DEFERRED (Time-Permitting)** (Decoupled; does not block core MVP) |

---

## Slide 11: Conclusion & Q&A

### Transforming Technical Learning in East Africa

- **Robust & Resilient:** Works reliably on unstable networks and entry-level mobile devices.
- **Bilingual & Cultural:** Seamless Amharic & English support with Ethiopic Dual Calendar.
- **Accessible to All:** Rigorously tested WCAG 2.2 AA compliance with zero axe-core violations.
- **Sustainable & Open:** Ultra-low operating cost (5–0/mo for 1,000 learners) with clean MIT open-source licensing.

**Thank you to the ALX Savanna Hackathon Organizers, Judges, and Co-Design Participants!**

- **Project Repository:** `https://github.com/EyasuGet/Hackaton`
- **Explore Hosted Demo:** Run `docker compose -f compose.deployment.yaml up -d` and visit `http://localhost/`
