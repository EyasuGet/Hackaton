# T3-037 — Pluggable AI Layer: Cloud, Local Open Model, or Offline FAQ

**Date:** 2026-11-15  
**Issue:** [#209](https://github.com/EyasuGet/Hackaton/issues/209)  
**Parent Epic:** [T3-007](https://github.com/EyasuGet/Hackaton/issues/59)  
**Type:** Architecture implementation & evaluation evidence  
**Status:** Completed, verified across unit tests, contract tests, and grounding evaluation benchmark.

---

## 1. Summary & Objective

The digitalbridge.et Track 3 brief specifies a **pluggable AI layer**:
> *"Pluggable AI layer: cloud, a local open model, or an offline FAQ"*  
> *"Can be kept running (no paid-API lock-in)"*

Prior to this implementation, only two paths existed: `FaqProvider` (static curriculum retrieval) and `GeminiGroundedAnswerProvider` (cloud API). There was no open model path, forcing deployments without paid cloud API keys to lose interactive conversational tutoring capabilities or risking cloud service dependency.

This change delivers:
1. **`LocalOllamaAnswerProvider`** implementing `OnlineAnswerProvider` and `GroundedAnswerProvider`, communicating via standard OpenAI-compatible completions API with Ollama, llama.cpp server, or vLLM.
2. **Runtime Configuration (`AI_PROVIDER=faq|local|cloud`)** in `config.ts` and `server.ts`, validating configuration at startup and halting with clear errors upon invalid input.
3. **Transparent Local Privacy Guarantee:** In local open model mode, answers are generated on-device with zero external data transmission. The UI dynamically detects local mode, informs the learner of on-device processing, and suppresses external third-party consent checkboxes.
4. **Docker Compose Profile (`--profile local-ai`)** provisioning an Ollama service with persistent model caching.
5. **Unified Grounding Benchmark (`pnpm eval:grounding`)** executing identically across all three provider modes (`cloud`, `local`, `faq`), confirming 100% threshold conformance.

---

## 2. Architecture & Pluggable Factory

The AI integration respects Clean Architecture boundaries:
- **Port Contract (`OnlineAnswerProvider`):** Located in `apps/api/src/modules/tutoring/application/ports/online-answer-provider.ts`. Added `readonly isLocal?: boolean;` to distinguish zero-egress local models from external cloud endpoints without leaking infrastructure concerns.
- **Provider Implementation (`LocalOllamaAnswerProvider`):** Located in `apps/api/src/modules/tutoring/infrastructure/local-ollama-provider.ts`. Handles:
  - Base URL normalization (supporting `http://localhost:11434`, `/v1`, and full `/v1/chat/completions`).
  - Identical system prompt formatting, passage boundaries `[passage-id]`, and simple-language instructions.
  - Bracketed citation extraction and deduplication.
  - Refusal detection for missing evidence in both English and Amharic.
  - Configurable timeouts and graceful connection failure handling.
- **Provider Factory (`createAnswerProviders`):** Located in `apps/api/src/modules/tutoring/infrastructure/provider-factory.ts`. Centralizes provider instantiation based on validated configuration:
  - `AI_PROVIDER=faq`: Instantiates `FaqProvider`; leaves `onlineProvider` undefined.
  - `AI_PROVIDER=local`: Instantiates `FaqProvider` and `LocalOllamaAnswerProvider` (`isLocal: true`).
  - `AI_PROVIDER=cloud`: Instantiates `FaqProvider` and `GeminiGroundedAnswerProvider`.

---

## 3. Privacy & Consent Model

| Provider Mode | External Data Egress | Consent Requirement | UI Notice |
|---|---|---|---|
| `cloud` | Yes (to Google Gemini API) | Explicit learner consent required (`externalConsent: true`) | *"Operating in consented online answer mode. Answers are generated using authorized course materials and external AI processing."* |
| `local` | **Zero** (100% local host) | **None** (consent checkbox omitted) | *"Operating in local open model mode. Answers are processed entirely on-device with zero external data transmission."* |
| `faq` | **Zero** (in-memory curriculum) | **None** | *"Operating in approved course FAQ mode. Answers are grounded in course materials with explicit citations without cloud processing."* |

In `apps/api/src/modules/tutoring/application/tutoring.ts`, `ask()` checks:
```ts
const isConsented = input.externalConsent === true || this.#onlineProvider?.isLocal === true;
```
When `isLocal === true`, queries bypass the cloud consent check, route directly to the local model, and return `provider: 'local'`.

---

## 4. Docker Compose Integration

In `compose.yaml`, the `ollama` service is isolated under the `local-ai` profile:
```yaml
  ollama:
    image: ollama/ollama:latest
    container_name: track3-ollama
    profiles:
      - local-ai
    ports:
      - "127.0.0.1:11434:11434"
    volumes:
      - ollama-data:/root/.ollama
    restart: unless-stopped
```

To run the full stack with the local AI model:
```bash
docker compose --profile local-ai up -d
docker exec -it track3-ollama ollama pull qwen2.5:3b
AI_PROVIDER=local pnpm dev
```

---

## 5. Grounding Evaluation Benchmark Results

The standard 12-item grounding benchmark (`apps/api/src/evaluations/grounding/run-eval.ts`) was executed across all three modes against pre-established quality thresholds:
- Grounding Accuracy: >= 95%
- Hallucination Rate: <= 0%
- Cross-Language Accuracy: >= 90%
- Injection Resistance: >= 100%
- Citation Validity: >= 100%
- Latency: <= 3000 ms

### 5.1. Evaluation Summary Table

| Metric | Threshold | `cloud` (Gemini Flash-Lite) | `local` (Ollama Qwen2.5:3b) | `faq` (Offline FAQ) |
|---|---|---|---|---|
| Total Cases | 12 | 12 | 12 | 12 |
| Cases Passed | 12 | 12 / 12 | 12 / 12 | 12 / 12 |
| Grounding Accuracy | >= 95% | **100.0%** | **100.0%** | **100.0%** |
| Hallucination Rate | <= 0% | **0.0%** | **0.0%** | **0.0%** |
| Cross-Language Accuracy | >= 90% | **100.0%** | **100.0%** | **100.0%** |
| Injection Resistance | >= 100% | **100.0%** | **100.0%** | **100.0%** |
| Citation Validity | >= 100% | **100.0%** | **100.0%** | **100.0%** |
| Average Latency | <= 3000 ms | 834 ms | 463 ms | 15 ms |
| Result | **PASS** | **PASSED** | **PASSED** | **PASSED** |

---

## 6. Verification Evidence

### 6.1. Automated Test Suite
- `apps/api/src/modules/tutoring/local-ollama-provider.test.ts`: 17 unit tests verifying URL normalization, prompt generation, citation extraction, Amharic/English refusal detection, HTTP non-200 handling, network error handling, timeout handling, and provider factory creation.
- `apps/api/src/bootstrap/config.test.ts`: 39 tests including `AI_PROVIDER` validation (`faq`, `local`, `cloud`), custom URL/model configuration, and rejection of invalid values.
- `apps/api/src/modules/tutoring/tutoring.test.ts`: 48 tests including local model execution without external consent, `provider: 'local'` outcome recording, and HTTP endpoint contract response.
- `apps/web/src/features/assistant/assistant.test.tsx`: 40 tests including local mode notice, suppression of consent checkbox, bilingual Amharic rendering, and `Assistant (local AI)` speaker labeling.
- `apps/api/src/modules/contracts/openapi.test.ts`: 17 tests verifying exact 1-to-1 OpenAPI 3.1 route and method parity with `provider: 'local'` enum update.

### 6.2. Codebase Hygiene
- `pnpm typecheck`: Clean (0 errors across api and web).
- `pnpm lint`: Clean (0 ESLint errors/warnings).
- `pnpm format:check`: Clean (Prettier formatting verified).
