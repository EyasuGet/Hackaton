# T3-044 Evidence Artifact — Level 3 Integration with Schema.org JobPosting

**Issue:** [#216 — [T3-044] Reach integration Level 3 with schema.org JobPosting](https://github.com/EyasuGet/Hackaton/issues/216)  
**Parent Epic:** Adoption & Career Integration  
**Phase:** Adoption / Career Gateway  
**Type:** Implementation & Integration Verification Evidence  
**Status:** Verification Passed [✓] (Production Adapter Ready & Fully Contract-Tested)  
**Date:** 2026-11-15  

---

## 1. Executive Summary

This deliverable fulfills Issue #216 by elevating the DigitalBridge Track 3 assistant to **Integration Level 3**. While Level 1 (script tag embed) and Level 2 (OpenAPI 3.1 specification) already provide host integration, Level 3 enables interoperability with public job platforms, national career aggregators, and partner employer boards that exchange opportunities using the international **schema.org/JobPosting** standard.

The implemented integration:
1. **Extends `jobs:import` CLI & Use Case:** Accepts schema.org `JobPosting` JSON-LD documents (including single objects, arrays, and `@graph` collections).
2. **Normalizes Public Partner Vacancies:** Automatically extracts `title`, `description`, `datePosted`, `validThrough`, `hiringOrganization.name`, `jobLocation` (supporting `PostalAddress` objects, location names, and text strings), `employmentType`, `occupationalCategory`, and `accessibility/accommodation notes` (`accessibilityRequirements`, `sensoryRequirement`, `physicalRequirement`, `jobBenefits`).
3. **Idempotent Ingestion & Versioning:** Integrates with `ImportJobs` and `PostgresJobRepository`, ensuring content is fingerprint-checked via deterministic SHA-256 hashes and assigned stable publication identities without duplicate rows.
4. **Content Negotiation on `GET /api/jobs/:id`:**
   - When `Accept: application/ld+json` is requested, returns a valid schema.org `JobPosting` JSON-LD object compliant with Google Rich Results guidelines.
   - When `Accept: application/json` or default is requested, returns the standard `JobDetail` JSON representation.
   - Properly enforces learner authentication (`401 Unauthorized`, `403 Forbidden`) and resource existence (`404 Not Found`).
5. **OpenAPI 3.1 Contract Parity:** Formally documents `GET /api/jobs/{id}`, `JobDetail`, and `SchemaOrgJobPosting` in `docs/contracts/openapi.json`, verified by `apps/api/src/modules/contracts/openapi.test.ts` with exact 1-to-1 route parity.
6. **Citation-Grounded Learner Q&A:** Extends `JobAnswers` to answer learner questions regarding job requirements and accessibility/accommodations (in English and Amharic) grounded strictly in approved job records with exact source citations.

---

## 2. Component Deliverables

| Layer | Component | File Path |
|---|---|---|
| Domain Model | `SchemaOrgJobPosting`, `parseSchemaOrgJobPosting`, `toSchemaOrgJobPosting`, `isSchemaOrgJobPosting` | [`apps/api/src/modules/careers/domain/schema-org-job-posting.ts`](../../apps/api/src/modules/careers/domain/schema-org-job-posting.ts) |
| Domain Model | `Job` & `JobRecord` (extended with `employmentType` and `accessibilityNotes`), `parseJobFile` | [`apps/api/src/modules/careers/domain/job.ts`](../../apps/api/src/modules/careers/domain/job.ts) |
| Infrastructure | `PostgresJobRepository` (provenance JSONB metadata persistence) | [`apps/api/src/modules/careers/infrastructure/postgres-job-repository.ts`](../../apps/api/src/modules/careers/infrastructure/postgres-job-repository.ts) |
| Application | `JobAnswers` (accommodation and requirement Q&A grounding) | [`apps/api/src/modules/careers/application/job-answers.ts`](../../apps/api/src/modules/careers/application/job-answers.ts) |
| Presentation | `GET /api/jobs/:id` with `Accept: application/ld+json` content negotiation | [`apps/api/src/modules/careers/presentation/http/careers-routes.ts`](../../apps/api/src/modules/careers/presentation/http/careers-routes.ts) |
| API Contract | OpenAPI 3.1 Specification (`/api/jobs/{id}`, `JobDetail`, `SchemaOrgJobPosting`) | [`docs/contracts/openapi.json`](../contracts/openapi.json) |
| Public Fixture | Public Partner JobPosting JSON-LD Fixture | [`fixtures/jobs/partner-schema-org-job.json`](../../fixtures/jobs/partner-schema-org-job.json) |
| Automated Tests | Unit, route, and grounding test suite (15 tests) | [`apps/api/src/modules/careers/schema-org-job-posting.test.ts`](../../apps/api/src/modules/careers/schema-org-job-posting.test.ts) |

---

## 3. Contract & Route Verification Matrix

The test suite in [`apps/api/src/modules/careers/schema-org-job-posting.test.ts`](../../apps/api/src/modules/careers/schema-org-job-posting.test.ts) and [`apps/api/src/modules/contracts/openapi.test.ts`](../../apps/api/src/modules/contracts/openapi.test.ts) exercises all required acceptance criteria:

| Test Case | Scenario / Verification | Expected Outcome | Result |
|---|---|---|---|
| JSON-LD Detection | Detection of `@context` and `@type: "JobPosting"` | Identified as schema.org JobPosting | **PASS** |
| Field Normalization | Parsing title, description, dates, org, location, employmentType, accommodations | Normalized into domain `Job` with partner provenance | **PASS** |
| Varied Locations | PostalAddress object, locality string, address string, place name | Correctly extracted into readable location string | **PASS** |
| Accommodations Extraction | Extracting from `accessibilityRequirements`, `sensoryRequirement`, `physicalRequirement` | Extracted into `accessibilityNotes` and augmented into description | **PASS** |
| Collection / Graph | Parsing JSON-LD `@graph` array | Array of schema.org jobs correctly parsed | **PASS** |
| Strict Error Accumulation | Missing required fields (title, description, dates, org) | Collects all validation errors without partial corruption | **PASS** |
| Idempotent Ingestion | Reimporting identical schema.org JobPosting content | Returns `status: "unchanged"` with identical publicationId | **PASS** |
| Content Negotiation (JSON-LD) | `GET /api/jobs/:id` with `Accept: application/ld+json` | Returns HTTP 200, `application/ld+json`, valid schema.org JobPosting | **PASS** |
| Content Negotiation (JSON) | `GET /api/jobs/:id` with `Accept: application/json` | Returns HTTP 200, `application/json`, standard `JobDetail` | **PASS** |
| Route Security (401) | `GET /api/jobs/:id` without bearer token | Returns HTTP 401 `{ error: "unauthenticated" }` | **PASS** |
| Route Security (403) | `GET /api/jobs/:id` with non-learner bearer token | Returns HTTP 403 `{ error: "forbidden" }` | **PASS** |
| Resource Not Found (404) | `GET /api/jobs/:id` with non-existent job ID | Returns HTTP 404 `{ error: "not_found" }` | **PASS** |
| OpenAPI 1-to-1 Parity | Parity check of all Fastify routes against OpenAPI specification | 17/17 tests pass with 0 missing/extra routes | **PASS** |
| Cited Q&A (Requirements) | Asking about requirements for imported schema.org job | Answer grounded in job record with exact source citation | **PASS** |
| Cited Q&A (Accommodations) | Asking about accessibility/accommodations for imported job | Answer returns accommodations with exact source citation | **PASS** |
| Multilingual Q&A (Amharic) | Asking about accommodations in Amharic | Returns Amharic answer with citations | **PASS** |

---

## 4. Verification Commands & Outputs

### 4.1 Schema.org JobPosting Test Suite
```bash
pnpm --filter @track3/api test src/modules/careers/schema-org-job-posting.test.ts
```
Output:
```text
 ✓ src/modules/careers/schema-org-job-posting.test.ts (15 tests) 218ms
   ✓ schema.org JobPosting Integration (T3-044 / #216) (15)
     ✓ 1. schema.org JobPosting JSON-LD Detection and Normalization (6)
     ✓ 2. Ingestion & Idempotent Versioning (1)
     ✓ 3. GET /api/jobs/:id Route and Content Negotiation (5)
     ✓ 4. Grounded Career Q&A with Citations for Imported Jobs (3)

 Test Files  1 passed (1)
      Tests  15 passed (15)
```

### 4.2 OpenAPI 3.1 Contract Parity
```bash
pnpm --filter @track3/api test src/modules/contracts/openapi.test.ts
```
Output:
```text
 ✓ src/modules/contracts/openapi.test.ts (17 tests) 250ms
   ✓ OpenAPI 3.1 Specification Contract Validation (T3-026-A) (17)
     ✓ Document structure and metadata (4)
     ✓ Route alignment between Fastify and OpenAPI (3)
     ✓ Clean Architecture error envelopes and response contracts (4)
     ✓ Secrets and sensitive data hygiene in examples (2)
     ✓ Live execution verification (4)

 Test Files  1 passed (1)
      Tests  17 passed (17)
```

### 4.3 Monorepo Checks (Typecheck, Lint, Format)
```bash
pnpm typecheck
pnpm lint
pnpm format:check
```
Output:
```text
$ pnpm --recursive run typecheck
Scope: 2 of 3 workspace projects
apps/api typecheck: Done in 8s
apps/web typecheck: Done in 10.2s

$ eslint .
(Clean exit with code 0)

$ prettier --check .
All matched files use Prettier code style!
```

---

## 5. Conclusion

With this change, Track 3 reaches **Integration Level 3**:
- Public partner job postings in schema.org format import into the career gateway without custom glue code.
- Learner Q&A answers questions about job requirements and accommodations grounded with citations.
- The platform can export any stored job opportunity as valid schema.org `JobPosting` JSON-LD over HTTP.
- All pre-PR gates (tests, typecheck, lint, format) pass cleanly.
