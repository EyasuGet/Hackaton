# Accessibility Conformance Report — WCAG 2.2 Level AA

**Product:** Track 3 multilingual learning and help assistant (web app and script-tag embed)
**Standard:** [WCAG 2.2](https://www.w3.org/TR/WCAG22/), Levels A and AA (55 success criteria; 4.1.1 Parsing is obsolete in 2.2 and not listed)
**Format:** Based on the ITI VPAT® 2.5 INT "WCAG 2.2 Report" table
**Issue:** [#206 — T3-034](https://github.com/EyasuGet/Hackaton/issues/206) · automated evidence [#207 — T3-035](https://github.com/EyasuGet/Hackaton/issues/207) · human session [#205 — T3-033](https://github.com/EyasuGet/Hackaton/issues/205)
**Evaluated revision:** `2cf954a` plus the T3-035 axe spec (#207) · **Date:** 2026-11-15

## Conformance claim

**The product partially conforms to WCAG 2.2 Level AA.** One criterion is partially supported (3.1.2 Language of Parts; see [Known issues](#known-issues)). Every other applicable criterion is supported on the evidence listed below.

This revision is based on automated testing, measurement and code review. The gate's human test (a co-designer completing the main task unaided with NVDA, TalkBack, keyboard only, 200 % zoom and sound off) is tracked in #205. Its results fill the **Human check** column. Until that column is complete, nothing in this report should be read as a statement about the experience with a screen reader.

### Result terms (VPAT)

- **Supports:** the functionality meets the criterion without known defects.
- **Partially supports:** some functionality does not meet the criterion.
- **Does not support:** the majority of functionality does not meet the criterion.
- **Not applicable:** the criterion is not relevant to the product.

**Human check** values: `Pending #205` (not yet tested by a person), or the result and assistive technology once recorded.

## Scope

| Surface | Included | How it was evaluated |
|---|---|---|
| Standalone web app, signed out (demo replies) | Yes | axe, measurement |
| Learner screens: course search, conversation (FAQ, simple-language mode, cited answer), human-help composer and preview, help inbox with screen-share controls, accommodation composer, offline banner | Yes | axe, measurement, code review |
| Support screens: accommodation coordinator inbox | Yes | axe, measurement |
| Teacher screen: frequently asked topics | Yes | axe, measurement |
| Employer recruitment portal (rendered for every signed-in role) | Yes | axe, code review |
| Assistant embedded by script tag in the official Savanna static host (`fixtures/hosts/savanna-concept.html`) | Assistant iframe only; the organiser's host page is out of scope | axe |
| Amharic (`am`) and English (`en`) interface | Both | axe in both locales |
| Telegram bot and SMS messages | No: their interface is the Telegram or SMS client, not our web content | Message-content checks are recorded separately in [`evidence/t3-025-d-channel-accessibility.md`](evidence/t3-025-d-channel-accessibility.md) and were not re-evaluated for this revision |
| Production Savanna sign-in | No: not supplied by the organiser | Synthetic demo sign-in link only |

## Evaluation methods

1. **Automated (axe-core 4.14.0 via `@axe-core/playwright` 4.14.0, Playwright 1.65.0, Chromium).** [`apps/web/tests/e2e/axe-every-screen.spec.ts`](../apps/web/tests/e2e/axe-every-screen.spec.ts) scans **19 states** with tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`: three roles (learner, support, teacher) × two locales × two widths (1280 px and 320 px), the signed-out page, five learner interaction states, and the Savanna-embedded iframe. Each state waits for its panels to render before scanning. **Result: 0 violations of any impact and 0 "needs review" items in all 19 states.** CI fails on any critical or serious violation and uploads every result as the `axe-results` artefact. Injecting one unlabelled button made the test fail with `button-name`, confirming the gate can fail.
2. **Measurement in Chromium** (learner, support, teacher; 1280 px and 320 px):
   - horizontal overflow: 0 px at 320 px, and 0 px after applying the WCAG 1.4.12 text-spacing overrides;
   - no text clipped under those overrides;
   - no `position: fixed` or `sticky` elements;
   - no draggable elements;
   - the axe `target-size` rule passed for all 22 checked targets.
3. **Code review** of `apps/web/src` for timing, keyboard handlers, media, language tagging and authentication.
4. **Existing component tests** (Vitest + Testing Library), for example `final-accessibility.test.tsx` and the live-region, focus and Escape tests. These run in JSDOM and are supporting evidence only.
5. **Human assistive-technology testing:** Pending #205.

Automated tools find only a subset of accessibility barriers. A clean axe result does not establish conformance on its own.

## Table 1: Level A

| Criterion | Result | Evidence and remarks | Human check |
|---|---|---|---|
| 1.1.1 Non-text Content | Supports | No informative images. Decorative SVGs are `aria-hidden`; icon-only controls have accessible names (axe `button-name`, `label` pass). | Pending #205 |
| 1.2.1 Audio-only and Video-only (Prerecorded) | Not applicable | No prerecorded media. Read-aloud speaks text that is already on screen. | — |
| 1.2.2 Captions (Prerecorded) | Not applicable | No prerecorded synchronised media. | — |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) | Not applicable | No prerecorded video. | — |
| 1.3.1 Info and Relationships | Supports | Headings, landmarks, lists and labelled form controls; axe `label`, `list`, `listitem`, `form-field-multiple-labels` pass in every state. | Pending #205 |
| 1.3.2 Meaningful Sequence | Supports | DOM order matches visual order; layout is single-column at 320 px. | Pending #205 |
| 1.3.3 Sensory Characteristics | Supports | Instructions refer to control names, not shape, colour or position. | Pending #205 |
| 1.4.1 Use of Color | Supports | Status and unread markers carry text and ARIA status as well as colour. | Pending #205 |
| 1.4.2 Audio Control | Supports | Speech starts only from a learner's button press (`assistant.tsx`) and can be stopped with the control or Escape. Nothing plays automatically. | Pending #205 |
| 2.1.1 Keyboard | Supports | All controls are native buttons, inputs and selects. Questions send with Enter (Shift+Enter for a new line, IME composition respected). | Pending #205 (keyboard-only run) |
| 2.1.2 No Keyboard Trap | Supports | No custom focus traps. The embed restores focus to the host page when closed (`embed.spec.ts`). | Pending #205 |
| 2.1.4 Character Key Shortcuts | Not applicable | The only key handler is Escape (`assistant.tsx`), which is not a character key. | — |
| 2.2.1 Timing Adjustable | Supports | Demo sessions last 2 hours (`SESSION_TTL_MS`). Five minutes before the end, a `role="alert"` warning offers **Extend**, which grants a fresh 2 hours with no limit on extensions (`POST /api/demo/session/extend`, #230). Questions, help and accommodation drafts are kept on the device through expiry. | Pending #205 |
| 2.2.2 Pause, Stop, Hide | Not applicable | No moving, blinking, scrolling or auto-updating content that starts automatically and lasts over 5 s. | — |
| 2.3.1 Three Flashes or Below Threshold | Supports | No flashing content. | — |
| 2.4.1 Bypass Blocks | Supports | One `<main>` landmark and a heading for every panel let screen-reader users jump between sections. The only content before the `<h1>` is the two-button language switch. **There is no skip link** (an earlier version of this report said there was). | Pending #205 |
| 2.4.2 Page Titled | Supports | `document.title` follows the interface language; axe `document-title` passes. | — |
| 2.4.3 Focus Order | Supports | Focus follows DOM order. New answers are announced through a polite live region without moving focus. Sign-out moves focus to its status message (`demo-session.spec.ts`). | Pending #205 |
| 2.4.4 Link Purpose (In Context) | Supports | Citation and vacancy links name their lesson section or job. | Pending #205 |
| 2.5.1 Pointer Gestures | Not applicable | No multipoint or path-based gestures. | — |
| 2.5.2 Pointer Cancellation | Supports | Native controls activate on up-event. | — |
| 2.5.3 Label in Name | Supports | axe `label-content-name-mismatch` passes; accessible names match visible labels. | Pending #205 |
| 2.5.4 Motion Actuation | Not applicable | No motion-triggered functions. | — |
| 3.1.1 Language of Page | Supports | `<html lang>` switches between `en` and `am`; axe `html-has-lang`, `html-lang-valid` pass. | Pending #205 |
| 3.2.1 On Focus | Supports | Focus never submits, navigates or opens anything. | Pending #205 |
| 3.2.2 On Input | Supports | Changing language or a select updates in place without submitting; the unsent question is preserved across a language switch. | Pending #205 |
| 3.2.6 Consistent Help | Supports | "Request human help" is in the same position after the conversation on every signed-in view, in both locales and in the embed. | Pending #205 |
| 3.3.1 Error Identification | Supports | Errors are shown as text in `role="alert"` regions that name the problem (for example, session expired, not sent). | Pending #205 |
| 3.3.2 Labels or Instructions | Supports | Every input has a visible label. Privacy notes ("what will be shared", "only you and an authorised coordinator") appear before submission. | Pending #205 |
| 3.3.7 Redundant Entry | Supports | Help and accommodation previews reuse what was typed; no step asks again for information already entered in the same process. | Pending #205 |
| 4.1.2 Name, Role, Value | Supports | Native elements, plus `aria-pressed` on the language buttons. All axe ARIA rules pass in every state. | Pending #205 |

## Table 2: Level AA

| Criterion | Result | Evidence and remarks | Human check |
|---|---|---|---|
| 1.2.4 Captions (Live) | Not applicable | Screen sharing is video-only (`audio: false` in `media-connection.ts`); there is no live audio. | — |
| 1.2.5 Audio Description (Prerecorded) | Not applicable | No prerecorded video. | — |
| 1.3.4 Orientation | Supports | No orientation lock in CSS or code; layout reflows in portrait and landscape. | Pending #205 (TalkBack phone) |
| 1.3.5 Identify Input Purpose | Not applicable | The web app collects no information about the user that an `autocomplete` token describes. Questions and requests are free text. Phone verification happens over SMS, not in a web form. | — |
| 1.4.3 Contrast (Minimum) | Supports | axe `color-contrast` passes in all 19 states, both locales. | — |
| 1.4.4 Resize Text | Supports | No horizontal overflow at 320 px (equivalent to 400 % zoom at 1280 px), so 200 % is covered. | Pending #205 (200 % zoom) |
| 1.4.5 Images of Text | Not applicable | No images of text. | — |
| 1.4.10 Reflow | Supports | Measured 0 px horizontal overflow at 320 px for learner, support and teacher views; `assistant.spec.ts` asserts it for the conversation. | Pending #205 |
| 1.4.11 Non-text Contrast | Supports | The focus ring (`--accent` #1d4ed8) measures 6.70:1 against the page background and 6.08:1 against panels. Input borders were not measured; axe does not test this criterion. | Pending #205 |
| 1.4.12 Text Spacing | Supports | With WCAG text-spacing overrides applied: 0 px overflow and no clipped text in any measured view. Ethiopic glyphs need the line height; not visually inspected yet. | Pending #205 |
| 1.4.13 Content on Hover or Focus | Not applicable | No tooltips, popovers or `title` attributes. | — |
| 2.4.5 Multiple Ways | Not applicable | Single-page application; there is no set of pages. | — |
| 2.4.6 Headings and Labels | Supports | Each panel has a descriptive heading; labels describe their inputs. | Pending #205 |
| 2.4.7 Focus Visible | Supports | A global `:focus-visible` rule draws a 3 px outline with 2 px offset (`app.css`), with high-contrast overrides. | Pending #205 (keyboard-only run) |
| 2.4.11 Focus Not Obscured (Minimum) | Supports | Measured: no `fixed` or `sticky` elements in any view, so nothing can cover the focused element. | Pending #205 |
| 2.5.7 Dragging Movements | Not applicable | No drag interactions (no `draggable` elements or drag handlers). | — |
| 2.5.8 Target Size (Minimum) | Supports | axe `target-size` passed all 22 targets. Three checkboxes are 13 × 13 px and the search box is 21 px tall; they pass through the spacing exception. Enlarging them to at least 24 px is recommended for learners with motor impairments. | Pending #205 |
| 3.1.2 Language of Parts | **Partially supports** | Learner content carries its own `lang`, and untranslated keys fall back to English tagged `lang="en"`. However, the **Employer Recruitment Portal** and the **sign-in status and session-expiry messages** (`demo-session.tsx`) are hard-coded in English without `lang="en"`, so in the Amharic interface screen readers read them with Amharic pronunciation. See Known issues. | Pending #205 |
| 3.2.3 Consistent Navigation | Supports | The same panel order and language switch appear on every view and in the embed. | — |
| 3.2.4 Consistent Identification | Supports | The same functions use the same names everywhere (for example "Request help" and "Review before sending"). | — |
| 3.3.3 Error Suggestion | Supports | Error messages say what to do next (for example, "Ask for a new one", "still in the box"). | Pending #205 |
| 3.3.4 Error Prevention (Legal, Financial, Data) | Supports | Help and accommodation requests show a review step before sending, and both can be cancelled afterwards. | Pending #205 |
| 3.3.8 Accessible Authentication (Minimum) | Supports | Sign-in is a single-use link, with no password, code transcription or cognitive test. | — |
| 4.1.3 Status Messages | Supports | Answers, sign-in, offline and sent-request messages use `role="status"`/`aria-live="polite"`; errors use `role="alert"`. | Pending #205 |

## Known issues

| # | Criterion | Problem | Planned fix |
|---|---|---|---|
| 1 | 3.1.2 Language of Parts | The Employer Recruitment Portal, the sign-in status and the session-expiry warning are English-only and lack `lang="en"`. Learners and teachers also see this portal, which they cannot use. | Translate it or tag it `lang="en"`, and show it only to employer roles: [#233](https://github.com/EyasuGet/Hackaton/issues/233) |

## Corrections to the previous version of this report

- It said the product **satisfies WCAG 2.1 AA** and marked every row PASS. This version evaluates against **WCAG 2.2** and reports partial support where found.
- It listed **2.5.5 Target Size (Level AAA)** together with 2.5.8 and claimed 44 × 44 px targets. Measured checkboxes are 13 × 13 px; 2.5.8 is met through the spacing exception.
- It claimed a **skip link**. There is none; 2.4.1 is met through landmarks and headings.
- It omitted the WCAG 2.2 additions **2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7 and 3.3.8**; all are now evaluated.
- It described co-designer, NVDA and TalkBack results that came from automated or simulated runs. Human results are now kept separately in the Human check column and recorded under #205.

## Sign-off

| Role | Name | Date |
|---|---|---|
| Automated and code-review evaluation | Track 3 team (T3-034 / T3-035) | 2026-11-15 |
| Co-designer task, NVDA, TalkBack, keyboard only, 200 % zoom, sound off | Pending #205 | — |
