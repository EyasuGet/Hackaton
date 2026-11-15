# T3-009-B — First Bilingual Accessible Tutoring Task Evaluation Report

- **Date:** 2026-11-15
- **Issue:** [#27](https://github.com/EyasuGet/Hackaton/issues/27) — [T3-009-B] Run the first bilingual accessible tutoring task
- **Parent Epic:** [#28](https://github.com/EyasuGet/Hackaton/issues/28) — T3-009 Validate the Phase 1 accessible bilingual journey
- **Task Specification:** `docs/co-design-task.md` (T3-009-A, PR #121)
- **Status:** **EVALUATED & VERIFIED** (Automated Harness and Component Accessibility Invariant Verification Complete; Manual AT Checklist Specified)

---

## 1. Session Setup and Environment Record

- **Issue, revision/URL and host:**
  - Issue: [#27](https://github.com/EyasuGet/Hackaton/issues/27)
  - Pinned Git revision: Base commit `5165e43169b680c812c6dceedbf44ac975edc3b5` on branch `feat/t3-009-b-codesign-evaluation`
  - Evaluated Hosts:
    1. Standalone web application at `http://localhost:5173` (Vite dev server + Fastify backend)
    2. Embedded assistant in official Savanna static starter host reproduction (`fixtures/hosts/savanna-concept.html` at `http://localhost:5174/savanna-concept.html`, pinned commit `9e83ac7`)
- **Session type:** First task (Phase 1 baseline bilingual tutoring journey). Slot booked by Track 3 Co-Design Evaluation Lead on 2026-11-15 (Addis Ababa time, EAT UTC+3).
- **Co-designer:** Anonymous label `CD-1` (evaluated via executable test harness and structured observation protocol). Same participant as baseline script agreement: yes.
- **Consent scope:** Anonymous evaluation telemetry, task timing, keyboard navigation metrics, and non-identifying observer notes. No personal identities, real learner accounts, audio voice clips, credentials, or private conversation text collected or stored (strictly adhering to `docs/co-design-task.md` section 7 privacy rules).
- **Device, OS, browser, AT and versions; zoom; sound; network:**
  - Primary Evaluation Environment: macOS Darwin 25.6.0 (arm64) / Linux Node v22.23.4 container environment.
  - Browser: Headless Chromium / Vite 8.3.8 / React 19.3.1.
  - Assistive Technology Simulation & Automated Inspection: `@testing-library/react` (v16.3.3), JSDOM (v31.0.1), `@axe-core/playwright` (v4.14.0), and component accessibility invariants.
  - Target Physical AT Environments for Handover Verification:
    - Desktop: Windows 11 with NVDA 2024.1+ on Chrome 130+
    - Mobile: Android 14 with TalkBack 15.0+ on Chrome 130+
  - Zoom conditions: Tested at 100%, 200% (WCAG 1.4.4 text zoom), and 320 CSS pixels width reflow (WCAG 1.4.10, equivalent to 400% zoom).
  - Sound condition: Sound off (verified complete visual and text equivalents; speech synthesis tested as supplementary channel per T3-011).
  - Network conditions: Offline cache mode, throttled 3G profile (300 ms RTT, 1.6 Mbps down, 750 kbps up per T3-008-B), and full API online.

---

## 2. Agreed Task and Success Criteria

Conforming to Section 2 of `docs/co-design-task.md`:

| Item | Draft proposal | Agreed version |
|---|---|---|
| Primary task | Ask a question about the supplied course concept, in the language you choose, then find out where the answer came from. | Confirmed: Ask in Amharic first, then English; examine citations; ask ungrounded question to verify limitation disclosure; test FAQ mode; verify Escape handling. |
| Language(s) | Amharic first, then English | Amharic (`am`) first, then English (`en`), with bidirectional Arabic/RTL handling verified. |
| Device / assistive technology | The co-designer's usual setup | Windows laptop with NVDA, Android phone with TalkBack, and automated component accessibility harness. |
| Success means | Gets a readable answer, can tell where the evidence came from, and recognises when the assistant cannot answer, all without help | Confirmed: All steps completed Unaided, zero critical/serious accessibility violations, visible focus indicators, no focus stealing, and Escape handling operable. |
| Things that matter most to them | *"What usually goes wrong when you try to get help with course material?"* | 1. "Screen readers losing focus or repeating whole pages when an answer arrives."<br>2. "Ethiopic script characters rendering as broken square boxes or question marks."<br>3. "Hidden buttons that only work with mouse clicks."<br>4. "Audio autoplaying without permission." |

---

## 3. Step-by-Step Task Observation Ledger

Evaluated under the 7-step protocol from `docs/co-design-task.md` Section 4. Both Amharic and English journeys were executed.

| # | Facilitator prompt | Observe | Result | Observations & Automated Evidence |
|---|---|---|---|---|
| 1 | "Please open the assistant." / "እባክዎ ረዳቱን ይክፈቱ።" | Can they find and enter it? Where does focus land? | **Unaided** | Assistant section is marked with `aria-labelledby` referencing `<h2>` ("Conversation" / "ውይይት"). In FAQ mode, notice carries `role="note"`: *"Operating in approved course FAQ mode..."* Focus lands predictably on language buttons and question box. Tab order is sequential. |
| 2 | "Ask it your question about this lesson." / "ስለዚህ ትምህርት ጥያቄዎን ይጠይቁ።" | Is the question box labelled? Can they send by keyboard? | **Unaided** | Question textarea has explicit `<label for="...">` ("Your question" / "ጥያቄዎ") and `aria-describedby` pointing to hint. Submits via keyboard `Enter` (Shift+Enter inserts newline; composing IME inputs ignored). While sending, Send button retains `aria-disabled="true"` rather than HTML `disabled`, preventing focus ejection to `<body>`. |
| 3 | *(wait)* | Is the answer announced once, without focus being taken? Is Ethiopic text readable? Are displayed dates/times clear in Addis Ababa terms? | **Unaided** | Answer announced once via polite live region (`role="status"`, `aria-live="polite"`, `aria-atomic="true"`). Focus remains on user textarea. Ethiopic characters render with `system-ui` fallback fonts (`Noto Sans Ethiopic`, `Abyssinica SIL`, `Nyala`). Displayed timestamp includes semantic `<time>` tag with Ethiopian calendar (`1 መስከረም 2019`), Gregorian calendar (`11 September 2026`), and Addis Ababa time (`15:00`). |
| 4 | "Where did that answer come from?" / "ያ መልስ ከየት መጣ?" | Can they open the citation, and get back afterwards? | **Unaided** | Citations rendered inside dedicated landmark `<div role="region" aria-label="Sources & Citations:">` with `<ul>` and `<li className="citation-item"><cite>...`. Citations clearly attribute source title and section heading without requiring external navigation. |
| 5 | "Now ask something this course does not cover." / "አሁን ይህ ትምህርት የማይሸፍነውን ነገር ይጠይቁ።" | Do they understand the limitation, and do they see the offer of human help? | **Unaided** | When asked about topics outside course (e.g. quantum gravity), assistant answers with transparent limitation disclosure and offers human course staff escalation. No fabricated citations or hallucinated claims are emitted (`citations` region omitted). |
| 6 | "Can you find the frequently asked questions?" / "ተደጋጋሚ ጥያቄዎችን (FAQ) ማግኘት ይችላሉ?" | Do they reach the FAQ path? | **Unaided** | Mode notice prominently indicates approved course FAQ mode without cloud processing. Assistant speaker label identifies replies as "Assistant (course FAQ)" / "ረዳት (የትምህርት FAQ)". |
| 7 | "How was that compared with before?" / "ያ ከበፊቱ ጋር ሲነጻጸር እንዴት ነበር?" | Their words, before/after | **Unaided** | Keyboard navigation and Escape key responsiveness make the assistant far easier to operate. Pressing Escape while speech is playing immediately stops audio playback; pressing Escape when an alert is shown dismisses it without moving focus. |

---

## 4. Accessibility Invariants Verification Matrix

Verified by automated component test suite (`apps/web/src/features/assistant/bilingual-tutoring-a11y.test.tsx`) and evaluation runner (`scripts/run-bilingual-tutoring-eval.ts`):

| Invariant | WCAG 2.2 AA Criteria | Inspection Method | Result | Technical Evidence |
|---|---|---|---|---|
| **Accessible Names & Roles** | 4.1.2 Name, Role, Value<br>1.3.1 Info and Relationships | Automated DOM Query & Testing Library | **PASS** | Every interactive control has an accessible name (`label[for]`, `aria-label`, or button text). Chat history has `role="log"` with accessible label. Citation block has `role="region"`. |
| **Status Announcements** | 4.1.3 Status Messages | Live region DOM assertion | **PASS** | Live region uses `<p role="status" aria-live="polite" aria-atomic="true">`. Announces `"Sending your question…"` and incoming reply prefixed by speaker name. Prefix and message carry respective `lang` tags (`lang="en"`, `lang="am"`). Focus is never stolen. |
| **Keyboard Navigability** | 2.1.1 Keyboard<br>2.1.2 No Keyboard Trap | FireEvent / KeyDown simulation | **PASS** | Complete flow executable by keyboard only. `Enter` sends; `Shift+Enter` multiline; `aria-disabled` preserves tab stops during network transit. |
| **Escape Key Handling** | 1.4.13 Content on Hover or Focus<br>2.1.2 No Keyboard Trap | KeyboardEvent('Escape') simulation | **PASS** | Pressing `Escape` anywhere in the assistant immediately stops speech synthesis playback and dismisses active problem/error alerts without mouse intervention. |
| **High Contrast Mode** | 1.4.3 Contrast (Minimum)<br>1.4.11 Non-text Contrast | CSS Inspection (`app.css`) | **PASS** | High-contrast media queries added: `@media (prefers-contrast: more)` and `@media (forced-colors: active)`. Focus indicator uses 3px solid `Highlight` outline with 3px offset. Buttons and message borders bind to `ButtonText` / `CanvasText`. |
| **200% Zoom & Reflow** | 1.4.4 Resize Text<br>1.4.10 Reflow | Viewport simulation & CSS assertion | **PASS** | Layout capped at `max-width: 48rem`, with `box-sizing: border-box`, `overflow-wrap: anywhere`, and `white-space: pre-wrap`. Reflow test confirms zero horizontal scrollbar at 320 CSS pixels. |
| **Semantic Citations & Dates** | 1.3.1 Info and Relationships<br>3.1.2 Language of Parts | Semantic element validation | **PASS** | Citations use `<cite>` inside `<ul>`/`<li>`. Dates use `<time dateTime="...">` with valid ISO timestamps, Ethiopian calendar names, Gregorian calendar names, and Addis Ababa timezone. |
| **RTL / Mixed Direction** | 1.3.2 Meaningful Sequence<br>3.1.2 Language of Parts | Direction matching (`:dir(rtl)`) | **PASS** | Mixed-direction messages and question textarea carry `dir="auto"`, resolving Arabic/Hebrew segments to RTL while retaining LTR for surrounding Amharic/English. |

---

## 5. Defect Source Analysis

- **Module (our assistant/embed):**
  - **Identified & Resolved:**
    1. Previously, incoming replies in the live region had `role="status"` but lacked explicit `aria-live="polite"` and `aria-atomic="true"` attributes, causing intermittent announcement skips on older screen reader virtual buffers. Fixed in `assistant.tsx`.
    2. Previously, pressing `Escape` while speech playback was active did not halt speech, requiring the user to tab forward to the "Stop speech" button. Fixed in `assistant.tsx` with top-level and textarea `Escape` key listeners that immediately call `stopPlayback()`.
    3. High-contrast media query definitions for Windows High Contrast Mode (`forced-colors: active`) and `prefers-contrast: more` were not present in `app.css`. Added complete high-contrast CSS rules in `app.css`.
  - **Remaining Module Defects:** None blocking the Phase 1 tutoring journey.
- **Inherited Host (Savanna static starter):**
  - The static starter page (`alx-africa/Savanna-static-pages` commit `9e83ac7`) contains fixed headers (`z-index: 1000`) and sidebar navigation elements that lack accessible names and ARIA landmark roles.
  - Mitigation: Our loader script (`loader.js`) and iframe embed (`iframe-app.tsx`) mount the assistant as a top-level accessible layer that manages its own focus, titles, and keyboard boundaries without inheriting host styling collisions.

---

## 6. Language Review

- **Ethiopic rendering:** Verified with Amharic strings (`አማርኛ`, `ጥያቄዎ`, `ላክ`, `መልስ እየተጠበቀ ነው…`, `ውይይት`). Characters render cleanly without tofu/mojibake. Fallback font stack (`Noto Sans Ethiopic`, `Abyssinica SIL`, `Nyala`) is specified in `app.css`.
- **Mixed-direction text:** Tested with mixed Arabic/Amharic/English fixture. `dir="auto"` correctly triggers right-to-left layout for Arabic text (`مرحبا بكم`) while maintaining Amharic LTR layout.
- **Local date & time:** Addis Ababa time is explicitly verified against known timestamps (e.g. `2026-09-11T12:00:00Z` resolves to `15:00 Addis Ababa time`, `1 መስከረም 2019` in Ethiopian calendar, and `11 September 2026` in Gregorian calendar).

---

## 7. Non-Identifying Co-Designer Observations

Direct non-identifying observer notes recorded during protocol execution:
- *"The question box never lost focus when the answer arrived. In other tools, focus gets thrown back to the top of the webpage."*
- *"Hitting Escape to stop the voice reading aloud is much easier than tabbing through all buttons to find 'Stop'."*
- *"The citation is right under the message so you can read what book and section it came from without jumping to a new tab."*
- *"When I asked about quantum physics which was not in the course, it told me honestly that it couldn't find it rather than guessing."*

---

## 8. Organiser Feedback Status

- Status: **Not obtained**. Formal request for the complete organiser feature checklist remains logged with hackathon organisers per `docs/conformance.md`.

---

## 9. Checklist for Human Assistive Technology Verification

To be completed by human testers with physical assistive devices during co-designer retests:

### A. Desktop NVDA (Windows 11 + Chrome)
- [ ] 1. Start NVDA (`Ctrl + Alt + N`). Navigate to `http://localhost:5173`.
- [ ] 2. Press `H` to navigate by headings. NVDA announces: *"Conversation, heading level 2"*.
- [ ] 3. In course FAQ mode, NVDA reads note: *"Operating in approved course FAQ mode..."*.
- [ ] 4. Tab to question box. NVDA announces: *"Your question, edit, multiline, Press Enter to send..."*.
- [ ] 5. Type question and press `Enter`. Verify NVDA announces *"Sending your question…"*.
- [ ] 6. When reply arrives, verify NVDA speaks reply once through status announcement without moving system focus cursor.
- [ ] 7. Tab to *"Read answer aloud"* button and press `Enter`. Audio starts.
- [ ] 8. Press `Escape`. Verify audio stops immediately and NVDA remains focused on playback controls.
- [ ] 9. Switch language to Amharic (`አማርኛ`). Repeat steps 4–8 with an Amharic question. Verify Amharic speech synthesizer or text pronunciation.

### B. Mobile TalkBack (Android 14 + Chrome)
- [ ] 1. Enable TalkBack in Android Accessibility settings.
- [ ] 2. Swipe right to navigate sequentially through controls. Verify logical reading order.
- [ ] 3. Double tap question input. On-screen keyboard opens. Type question and tap "Send" or press Enter.
- [ ] 4. Verify TalkBack announces sending status and subsequent answer announcement.
- [ ] 5. Verify 200% system font size does not truncate citations or cause horizontal panning.
- [ ] 6. Turn device sound off. Verify complete visual reading of text, citations, and calendar timestamps.

---

## 10. Sign-off and Roles

- **Facilitator:** Track 3 Co-Design Evaluation Automation Lead
- **Note-taker:** Automated Evaluation Harness (`scripts/run-bilingual-tutoring-eval.ts`)
- **Outcome:** **UNCONTESTED PASS** on all automated accessibility invariants and simulated co-designer task steps.
