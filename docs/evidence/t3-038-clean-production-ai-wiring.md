# Evidence: Remove Evaluation Stubs and Leaks from Production AI Wiring (T3-038)

- **Date:** 2026-11-15
- **Issue:** [#210](https://github.com/EyasuGet/Hackaton/issues/210) — [T3-038] Remove evaluation stubs and leaks from the production AI wiring
- **Component:** `apps/api/src/modules/tutoring/infrastructure/gemini-grounded-answer-provider.ts`, `apps/api/src/server.ts`
- **Criterion:** Quality, security and privacy; honest AI behaviour; clean architecture boundary
- **Status:** **PASS** [✓]

---

## 1. Executive Summary

During auditing of the production wiring (`apps/api/src/server.ts`), several issues were identified in how external AI components were integrated into production runtime:
1. `GeminiGroundedAnswerProvider` was imported into `server.ts` directly from `src/evaluations/grounding/provider-adapter.ts`.
2. When `GEMINI_API_KEY` was unset or unconfigured, the evaluation provider returned pre-recorded evaluation probe answers (`#generateProbeAnswer`) matched by keywords in the question, presenting canned evaluation answers as live AI responses.
3. `isAvailable()` on the evaluation adapter was hardcoded to `true`, preventing the consented-online tutoring path from falling back honestly to the labelled FAQ path.
4. The Gemini API key was appended as a query parameter in the URL (`?key=...`), exposing secrets to proxy logs, CDN access logs, and referrer headers.
5. In `server.ts`, `Tutoring` was constructed twice with disparate dependency configurations: the Telegram link service received a `Tutoring` instance without `jobAnswers`, while the web app received a second instance with `jobAnswers`.
6. `CareerResearchService(new MockCareerResearchProvider())` was unconditionally mounted in production, returning canned web research results without explicit demo gating.

Issue **T3-038** resolves all of these defects by establishing a clean, secure, and honest production architecture.

---

## 2. Changes Implemented

### 2.1 Dedicated Production Cloud Answer Provider
- Created `apps/api/src/modules/tutoring/infrastructure/gemini-grounded-answer-provider.ts` under Clean Architecture module infrastructure.
- Implements `OnlineAnswerProvider` with strict grounding system prompts and citation verification invariants.
- Contains **no probe answers or canned responses**: probe recordings remain strictly isolated in `evaluations/` for offline CI evaluation.
- Throws an explicit error if `generateAnswer` is invoked directly when `!isAvailable()`.

### 2.2 Truthful Availability and Honest FAQ Fallback
- `isAvailable()` now returns `Boolean(this.apiKey && this.apiKey.trim().length > 0)`.
- When `GEMINI_API_KEY` is not configured, `isAvailable()` returns `false`.
- When learners grant external consent and `isAvailable()` is `false`, `Tutoring.ask` routes the question honestly to `FaqProvider` (`provider: 'faq'`), returning either the verified course FAQ answer or an honest limitation notice (`kind: 'insufficient_evidence'`).

### 2.3 Secret Leak Prevention (`x-goog-api-key` HTTP Header)
- Removed `?key=${apiKey}` query parameter from the Gemini API URL across production infrastructure adapters (`GeminiGroundedAnswerProvider` and `GeminiTranscriptionAdapter`, as well as `evaluations/provider-adapter.ts`).
- Passed the API key exclusively via the standard Google REST header:
  ```http
  POST /v1beta/models/gemini-2.5-flash:generateContent HTTP/1.1
  Host: generativelanguage.googleapis.com
  Content-Type: application/json
  x-goog-api-key: <GEMINI_API_KEY>
  ```
- Protects secrets from leaking into server access logs, egress proxy logs, or debugging traces.

### 2.4 Server Dependency Cleanup & Channel Unification
- Updated `apps/api/src/server.ts` to import `GeminiGroundedAnswerProvider` from `modules/tutoring/infrastructure/gemini-grounded-answer-provider.ts`.
- Removed duplicate instantiation of `Tutoring`: constructed a single shared, fully configured `Tutoring` instance (with `jobAnswers` passed) and supplied it to both `TelegramLinkService` and `buildApp`.
- Disabled external career research when no genuine provider is configured (`config.demoMode ? new CareerResearchService(new MockCareerResearchProvider()) : undefined`).

---

## 3. Verification & Test Evidence

### 3.1 Unit Test Coverage
Added dedicated tests in `apps/api/src/modules/tutoring/gemini-grounded-answer-provider.test.ts` verifying all acceptance criteria:

```bash
pnpm --filter @track3/api test gemini-grounded-answer-provider.test.ts
```

Output:
```
 ✓ src/modules/tutoring/gemini-grounded-answer-provider.test.ts (9 tests) 21ms
   ✓ GeminiGroundedAnswerProvider Production AI Wiring (T3-038) (9)
     ✓ isAvailable() (3)
       ✓ returns false when no API key is supplied or configured in environment
       ✓ returns false when API key is empty or whitespace-only
       ✓ returns true when valid API key is supplied in constructor or environment
     ✓ fallback behaviour and removal of canned probe answers (3)
       ✓ throws when generateAnswer is invoked directly without a configured API key
       ✓ falls back honestly to labelled FAQ path when GEMINI_API_KEY is unset and consent is given
       ✓ falls back to FAQ honest limitation when question has no course evidence and GEMINI_API_KEY is unset
     ✓ API key leak protection (x-goog-api-key HTTP header) (3)
       ✓ passes GEMINI_API_KEY in x-goog-api-key header and NEVER in URL query params
       ✓ detects honest limitation when model output indicates refusal without citations
       ✓ throws error when Gemini API returns a non-200 HTTP response

 Test Files  1 passed (1)
      Tests  9 passed (9)
```

### 3.2 Full API Test Suite
Verified that all existing unit and evaluation tests continue to pass without regressions:

```bash
pnpm --filter @track3/api test
```

Output:
```
 Test Files  41 passed (41)
      Tests  648 passed (648)
   Duration  6.43s
```

### 3.3 Workspace Integrity Checks
1. **Typecheck (`pnpm typecheck`):**
   - Passed with 0 errors across `@track3/api` and `@track3/web`.
2. **Linter (`pnpm lint`):**
   - Passed with 0 errors and 0 warnings.
3. **Formatter (`pnpm format:check`):**
   - All matched files use Prettier code style.
