# Static starter boundary and integration questions (T3-002 evidence)

Evidence record for [T3-002](https://github.com/EyasuGet/Hackaton/issues/5). Recorded 2026-11-14 against the supplied starter [alx-africa/Savanna-static-pages at `9e83ac7`](https://github.com/alx-africa/Savanna-static-pages/tree/9e83ac77891708117728ad9fc05301e124cc8ec8) (upstream `main` still pointed at this commit on that date). It builds on [the source reconciliation](savanna-reconciliation.md) and does not repeat its source citations. Nothing here claims runtime acceptance, judging acceptance or production Savanna integration.

## Status labels

| Label | Meaning |
|---|---|
| **OBSERVED** | Seen when the pinned pages were served and loaded in the test setup below |
| **SOURCE** | Read from the pinned source; not exercised at runtime |
| **ORGANISER-CONFIRMED** | Stated by the organisers, relayed by the team (wording and date given) |
| **UNRESOLVED** | Missing contract, permission or answer; has an owner and next action |
| **NOT RUN** | A check that this record did not perform; has a next action |

## What the starter is

A static capture of three learner pages plus a landing page: no backend, API, identity issuer, `postMessage` contract, microphone or screen-capture code, package manifest, test runner or repository licence (SOURCE, see [reconciliation §1–2](savanna-reconciliation.md#2-confirmed-source-facts)). It is our integration demo host, not part of our application.

## Runtime observations

Test setup (OBSERVED): pinned clone in a temporary directory outside this repository; `python3 -m http.server 8765 --bind 127.0.0.1` from the starter root (Python 3.14.4); Mozilla Firefox 158.0 headless, `--screenshot` at 1280×900 and 640×900 window widths, loading `index.html` and the three `pages/*.html`. No starter code was modified and nothing was installed. Screenshots stay outside the repository because the captures render a captured learner's display name.

| Check | Result |
|---|---|
| Pages load over local HTTP | OBSERVED: all four pages rendered at both widths; dashboard, curriculum sidebar and lesson content visible |
| Same-origin requests | OBSERVED: server log shows 59 `200` and 0 `404` responses (others were `304` cache revalidations); CSS, fonts, Popper/Bootstrap, `static-page.js` and images are all served locally |
| Off-origin requests | NOT RUN: the local server cannot see them. SOURCE: Typekit CSS lists remote font URLs before local fallbacks; the only remote `<script>` tags sit inside an `<!--[if lt IE 9]>` comment and are inactive in current browsers. Next action: capture a browser network log in T3-026-B |
| Narrow layout (640 px, a rough stand-in for 200% zoom) | OBSERVED: dashboard content reflows to one column; the fixed header stays on top. Not a substitute for a real 200% zoom test (T3-025-A) |
| Console errors, keyboard operation | NOT RUN: headless screenshot mode does not report them. Next action: interactive browser pass in T3-026-B |
| Runnable starter checks | None supplied (SOURCE), so there is no automated starter verification to record |

## Safe assistant mount and content boundary

- **Mount point (SOURCE).** `static-page.js` replaces the children of `#static-track-host` and `#static-track-modals` (paced dashboard) and `[data-section-host]` (self-paced dashboard) when the learner switches tabs or sections. Anything mounted inside those containers is destroyed on navigation. Each page ends with three local `<script>` tags just before `</body>`, outside every swapped container. A single assistant `<script>` added after them, which appends its own launcher and iframe to `<body>`, is outside every swapped region. This matches the organiser-confirmed plug-in script approach below and [D06](decisions.md#locked-choices); it is verified only when [T3-006-B](https://github.com/EyasuGet/Hackaton/issues/14) and [T3-026-B](https://github.com/EyasuGet/Hackaton/issues/60) actually run it.
- **Layering (SOURCE).** The page header is `position: fixed` with `z-index: 1000`. Our launcher must not be hidden under it or cover its controls.
- **Host changes.** Keep them to adding that script tag, plus sanitising captured learner data before any demo copy is published (see below). Record every change in T3-026-B.
- **Content boundary (SOURCE).** Only the authored lesson text inside `#curriculum_navigation_content` on `concept-with-navigation.html` is a candidate corpus for [T3-005-A](https://github.com/EyasuGet/Hackaton/issues/10), and only after content-reuse approval (UNRESOLVED, below). Navigation, progress, profile and form markup are excluded.
- **Identity (SOURCE + D10).** The pages render a captured learner display name and progress (OBSERVED in screenshots), carry a `signed_in` class and keep a form `authenticity_token` field. None of these is a credential. Our separate backend issues server-controlled synthetic demo sessions ([T3-004-C](https://github.com/EyasuGet/Hackaton/issues/9)), which need nothing from the host page. This is compatible with the static host because the iframe authenticates against our origin, not the host's. Production SSO is a separate external contract ([T3-004-B](https://github.com/EyasuGet/Hackaton/issues/102)) and is not a prerequisite for the labelled static demonstration.
- **Before publishing a hosted demo copy**, replace captured display names and remove token values with synthetic fixtures. Do not republish the capture as-is.

## Inherited accessibility defects

Defects in the host page that affect the complete learner journey are reported, not hidden behind the iframe boundary. axe was NOT RUN (no install was authorised for this check); next action: T3-025-A scans the host-plus-assistant pages.

| Defect | Evidence | Location |
|---|---|---|
| Sidebar hamburger is a `<div>` with a click handler: no button role, not focusable, no accessible name | SOURCE; the starter's own script states it deliberately preserves this defect | `.hamburger` in each learner page header; `static-page.js` sidebar toggle |
| No skip link on any page | SOURCE (no skip-link markup found) | All four pages |
| No `<nav>` landmark for the sidebar or curriculum navigation (only the paced dashboard has one) | SOURCE | `concept-with-navigation.html`, `homepage-v1-self-paced.html` |
| Font loading depends on remote Typekit URLs before local fallbacks | SOURCE; runtime effect NOT RUN | `assets/css/typekit-*.css` |

Positive SOURCE findings (not a conformance claim): every page declares `lang="en"`, has one `<main>`, and every `<img>` has an `alt` attribute.

## Contracts and open questions

| Item | State | Evidence | Next action | Owner |
|---|---|---|---|---|
| Integration form | **ORGANISER-CONFIRMED**: organisers want the assistant delivered as a plug-in HTML `<script>`, without changing the original site much (relayed by the team, 2026-11-14; paraphrase, not organiser wording) | Team report to the T3-002 owner | Build the loader in T3-006-B; prove it in the pinned pages in T3-026-B | T3-006-B / T3-026-B owners |
| Serving the pages over local/hosted HTTP(S) rather than `file://` | UNRESOLVED as an organiser ruling; OBSERVED to work locally | Runtime observations above | Confirm with organisers alongside the questions below; never accept a `null`/`file://` origin for authentication | T3-002 owner (Fenety) |
| Production Savanna identity, roster and content APIs | UNRESOLVED (external): none supplied by the starter | SOURCE; [reconciliation §4](savanna-reconciliation.md#what-the-meetings-changeor-do-not-establish) | Later adapter T3-004-B once a contract is supplied; synthetic sessions (T3-004-C) cover the demo | T3-004-B owner when claimed |
| Full accessibility / required-feature checklist | UNRESOLVED: **to be requested**; only the public gate (NVDA, TalkBack, keyboard, 200% zoom, sound off, zero critical/serious axe findings, WCAG 2.2 AA report) is known | [Official brief](https://digitalbridge.et/#apply) | Send the checklist request (question 3 below); map any differences to issues | T3-002 owner (Fenety) |
| Mobile screen-sharing alternative (desktop sharing + text help on phones) | UNRESOLVED: **to be requested**; not waived | Most phone browsers cannot share a screen from a web page; [decisions](decisions.md#external-gates-and-remaining-precision-checks) | Send question 1 below; record the answer in [T3-018-C](https://github.com/EyasuGet/Hackaton/issues/42) | T3-002 owner (Fenety) |
| Lesson/asset reuse, offline publication and submission licence | UNRESOLVED | No repository licence; Typekit has separate terms (SOURCE) | Send question 2 below; T3-027-A records the answer | T3-002 owner (Fenety) |
| Submission form, slide template, hosting expectations | UNRESOLVED | Meeting evidence in [reconciliation §4](savanna-reconciliation.md#what-the-meetings-changeor-do-not-establish) | Send question 4 below | T3-002 owner (Fenety) |
| Deployed CSP, frame and microphone/display-capture permissions | NOT RUN: the starter supplies no headers | SOURCE | Test on the actual demo host in T3-026-B/T3-026-D | T3-026-B owner |

### Questions still to send to the organisers

These replace the remaining parts of the [earlier drafts](savanna-reconciliation.md#questions-to-send-to-organisers); the script-integration part is already answered. They have **not been sent** as of this record.

1. **Screen sharing:** Most phone browsers cannot share a screen from a web page. Is learner-controlled screen sharing on desktop browsers, plus text help with a person on phones, acceptable for Track 3?
2. **Content and licence:** May we extract, translate and offline-cache the lesson text from the supplied concept page, and reuse its images in our hosted demo? Which open licence applies to our submission?
3. **Checklist:** Please share the full required-feature / accessibility checklist referred to on the public page.
4. **Submission and serving:** Please share the submission form and slide template, the hosted-demo expectations, and confirm we may serve the static pages over local or hosted HTTP(S) instead of opening them as files.

Record each answer here with its date and source, then update the affected issue.
