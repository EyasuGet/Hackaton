# Channel Media, Delivery References, and Contact Retention Audit (T3-023-D)

## Executive Summary

- **Issue:** [T3-023-D] Audit added channel media, delivery references and contacts (#96)
- **Parent Epic:** [T3-023] Enforce retention and deletion across private records (#97)
- **Status:** PASS
- **Target Revision:** Verified on branch `feat/t3-023-d-channel-media-retention-audit`.
- **Audit Scope:**
  1. **Delivery Intent & Worker Recovery:** Verification that worker recovery cannot resurrect deleted or expired content. Expired source content (`contentExpiresAt <= now`) suppresses stale queued work, scrubs payload references (`contentRef = null`), and cancels delivery intents.
  2. **Unsubscribe & Contact Cleansing:** Verification that learner unsubscribe (SMS `STOP` / `አቁም` / `/unsubscribe` or Telegram `/unlink`) immediately cancels queued dispatches for that destination, while preserving unrelated active subscriptions.
  3. **Non-Content Dedup Key Lifecycle:** Verification that dedup records store only SHA-256 digests (`dedupDigest`), contain zero user content or recipient numbers, persist for 30 days to prevent replay attacks, and are pruned deterministically.
  4. **Channel Audio & Media Memory Wipe:** Verification of zero disk persistence, container signature validation via magic bytes (`detectAudioMimeType`), and guaranteed in-memory buffer clearing (`audioBuffer.fill(0)`) in `finally` blocks for speech synthesis and voice downloads.
  5. **Interactive Voice Review 15-Minute TTL:** Verification that pending Telegram voice reviews expire on a strict 15-minute clock, cannot be approved after expiry, and are pruned cleanly.
  6. **Human Verification Simulation:** Step-by-step verification proving expired synthetic content and revoked destinations are rejected by all subsequent worker sweeps.

---

## 1. Automated Verification Evidence

The test suite in [`apps/api/src/modules/retention/channel-retention-audit.test.ts`](file:///Users/apple/projects/personal/Hackaton/apps/api/src/modules/retention/channel-retention-audit.test.ts) asserts 8 comprehensive test cases under a controlled application clock:

```
$ node scripts/run-tests.js apps/api/src/modules/retention/channel-retention-audit.test.ts

 RUN  v5.1.0 apps/api

 ✓ src/modules/retention/channel-retention-audit.test.ts (8 tests) 11ms
   ✓ Channel Media, Delivery References, and Contact Retention Audit (T3-023-D) (8)
     ✓ suppresses stale queued work and scrubs payload when source content expires before send 5ms
     ✓ cancels queued delivery and removes contact destination on unsubscribe while preserving unrelated active subscriptions 2ms
     ✓ guarantees worker recovery cannot resurrect deleted or expired content after worker crash 0ms
     ✓ preserves bounded non-content dedup digest for 30 days and prunes deterministically without holding user content 0ms
     ✓ enforces zero disk persistence and wipes synthesized speech audio buffers in memory 0ms
     ✓ rejects spoofed or invalid audio containers prior to transcription or storage 0ms
     ✓ enforces 15-minute TTL on interactive Telegram voice reviews and prunes expired reviews 0ms
     ✓ revoking Telegram link suppresses all future delivery to chat and deletes preferences 0ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

### Full Workspace Verification Commands
- `pnpm format:check` (PASS: Clean code style)
- `pnpm lint` (PASS: Clean ESLint checks with zero warnings/errors)
- `pnpm typecheck` (PASS: Clean TypeScript type check across all workspaces)
- `pnpm --filter @track3/api test` (PASS: 40/40 test files passed, 639/639 tests passed)

---

## 2. Channel Delivery & Contact Lifecycle Audit

| Area | Contract / Rule | Test Scenario & Clock Point | Verified Outcome | Code Pointers |
|---|---|---|---|---|
| **Expired Content in Queue** | Stale queued work must not be delivered if source content expired. | Queued delivery intent with `contentExpiresAt = T + 168h`. Advanced clock to `T + 169h`. Worker batch runs. | Worker skips send (`claimed = 0`); `dispatch` never called; intent status set to `cancelled`; `contentRef` scrubbed to `null`. | [`channel-retention-audit.test.ts:384`](file:///Users/apple/projects/personal/Hackaton/apps/api/src/modules/retention/channel-retention-audit.test.ts#L384) |
| **Unsubscribe / Opt-Out** | Unsubscribe cancels pending sends and removes contact while preserving unrelated subscriptions. | Two SMS intents queued for Learner 1 (`+251911223344`) and Learner 2 (`+251922334455`). Learner 1 sends opt-out. | Learner 1 intent cancelled and payload scrubbed; Learner 2 intent remains `pending` and delivers successfully. | [`channel-retention-audit.test.ts:430`](file:///Users/apple/projects/personal/Hackaton/apps/api/src/modules/retention/channel-retention-audit.test.ts#L430) |
| **Worker Crash & Recovery** | Worker recovery cannot resurrect deleted or expired content. | Worker claims intent with 60s lease; crashes. Clock advances past lease expiry and past content retention (`T + 169h`). Recovery worker claims work. | Recovered worker identifies expired content, cancels intent, and scrubs payload; zero messages sent. | [`channel-retention-audit.test.ts:505`](file:///Users/apple/projects/personal/Hackaton/apps/api/src/modules/retention/channel-retention-audit.test.ts#L505) |
| **Dedup Key Retention** | Non-content dedup digest preserved for 30 days to suppress replays, then purged. | Completed intent with SHA-256 digest at `T`. Clock advanced to `T + 29d`, then `T + 30d`. | Kept at 29 days; purged at 30 days. Contains strictly SHA-256 hash (64 hex characters), zero phone numbers or content text. | [`channel-retention-audit.test.ts:565`](file:///Users/apple/projects/personal/Hackaton/apps/api/src/modules/retention/channel-retention-audit.test.ts#L565) |
| **Telegram Unlink** | Revoking Telegram link suppresses all future delivery to chat and deletes preferences. | Linked Telegram user unlinks via `/unlink`. Pending intent queued for chat ID. | Identity link revoked (`revoked_at` recorded); identity lookup returns `null`; queued intent cancelled and scrubbed. | [`channel-retention-audit.test.ts:650`](file:///Users/apple/projects/personal/Hackaton/apps/api/src/modules/retention/channel-retention-audit.test.ts#L650) |

---

## 3. Audio & Voice Media Retention Controls

1. **Zero Disk Persistence (D16):**
   - Synthesized speech (`SpeechSynthesizerProvider`) and incoming Telegram voice downloads are processed strictly in RAM (`Buffer` / `Uint8Array`).
   - Neither the API server nor worker processes create temporary audio files on disk (`/tmp` or workspace directories).
2. **Ephemeral Memory Zeroing (`audioBuffer.fill(0)`):**
   - In [`telegram-link-service.ts`](file:///Users/apple/projects/personal/Hackaton/apps/api/src/modules/telegram/application/telegram-link-service.ts), all audio processing wraps memory buffers in a `try ... finally` block:
     ```typescript
     try {
       await this.#telegramClient.sendVoice({ ... });
     } finally {
       audioBuffer.fill(0);
     }
     ```
   - Zeroing out memory buffers guarantees that audio bytes cannot linger in garbage-collected heap memory or be leaked in heap dumps.
3. **Container Magic Byte Sniffing (D17 / V04):**
   - [`detectAudioMimeType`](file:///Users/apple/projects/personal/Hackaton/apps/api/src/modules/telegram/application/audio-sniffer.ts) inspects container signatures (Ogg Opus `OggS`, RIFF WAV `RIFF....WAVE`, WebM, MP4, MP3) before transcription or dispatch. Spoofed non-audio payloads are rejected immediately.
4. **15-Minute Voice Review Expiry:**
   - Interactive voice review records stored in `telegram_voice_reviews` have a 15-minute TTL (`expires_at = created_at + 15m`).
   - Expired reviews return `null` on read, cannot be approved or edited, and are purged from the database.

---

## 4. Human Verification Procedure & Results

### Verification Scenario
1. **Setup:** Queue a synthetic delivery intent with a 7-day retention anchor (`T + 168h`) and an active Telegram chat destination.
2. **Action 1 (Expire Content):** Advance clock past expiration (`T + 168h + 1s`).
3. **Observation 1:** Execute worker sweep. Worker inspects intent, verifies `contentExpiresAt <= now`, marks status `cancelled`, sets `contentRef = null`, and aborts external transmission.
4. **Action 2 (Revoke Destination):** Link a Telegram test account, queue a notification, then execute `/unlink`.
5. **Observation 2:** Inspect database identity row: `revoked_at` is set. Attempt delivery: worker identifies revoked recipient, cancels delivery intent, and zeroes out destination mapping.
6. **Result:** Verified that no later send can use deleted data or dispatch to revoked destinations.

---

## 5. Truthful External-Provider & Backup Disclosures

1. **Telegram Bot API & AfroMessage Retention:**
   - Audio notes and text messages delivered to Telegram or AfroMessage reside on Telegram Cloud and AfroMessage telecom gateways according to those providers' retention policies.
   - Local database deletion or memory wiping does not delete messages already received by learners on Telegram clients or mobile handsets.
2. **Database Backups:**
   - In accordance with Decision D16, database backups retain rows until the backup snapshot expires.
   - If a database is restored from an operator snapshot, the read rule (`expires_at > now`) prevents expired records from being served, and an immediate startup purge sweep permanently cleans restored expired rows.
