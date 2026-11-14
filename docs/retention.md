# Retention and expiry contract

Status: **PROVISIONAL. The institution has not confirmed this.** This contract records [T3-023-A](https://github.com/EyasuGet/Hackaton/issues/49) and implements the seven-day default in [spec R03](spec.md) and [D16](decisions.md). It is an implementation contract, not a legal or privacy promise to learners. Until the institution confirms the anchor and the open questions below, store **only synthetic data**. Implementing issues (T3-023-B/C/D and each data-owning feature) apply this rule as written. They must not choose a longer one.

## The rule

1. **Each stored content item expires 168 hours after it is created.**
   - Seven days means exactly 168 hours, not calendar days, so time zones and calendar conversion cannot change it.
   - When an item is written, `expires_at = created_at + retention`.
   - `expires_at` is never moved later. Later activity, a reply, a read, a share, a help request still being open, or downtime does not extend an item already stored.
2. **An item is expired when `now >= expires_at`.** At that instant it is no longer served, even if the purge has not yet run (see the read rule).
3. **One clock decides both values.** The same application clock supplies `created_at` and the `now` used for every expiry comparison. Values are stored as UTC `timestamptz`. Tests inject this clock.
4. **The default retention is 168 hours.** A configured value may be shorter. A longer value needs recorded institution approval first, because it extends storage.

This is the strictest of the candidate anchors: creation, last activity, and help-request resolution. Nothing can keep an item past seven days from when it was written. If the institution chooses another anchor, update this file and the dependent tests before real data is accepted. Do not quietly keep data longer meanwhile.

## What it covers

| Record | Expires | Notes |
|---|---|---|
| Learner questions, assistant replies, transcripts | Own `expires_at` | Clearing history deletes them immediately (see below) |
| Conversation container | Deleted by the same purge that removes its last item | Holds no content of its own beyond owner/context identifiers |
| Help-request messages and support replies | Own `expires_at` | Expires even while the request is waiting or assigned. The request row (state, owner, timestamps, no content) stays only to show that the content has expired |
| Help-request row (no content) | When closed and its content is gone, and in any case 30 days after creation (**provisional**) | Purpose: lets the learner and support see that a request existed and how it ended. Bounded so metadata is not kept indefinitely |
| Context a learner shares into a help request | The **earliest** `expires_at` of its source items | Copying never resets the clock. A copy can never outlive the original |
| Accommodation request text | Own `expires_at` | Same rule |
| Pending delivery payloads that hold or reference content | No later than the content they carry | Workers recheck that the content still exists before sending. Missing content means skip and never re-create. Scrub the payload when the source is deleted |
| Alert contact details (phone/Telegram destination) | On unsubscribe, or when the subscription ends because it is cancelled, consent is withdrawn or the learner's account is removed | Not on the 168-hour clock. Deletion and cancelling queued sends happen in the same transaction |
| Deduplication/audit keys | 30 days after creation (**provisional**) | Opaque, with no message text or contact details. Purpose: stop a replayed import/event or a retried send from repeating an alert |
| Temporary audio | Deleted on every terminal path (success, failure, cancel) | Never kept until the 168-hour purge |
| Demo handoff codes and sessions | Their own short `expires_at` | Credentials, not content. Hold no learner text. A purge must remove them once they expire; none exists yet |

**Not covered:**
- Approved course content, FAQs and job records. They are institution material, not learner data.
- Principals and course grants.
- The `demo_records` table (migration 0002). It holds synthetic fixture text only, and its migration says it is dropped once real learner data such as T3-007-D's history replaces it.

## How expiry is enforced

- **Read rule:** every query that returns content filters `expires_at > now`. This applies to lists, single items, help views, delivery workers and exports. Expired content is therefore never served between purge runs or while a purge is catching up.
- **Purge:**
  - Hard-deletes rows with `expires_at <= now`, in bounded batches.
  - Runs once at process start and then on a fixed interval while the process is running. An interval of one hour or less is suggested; the owner records the actual value.
  - Is idempotent and safe if two instances run it at once.
- **After downtime:** there is no grace period. The startup run deletes everything that expired while the process was down, and the read rule hides it until then.
- **Clearing history:** a learner can clear their own conversation history at any time. It is deleted immediately, not on the next purge. They cannot clear another learner's, and the server enforces this. Provisionally, clearing also deletes the copies of that content in the learner's own help requests (see question 3).
- **Caches and logs:**
  - Private content is never placed in offline caches; only public approved FAQs are cached.
  - Routine logs never contain content, contact details, tokens or audio, so there is nothing to expire there.

## What local deletion does not reach

- **Backups.** None are configured in this repository. If an operator adds them, copies persist until that backup's rotation. The operator must record the rotation period. A restore must not serve data that has already expired; the read rule handles this, and the purge should run immediately after a restore.
- **External providers.** Text or audio sent to a hosted AI or speech provider is kept under that provider's terms, not this rule. The [AI feasibility notes](ai-feasibility.md) record that free-tier processing may be retained or used by the provider. Disclose this separately, and never claim that local deletion removes a provider's copy.

## Expected clock-based outcomes for later tests

`T` is an item's creation time; `R` is 168 hours. The owning issues (T3-023-B/C/D and the data-owning features) turn these into controlled-clock tests at the lowest sufficient layer, without duplicating one another.

| # | Setup | At | Expected |
|---|---|---|---|
| 1 | Message created at `T` | `T + R − 1 s` | Returned to its owner |
| 2 | Same message | `T + R` | Not returned, even before any purge runs |
| 3 | Purge runs | `T + R` | Message deleted. A message created at `T + 1 h` remains until `T + R + 1 h` |
| 4 | New activity in the same conversation at `T + 100 h` | `T + R` | The first message still expires at `T + R`; activity does not extend it |
| 5 | Process down from `T + 100 h` to `T + 200 h` | Startup | Startup purge deletes the expired message, and reads exclude it before the purge finishes |
| 6 | Help request opened at `T + 1 h`, sharing the message created at `T` | `T + R` | The shared copy expires with its source, even though the request is still waiting. The request shows the content as expired |
| 7 | Support reply created at `T + 50 h` | `T + R + 50 h` | Reply expires on its own clock |
| 8 | Learner A clears history at `T + 10 h` | Immediately | A's conversation items are gone, and so are A's copies in A's help requests. Learner B's items are untouched |
| 9 | Learner A tries to clear learner B's history | — | Denied. Nothing is deleted |
| 10 | Delivery queued for a message that then expires or is cleared | Worker run | No send. The payload is scrubbed and nothing is re-created |
| 11 | Learner unsubscribes while a send is queued | Immediately | Contact deleted and queued send cancelled |
| 12 | Dedup key created at `T` | `T + 30 days` | Purged. It never contained content |
| 13 | Purge runs twice, or on two instances at once | — | Same result as running once, with no errors |
| 14 | Help request created at `T`, still open, content expired at `T + R` | `T + 30 days` | The contentless request row is purged |

## Open decisions: approval still needed

Ask the institution, through the team's authorised contact. Record each answer, its date and the person who confirmed it in #49 and update this file. Until then the provisional choice applies.

1. **Anchor.** Is seven days counted from each item's creation (provisional), from the conversation's last activity, or from help-request resolution?
2. **Open help requests.** Should help content expire at seven days even if the request is still waiting or assigned (provisional)? Or keep it until resolution, and then for how long?
3. **Clearing history versus shared help context.** Should clearing a conversation also delete the copies already shared with support (provisional)?
4. **Backups and providers.** Will the deployment keep backups, with what rotation? Is the selected AI/speech provider's retention acceptable for real learner data?
5. **Non-content records.** Is a 30-day bound acceptable for deduplication keys and for contentless help-request rows?
6. **Overrides.** Does any record type need a longer approved period?
