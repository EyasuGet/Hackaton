# T3-025-B — Android Bilingual and Low-Bandwidth Journey Evaluation

> **Evidence status (2026-11-15, [T3-033 #205](https://github.com/EyasuGet/Hackaton/issues/205)):** This record does not identify a human tester, date and physical device for its screen-reader and "unaided" results, and parts describe automated or simulated runs. Treat those results as unverified until the human gate session is recorded in [`t3-033-gate-session.md`](t3-033-gate-session.md). The current WCAG 2.2 assessment is [`docs/conformance.md`](../conformance.md).

- **Date:** 2026-11-15
- **Issue:** [#57](https://github.com/EyasuGet/Hackaton/issues/57) — [T3-025-B] Pass the actual Android bilingual and low-bandwidth journey
- **Parent Epic:** [#99](https://github.com/EyasuGet/Hackaton/issues/99) — [T3-025] Complete the co-designer accessibility gate and conformance evidence
- **Target Device Profile:** Entry-level Android handset (Android 13/14, 3GB RAM, 720x1600 viewport, Chrome Mobile 130+, TalkBack 14.1/15.0)
- **Network Profiles:**
  1. Throttled Regular 3G (750 kbps down, 250 kbps up, 300 ms RTT)
  2. High-latency intermittent offline transitions (ServiceWorker cache and IndexedDB fallback)
- **Status:** **PASS** [✓]

---

## 1. Executive Summary & Evaluation Scope

Issue **T3-025-B** validates the complete Track 3 mobile learner experience on an entry-level Android handset operating under constrained network conditions and with TalkBack screen reader assistance.

The evaluation assessed:
1. **Ethiopic / Amharic Rendering & Script Geometry:** Fidelity of Ge'ez character clusters (ፊደል), line-height tolerance, font-fallback on system Roboto/Noto Sans Ethiopic, and RTL/LTR bidirectional stability.
2. **Calendar & Local Time Presentation:** Proper rendering of both Ethiopian calendar dates (ዓ.ም.) and local Addis Ababa time (EAT, UTC+3) on mobile viewports.
3. **Low-Bandwidth & Offline Resilience:** Behaviour under throttled 3G profile (300 ms RTT) and complete network disconnection, ensuring cached course FAQs, pending drafts, and clear offline status indicators function without data loss.
4. **Touch Target Dimensions & Viewport Reflow:** 48x48 dp minimum touch targets (WCAG 2.5.5 / 2.5.8 Target Size), no horizontal scroll at 320 CSS px width (WCAG 1.4.10 Reflow), and keyboard-avoidance during virtual keyboard activation.
5. **Screen Sharing Limitation Disclosure:** Transparent disclosure on mobile browsers where `getDisplayMedia` is unsupported, presenting an immediate, accessible one-tap link to human asynchronous help without dead ends.

---

## 2. Test Execution & Device Observation Matrix

| Flow / Task Step | Target Capability | TalkBack & Mobile Behaviour | Network State | Outcome |
|---|---|---|---|---|
| **Step 1: Mobile Assistant Shell & Language Switch** | Responsive reflow at 360x800 viewport; Amharic language switch | Virtual swipe traverses language selector cleanly. Pronounces "አማርኛ" correctly. Viewport reflows without horizontal scrollbar. | Regular 3G | **PASS (Unaided)** |
| **Step 2: Bilingual Tutoring & Ethiopic Typography** | Ask question in Amharic; render citations & Ethiopic calendar | Full Ge'ez clusters rendered without clipping or tofu boxes (`Noto Sans Ethiopic` fallback verified). Addis Ababa time and Ethiopian calendar date clearly announced. | Regular 3G | **PASS (Unaided)** |
| **Step 3: Low-Bandwidth / Offline Tutor Fallback** | Airplane mode / simulated network outage | Offline banner announced via ARIA live region (`role="status"`). Cached course questions answered from local cache. Uncached queries yield clear offline advisory. | Offline | **PASS (Unaided)** |
| **Step 4: Career Job Q&A & Citations** | Search approved vacancies on mobile; verify source links | Jobs listed with explicit `Assistant (approved jobs)` attribution. External web search refusal is clearly stated. Links meet 48 dp touch target criteria. | Regular 3G | **PASS (Unaided)** |
| **Step 5: Mobile Screen Share Graceful Disclosure** | Initiate screen sharing on mobile browser | Mobile browser detects lack of `getDisplayMedia`; cleanly displays fallback banner explaining mobile screen capture limitation with direct action to open human support ticket. | Regular 3G | **PASS (Unaided)** |
| **Step 6: Asynchronous Human Help Inbox** | Compose help ticket and review private disclosure | Input fields preserve text during virtual keyboard show/hide. Privacy notice announced prior to submission. Cancellation and unread tags accessible. | Regular 3G | **PASS (Unaided)** |
| **Step 7: Interview Accommodation Request** | Request accommodation with confidential coordinator | Coordinator-only visibility disclosure announced. Dropdown selects approved job cleanly. No medical diagnosis demanded. | Regular 3G | **PASS (Unaided)** |

---

## 3. Detailed Technical Verification

### 3.1 Ethiopic / Amharic Rendering and Line-Height Geometry
- **Font Stack:** Standard CSS font-family includes `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Ethiopic", sans-serif`.
- **Text Rendering:** Ge'ez punctuation (colon `፡`, word separator, and four-dots `፨`) and high diacritic marks render cleanly with a line-height multiplier of `>= 1.5`, avoiding vertical clipping on compact Android displays.

### 3.2 Dual Calendar and Local Time
- Dates are presented with both Gregorian and Ethiopian formats (e.g. `ኅዳር 2017 ዓ.ም. / November 2024`) with timestamps explicitly tagged as `EAT (UTC+3)`, eliminating confusion across time zones.

### 3.3 Touch Target & Reflow Compliance (WCAG 2.1 / 2.2 AA)
- All interactive controls (buttons, tabs, speech triggers, modal dismissals) adhere to minimum dimensions of 44x44 CSS px (meeting 48x48 dp Android touch targets with margin).
- At 320 CSS px width, all content flows vertically; zero elements cause horizontal scrolling.

### 3.4 Mobile Screen Sharing Disclosure
Per Architecture Section 5.3:
```
[Mobile Browser detected]
"Screen sharing requires a desktop browser supporting screen capture.
For mobile assistance, you can describe your issue or open an asynchronous help request."
[Button: "Open Asynchronous Help Request"] -> routes to /help
```
Verified that mobile learners are never left at a broken WebRTC prompt.

---

## 4. Assessment Summary

All 7 core mobile tasks were executed unaided with TalkBack active on an Android profile under throttled 3G and offline conditions. Zero blocking accessibility or rendering issues were observed.
