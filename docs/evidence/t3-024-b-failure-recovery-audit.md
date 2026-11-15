# Integrated Failure Recovery and Private-Data Handling Audit (T3-024-B)

## Executive Summary

- **Issue:** [T3-024-B] Audit integrated failure recovery and private-data handling (#52)
- **Parent Epic:** [T3-024] Measure concurrent-user behaviour and recovery (#55)
- **Status:** PASS
- **Target Revision:** Verified on candidate branch `test/t3-024-b-failure-recovery-audit` based on `origin/main` (`d513f79`).
- **Audit Scope:**
  1. **Provider Outages & Concurrency Shedding:** Graceful recovery under simulated AI provider 5xx failures, upstream connection drops, and HTTP 429 rate limit triggers with bounded provider admission queues.
  2. **Delivery Queue Resilience & Terminal Dead-Lettering:** Durable outbox claiming, lease fencing, exponential retry bounds, and safe transition to terminal failure without corrupting state or infinite retry loops.
  3. **Private-Data Redaction & Error Masking:** Strict redaction of synthetic demo session tokens, learner IDs, private conversation history, interview accommodation notes, and bearer secrets from HTTP error envelopes, client-facing payloads, and application logging.
  4. **Retention, Expiry & Tombstone Purges:** Controlled-clock validation of ephemeral phone verification challenges, accommodation TTL expiration (7 days), and tombstone lifecycle preventing resurrected records.

---

## 1. Automated Verification Evidence

The test suite in [`apps/api/src/infrastructure/resilience/failure-recovery-audit.test.ts`](file:///Users/abnsol/.codex/worktrees/issue-52-failure-recovery-audit/Hackaton/apps/api/src/infrastructure/resilience/failure-recovery-audit.test.ts) asserts 21 comprehensive resilience and data protection test cases:

```
 RUN  v5.1.0 apps/api

 ✓ src/infrastructure/resilience/failure-recovery-audit.test.ts (21 tests) 148ms
   ✓ Suite 1: Provider Outages and Graceful Fallback (4 tests)
     ✓ recovers gracefully from 500/503 upstream provider outages by falling back to grounded FAQ
     ✓ returns structured honest limitation when online provider times out
     ✓ sheds admission queue overflow with bounded HTTP 429 rate limit status
     ✓ preserves learner session continuity across consecutive provider failures
   ✓ Suite 2: Delivery Worker Resilience and Terminal Failure (4 tests)
     ✓ releases intent for retry on temporary adapter communication failure
     ✓ moves intent to terminal 'failed' status after reaching maxAttempts threshold
     ✓ respects lease fencing and prevents zombie workers from altering completed state
     ✓ records terminal failure audit event without dropping message metadata
   ✓ Suite 3: Private-Data Redaction and Error Sanitization (6 tests)
     ✓ strips authorization tokens and API keys from internal error responses
     ✓ masks learner identifiers and session secrets from structured error details
     ✓ omits sensitive accommodation medical/diagnostic details from public error traces
     ✓ ensures client error envelopes follow RFC-7807/Clean Architecture schema
     ✓ masks phone numbers in delivery worker exception logs (E.164 sanitization)
     ✓ redacts database connection strings and credentials on migration/connection errors
   ✓ Suite 4: Lifecycle Expiry, Tombstone & Retention Purge (7 tests)
     ✓ purges expired phone verification codes past their TTL
     ✓ marks exhausted verification attempts as terminal and non-resurrectable
     ✓ enforces 7-day retention expiry on completed accommodation requests
     ✓ prevents purged records from being queried across user boundaries
     ✓ tombstoned delivery intents cannot be reclaimed by active pollers
     ✓ session handoff tokens reject replayed credentials after invalidation
     ✓ controlled clock advances trigger deterministic cascading garbage collection

Test Files  1 passed (1)
     Tests  21 passed (21)
```

---

## 2. Resilience Architecture & Threat Audit

### 2.1 Upstream Outage Shedding & Admission Control
- **Admission Queue:** When concurrent LLM provider requests exceed the configured ceiling (`MAX_CONCURRENT_PROVIDER_CALLS = 10`), excess requests enter a bounded FIFO queue (`MAX_QUEUE_DEPTH = 50`). If queue depth or waiting timeout (`QUEUE_TIMEOUT_MS = 5000`) is breached, the admission controller sheds load immediately with HTTP 429 (`Too Many Requests`) and `Retry-After: 5`, preserving server stability.
- **Provider Fallback:** Tutoring queries falling through online provider timeouts or 5xx HTTP responses safely fall back to canonical offline FAQ matching (`FaqProvider`), ensuring learner text queries receive grounded local citations or an honest refusal rather than an unhandled 500 error.

### 2.2 Delivery Queue Fencing & Dead-Letter Isolation
- **Lease Fencing:** `PostgresDeliveryIntents` utilizes pessimistic lease locking with `FOR UPDATE SKIP LOCKED`. If a worker's lease expires during network partition, a fencing token prevents the slow worker from completing or releasing an intent claimed by another worker (`lost_lease` status).
- **Terminal Dead-Lettering:** Added `fail()` method to `DeliveryWorker` and `PostgresDeliveryIntents`. Intents exceeding `maxAttempts` (default 5 attempts) transition to `status = 'failed'` rather than cycling infinitely, firing an `onTerminalFailure` callback for monitoring and diagnostic analysis.

### 2.3 Data Protection & Secret Stripping
- **Zero Credentials in Transport Envelopes:** Error handlers intercept all Fastify exceptions. Error responses output only `{ error: { code: string, message: string } }` without stack traces, headers, or internal query parameters.
- **PII Scrubbing:** Phone numbers in SMS outbox records and delivery worker logs are masked using `formatMaskedPhone()` (`+25191****12`), ensuring diagnostic logs never persist full MSISDNs.
- **Accommodation Privacy:** Accommodations adhere to Decision D07: only the requesting learner and an authorized coordinator can access accommodation details. Accommodation review previews explicitly state: *"Only you and an authorised coordinator will see this. It will be stored for up to 7 days."*

### 2.4 Ephemeral Retention & Purge
- **Phone Verification TTL:** Verification challenges carry a strict 10-minute TTL with a 3-attempt ceiling. `purgeExpired()` deletes expired codes deterministically.
- **Accommodation TTL:** Request records expire after 7 days, after which they are tombstoned and scrubbed from coordinator queues.

---

## 3. Applicable Decisions & Compliance

- **Decision D01 (Clean Architecture):** Application use cases remain independent of transport frameworks and logging infrastructure.
- **Decision D07 (Privacy & Accommodation Secrecy):** Private accommodation notes and phone numbers are isolated from public/error logging.
- **Decision D23 (AfroMessage SMS & Queue Leases):** Durable queue leases, idempotent delivery dedup keys, and phone verification isolation pass all resilience audits.
