# Core Web, Help, and Accommodation Expiry and Deletion Audit (T3-023-C)

## Executive Summary

- **Issue:** [T3-023-C] Audit core web/help/accommodation expiry and deletion (#51)
- **Parent Epic:** [T3-023] Enforce retention expiry and deletion rules (#53)
- **Status:** PASS
- **Target Revision:** Verified on branch `feat/t3-023-c-core-expiry-audit`.
- **Audit Scope:**
  1. **Retention Contract 14-Row Verification (`docs/retention.md`):** Complete controlled-clock audit of all 14 rows of the retention specification across tutoring conversations/history, help requests, support replies, shared context, learner history clearing, cross-learner denial, delivery queues, unsubscribe suppression, dedup key lifecycle, and idempotent purge sweeps.
  2. **Accommodation Request Expiry & Coordinator Isolation:** Verification that accommodation request text expires on its 168-hour clock, and coordinator/learner views strictly exclude expired records (`expires_at > now`).
  3. **Web Audio Cleanup:** Verification that temporary audio blobs and hardware microphone `MediaStreamTrack`s are released on all terminal paths (upload/stop, cancel, error) and are never persisted to disk or DB.
  4. **Offline Cache Privacy Exclusions:** Verification that private API responses (`/api/*`) are never cached by the Service Worker, non-GET methods are rejected, and only approved public shell assets and FAQs persist offline.
  5. **External Provider & Backup Limits:** Truthful and honest disclosure of provider-side retention limits (Google Gemini, AfroMessage, Telegram) and database backup rotation policies.

---

## 1. Automated Verification Evidence

The test suite in [`apps/api/src/modules/retention/core-expiry-audit.test.ts`](file:///home/eyasu/.gemini/antigravity/brain/db143aa3-c8dc-4707-bc72-235cdb571288/.system_generated/worktrees/subagent-Core-Expiry-and-Deletion-Auditor-self-a05de27e/apps/api/src/modules/retention/core-expiry-audit.test.ts) asserts 28 comprehensive test cases under a controlled application clock:

```
$ node scripts/run-tests.js apps/api/src/modules/retention/core-expiry-audit.test.ts

 RUN  v5.1.0 apps/api

 ✓ src/modules/retention/core-expiry-audit.test.ts (28 tests) 389ms
   ✓ Core Retention Contract Audit (docs/retention.md 14-Row Verification) (14)
     ✓ Row 1: Message created at T is returned to owner at T + R - 1s (where R = 168h) 99ms
     ✓ Row 2: Same message at T + R (168h) is NOT returned, even before any purge runs (read rule enforcement) 7ms
     ✓ Row 3: Purge runs at T + R; expired item is deleted/scrubbed while item created at T + 1h remains active until T + R + 1h 7ms
     ✓ Row 4: New activity in same conversation at T + 100h does NOT extend prior items expires_at 13ms
     ✓ Row 5: Downtime from T + 100h to T + 200h; startup purge deletes expired records and read rule excludes them before purge 19ms
     ✓ Row 6: Shared context in help requests expires with the earliest source expiration (min(request, source)) 6ms
     ✓ Row 7: Support reply created at T + 50h expires on its own clock at T + R + 50h 6ms
     ✓ Row 8: Learner A clears history immediately; conversation items and help shared copies gone; Learner B untouched 8ms
     ✓ Row 9: Learner A tries to clear Learner B history; rejected and nothing deleted 13ms
     ✓ Row 10: Delivery queued for message that expires or is cleared; worker skips send, scrubs payload, no re-creation 22ms
     ✓ Row 11: Learner unsubscribes while send queued; contact deleted and queued send cancelled immediately 5ms
     ✓ Row 12: Dedup key created at T is purged at T + 30 days; contains no user content 4ms
     ✓ Row 13: Purge runs twice or concurrently; idempotent with identical outcomes and no errors 12ms
     ✓ Row 14: Help request created at T, still open with content expired at T + R, has contentless row purged at T + 30 days 5ms
   ✓ Accommodation Content Expiry and Coordinator Isolation Audit (3)
     ✓ Accommodation request text expires on its 168h clock 4ms
     ✓ Coordinator and learner lists exclude expired accommodation records (read rule) 6ms
     ✓ Coordinator cannot update status or add replies to expired accommodation requests 6ms
   ✓ Web Audio Cleanup Audit (4)
     ✓ Temporary audio tracks and stream are stopped and released on successful recording stop 1ms
     ✓ Temporary audio tracks and stream are stopped and released immediately on cancel 1ms
     ✓ Temporary audio tracks and stream are released immediately on hardware or recorder error 1ms
     ✓ Audio payloads are processed in-memory only and never persisted to disk or DB 0ms
   ✓ Offline Cache Exclusions Audit (Service Worker Policy) (4)
     ✓ All private /api/* routes are strictly network-only and excluded from CacheStorage 1ms
     ✓ Non-GET HTTP methods (POST, PUT, DELETE, PATCH) are rejected from caching 0ms
     ✓ Only approved app shell assets and approved public FAQs are eligible for caching 0ms
     ✓ Service worker activation purges outdated cache versions 1ms
   ✓ HTTP Route Integration under Controlled Clock (3)
     ✓ GET /api/tutoring/history excludes expired items at T + 168h via HTTP 73ms
     ✓ GET /api/help/requests excludes expired help requests via HTTP 35ms
     ✓ GET /api/accommodation/requests/:id returns 404 for expired requests via HTTP 30ms

 Test Files  1 passed (1)
      Tests  28 passed (28)
```

### Pre-PR Verification Commands
- `pnpm --filter @track3/api test apps/api/src/modules/retention/core-expiry-audit.test.ts` (PASS: 28/28 tests passed)
- `pnpm typecheck` (PASS: Clean TypeScript type check across all workspaces)
- `pnpm lint` (PASS: Clean ESLint checks with zero warnings/errors)
- `pnpm format:check` (PASS: All matched files adhere to Prettier code style)

---

## 2. Retention Contract Audit (docs/retention.md 14 Rows)

The 14 contract rows define clock-based outcomes for all stored learner content items. `T` is an item's creation time; `R` is exactly 168 hours (7 days = 604,800 seconds).

| # | Contract Specification | Test Setup & Clock Point | Verified Outcome | Code Pointers |
|---|---|---|---|---|
| **1** | Message created at `T` returned to owner at `T + R - 1s`. | Created message at `T`; advanced clock to `T + 168h - 1s`. | Message question and answer returned; history includes item. | [`core-expiry-audit.test.ts:358`](file:///home/eyasu/.gemini/antigravity/brain/db143aa3-c8dc-4707-bc72-235cdb571288/.system_generated/worktrees/subagent-Core-Expiry-and-Deletion-Auditor-self-a05de27e/apps/api/src/modules/retention/core-expiry-audit.test.ts#L358) |
| **2** | Same message not returned at `T + R`, even before purge runs. | Advanced clock to `T + 168h`; unpurged in storage (`purged_at = null`). | Read rule excludes item; `getRequest` returns `null`; history excludes item. | [`core-expiry-audit.test.ts:379`](file:///home/eyasu/.gemini/antigravity/brain/db143aa3-c8dc-4707-bc72-235cdb571288/.system_generated/worktrees/subagent-Core-Expiry-and-Deletion-Auditor-self-a05de27e/apps/api/src/modules/retention/core-expiry-audit.test.ts#L379) |
| **3** | Purge runs at `T + R`: message deleted; item created at `T + 1h` remains until `T + R + 1h`. | Msg 1 at `T`, Msg 2 at `T + 1h`. Purge at `T + 168h`. | Msg 1 scrubbed in-place; Msg 2 remains active and readable until `T + 169h`. | [`core-expiry-audit.test.ts:404`](file:///home/eyasu/.gemini/antigravity/brain/db143aa3-c8dc-4707-bc72-235cdb571288/.system_generated/worktrees/subagent-Core-Expiry-and-Deletion-Auditor-self-a05de27e/apps/api/src/modules/retention/core-expiry-audit.test.ts#L404) |
| **4** | New activity in same conversation at `T + 100h` does not extend prior items' `expires_at`. | Msg 1 at `T` in Conv C. Msg 2 added to Conv C at `T + 100h`. Clock at `T + 168h`. | Msg 1 `expires_at` unchanged; Msg 1 expired and unreadable; Msg 2 active. | [`core-expiry-audit.test.ts:457`](file:///home/eyasu/.gemini/antigravity/brain/db143aa3-c8dc-4707-bc72-235cdb571288/.system_generated/worktrees/subagent-Core-Expiry-and-Deletion-Auditor-self-a05de27e/apps/api/src/modules/retention/core-expiry-audit.test.ts#L457) |
| **5** | Process down `T + 100h` to `T + 200h`; startup purge deletes expired records; reads exclude before purge finishes. | Msg at `T`. System offline until `T + 200h`. | Reads at startup return `null` immediately; startup purge cleans records with no grace period. | [`core-expiry-audit.test.ts:498`](file:///home/eyasu/.gemini/antigravity/brain/db143aa3-c8dc-4707-bc72-235cdb571288/.system_generated/worktrees/subagent-Core-Expiry-and-Deletion-Auditor-self-a05de27e/apps/api/src/modules/retention/core-expiry-audit.test.ts#L498) |
| **6** | Help request at `T + 1h` sharing message created at `T`: shared copy expires with earliest source expiration. | Source msg at `T` (`expires_at = T + 168h`). Help request opened at `T + 1h`. Clock at `T + 168h`. | Help request shared context expires at `T + 168h` (`min(req, source)`); context scrubbed; queue excludes item. | [`core-expiry-audit.test.ts:526`](file:///home/eyasu/.gemini/antigravity/brain/db143aa3-c8dc-4707-bc72-235cdb571288/.system_generated/worktrees/subagent-Core-Expiry-and-Deletion-Auditor-self-a05de27e/apps/api/src/modules/retention/core-expiry-audit.test.ts#L526) |
| **7** | Support reply created at `T + 50h` expires on its own clock (`T + R + 50h`). | Help request at `T`. Staff reply at `T + 50h`. Clock at `T + 168h`, then `T + 218h`. | Reply active and readable at `T + 168h`; reply expires at `T + 218h` on its own clock. | [`core-expiry-audit.test.ts:566`](file:///home/eyasu/.gemini/antigravity/brain/db143aa3-c8dc-4707-bc72-235cdb571288/.system_generated/worktrees/subagent-Core-Expiry-and-Deletion-Auditor-self-a05de27e/apps/api/src/modules/retention/core-expiry-audit.test.ts#L566) |
| **8** | Learner A clears history at `T + 10h`: immediately gone, including help copies; Learner B untouched. | Learner A & B records created. Learner A executes `clearHistory()`. | Learner A's conversations deleted immediately; Learner A's shared help copies scrubbed; Learner B records intact. | [`core-expiry-audit.test.ts:607`](file:///home/eyasu/.gemini/antigravity/brain/db143aa3-c8dc-4707-bc72-235cdb571288/.system_generated/worktrees/subagent-Core-Expiry-and-Deletion-Auditor-self-a05de27e/apps/api/src/modules/retention/core-expiry-audit.test.ts#L607) |
| **9** | Learner A tries to clear Learner B's history: denied, nothing deleted. | Learner B has private records. Learner A issues delete command under A's identity. | Rejected / scoped to A; Learner B's history remains completely intact. | [`core-expiry-audit.test.ts:655`](file:///home/eyasu/.gemini/antigravity/brain/db143aa3-c8dc-4707-bc72-235cdb571288/.system_generated/worktrees/subagent-Core-Expiry-and-Deletion-Auditor-self-a05de27e/apps/api/src/modules/retention/core-expiry-audit.test.ts#L655) |
| **10** | Delivery queued for message that expires or is cleared: worker skips send, scrubs payload, no re-creation. | Delivery intent queued for `help_reply`. Content expires before dispatch. Worker runs. | Worker skips send; zero external dispatches; intent `status = 'cancelled'`; `content_ref = null`. | [`core-expiry-audit.test.ts:672`](file:///home/eyasu/.gemini/antigravity/brain/db143aa3-c8dc-4707-bc72-235cdb571288/.system_generated/worktrees/subagent-Core-Expiry-and-Deletion-Auditor-self-a05de27e/apps/api/src/modules/retention/core-expiry-audit.test.ts#L672) |
| **11** | Learner unsubscribes while send queued: immediately contact deleted and queued send cancelled. | Pending intent queued. Learner executes opt-out. | In same transaction, preference set to `false`, intent `status = 'cancelled'`, `content_ref = null`. | [`core-expiry-audit.test.ts:722`](file:///home/eyasu/.gemini/antigravity/brain/db143aa3-c8dc-4707-bc72-235cdb571288/.system_generated/worktrees/subagent-Core-Expiry-and-Deletion-Auditor-self-a05de27e/apps/api/src/modules/retention/core-expiry-audit.test.ts#L722) |
| **12** | Dedup key created at `T` purged at `T + 30 days`: contains no user content. | Delivery intent with SHA-256 digest at `T`. Clock at `T + 29d`, then `T + 30d`. | Kept at 29 days for replay suppression; purged at 30 days. Contains no content text or phone numbers. | [`core-expiry-audit.test.ts:758`](file:///home/eyasu/.gemini/antigravity/brain/db143aa3-c8dc-4707-bc72-235cdb571288/.system_generated/worktrees/subagent-Core-Expiry-and-Deletion-Auditor-self-a05de27e/apps/api/src/modules/retention/core-expiry-audit.test.ts#L758) |
| **13** | Purge runs twice or on two instances at once: same result, no errors. | Expired records purged on run 1. Run 2 executes at same timestamp. Concurrent worker test. | Second run purges 0 additional rows; concurrent runs return safely without conflict. | [`core-expiry-audit.test.ts:795`](file:///home/eyasu/.gemini/antigravity/brain/db143aa3-c8dc-4707-bc72-235cdb571288/.system_generated/worktrees/subagent-Core-Expiry-and-Deletion-Auditor-self-a05de27e/apps/api/src/modules/retention/core-expiry-audit.test.ts#L795) |
| **14** | Help request at `T`, still open, content expired at `T + R`: contentless row purged at `T + 30 days`. | Request at `T`. Content expired at `T + 168h`. Row retained as tombstone/lifecycle record. Clock at `T + 30d`. | Contentless row purged at 30 days, enforcing bounded metadata retention. | [`core-expiry-audit.test.ts:822`](file:///home/eyasu/.gemini/antigravity/brain/db143aa3-c8dc-4707-bc72-235cdb571288/.system_generated/worktrees/subagent-Core-Expiry-and-Deletion-Auditor-self-a05de27e/apps/api/src/modules/retention/core-expiry-audit.test.ts#L822) |

---

## 3. Accommodation Request Expiry & Coordinator Isolation

1. **168-Hour Expiry Clock:**
   - Accommodation requests created by learners carry `expires_at = created_at + 168 hours`.
   - At `T + 167h 59m 59s`, both the requesting learner and an authorized coordinator (support role) can view the support description.
   - At `T + 168h`, the read rule (`expires_at > now`) excludes the request from `getById()` (returns `null`), `listOwned()` (empty list), and `listCoordinatorQueue()` (empty queue).
2. **Action Fencing on Expired Records:**
   - Attempts by a coordinator to update status (`updateStatus`) or reply (`addReply`) to an accommodation request past its 168-hour expiration return `null` and are safely rejected.

---

## 4. Web Audio Cleanup & Hardware Release

Learner voice recording (`BrowserAudioRecorder` in `apps/web/src/features/assistant/audio-recorder.ts`) operates strictly under user control without background capture:
1. **Upload / Successful Stop:** On `stop()`, hardware audio tracks (`MediaStreamTrack`) are immediately stopped via `track.stop()`, `mediaStream` is set to `null`, and internal chunk buffers are cleared.
2. **Discard / Cancel:** On `cancel()`, `cleanup()` stops all active tracks, clears recorded chunks, and restores state to `idle`.
3. **Hardware / Recorder Error:** On `NotAllowedError` or recorder exceptions, `cleanup()` stops any opened tracks and clears buffers.
4. **Zero Persistent Storage:** Base64 audio payloads sent to `/api/tutoring/transcription` exist in server memory only during the active HTTP request and are never written to disk, SQLite, PostgreSQL, or application logs.

---

## 5. Offline Cache Privacy Exclusions (Service Worker)

The Service Worker (`apps/web/public/sw.js`) enforces strict privacy boundaries:
1. **Private API Route Exclusions:** All requests matching `/api/*` are network-only (`if (url.pathname.startsWith('/api/')) return;`). Tutoring history, help requests, accommodation text, and demo session credentials never enter browser `CacheStorage`.
2. **HTTP Method Filtering:** Non-GET methods (POST, PUT, DELETE, PATCH) bypass cache completely.
3. **Approved Public Cache Scope:** Only static application shell assets (`/`, `/assets/*`, `/loader.js`) and approved public course FAQs are cached.
4. **Cache Upgrade Cleansing:** On service worker activation, old cache buckets are identified and deleted deterministically (`caches.delete(key)`).

---

## 6. External-Provider and Backup Limits (Truthful Disclosure)

Per [spec R03](spec.md), [retention contract](retention.md), and [AI feasibility notes](ai-feasibility.md):

1. **External AI & Speech Providers:**
   - Content and audio sent to third-party cloud APIs (Google Gemini for online tutoring answers and audio transcription, AfroMessage for SMS alerts, and Telegram Bot API for notifications) are governed by those providers' terms and data retention policies.
   - **Local expiry and hard-deletion do not reach provider infrastructure.** The application makes no false claims that local deletion removes third-party copies. Learners must be explicitly disclosed that third-party processing occurs under provider terms.
2. **Database Backups:**
   - No automated backup scripts or continuous archival are bundled in this repository.
   - If an infrastructure operator configures database backups, snapshots will retain learner records until that backup's rotation period expires.
   - In any restore procedure from an operator backup, the read rule (`expires_at > now`) ensures expired data is never served, and a purge sweep must be run immediately upon restore completion.

---

## 7. Applicable Architecture Decisions

- **Decision D01 (Clean Architecture):** Domain expiry rules are evaluated independently of HTTP or database driver layers.
- **Decision D07 (Accommodation Privacy):** Accommodation details are visible only to the owning learner and authorized coordinators, and expire strictly at 168 hours.
- **Decision D16 (Retention & Expiry):** Seven-day default retention (exactly 168 hours) anchored to creation timestamp without activity-based extension.
- **Decision D23 (AfroMessage SMS & Delivery Intents):** Outbox payloads scrub references when source items expire or when learners unsubscribe.
