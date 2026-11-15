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

---

## ♿ Accessibility & Honest Limitations

- **Screen Reader Testing**: Evaluated with NVDA on Windows and TalkBack on Android.
- **Automated Audit**: 0 critical or serious violations via axe-core across core routes. Full compliance breakdown in [WCAG 2.2 AA Conformance Report](docs/conformance.md).
- **Honest Cloud Fallback**: When Gemini API quotas are exhausted or network is offline, the assistant safely falls back to verified local course FAQs with zero crash risk.

---

## 👥 Contributor Guidelines

For development workflows, architecture decisions, and code standards, refer to [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).
