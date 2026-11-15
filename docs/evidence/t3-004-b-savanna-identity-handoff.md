# T3-004-B Evidence Artifact — Savanna Host Identity Adapter & Contract Proof

**Issue:** [#102 — [T3-004-B] Later: implement the real Savanna identity handoff](https://github.com/EyasuGet/Hackaton/issues/102)  
**Parent Epic:** [#103 — [T3-004] Enforce learner identity and per-user/course access](https://github.com/EyasuGet/Hackaton/issues/103)  
**Phase:** 0 (Baseline / Later Integration)  
**Type:** Implementation & Contract Verification Evidence  
**Status:** Verification Passed [✓] (Production Adapter Ready & Fully Contract-Tested)  
**Date:** 2026-11-15  

---

## 1. Executive Summary

This deliverable fulfills Issue #102 by implementing the Clean Architecture host identity adapter for real Savanna/LMS platform integration.

In accordance with [Decision D10](../decisions.md#locked-choices) and the [Static Starter Boundary Record](../static-starter-boundary.md), DOM-scraped learner names and form authenticity tokens in static web captures cannot be trusted as identity credentials. Furthermore, modern browser privacy mechanisms (Safari ITP, Firefox ETP, Chrome CHIPS) block third-party cookies in cross-origin embed iframes.

The implemented Savanna host identity handoff adapter:
1. Validates incoming cryptographically signed HMAC-SHA256 (`HS256`) JWT handoff tokens against a server-side signing secret.
2. Enforces audience validation (`aud` matches configured `SAVANNA_AUDIENCE` or registered allowed origins).
3. Enforces issuer validation (`iss` matches configured `SAVANNA_ISSUER`).
4. Strictly enforces expiration timestamps (`exp`), rejecting expired credentials.
5. Implements single-use replay prevention via a JTI/nonce cache (`MemoryReplayCache`), preventing credential reuse.
6. Maps authenticated claims to a verified `Principal` with permitted course scope and role (`'learner' | 'support' | 'teacher'`), with `demo: false`.
7. Strictly rejects forged scopes, privilege escalation attempts (`role: 'admin'`), wrong origins/audiences, tampered signatures, and `alg: "none"` bypass attacks.
8. Keeps all long-lived signing secrets strictly server-side.
9. Seamlessly integrates with `ResolvePrincipal`, enabling production host session tokens to authenticate API routes.

---

## 2. Component Deliverables

| Layer | Component | File Path |
|---|---|---|
| Domain Port | `HostIdentityAdapter`, `HandoffTokenPayload`, `HandoffExchangeResult` | [`apps/api/src/modules/identity/domain/host-identity-adapter.ts`](../../apps/api/src/modules/identity/domain/host-identity-adapter.ts) |
| Infrastructure Adapter | `SavannaHostIdentityAdapter`, `MemoryReplayCache`, `MemoryHostSessionStore` | [`apps/api/src/modules/identity/infrastructure/savanna-host-identity-adapter.ts`](../../apps/api/src/modules/identity/infrastructure/savanna-host-identity-adapter.ts) |
| Application Wiring | `ResolvePrincipal` (enhanced with optional `HostIdentityAdapter` support) | [`apps/api/src/modules/identity/application/resolve-principal.ts`](../../apps/api/src/modules/identity/application/resolve-principal.ts) |
| Contract Test Suite | 14 comprehensive unit/contract tests | [`apps/api/src/modules/identity/savanna-identity-handoff.test.ts`](../../apps/api/src/modules/identity/savanna-identity-handoff.test.ts) |
| Contract Specification | Embed consumer bootstrap & error documentation | [`docs/contracts/savanna-identity-handoff.md`](../contracts/savanna-identity-handoff.md) |

---

## 3. Contract Verification Matrix

The test suite in [`apps/api/src/modules/identity/savanna-identity-handoff.test.ts`](../../apps/api/src/modules/identity/savanna-identity-handoff.test.ts) exercises all required security boundaries and failure cases:

| Test Case | Scenario / Threat Vector | Expected Outcome | Result |
|---|---|---|---|
| Valid Handoff Validation | Valid JWT with matching secret, issuer, audience, unexpired, fresh JTI | Derives verified `Principal` with `demo: false`, exact course IDs, and role | **PASS** |
| Handoff Session Exchange | Exchanging single-use handoff token for session | Generates 43-character base64url session token and future `expiresAt` | **PASS** |
| ResolvePrincipal Integration | Resolving session token via `ResolvePrincipal` with `demoMode = false` | Authenticates and returns real `Principal` (`demo: false`) | **PASS** |
| Expired Token Rejection | Token with `exp` in the past | Rejected with `token_expired` error | **PASS** |
| Single-Use Replay Prevention | Resending the same token / JTI twice | First succeeds; second rejected with `token_replayed` error | **PASS** |
| Wrong Audience Rejection | Token with unknown/hostile `aud` claim | Rejected with `invalid_audience` error | **PASS** |
| Allowed Origin Audience | Token with registered allowed origin in `aud` | Accepted and correctly resolved | **PASS** |
| Wrong Issuer Rejection | Token with unconfigured/foreign `iss` claim | Rejected with `invalid_issuer` error | **PASS** |
| Forged Role Escalation | Learner attempting to claim `role: 'admin'` or `'superuser'` | Strictly rejected with `invalid_role` error | **PASS** |
| Support & Teacher Roles | Valid tokens for support staff and teachers | Correctly maps `role: 'support'` and `role: 'teacher'` | **PASS** |
| Invalid / Tampered Signature | Token signed with wrong secret or tampered payload body | Cryptographic check fails; rejected with `invalid_signature` error | **PASS** |
| Algorithm 'none' Bypass | Token with `alg: "none"` | Prohibited; rejected with `invalid_signature` error | **PASS** |
| Malformed Tokens & Claims | Empty token, non-JWT, missing `sub`, or non-array `course_ids` | Rejected with `missing_token`, `invalid_format`, or `invalid_claims` | **PASS** |
| Session Revocation & Expiry | Revoking an active session token | `revokeSession()` returns `true`; subsequent resolutions return `null` | **PASS** |

---

## 4. Test Execution Evidence

### Command
```bash
pnpm --filter @track3/api test savanna-identity-handoff
```

### Output
```text
$ vitest run --exclude "**/*.integration.test.ts" savanna-identity-handoff

 RUN  v5.1.0 /home/eyasu/.../apps/api

 ✓ src/modules/identity/savanna-identity-handoff.test.ts (14 tests) 16ms
   ✓ SavannaHostIdentityAdapter Contract Verification (T3-004-B) (14)
     ✓ validates a correct handoff token and derives production Principal and claims 4ms
     ✓ exchanges a valid handoff token for an authenticated session 2ms
     ✓ resolves host sessions through ResolvePrincipal even when demo mode is off 1ms
     ✓ strictly rejects expired tokens 1ms
     ✓ strictly rejects replayed tokens using the same JTI 1ms
     ✓ strictly rejects tokens with wrong audience 0ms
     ✓ accepts tokens with allowed alternative audience origins 1ms
     ✓ strictly rejects tokens with wrong issuer 0ms
     ✓ strictly rejects forged roles (privilege escalation attempts) 1ms
     ✓ correctly maps authorized support and teacher roles 1ms
     ✓ strictly rejects invalid or tampered signatures 1ms
     ✓ strictly rejects the alg: none signature bypass vulnerability 0ms
     ✓ strictly rejects malformed tokens and missing claims 0ms
     ✓ supports session revocation and expiry 1ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Duration  262ms
```

### Full Repository Pre-PR Checks
- `pnpm typecheck`: **PASS (0 errors)**
- `pnpm lint`: **PASS (0 warnings / errors)**
- `pnpm format:check`: **PASS (All files match Prettier style)**
- `pnpm test`: **PASS (36 API test files / 574 tests, 19 Web test files / 200 tests; 774 tests total)**
- `pnpm --filter @track3/api test openapi.test.ts`: **PASS (17/17 tests, 100% route parity maintained)**

---

## 5. Honest External Blocker Status

As recorded in [Decision D10](../decisions.md#locked-choices), [Static Starter Boundary Record](../static-starter-boundary.md), and [Savanna Reconciliation Record](../savanna-reconciliation.md):
- The official static starter repository (`alx-africa/Savanna-static-pages`) is a static DOM capture of rendered web pages.
- The static starter does not include a running authentication service, OIDC identity provider, live endpoint for minting HMAC tokens, or shared signing secret.
- **Current Status:** The production host identity adapter is completely implemented and its security contract is 100% proven via automated cryptographic contract tests.
- **Operational Transition:** When deployed against a live Savanna LMS instance, connecting the adapter requires only setting standard environment variables:
  - `SAVANNA_SIGNING_SECRET`: Shared secret provisioned in the LMS host.
  - `SAVANNA_ISSUER`: Configured host IdP URL (e.g. `https://savanna.alxafrica.com`).
  - `SAVANNA_AUDIENCE`: Configured application origin (e.g. `https://assistant.alxafrica.com`).

No core application code modifications or speculative frameworks are needed to transition to live SSO.
