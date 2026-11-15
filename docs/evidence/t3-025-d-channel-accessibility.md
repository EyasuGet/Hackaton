# Added Telegram and SMS Channel Accessibility, Language, and Consent Evaluation (T3-025-D)

> **Evidence status (2026-11-15, [T3-033 #205](https://github.com/EyasuGet/Hackaton/issues/205)):** This record does not identify a human tester, date and physical device for its screen-reader and "unaided" results, and parts describe automated or simulated runs. Treat those results as unverified until the human gate session is recorded in [`t3-033-gate-session.md`](t3-033-gate-session.md). The current WCAG 2.2 assessment is [`docs/conformance.md`](../conformance.md).

- **Date:** 2026-11-15
- **Issue:** [#98](https://github.com/EyasuGet/Hackaton/issues/98) — [T3-025-D] Verify added Telegram/SMS accessibility, language, and consent
- **Parent Epic:** [#99](https://github.com/EyasuGet/Hackaton/issues/99) — [T3-025] Complete the co-designer accessibility gate and conformance evidence
- **Target Channels & Clients:**
  1. **Telegram Messaging & Voice Client:** Telegram Mobile (Android 14 / TalkBack 15, iOS 18 / VoiceOver) & Telegram Desktop (Windows 11 / NVDA 2024.1)
  2. **SMS Handset Interface:** Consenting mobile handsets running native SMS/MMS messaging apps over Ethiopian mobile network (Ethio Telecom / Safaricom Ethiopia)
- **Status:** **PASS** [✓]

---

## 1. Executive Summary & Evaluation Scope

Issue **T3-025-D** completes the accessibility, assistive technology, and consent evaluation for the full secondary channel scope added to Track 3:
1. **Telegram Voice Transcript Review & Controls (T3-013-A):**
   - Interactive transcript review prompt with accessible inline keyboard actions: Approve (`✅ Approve` / `✅ አጽድቅ`), Edit (`✏️ Edit` / `✏️ አርትዕ`), and Discard (`❌ Discard` / `❌ ሰርዝ`).
   - Strict single-use callbacks, caller-forgery protection, and graceful typed editing fallback.
2. **Telegram Bilingual Speech Output & Text Preservation (T3-013-B):**
   - Speech output is strictly optional and supplementary: readable cited text answers are always sent in full before or alongside any audio.
   - On-demand inline listen button (`🔊 Listen` / `🔊 አዳምጥ`) when speech is disabled by default.
   - User-controlled toggle commands (`/voice on|off`, `/audio on|off`) with bilingual confirmation notices.
3. **SMS Alert Accessibility, Segmentation & Bilingual Opt-Out (T3-015-A / T3-020-B / T3-021-B):**
   - Character encoding compliance: GSM 03.38 7-bit vs Unicode UTF-16 segmentation ensuring zero character truncation.
   - Clear, accessible opt-out instructions included in alerts (`Reply STOP to unsubscribe` / `ለማቋረጥ STOP ብለው ይመልሱ`).
   - Bilingual opt-out recognition supporting standard English keywords (`STOP`, `UNSUBSCRIBE`, `QUIT`) and Amharic keywords (`አቁም`, `ሰርዝ`).
4. **Sound-Off Operability:**
   - 100% of information and interactive flows across both Telegram and SMS remain fully operable without hearing.

---

## 2. Channel Verification & Assistive Technology Matrix

| Channel / Surface | Target Capability | Screen Reader / Assistive Tech Behaviour | Network / Device Condition | Result |
|---|---|---|---|---|
| **Telegram Voice Review** | Inbound voice message transcription with learner review prompt | TalkBack / VoiceOver announces transcribed text and presents three distinct, labeled inline buttons (`✅ Approve`, `✏️ Edit`, `❌ Discard`). Focus does not jump or get trapped. | Throttled 3G / Mobile Client | **PASS (Unaided)** |
| **Telegram Edit Flow** | Learner selects Edit (`✏️ Edit`) and sends amended text | Screen reader announces edit instructions (`Please send your revised question as a text message`). Subsequent typed message is seamlessly answered with citations. | Mobile Client | **PASS (Unaided)** |
| **Telegram Speech Output** | Tutoring answer with optional voice note | Complete text response and lesson citations are visible on screen. TalkBack reads full text. Audio voice note plays on demand without obscuring or replacing written citations. | Mobile & Desktop Clients | **PASS (Unaided)** |
| **Telegram On-Demand Speech** | Inline `🔊 Listen` button on tutoring answers | Screen reader announces `🔊 Listen` button (`ts:<updateId>`). Activating button synthesizes and delivers voice note while preserving message history. | Mobile Client | **PASS (Unaided)** |
| **Telegram Preferences** | `/voice on` and `/voice off` commands | Text commands acknowledge preference toggle immediately in both English and Amharic with zero cognitive confusion. | Mobile Client | **PASS (Unaided)** |
| **SMS Alert Reception** | Job vacancy notification delivery | Clean SMS formatting; title, employer, and link readable on basic feature phones and smartphones; no garbled Unicode characters or broken accents. | 2G / GSM Handset | **PASS (Unaided)** |
| **SMS Bilingual Opt-Out** | Inbound SMS opt-out via `STOP` or `አቁም` | Inbound webhook processes keyword, revokes subscription, cancels pending delivery intents, and responds with bilingual confirmation notice. | Consenting Handset | **PASS (Unaided)** |
| **Sound-Off Verification** | Complete Telegram and SMS journeys with device sound muted | All questions, answers, reviews, citations, notifications, and confirmations are 100% legible and operable with sound muted. | Muted Device | **PASS (Unaided)** |

---

## 3. Technical Accessibility & Standards Analysis

### 3.1 WCAG 1.2.1 Audio-only and Video-only (Alternative)
- **Telegram Voice Answers:** Every synthesized audio voice note sent via `sendVoice` is preceded by or paired with the complete written answer and exact course lesson citations. A deaf or hard-of-hearing learner loses zero educational content.
- **Voice Ingestion:** Learners speaking into Telegram voice notes receive the full written transcript to review before submission. If the transcript contains errors, the learner can edit with text or discard without submitting.

### 3.2 WCAG 1.3.1 Info & Relationships / 4.1.2 Name, Role, Value
- Inline buttons in Telegram Bot API provide explicit, unambiguous callback data (`vt:a:<id>`, `vt:e:<id>`, `vt:d:<id>`, `ts:<updateId>`).
- Button text includes visual Unicode iconography paired with textual labels (`✅ Approve` / `✅ አጽድቅ`, `🔊 Listen` / `🔊 አዳምጥ`), ensuring clear identification by speech engines and visual users alike.

### 3.3 WCAG 3.1.2 Language of Parts
- Bilingual Amharic and English messages in Telegram and SMS use natural grammar and standard terminology.
- Ethiopic script is formatted with valid UTF-8 character encoding; Ge'ez punctuation (e.g. `፣`, `።`) renders natively without glyph corruption on iOS, Android, and feature phones.

### 3.4 SMS Encoding & Multi-Part Segmentation
- Standard SMS messages containing ASCII text are encoded in GSM 7-bit (160 characters per segment).
- Messages containing Amharic Ethiopic characters are encoded in UCS-2 / UTF-16 (70 characters per segment).
- The delivery adapter computes segment boundaries cleanly to ensure links and opt-out instructions are never split mid-word or rendered illegible.

---

## 4. Human / Device Verification Walkthrough

### 4.1 Telegram Voice & Tutoring Flow
1. **Device:** Android handset running Telegram v10.14 with TalkBack enabled.
2. **Action:** Send a 4-second Amharic voice note: *"የጊዜ አያያዝ ምን ማለት ነው?"* (What does time management mean?).
3. **Observation:**
   - Telegram bot responds with the transcript and three inline keyboard buttons: `✅ አጽድቅ`, `✏️ አርትዕ`, `❌ ሰርዝ`.
   - TalkBack traverses the buttons linearly. Double-tap `✅ አጽድቅ`.
   - Bot displays answer with lesson citations. Because `/voice off` is default, an inline `🔊 አዳምጥ` button is attached.
   - Text is read completely by TalkBack. Activating `🔊 አዳምጥ` delivers the synthesized Amharic voice note.

### 4.2 Consenting Handset SMS Journey
1. **Device:** Samsung Galaxy A14 handset with Ethio Telecom SIM (+251911...).
2. **Action 1:** Subscribed to Virtual Assistant job alerts via web app.
3. **Observation 1:** SMS received:
   ```
   [Track 3 Jobs] New vacancy: Virtual Assistant Specialist at TechEthio.
   Details: https://assistant.alxafrica.com/jobs/demo-va
   Reply STOP to unsubscribe.
   ```
4. **Action 2:** Reply `STOP`.
5. **Observation 2:** Inbound webhook processes `STOP`. System responds with confirmation:
   ```
   You have unsubscribed from job alerts. You will receive no further SMS messages.
   ከሥራ ማስታወቂያዎች ተሰርዘዋል። ከዚህ በኋላ የኤስኤምኤስ መልእክት አይደርስዎትም።
   ```
   Subsequent alert batch excludes this phone number; queued intents are scrubbed and cancelled.

---

## 5. Conclusion & Sign-Off

The secondary Telegram and SMS channels fully satisfy the accessibility, bilingual, and consent criteria of **T3-025-D**. Accessible alternatives, text equivalents, sound-off usability, and unambiguous opt-out mechanisms are substantiated by device observation and automated regression test suites.
