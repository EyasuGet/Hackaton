# T3-026-D — Completed core journey in the official static starter

**Date:** 2026-11-15  
**Issue:** [#61](https://github.com/EyasuGet/Hackaton/issues/61)  
**Parent:** [T3-026 / #60](https://github.com/EyasuGet/Hackaton/issues/60)  
**Type:** Integration evidence  
**Status:** Complete; automated suite and verification checks passing  

---

## Summary & Outcome

This evidence document records the complete, integrated learner journey of the multilingual learning/help assistant embedded inside the organiser's static starter capture (`fixtures/hosts/savanna-concept.html` served at `http://localhost:5174/savanna-concept.html`).

Unlike the initial shell proof delivered in T3-026-B (which proved embed mounting and template-swap survival for a static shell), T3-026-D proves the **full integrated assistant connected to the real backend**:
1. **Authenticated synthetic demo session handoff:** Exchanges a single-use handoff code for an in-memory session token without storing credentials in DOM attributes, local storage, or URLs.
2. **Cited question & answer with grounding:** Delivers course-grounded answers citing the enrolled module with interactive citation links and semantic `<cite>` markup.
3. **Asynchronous human help requests & reply inbox:** Supports context drafting, disclosure preview, transmission confirmation, and persistent reply reading.
4. **Accommodation request workflow:** Enables job-specific accommodation requests with explicit disclosure and coordinator review status tracking.
5. **Controlled desktop screen sharing:** Initializes view-only video capture (`audio: false`) with persistent learner stop controls, respecting device and secure-context gates.
6. **Iframe permissions & CSP compliance:** Uses explicit `Permissions-Policy` delegation (`allow="microphone; display-capture"`) and strict CSP origin validation, while degrading gracefully when permissions are denied.

---

## 1. Pinned Savanna static starter source

| Property | Pinned Value |
|---|---|
| **Repository** | `alx-africa/Savanna-static-pages` |
| **Pinned Commit** | `9e83ac77891708117728ad9fc05301e124cc8ec8` |
| **Commit Message** | `cleanup` (2026-11-05) |
| **Source Inspection** | `pages/concept-with-navigation.html` |
| **Static Capture Fixture** | `fixtures/hosts/savanna-concept.html` (served on port 5174) |
| **Embedded App Origin** | `http://localhost:5173` |

### Host DOM structure and layering

The fixture faithfully preserves the actual DOM classes, attributes, and z-index layering from the pinned Savanna capture:
- **Body classes:** `class="signed_in env_development notranslate" data-theme-suffix="_alx" translate="no"`
- **Fixed Header:** `z-index: 1000`
- **Navigation Sidebar:** `position: fixed; z-index: 100`
- **Main Container:** `.content-container` / `#curriculum_navigation_content`
- **Assistant Embed Iframe:** Appended to `document.body` with `z-index: 999999`, ensuring all assistant controls and dialogs remain accessible above host headers and swappable content.

---

## 2. Iframe sandbox, permissions policy, and CSP delegation

### Permissions-Policy delegation

The script loader (`apps/web/public/loader.js` and `apps/web/src/embed/loader.ts`) configures iframe permissions:

```html
<iframe
  src="http://localhost:5173"
  title="Learning assistant"
  allow="microphone; display-capture"
  style="position: fixed; bottom: 0; right: 0; width: 420px; height: 600px; z-index: 999999; border: none;"
></iframe>
```

- **`display-capture`**: Delegated to the assistant origin to support desktop screen sharing for human tutoring. Audio capture is explicitly disabled (`audio: false`) at the media constraints layer.
- **`microphone`**: Delegated to enable optional voice input without prompting the host context.
- **Origin boundary:** Origin validation (`isValidOrigin`) strictly enforces exact origin matching between the host and assistant. Untrusted origins (`null`, `file://`, or unauthorized hosts) are rejected with console warnings.

### Content Security Policy (CSP)

- The server sets `Content-Security-Policy: frame-ancestors 'self' http://localhost:5174 http://127.0.0.1:5174;` (and wildcard in relay deployment) allowing authorized static hosts to frame the assistant while isolating script execution and network requests to the assistant origin.
- The embed never executes host scripts or accesses host cookies/storage.

### Permission denial resilience

When a host embeds the assistant with restricted permissions (e.g. `allow=""` or sandbox without capture delegation):
- The assistant displays an accessible, polite notice explaining that screen capture is restricted or unavailable on the current browser/device.
- Core tutoring Q&A, course search, asynchronous help messaging, and accommodation requests continue to function normally.

---

## 3. Completed core journey walkthrough

### Step 1: Authenticated synthetic demo handoff
- **Host action:** Host script calls `embedAssistant({ token: code, origin: 'http://localhost:5173' })`.
- **Protocol:** Host sends `{ type: 'init', token: code }` over `postMessage` upon receiving `{ type: 'status', status: 'ready' }`.
- **Execution:** Inside the iframe, `DemoSession` exchanges the single-use handoff code via `POST /api/demo/session` and validates identity with `GET /api/me`.
- **Result:** Learner session is established in memory. Sign-in status displays `Signed in as Demo learner A (learner). Synthetic demo identity — not real authentication.` Replaying the handoff code in another context is rejected by the server.

### Step 2: Course question answering with grounding citations
- **Learner action:** Learner enters `"How is AI changing virtual assistant work?"`.
- **Backend response:** Tutoring module retrieves relevant sections from `course-1` (`Savanna Virtual Assistant`).
- **Rendering:** Answer renders in the chat stream with grounded citations:
  - Source Title: `Savanna Virtual Assistant`
  - Section Heading: `Artificial Intelligence and the Future of VA Work`
  - Semantic markup: `<cite>` tag and interactive citation links.

### Step 3: Asynchronous human help request
- **Learner action:** Learner opens the help composer via `Ask a person for help`.
- **Disclosure gate:** Before submission, the learner reviews the disclosure notice clarifying that the request is asynchronous and carries no promise of immediate staff availability.
- **Confirmation:** Learner clicks `Confirm and send request`. Request enters the waiting queue and is displayed in `HelpInbox` with Addis Ababa timestamp formatting.

### Step 4: Accommodation request form submission
- **Learner action:** Learner clicks `Request an interview accommodation`.
- **Composer:** Learner selects the relevant job, enters accommodation details (e.g., extra time or screen reader adjustments), and reviews the disclosure notice.
- **Outcome:** The request is saved and displayed with status `waiting`, enabling private two-way coordinator messaging once reviewed.

### Step 5: Controlled desktop screen sharing
- **Trigger:** In a claimed support session, the `ScreenShare` component offers `Share screen`.
- **Constraints:** Enforces `{ video: true, audio: false }` to protect learner privacy; no microphone audio or ambient room noise is captured.
- **Teardown:** Learner can click `Stop sharing` at any time; closing the iframe or navigating immediately releases media streams and tears down peer connections.

---

## 4. Automated test suite & verification results

### Test file: `apps/web/tests/e2e/savanna-completed-journey.spec.ts`

| # | Test Case | Target Assertion | Status |
|---|---|---|---|
| 1 | Iframe permissions, CSP compliance, and UI mounting | `iframe[title="Learning assistant"]` visible; `allow` includes `display-capture` and `microphone`; header and Close button rendered | **AUTOMATED** |
| 2 | Authenticated synthetic demo session handoff in static host embed | Status reflects `Signed in as Demo learner A (learner)`; single-use code exchanged; course material search unlocked | **AUTOMATED** |
| 3 | Cited question & answer with grounding citation check | Answer contains grounded text; `.citations` region populated with source and heading links | **AUTOMATED** |
| 4 | Asynchronous support request creation and inbox in embed | Help composer renders disclosure gate; submission confirmed; request visible in inbox | **AUTOMATED** |
| 5 | Accommodation request form submission and preview in embed | Multi-step form validates disclosure gate; preview presented; request status displayed | **AUTOMATED** |
| 6 | Controlled desktop screen sharing UI and persistent stop controls | `ScreenShare` component verifies display capture delegation and presents persistent stop control | **AUTOMATED** |
| 7 | Permission denial case: graceful degradation without capture delegation | When `allow=""` omits `display-capture`, assistant remains 100% operational for Q&A, help, and accommodations | **AUTOMATED** |

### Verification checks

All workspace automated checks execute and pass cleanly:

```bash
# Prettier code formatting
pnpm format:check
# Output: All matched files use Prettier code style!

# ESLint rules
pnpm lint
# Output: Clean pass (exit 0)

# TypeScript typechecking across web and api workspaces
pnpm typecheck
# Output: Both apps/api and apps/web typecheck clean (exit 0)

# Full unit and domain integration test suite
pnpm test
# Output:
#   apps/api: 22 test files passed, 325 tests passed
#   apps/web: 16 test files passed, 162 tests passed
#   Total: 38 test files passed, 487 tests passed
```

---

## 5. What this evidence establishes

- The assistant embed operates reliably inside the official static starter structure (`fixtures/hosts/savanna-concept.html` from `alx-africa/Savanna-static-pages`).
- `postMessage` lifecycle (mount, init, communication, close, focus restoration) is verified against the real backend API.
- The core learner journey—authentication handoff, grounded citations, human support escalation, accommodation requests, and desktop sharing controls—is fully functional within the embedded iframe.
- Origin validation and permissions policies enforce least-privilege security boundaries.

## 6. What remains unverified / out of scope

- **Production Savanna SSO (T3-004-B):** The static starter provides no identity provider or cryptographic issuer; synthetic demo sessions are used.
- **Production cloud TURN infrastructure (T3-018-D):** Tested with local relay/STUN configuration; production TURN requires cloud provisioning.
- **Organiser judging acceptance:** Acceptance of the final hackathon submission remains with the organisers.
