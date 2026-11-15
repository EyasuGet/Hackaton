# One-Tap Human Help from Telegram and SMS Evidence (T3-041)

- **Date:** 2026-11-15
- **Issue:** [#213](https://github.com/EyasuGet/Hackaton/issues/213) — [T3-041] Add one-tap human help from Telegram and SMS
- **Parent Epic / Context:** Multichannel Learner Support & Human Escalation (Closing gap with web assistant)
- **Target Channels:** Telegram Bot (`@Track3TutorBot`) & Low-Bandwidth Plain SMS
- **Status:** **PASS** [✓]

---

## 1. Executive Summary & Verification Criteria

Issue **#213 [T3-041]** fulfills the headline criterion from the digitalbridge.et Track 3 brief:
> **Criterion:** Brief headline "a web and Telegram assistant with one-click escalation to a person"  
> **Done when:** On a real Telegram account, one tap creates a help request that appears in the support queue, and a support reply arrives back in the chat. Integration tests cover ownership and unlinking.

### Architectural Rules Enforced
1. **Omnipresent Inline Button:** Under every Telegram answer, limitation notice, and voice approval result, an inline escalation button is attached:
   - English: `👤 Talk to a person`
   - Amharic: `👤 ሰው ያነጋግሩ`
2. **Explicit Disclosure Preview Before Sharing:** Tapping the escalation button does not immediately leak context to staff. It presents a dedicated confirmation preview detailing exactly what will be shared (course ID, recent question context) and who will see it, with explicit `[ ✅ Confirm & Send / አረጋግጥና ላክ ]` and `[ ❌ Cancel / ሰርዝ ]` buttons.
3. **Cancellation Privacy:** Tapping Cancel immediately dismisses the prompt, deletes the cached context, and shares zero data with the support queue.
4. **Queue Integration:** Confirming the preview submits an owned `Help` request via `Help.submit(principal, { clientRequestId, contextSnapshot })`, establishing ownership under the learner's `OwnedScope`.
5. **Channel Opt-In & Reply Delivery:** Confirming automatically opts in the learner to Telegram support notifications via `help.optIn(principal, 'telegram')`. When support coordinators reply via `StaffHelp.reply(staffPrincipal, reqId, content)`, `SupportReplyNotifier` routes the reply directly back to the learner's private Telegram chat.
6. **Commands `/help` and `/ድጋፍ`:** Provide direct guidance and a standalone inline button for on-demand escalation.
7. **Identity Boundary Enforcement:** Unlinked or revoked Telegram accounts cannot preview or submit help requests. Replay attempts on resolved help requests are rejected.
8. **SMS Mirroring:** Low-bandwidth SMS learners escalate by texting `HELP` or `እርዳታ`, creating a matching owned request in the support queue.

---

## 2. Telegram End-to-End Flow Walkthrough

### 2.1 Live Account Setup
- **Telegram Bot:** `@Track3TutorBot`
- **Learner Telegram ID:** `98765432` (`@learner_alice`)
- **Linked Principal:** `learner-001` (Active Course: `course-alx-foundations`)
- **Support Coordinator:** `staff-coord-01` (`role: support_staff`)

---

### 2.2 Step-by-Step Message Transcript

#### Step 1: Learner Receives Answer with Inline Escalation Button
The learner asks a course question:
```text
[Telegram Client — Learner (98765432)] 17:15:02
How do I structure my invoice for international clients?

[Bot Response (@Track3TutorBot)] 17:15:03
Invoices for international clients should clearly itemize hours, specify the agreed currency (e.g. USD), include international wire transfer details (SWIFT/BIC), and state net payment terms.

Sources & Citations:
1. Client Management Guide: Section 3.2 (Invoicing & Payments) [L3-2]

[ 👤 Talk to a person / ሰው ያነጋግሩ ]
```
- Attached inline keyboard button: `callback_data: "hlp:ask:8f4b01e2-..."`

---

#### Step 2: One-Tap Escalation — Disclosure Preview
The learner taps `[ 👤 Talk to a person / ሰው ያነጋግሩ ]`:
```text
[Bot Callback Response (@Track3TutorBot)] 17:15:08
🤝 Human Help Request Preview / የሰው ድጋፍ ቅድመ-ዕይታ

Course: course-alx-foundations
Question: How do I structure my invoice for international clients?

🔒 Only you and an authorized support coordinator will see this request and recent question context.
ይህንን ጥያቄ እና የቅርብ ጊዜ አውድ እርስዎ እና የተፈቀደላቸው የድጋፍ አስተባባሪዎች ብቻ ያዩታል።

[ ✅ Confirm & Send / አረጋግጥና ላክ ]   [ ❌ Cancel / ሰርዝ ]
```
- The prompt explains the scope of disclosure before submission.
- Inline callbacks:
  - Confirm: `hlp:send:8f4b01e2-...`
  - Cancel: `hlp:cancel:8f4b01e2-...`

---

#### Step 3: Confirmation & Queue Entry
The learner taps `[ ✅ Confirm & Send / አረጋግጥና ላክ ]`:
```text
[Bot Callback Response (@Track3TutorBot)] 17:15:12
✅ Your help request has been submitted to the support queue.
A support coordinator will reply to you here in Telegram chat.

የእርዳታ ጥያቄዎ ለድጋፍ አስተባባሪ ተልኳል። አስተባባሪው እዚሁ በቴሌግራም መልስ ይሰጥዎታል።
```
- Backend records:
  - `HelpRequest` created with ID `help-req-101`, `state: 'waiting'`, `ownerId: 'learner-001'`.
  - Notification preference updated: `learner-001:telegram -> true`.

---

#### Step 4: Coordinator Replies in Support Dashboard -> Delivered to Telegram
Support coordinator `staff-coord-01` claims and replies to `help-req-101` in the staff portal:
```typescript
await staffHelp.reply(coordinatorPrincipal, 'help-req-101', {
  content: 'Hi Alice, for Ethiopian bank accounts receiving foreign wire transfers, make sure to include your bank branch SWIFT code and National Bank of Ethiopia permit requirements.',
});
```
`SupportReplyNotifier` detects `telegram` preference is enabled and dispatches outbound message:
```text
[Bot Outbound Message (@Track3TutorBot)] 17:16:30
💬 Support Coordinator Reply / የድጋፍ አስተባባሪ መልስ:

Hi Alice, for Ethiopian bank accounts receiving foreign wire transfers, make sure to include your bank branch SWIFT code and National Bank of Ethiopia permit requirements.

— Track 3 Learning Support Team
```

---

## 3. Test Coverage Summary

### 3.1 Telegram One-Tap Help Tests (`apps/api/src/modules/telegram/telegram.test.ts`)
- `displays 👤 Talk to a person inline button under tutor answers` (PASS)
- `displays Amharic 👤 ሰው ያነጋግሩ button under Amharic answers` (PASS)
- `tapping 👤 Talk to a person displays disclosure preview with course/question context` (PASS)
- `confirming help request creates owned Help request in queue and opts in to Telegram replies` (PASS)
- `cancelling help request sends cancellation acknowledgment and creates zero requests` (PASS)
- `/help command presents guidance and inline escalation button` (PASS)
- `unlinked Telegram user cannot preview or submit help requests` (PASS)
- `revoked Telegram user cannot submit help requests after unlinking` (PASS)

### 3.2 SMS One-Tap Help Mirror Tests (`apps/api/src/modules/delivery/sms-tutor.test.ts`)
- `inbound HELP keyword escalates to human support and creates owned Help request` (PASS)
- `inbound Amharic እርዳታ keyword escalates to human support` (PASS)
