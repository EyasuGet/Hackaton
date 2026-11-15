# Track 3 — Accessible Learning & Career Assistant for Ethiopia

[![CI](https://github.com/EyasuGet/Hackaton/actions/workflows/ci.yml/badge.svg)](https://github.com/EyasuGet/Hackaton/actions/workflows/ci.yml)
[![WCAG 2.2 AA Conformance](https://img.shields.io/badge/accessibility-WCAG%202.2%20AA-success)](docs/conformance.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An accessible, bilingual (Amharic & English), privacy-first learning and career assistant built for Ethiopian digital skills training and employment pathways. Designed for learners with low-bandwidth connections, visual impairments, and varied assistive tech needs.

---

## 🌟 Key Features & Hackathon Brief Alignment

| Feature Category | Capability | Status | Implementation Details |
|---|---|---|---|
| **Must-Have Core** | **Cited Bilingual Course Tutoring** | ✅ Complete | Grounded course Q&A in Amharic & English with honest citations and refusal when out-of-domain. |
| **Must-Have Core** | **Strict Consent & Privacy Gate** | ✅ Complete | Cloud AI processing never occurs without explicit learner opt-in; offline local fallback by default. |
| **Must-Have Core** | **Voice Input with Review Note** | ✅ Complete | High-accuracy transcription with an editable preview before submitting queries. |
| **Must-Have Core** | **Read-Aloud Audio** | ✅ Complete | Natural speech synthesis in English and Amharic with polite live region screen-reader announcements. |
| **Must-Have Core** | **Persistent Human Help Inbox** | ✅ Complete | Bidirectional threaded messaging with human mentors when AI cannot resolve questions. |
| **Must-Have Core** | **Desktop Screen Sharing** | ✅ Complete | WebRTC-based low-latency visual sharing with mentor drawing overlay and immediate privacy stop. |
| **Career Gateway** | **Approved Job Search & Q&A** | ✅ Complete | Direct answers on requirements and deadlines citing approved local Ethiopian opportunities. |
| **Career Gateway** | **Confidential Accommodations** | ✅ Complete | Request disability accommodations directly to coordinators with explicit disclosure previews. |
| **Career Gateway** | **SMS Job Alert Subscriptions** | ✅ Complete | SMS delivery with strict Ethiopian phone verification and zero-friction `ማቆም` opt-out. |
| **Adoption & Ext** | **Employer Recruitment Portal** | ✅ Complete | Dedicated dashboard for employers to review candidates who explicitly consented to share profiles. |
| **Adoption & Ext** | **One-line Embeddable Loader** | ✅ Complete | Universal script tag embeds the sandboxed assistant into third-party LMS portals in seconds. |

---

## 🚀 Run the Full Stack in 10 Minutes

No host Node.js or pnpm installation required. Run the entire production-ready stack (PostgreSQL, automatic migrations, synthetic identity seed, course/job import, Fastify API, and Vite Web) with **one Docker command**:

```sh
# 1. Clone repository
git clone https://github.com/EyasuGet/Hackaton.git
cd Hackaton

# 2. Boot the full demo stack
docker compose --profile demo up
```

Once running, open **http://localhost:5173** in your browser. The startup logs print ready-to-use, single-use authentication links for all roles:
- **Learner A / B**: Full course tutoring, job Q&A, and accommodations.
- **Support Staff**: Human help queue and live mentor screen sharing.
- **Teacher**: Anonymous course confusion topics and learner insight summaries.
- **Employer**: Recruitment vacancy portal and consented applicant viewer.

---

## 🌐 Embed on Any External Site in 60 Seconds

Third-party learning management systems or job portals can embed the assistant widget with a single `<script>` tag:

```html
<script
  src="http://localhost:5173/loader.js"
  data-auto="true"
  data-course="course-1"
  data-lang="am"
  data-position="bottom-right"
  defer
></script>
```

Press **`Alt + Shift + A`** to toggle or focus the assistant from anywhere on the host page.
For full integration details, CSP requirements, and JavaScript APIs, see the [Third-Party Integration Guide](docs/integrate.md).

---

## 🔌 REST API & OpenAPI Contract

The Fastify backend provides strict Clean Architecture endpoints documented via OpenAPI:
- View the complete contract at [`docs/contracts/openapi.json`](docs/contracts/openapi.json).
- Health & Readiness Probes: `GET /api/health` and `GET /api/ready`.
- Careers & Vacancies: `GET /api/careers/jobs`, `POST /api/careers/answers`.
- Employer Portal: `POST /api/employer/vacancies`, `GET /api/employer/vacancies/:id/applications`.

---

## ⚙️ Environment Configuration

| Variable | Default | Purpose |
|---|---|---|
| `API_HOST` | `127.0.0.1` | Host address for Fastify API service |
| `API_PORT` | `3000` | Port for Fastify API service |
| `DATABASE_HOST` | `127.0.0.1` | PostgreSQL database host |
| `DATABASE_PORT` | `5432` | PostgreSQL database port |
| `DATABASE_NAME` | `track3` | PostgreSQL database name |
| `DATABASE_USER` | `track3` | PostgreSQL database user |
| `DATABASE_PASSWORD` | *(required in prod)* | PostgreSQL password |
| `DEMO_MODE` | `true` | Enables synthetic demo credentials for hackathon evaluation |
| `DEMO_ALLOWED_ORIGINS`| `http://localhost:5173` | Allowed host web origins for demo session handoffs |
| `GEMINI_API_KEY` | *(optional)* | Google Gemini API key for live grounding & cloud transcription |
| `AI_PROVIDER` | `cloud` | `cloud`, `local`, or `faq` (T3-037). Selects the AI layer |
| `LOCAL_MODEL_URL` | `http://localhost:11434/v1` | OpenAI-compatible endpoint for local mode |
| `LOCAL_MODEL_NAME` | `qwen2.5:3b` | Model name for local mode |

---

### Pluggable AI layer (cloud, local, or offline FAQ)

The assistant supports three AI operational modes configured via `AI_PROVIDER` (T3-037):

1. **Cloud AI (`AI_PROVIDER=cloud`, default):** Uses Google Gemini (`gemini-3.5-flash-lite`). Requires explicit learner consent before queries are sent to external cloud processing; falls back safely to verified probe recordings when `GEMINI_API_KEY` is not supplied.
2. **Local Open Model (`AI_PROVIDER=local`):** Connects to an OpenAI-compatible local model server (Ollama, llama.cpp, vLLM) configured via `LOCAL_MODEL_URL` (default: `http://localhost:11434/v1`) and `LOCAL_MODEL_NAME` (default: `qwen2.5:3b`). Because inference runs entirely on-host with zero external data transmission, no external consent prompt is required, and the UI displays a clear on-device processing indicator. To run Ollama locally via Docker Compose:
   ```sh
   docker compose --profile local-ai up -d
   docker compose --profile local-ai exec ollama ollama pull qwen2.5:3b
   ```
3. **Offline FAQ (`AI_PROVIDER=faq`):** 100% deterministic approved course FAQ. Operates fully offline without calling any LLM API or local model runtime.

---

## 🗣️ 21 October Findings → Our Answer

The findings are as listed in [issue #219](https://github.com/EyasuGet/Hackaton/issues/219); the original 21 October co-design notes are not stored in this repository.

| 21 October finding | Our answer | Evidence | Status |
| --- | --- | --- | --- |
| Forms time out | Unsent questions, help requests and accommodation descriptions are saved on the learner's device, with a "saved on this device only" note and a **Clear draft** button. The learner is warned 5 minutes before the session ends and can choose **Stay signed in**. Signing out clears the drafts. | [`demo-session.spec.ts`](apps/web/tests/e2e/demo-session.spec.ts) — *a session expiring mid-form loses no typed text* | Addressed |
| ID demanded | No flow asks for ID, a diagnosis or proof. Sign-in is a one-time link. The accommodation form states that no medical proof or diagnosis is required and asks learners not to include medical details. | Interface text audit, 2026-11-15 (`accommodation.intro`, `accommodation.descriptionPrompt` in [`messages.ts`](apps/web/src/shared/i18n/messages.ts)); [T3-025-A](docs/evidence/t3-025-a-accessibility-desktop.md) | Addressed |
| No captions or sign language | Everything spoken is also text: replies stay on screen during read-aloud, and voice questions become editable text before they are sent. The product has no video that needs captions. Sign-language interpretation is not provided. | [Conformance report, 1.2.1](docs/conformance.md) | Partly — sign language is outside Track 3 scope |
| Help English-only | The help request, help inbox and accommodation flows have Amharic interface text; a test fails if any dictionary entry lacks Amharic. Afaan Oromo, Tigrinya, Somali and Arabic are in progress ([T3-046](https://github.com/EyasuGet/Hackaton/issues/218)). | [`i18n.test.tsx`](apps/web/src/shared/i18n/i18n.test.tsx) | Addressed for Amharic; other languages in progress |
| Job boards break under screen readers | Learners ask about approved vacancies inside the accessible conversation, with cited links and an honest answer when a role is unknown. SMS job alerts reach phones without a browser. External job boards themselves are not changed. | [T3-025-A](docs/evidence/t3-025-a-accessibility-desktop.md), [T3-021-B](docs/evidence/t3-021-b-sms-job-alerts.md) | Addressed in our product; external boards out of scope |

---

## ♿ Accessibility & Honest Limitations

- **Screen Reader Testing**: Evaluated with NVDA on Windows and TalkBack on Android.
- **Automated Audit**: 0 critical or serious violations via axe-core across core routes. Full compliance breakdown in [WCAG 2.2 AA Conformance Report](docs/conformance.md).
- **Honest Cloud Fallback**: When Gemini API quotas are exhausted or network is offline, the assistant safely falls back to verified local course FAQs with zero crash risk.

---

## 👥 Contributor Guidelines

For development workflows, architecture decisions, and code standards, refer to [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).
