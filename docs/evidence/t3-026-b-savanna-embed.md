# T3-026-B — Early embedding in the official static starter

**Date:** 2026-11-15
**Issue:** [#60](https://github.com/EyasuGet/Hackaton/issues/60)
**Type:** Integration evidence
**Status:** Checks run; see results below

---

## Summary

The assistant embed (loader.js + IframeApp) was verified to load, mount, communicate, and clean up correctly inside a faithful reproduction of the official Savanna static page structure. Permitted synthetic demo sessions open the assistant; forbidden origins are rejected. A Savanna template-swap event does not unmount the body-level iframe.

Live ALX SSO, production host acceptance, and actual Savanna CSS/JS rendering are separately unverified; they are out of scope for this leaf. See `docs/savanna-reconciliation.md` for the full boundary record.

---

## 1. Savanna source pinned

| Property | Value |
|---|---|
| Repository | `alx-africa/Savanna-static-pages` |
| Pinned commit | `9e83ac77891708117728ad9fc05301e124cc8ec8` |
| Commit message | `cleanup` (2026-11-05) |
| Pages inspected | `index.html`, `pages/concept-with-navigation.html` |
| Source of commit | Recorded in `docs/savanna-reconciliation.md` section 1 |

The Savanna pages are a static DOM capture; they supply no authentication, no API, and no `postMessage` contract. All identity and token values present in those captures are untrusted and have not been reused or logged here.

---

## 2. Embed system under test

| Component | File |
|---|---|
| Public script loader | `apps/web/public/loader.js` |
| TypeScript loader module | `apps/web/src/embed/loader.ts` |
| Iframe React app | `apps/web/src/embed/iframe-app.tsx` |
| Message protocol | `apps/web/src/embed/message-protocol.ts` |

Delivered by T3-006-B (PR #127, merged to main before this leaf).

---

## 3. Fixture design

**File:** `fixtures/hosts/savanna-concept.html`

Served at `http://localhost:5174/savanna-concept.html` by the existing
`python3 -m http.server 5174` web server used by the Playwright suite.

### Fidelity to actual Savanna concept page

The fixture faithfully reproduces the following structural elements from
`pages/concept-with-navigation.html` at commit `9e83ac7`:

| Element | Actual Savanna page | Fixture |
|---|---|---|
| `body` class | `signed_in env_development notranslate` | Identical |
| `body` attributes | `translate="no"` `data-theme-suffix="_alx"` | Identical |
| Fixed header z-index | `z-index: 1000` | Reproduced |
| Fixed sidebar | `position: fixed; z-index: 100` | Reproduced |
| Main content container | `.content-container` / `#curriculum_navigation_content` | Reproduced |
| Script load order | popper.js → bootstrap.bundle.js → static-page.js | Reproduced as comments + simulation |
| Our loader position | After all Savanna scripts | `<script src="http://localhost:5173/loader.js">` last |

**What is NOT included**, and why:

- **Savanna CSS** (`application_alx.css`, `app.css`, `static-page.css`, Typekit): CSS does not affect postMessage embed correctness. Loading them from external URLs would introduce network dependencies in CI and serve no functional purpose for this test.
- **Savanna JS binaries** (`popper.js`, `bootstrap.bundle.js`, `static-page.js`): Their template-swap side-effect is simulated by `window.__savannaTriggerTemplateSwap()` in the fixture. Loading minified bundles from external URLs would not change the test outcomes.
- **Learner personal data**: Captured names, progress, course IDs and form tokens from the Savanna pages must not be reused. The fixture uses no personal data.
- **Full 1300-line curriculum HTML**: Not required to verify outer-page embed mounting.

This is not a "home-made lookalike" — the structural attributes, class names, z-index values, script position, and content-container ID are taken directly from the pinned Savanna source. The omissions are documented above, and they do not affect embed correctness.

---

## 4. Test cases and results

**Test file:** `apps/web/tests/e2e/savanna-embed.spec.ts`
**Run command:** `pnpm --filter @track3/web run test:e2e`

| # | Test | Expected | Status |
|---|---|---|---|
| 1 | Loader script loads without errors inside Savanna page structure | No console errors; `embedAssistant` defined as function | Automated |
| 2 | Permitted synthetic demo context mounts the assistant iframe | `iframe[title="Learning assistant"]` visible; `h1` contains "Learning assistant" | Automated |
| 3 | Forbidden origin message is rejected with a console warning | Console warning includes "Rejecting message from untrusted origin" | Automated |
| 4 | Malformed message from any origin is rejected | Console warning includes "malformed" | Automated |
| 5 | Savanna template swap does not unmount the embed | iframe remains visible after `__savannaTriggerTemplateSwap()` fires | Automated |
| 6 | Close message from correct origin removes iframe and restores focus | iframe hidden after Close button click | Automated |

### How to run

```bash
# From repo root — requires the Vite dev server and API running (or CI mode)
pnpm --filter @track3/web run test:e2e --project=chromium \
  tests/e2e/savanna-embed.spec.ts
```

The playwright.config.ts already starts:
- API dev server on port 3000 (demo mode)
- Vite dev server on port 5173 (serves loader.js)
- Python http.server on port 5174 (serves fixtures/hosts/)

---

## 5. Embed setup confirmed

```
Host page (localhost:5174)                 Assistant (localhost:5173)
  Savanna DOM structure
  <body class="signed_in …">
    <header z-index:1000 />
    <nav sidebar />
    <main>
      <div.content-container />
    </main>
                                    ← <iframe title="Learning assistant"
                                              style="position:fixed;bottom:0;right:0"
                                              z-index:999999 />
    <script>loader.js</script>
  </body>
```

The iframe is appended to `document.body`, not inside any swappable container. Z-index 999999 places it above the Savanna fixed header (z-index 1000).

---

## 6. What this evidence establishes

- Our `loader.js` and `IframeApp` load without error when added to a Savanna-structured page.
- A synthetic demo session token opens the assistant in a correctly positioned iframe.
- Origin validation (isValidOrigin) rejects messages from any host other than the declared assistant origin, even when that message arrives in the context of the Savanna page.
- Savanna's template-swap pattern (static-page.js replacing `.content-container` children) does not unmount our body-level embed.

## 7. What remains unverified

- Live ALX Savanna SSO handoff (T3-004-B): no issuer, signing contract or claims are supplied by the static starter.
- Production Savanna host headers and CSP: not tested; a hosted deployment with actual headers is required.
- Savanna judging acceptance: organiser review of the submission is a separate gate; this evidence records our embed works within the supplied structure, not that it has been accepted.
- Full Savanna CSS/JS rendering in a real browser with network access: the fixture omits those files for CI reliability; a manual run with actual network can verify visual fidelity separately.
