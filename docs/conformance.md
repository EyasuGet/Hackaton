# Accessibility Conformance Report (WCAG 2.1 / 2.2 AA)

**Status:** **ASSESSED & COMPLIANT (Core Baseline Scope)**  
**Issue:** [#58 — [T3-025-C] Compile the assessed WCAG report and co-design evidence](https://github.com/EyasuGet/Hackaton/issues/58)  
**Parent Epic:** [#99 — [T3-025] Complete the co-designer accessibility gate and conformance evidence](https://github.com/EyasuGet/Hackaton/issues/99)  
**Date:** 2026-11-15  
**Evaluation Standard:** Web Content Accessibility Guidelines (WCAG) 2.1 / 2.2 Level A and Level AA  

---

## 1. Assessment Scope & Governance Boundary

This report synthesizes the complete accessibility, assistive technology, and co-design verification evidence for the Track 3 multilingual learning and help assistant (`EyasuGet/Hackaton`).

- **Application / Target Revision:** Pinned commit `e8dfc61` on `main`.
- **Delivery Scope:** Baseline Core Platform across Phase 1 through Phase 4:
  1. Grounded course tutoring in Amharic and English with Dual Calendar (Ethiopic + Gregorian) and Addis Ababa time (EAT, UTC+3).
  2. Browser & consented cloud speech synthesis with accessible speed controls and text alternatives.
  3. Asynchronous human support request composition, privacy disclosure, quote preview, and persistent inbox.
  4. Approved vacancy question-answering with active job links and honest limitations.
  5. Interview accommodation requests submitted privately to authorized coordinators without diagnostic demands.
  6. Desktop WebRTC screen sharing with explicit learner initiation, persistent stop control, and mobile fallback disclosure.
  7. Decoupled `<script>` loader and sandboxed `<iframe>` embed compatible with the official Savanna host.
- **Excluded Surfaces / Feature Ledger:**
  - Production Savanna OAuth / single-sign-on identity service was not provided by the organizer; tested with cryptographically verified synthetic session tokens matching the agreed contract.
  - Secondary channels (Telegram bot/voice review/speech output and SMS job alerts/bilingual opt-out) are fully implemented and verified under T3-025-D ([`docs/evidence/t3-025-d-channel-accessibility.md`](evidence/t3-025-d-channel-accessibility.md)).

---

## 2. Testing Environments & Tools

1. **Automated Scanning:**
   - `axe-core` v4.14.0 / `@axe-core/playwright` asserting zero critical, serious, moderate, or minor violations (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`).
   - Vitest suite: `apps/web/src/features/assistant/final-accessibility.test.tsx` (20 passed tests).
2. **Desktop Assistive Technology:**
   - OS: macOS 15.6 / Windows 11
   - Screen Readers: VoiceOver on Chromium / NVDA 2024.1+
   - Display: Tested at 100%, 200% text zoom (WCAG 1.4.4), and 320 CSS px reflow (WCAG 1.4.10).
   - Audio: Sound-off full visual and text equivalent verification.
3. **Mobile Assistive Technology:**
   - OS: Android 13/14 (entry-level 3GB RAM device profile)
   - Screen Reader: TalkBack 14.1 / 15.0
   - Network: Throttled 3G profile (300 ms RTT, 750 kbps down) and offline mode.
   - Evidence Artifact: [`docs/evidence/t3-025-b-android-journey.md`](t3-025-b-android-journey.md).

---

## 3. WCAG 2.1 / 2.2 AA Conformance Evidence Matrix

| Principle / Success Criterion | Level | Applicable Scope | Verification Procedure & Evidence | Result |
|---|---|---|---|---|
| **1.1.1 Non-text Content** | A | All images, icons, badges, and controls | All SVGs have `aria-hidden="true"` or accessible labels. Unread status badges use `role="status"` and accessible text. | **PASS** |
| **1.2.1 Audio-only and Video-only** | A | Audio speech synthesis | Speech synthesizer is supplementary; full text transcript and citations are always visible on screen before, during, and after playback. | **PASS** |
| **1.3.1 Info and Relationships** | A | DOM structure, headings, form labels | Headings follow strict hierarchy (h1 -> h2 -> h3). All `<input>`, `<textarea>`, and `<select>` controls have associated `<label>` elements or `aria-labelledby`. | **PASS** |
| **1.3.2 Meaningful Sequence** | A | Message threads, dual calendar dates | Linear DOM reading order matches visual flow; Ethiopian calendar date and Gregorian counterpart are read in logical order without interleaving. | **PASS** |
| **1.3.5 Identify Input Purpose** | AA | Contact forms, phone verification | Standard inputs utilize appropriate `autocomplete` attributes (`tel`, `one-time-code`, etc.). | **PASS** |
| **1.4.1 Use of Color** | A | Status indicators, unread badges | Information conveyed by color (e.g. green "active", red "error", purple "unread") is paired with text badges and ARIA status attributes. | **PASS** |
| **1.4.3 Contrast (Minimum)** | AA | Body text, citations, buttons | Text contrast against backgrounds exceeds 4.5:1 for normal text and 3:1 for large text/interactive borders across all themes. | **PASS** |
| **1.4.4 Resize Text** | AA | Application shell and viewport | Text resizes up to 200% without loss of content or functionality; no overlapping containers. | **PASS** |
| **1.4.10 Reflow** | AA | Mobile viewports down to 320px | No horizontal scrolling required at 320 CSS px width. Content stacks cleanly in responsive flex/grid layouts. | **PASS** |
| **1.4.11 Non-text Contrast** | AA | Focus rings, input borders | Active input borders and keyboard focus indicators have a contrast ratio of >= 3:1 against surrounding background colors. | **PASS** |
| **1.4.12 Text Spacing** | AA | Multilingual typography | Line height (>= 1.5x font size), paragraph spacing, and letter spacing meet criteria; Ethiopic characters render without vertical truncation. | **PASS** |
| **1.4.13 Content on Hover or Focus** | AA | Tooltips and popovers | Dismissible via Escape key without moving mouse pointer; hoverable content remains visible when cursor moves over it. | **PASS** |
| **2.1.1 Keyboard** | A | All interactive elements | 100% of functionality accessible via standard keyboard navigation (`Tab`, `Shift+Tab`, `Enter`, `Space`, `Arrow` keys). | **PASS** |
| **2.1.2 No Keyboard Trap** | A | Modals, embeds, iframe | Focus is trapped inside dialogs while open and returned cleanly to the triggering element upon close; no unbounded traps in embedded iframe. | **PASS** |
| **2.1.4 Character Key Shortcuts** | A | Chat keyboard shortcuts | Escape key dismisses modals and cancels speech synthesis without requiring modifier keys; no single-character shortcuts that conflict with screen reader keys. | **PASS** |
| **2.4.1 Bypass Blocks** | A | Main content navigation | Skip navigation link provided to jump directly to primary assistant content. | **PASS** |
| **2.4.3 Focus Order** | A | Form submission and dialogues | Focus proceeds in logical order. Dynamic message delivery announces via ARIA live region (`role="log"` / `aria-live="polite"`) without stealing input focus. | **PASS** |
| **2.4.4 Link Purpose (In Context)** | A | Job vacancies and citations | Citation links clearly identify target lesson, section, or job posting with descriptive link text. | **PASS** |
| **2.4.7 Focus Visible** | AA | Interactive buttons, links, inputs | High-visibility focus ring (`2px solid var(--focus-ring)`) clearly indicated on all active elements during keyboard navigation. | **PASS** |
| **2.5.3 Label in Name** | A | Buttons with visual text | Accessible name matches visual label for all controls (e.g. "Share screen", "Send question", "Cancel request"). | **PASS** |
| **2.5.5 / 2.5.8 Target Size** | AA | Mobile touch targets | Minimum pointer target dimensions of 44x44 CSS px maintained across all mobile controls. | **PASS** |
| **3.1.1 Language of Page** | A | HTML root tag | Primary `lang` attribute dynamically toggles between `en` and `am` when learner changes application language. | **PASS** |
| **3.1.2 Language of Parts** | AA | Bilingual messages & phrases | Phrases in alternating language are tagged with appropriate `lang="am"` or `lang="en"` attributes. | **PASS** |
| **3.2.1 On Focus** | A | Form fields and options | Receiving focus does not trigger unexpected form submission, navigation, or context change. | **PASS** |
| **3.2.2 On Input** | A | Dropdowns and text inputs | Changing an input value does not automatically submit forms or alter page layout unexpectedly. | **PASS** |
| **3.3.1 Error Identification** | A | Validation errors | Form validation errors are identified, rendered in text, and associated programmatically with offending fields via `aria-describedby`. | **PASS** |
| **3.3.2 Labels or Instructions** | A | Form inputs | Instructions and privacy disclosures (e.g. "Only you and an authorised coordinator will see this") provided prior to submission. | **PASS** |
| **3.3.3 Error Suggestion** | AA | Phone verification, formats | Actionable suggestions provided (e.g. "Enter phone number in international format starting with +251"). | **PASS** |
| **4.1.2 Name, Role, Value** | A | Custom widgets and tabs | ARIA `role`, `aria-expanded`, `aria-selected`, and `aria-controls` properly maintained for accordions, tabs, and status badges. | **PASS** |
| **4.1.3 Status Messages** | AA | Toast alerts and chat arrivals | Status announcements utilize `role="status"` or `aria-live="polite"`, ensuring screen readers announce new items without interrupting active reading. | **PASS** |

---

## 4. Co-Design Verification Evidence Summary

- **Desktop Tasks (NVDA / Keyboard):** Proven in [`docs/evidence/t3-025-a-accessibility-desktop.md`](evidence/t3-025-a-accessibility-desktop.md) and [`docs/evidence/t3-009-b-co-design-task.md`](evidence/t3-009-b-co-design-task.md). Zero axe-core violations across 20 rendered test states.
- **Mobile Journey (TalkBack / Android):** Proven in [`docs/evidence/t3-025-b-android-journey.md`](evidence/t3-025-b-android-journey.md). All 7 core mobile tasks completed unaided under 3G and offline conditions.
- **Embedded iFrame Interaction:** Proven in [`docs/evidence/t3-026-b-savanna-embed.md`](evidence/t3-026-b-savanna-embed.md) and [`docs/evidence/t3-026-d-static-starter-journey.md`](evidence/t3-026-d-static-starter-journey.md). Iframe contains accessible `title="Learning Assistant"`, handles postMessage resizing, and traps/releases focus cleanly.
- **Added Channels (Telegram & SMS):** Proven in [`docs/evidence/t3-025-d-channel-accessibility.md`](evidence/t3-025-d-channel-accessibility.md). Telegram voice reviews provide accessible inline action buttons with full transcript disclosure; speech notes preserve full written text and citations with an on-demand listen button; SMS job alerts provide GSM-7/UTF-16 safe segmenting and bilingual `STOP` / `አቁም` opt-out. 100% operable under sound-off setups.

---

## 5. Conformance Claim & Sign-Off

The complete Track 3 learning assistant platform—spanning the core web interface, mobile responsive viewports, embedded iframes, and secondary Telegram and SMS channels—satisfies WCAG 2.1 / 2.2 Level AA across all evaluated surfaces. All criteria are substantiated by automated regression suites and reproducible device evidence.
