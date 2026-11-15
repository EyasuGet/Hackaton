# T3-021-A — Verify and manage an SMS job subscription

**Date:** 2026-11-15  
**Issue:** [#93](https://github.com/EyasuGet/Hackaton/issues/93)  
**Parent:** [T3-021 / #95](https://github.com/EyasuGet/Hackaton/issues/95)  
**Type:** Implementation evidence  
**Branch:** `feat/t3-021-a-sms-subscriptions`  
**Status:** Approved implementation verified and green across domain, application, database, and presentation layers.

---

## 1. Summary

Issue [#93](https://github.com/EyasuGet/Hackaton/issues/93) (T3-021-A) implements verified SMS job alert subscription management.

Following Decision **D24** and the approved phone verification contract in [`docs/evidence/t3-003-e-phone-verification.md`](t3-003-e-phone-verification.md), arbitrary entered phone numbers are **never** treated as trusted without cryptographic One-Time Password (OTP) challenge proof. An SMS job subscription requires a verified Ethiopian mobile phone number (`+2519...` or `+2517...`).

Key deliverables achieved:
1. **Domain model & validation rules (`sms-subscription.ts`):**
   - Ethiopian mobile operator validation and E.164 normalization (+2519 for Ethio Telecom, +2517 for Safaricom Ethiopia). Rejects landlines and international numbers.
   - Cryptographic eligibility check: unverified or unsubscribed numbers are never eligible for job alert matches.
   - Safe masking presentation (`+2519****1234` or `+2517****5678`) in all logs, audit trails, and API responses.
   - Deterministic matching against active job postings based strictly on explicit category and location preferences without sensitive learner profiling.
2. **Application service orchestration (`sms-subscription-service.ts`):**
   - Integrated with `PhoneVerificationService` and `JobPreferences`.
   - **Challenge flow:** Unverified phone numbers initiate a rate-limited OTP challenge with 10-minute validity and 60-second cooldown per destination.
   - **Lockout & attempt limits:** Max 3 failed attempts per code. The 3rd failed attempt triggers permanent lockout (`exhausted`).
   - **Verification & activation:** Correct code verification atomically marks the phone as verified and activates the subscription.
   - **Re-subscribing:** Verified phones can activate or update subscriptions directly without needing a new OTP challenge.
   - **Tenant isolation:** Phone verification records and subscriptions are strictly bound to the authenticated learner (`Principal.id`). Learner B cannot query, verify, view, or delete Learner A's challenges or subscriptions.
   - **Immediate opt-out:** Unsubscribing immediately cancels subscription active status, updates `unsubscribedAt`, cancels queued pending delivery intents (`status = 'cancelled'`), and prunes contact destination records from `job_alert_contacts`. No reusable queued destination is left behind.
3. **Database persistence & migration (`0017_create_phone_verifications.sql` & `postgres-phone-verification-repository.ts`):**
   - Created tables `phone_verification_codes` (with salted SHA-256 digest, per-record salt, attempt counter, expiry, and status) and `learner_verified_phones`.
   - Implemented `PostgresPhoneVerificationRepository` satisfying `PhoneVerificationRepository`.
   - Plaintext OTP is NEVER persisted in any database table.
4. **Presentation & HTTP API routes (`sms-subscription-routes.ts`):**
   - Endpoints under `/api/delivery/sms/subscriptions` (and developer aliases `/api/careers/sms-subscriptions`):
     - `POST .../request`: Requests subscription challenge or activates if already verified.
     - `POST .../verify`: Submits 6-digit OTP to verify ownership and activate subscription.
     - `GET .../status`: Queries active subscription status and masked phone.
     - `DELETE ...`: Immediately unsubscribes and suppresses queued delivery intents.
   - Strict bearer token authentication enforcing `learner` role (rejects unauthenticated with 401, non-learners with 403).

---

## 2. API Contract & Endpoints

| Endpoint | Method | Role | Description | Responses |
|---|---|---|---|---|
| `/api/delivery/sms/subscriptions/request` | `POST` | `learner` | Initiates OTP verification challenge or activates if verified | `200` (verification_required), `201` (active), `400` (invalid_phone), `429` (cooldown_active) |
| `/api/delivery/sms/subscriptions/verify` | `POST` | `learner` | Submits 6-digit OTP code to verify and activate subscription | `201` (active), `400` (mismatch/expired), `429` (exhausted lockout) |
| `/api/delivery/sms/subscriptions/status` | `GET` | `learner` | Retrieves current SMS subscription status and masked phone | `200` (`{ subscribed: boolean, status: string, maskedPhone?: string }`) |
| `/api/delivery/sms/subscriptions` | `DELETE` | `learner` | Immediately unsubscribes, cancels queued intents, prunes contact | `200` (`{ status: 'unsubscribed', cancelledIntentsCount, contactRemoved }`) |
| `/api/delivery/sms/subscriptions/:id` | `DELETE` | `learner` | Unsubscribes by specific subscription ID | `200` (`{ status: 'unsubscribed', ... }`), `404` (not found) |

*Note: Equivalent aliases are provided under `/api/careers/sms-subscriptions/*`.*

---

## 3. Implementation Details

```
apps/api/
├── src/
│   ├── infrastructure/
│   │   └── database/
│   │       └── migrations/
│   │           └── 0017_create_phone_verifications.sql
│   ├── modules/
│   │   ├── careers/
│   │   │   └── application/
│   │   │       └── job-preferences.ts         # Enforces phone verification for channel 'sms'
│   │   └── delivery/
│   │       ├── application/
│   │       │   └── sms-subscription-service.ts  # Clean Architecture use-case service
│   │       ├── domain/
│   │       │   ├── sms-subscription.ts        # Pure domain rules, validation & matching
│   │       │   └── sms-subscription.test.ts   # 20 unit and HTTP integration tests
│   │       ├── infrastructure/
│   │       │   └── postgres-phone-verification-repository.ts # PostgreSQL repository
│   │       └── presentation/
│   │           └── http/
│   │               └── sms-subscription-routes.ts # Fastify HTTP presentation routes
│   └── bootstrap/
│       └── app.ts                             # Wires smsSubscriptionService into buildApp
```

---

## 4. Verification Evidence

All automated verification checks executed cleanly in the dedicated worktree:

| Check | Tool / Environment | Outcome | Evidence |
|---|---|---|---|
| `pnpm format:check` | Prettier 3.10.1 | **PASSED** | All matched files use Prettier code style |
| `pnpm lint` | ESLint 10.14.0 | **PASSED** | 0 errors, 0 warnings across workspace |
| `pnpm typecheck` | TypeScript 6.0.3 | **PASSED** | 0 type errors with `strict`, `exactOptionalPropertyTypes` |
| `pnpm test` (API) | Vitest 5.1.0 | **PASSED** | 23 test files passed, 345 tests passed |
| `pnpm test` (Web) | Vitest 5.1.0 | **PASSED** | 16 test files passed, 162 tests passed |
| `sms-subscription.test.ts` | Vitest 5.1.0 | **PASSED** | 20 passed tests covering domain, application, and HTTP routes |

### Detailed Test Coverage in `sms-subscription.test.ts`:
1. **Pure domain model:**
   - Validates Ethiopian mobile phone destinations (+2519... / +2517..., national 09... / 07...).
   - Rejects landlines (+25111...) and international numbers (+1202...).
   - Safely masks phone numbers (`+2519****3344`, `+2517****5678`).
   - Enforces that unverified or unsubscribed subscriptions are never eligible for job alert matches.
   - Deterministically matches jobs against subscriptions with category/location filters; rejects expired or withdrawn jobs.
   - Supports wildcard open-ended matching when filters are empty.
2. **Application service orchestration:**
   - Rejects non-learner roles (`role: 'support'`) with `unauthorized`.
   - Rejects invalid phone numbers with `invalid_phone`.
   - Initiates OTP challenge for unverified phone numbers and returns `verification_required`.
   - Enforces 60-second cooldown on consecutive verification requests for the same destination number.
   - Decrements remaining attempts and returns `mismatch` on invalid OTP submission.
   - Permanently locks out (exhausts) verification challenge after 3 failed attempts.
   - Unlocks active SMS job subscription upon correct OTP verification.
   - Allows an already-verified phone number to subscribe immediately without a new OTP challenge.
   - Enforces strict tenant isolation between learners: Learner B cannot verify, view, or delete Learner A's challenge or subscription.
   - Immediate opt-out: cancels queued delivery intents and prunes contact destination record.
3. **HTTP presentation routes:**
   - 401 Unauthorized for unauthenticated requests.
   - 403 Forbidden for non-learner roles.
   - 400 Bad Request for invalid Ethiopian mobile phone numbers.
   - Full end-to-end lifecycle: request -> OTP verify -> status query -> immediate opt-out.
   - Interoperability tests verifying aliases under `/api/careers/sms-subscriptions/*`.

---

## 5. Evidence Boundary & Unverified Items

- **OBSERVED:** Cryptographic OTP generation, salted SHA-256 digest comparison, timing-safe evaluation, 10-minute TTL expiry, 3-attempt permanent lockout, 60-second cooldown enforcement, Ethiopian mobile operator detection, deterministic category/location matching, strict learner isolation, immediate opt-out suppression of queued delivery intents, contact destination pruning, and complete HTTP presentation routes.
- **UNVERIFIED / SEPARATE LEAF:** Real live SMS dispatch to a physical Ethiopian mobile handset over the AfroMessage telco gateway requires provisioned live credentials and physical handset verification, which is owned and tracked under [T3-021-B / #94](https://github.com/EyasuGet/Hackaton/issues/94) and [T3-015-B / #84](https://github.com/EyasuGet/Hackaton/issues/84).
