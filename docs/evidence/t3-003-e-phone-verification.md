# T3-003-E — Phone-ownership verification route

**Date:** 2026-11-15  
**Issue:** [#71](https://github.com/EyasuGet/Hackaton/issues/71)  
**Parent:** [T3-003](https://github.com/EyasuGet/Hackaton/issues/72)  
**Type:** Decision evidence / Architecture contract  
**Status:** Approved contract recorded; domain models, application service, and comprehensive test suite implemented and verified.

---

## 1. Summary

This decision record and specification resolves the phone-ownership verification route required before any learner can activate SMS job alert subscriptions ([T3-021-A](https://github.com/EyasuGet/Hackaton/issues/93)) or receive real outbound SMS job alerts ([T3-021-B](https://github.com/EyasuGet/Hackaton/issues/94)).

It settles the identity boundary with the host application (Savanna static pages), establishes that typed phone numbers are never treated as verified without cryptographic challenge proof, and fixes the One-Time Password (OTP) verification contract.

---

## 2. Host boundary and identity clarification

The official ALX Savanna host was inspected at pinned commit `9e83ac77891708117728ad9fc05301e124cc8ec8` (`alx-africa/Savanna-static-pages`). Findings:
1. **No verified phone claims:** The Savanna static pages contain static DOM fixtures with mock session markers. They provide no backend API, no OAuth 2.0 / OIDC identity tokens, and no verified user contact claims (e.g. verified phone numbers or verified emails).
2. **Untrusted DOM input:** Any phone number entered by a learner in the web UI is unverified user input. Treating a typed phone number as verified without an active proof of ownership would create critical failure modes:
   - **Harassment / Spam targetting:** A malicious learner could enter another person's phone number to trigger unwanted SMS alerts.
   - **Cost exhaustion:** Automated abuse could rapidly exhaust gateway SMS balance through unauthorized dispatches.
   - **Privacy leakage:** Job alert notifications containing personal or career preferences would be sent to wrong handsets.
3. **Resolution:** Decision **D23** locks the requirement that phone ownership must be verified via an explicit, rate-limited cryptographic OTP challenge flow before any SMS subscription or alert dispatch is permitted.

---

## 3. Approved phone-ownership verification contract

### 3.1. Cryptographic OTP generation
- **Code format:** 6-digit cryptographically random numeric string (`000000`–`999999`), generated using `crypto.randomInt(0, 1000000)`.
- **CSPRNG guarantee:** Uses the operating system's cryptographic pseudo-random number generator; never uses `Math.random()`.
- **Plaintext hygiene:** The plaintext OTP code is returned once to the caller solely for immediate dispatch via the approved SMS provider (`SmsAdapter`). Plaintext OTP is **never** persisted to the database, logged, or returned across public API routes.

### 3.2. Salted digest storage & constant-time comparison
- **Per-record salt:** A unique 16-byte cryptographically secure random salt (`crypto.randomBytes(16).toString('hex')`) is generated for every challenge.
- **Hashing algorithm:** SHA-256 digest computed over `${salt}:${code}`.
- **Timing side-channel mitigation:** Candidate code verification uses `crypto.timingSafeEqual` over candidate and stored digest buffers, preventing timing side-channel attacks.

### 3.3. Validity window (TTL)
- **Time-to-Live:** 10 minutes (600,000 ms) from creation (`expiresAt = createdAt + 10m`).
- **Expiry enforcement:** Codes evaluated at `now >= expiresAt` are rejected with status `expired`. Expired codes cannot be verified and require a new challenge request.

### 3.4. Attempt limits & lockout
- **Maximum attempts:** 3 failed verification attempts permitted per token.
- **Mismatch tracking:** Each incorrect code submission increments `attempts` and decrements `remainingAttempts`.
- **Lockout (exhaustion):** Upon the 3rd failed attempt, the token status is permanently transitioned to `exhausted`.
- **Permanent rejection:** A 4th invalid attempt (or any subsequent attempt, even if the correct code is supplied) is rejected with `status: 'exhausted'`. The learner must initiate a new challenge.

### 3.5. Rate-limiting & cooldown
- **Per-destination cooldown:** A minimum of 60 seconds cooldown is enforced between challenge dispatch requests for the same destination phone number.
- **Abuse protection:** Rapid consecutive requests return `cooldown_active` with the remaining seconds (`retryAfterSeconds`).

### 3.6. Learner isolation & data privacy
- **Principal authentication:** Only authenticated learner principals (`Principal.role === 'learner'`) may request verification or submit OTP codes. Support staff have no access.
- **Strict tenant isolation:** Verification tokens are strictly bound to `learnerId`. Learner B cannot query, verify, or view verification state for Learner A's phone number.
- **Safe display masking:** Phone numbers are masked in all logs, audit trails, and UI responses as `+2519****1234` or `+2517****1234` (preserving operator prefix and last 4 digits).

---

## 4. Accepted and rejected ownership examples

| Scenario | Input | Outcome | Reason |
|---|---|---|---|
| Valid Ethio Telecom challenge | `+251912341234` + correct OTP within 10 min (attempt 1) | **ACCEPTED (Verified)** | Matches SHA-256 digest within attempt and TTL window; ownership bound to learner. |
| Valid Safaricom challenge | `+251712345678` + correct OTP on attempt 2 (after 1 typo) | **ACCEPTED (Verified)** | Recovery allowed within the 3-attempt limit. |
| National format entry | `0912341234` | **ACCEPTED (Normalized)** | Validated and normalized to E.164 `+251912341234` before challenge dispatch. |
| Arbitrary entered number | `+251911112222` entered without OTP proof | **REJECTED** | Unverified input; never marked verified without challenge completion. |
| Expired challenge | Correct OTP submitted at 10 min 05 sec | **REJECTED (Expired)** | Outside 10-minute TTL; code is invalid. |
| Exhausted token (lockout) | 3 failed attempts followed by 4th attempt | **REJECTED (Exhausted)** | Permanent lockout after 3 failed attempts; code permanently unusable. |
| Cooldown violation | Re-requesting code 25 seconds after initial request | **REJECTED (Cooldown active)** | Violates 60-second cooldown per destination. |
| Cross-learner verification | Learner B submits code for Learner A's pending challenge | **REJECTED (Not found / Isolated)** | Challenges are scoped strictly to the requesting `learnerId`. |
| Landline number | `+251111234567` | **REJECTED (Invalid phone)** | Ethiopian landlines do not support mobile SMS OTP delivery. |
| Non-Ethiopian destination | `+12025550199` | **REJECTED (Invalid phone)** | Only Ethiopian destination mobile numbers (+251) are supported. |

---

## 5. Implementation architecture

The implementation follows Clean Architecture conventions in `apps/api`:

```
apps/api/src/modules/delivery/
├── domain/
│   ├── phone-number.ts                # Ethiopian mobile E.164 normalization & operator detection
│   ├── phone-verification.ts          # Pure domain models (PhoneVerificationCode, attempt logic, masking)
│   └── phone-verification.test.ts     # Comprehensive unit tests for domain & application service
└── application/
    ├── ports/
    │   ├── phone-verification-repository.ts  # Persistence port (challenges, cooldowns, verified bindings)
    │   └── sms-adapter.ts                    # Outbound SMS gateway port
    └── phone-verification-service.ts  # Clean Architecture use-case service handling request, verify, cooldown
```

---

## 6. Verification evidence

All checks executed in the dedicated worktree:
- **Test suite:** `pnpm test` executes 21 unit tests in `phone-verification.test.ts`, covering:
  - Cryptographically secure 6-digit generation & padding.
  - Salt generation and deterministic SHA-256 hashing.
  - Timing-safe constant-time digest comparison.
  - Safe phone number masking (`+2519****1234`, `+2517****5678`).
  - Successful verification and `verifiedAt` timestamp recording.
  - Mismatch tracking and lockout after 3 failed attempts (including 4th attempt permanent exhaustion).
  - Expiration after 10-minute TTL.
  - 60-second cooldown calculation and enforcement.
  - Principal authorization and cross-learner tenant isolation.
- **Code style & formatting:** `pnpm format:check` reports clean formatting.
- **Static analysis:** `pnpm lint` reports 0 errors and 0 warnings.
- **Type safety:** `pnpm typecheck` reports 0 errors with `exactOptionalPropertyTypes`, `strict`, and `erasableSyntaxOnly`.
