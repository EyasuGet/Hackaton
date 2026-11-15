# T3-018-B — Share and stop a chosen desktop screen

**Date:** 2026-11-15  
**Issue:** [#40](https://github.com/EyasuGet/Hackaton/issues/40)  
**Parent:** [T3-018 / #43](https://github.com/EyasuGet/Hackaton/issues/43)  
**Type:** Implementation evidence  
**Branch:** `feat/t3-018-b-desktop-screen-share`  

---

## Summary

Implemented desktop screen sharing under learner control connected to the validated signalling path with a persistent accessible stop control.
- **Learner control & user activation:** Capture is invoked exclusively by an explicit learner user gesture clicking the "Share screen" button. No staff initiation, remote control, or automatic capture.
- **Media constraints:** Strictly video of chosen screen only (`{ video: true, audio: false }`). No audio, no webcam, no screen recording, and no conferencing features.
- **Browser-native permission UI:** Uses standard `navigator.mediaDevices.getDisplayMedia(...)`. Cancellation or permission denial is handled gracefully with an accessible status notice and clean reset.
- **Persistent accessible stop control:** An accessible `<button>` is present whenever sharing or viewing is active. Stopping immediately terminates all active tracks (`track.stop()`), closes the peer connection, revokes the session on the backend, and updates state to stopped. Reconnection requires fresh learner action (no silent or automatic resume).
- **Native browser stop handling:** Listens to `track.onended` (when the learner clicks the browser's native floating "Stop sharing" control), triggering identical teardown.
- **Graceful disclosure for unsupported browsers:** Detects `isScreenShareSupported()` (checks secure context and `getDisplayMedia` availability). On unsupported browsers (e.g. mobile Chrome/Firefox on Android), displays an accessible disclosure notice without removing, obstructing, or disabling asynchronous text help.
- **Signalling path:** Built Clean Architecture ephemeral signal exchange (`SignalChannel` port, `MemorySignalChannel` adapter, `sendSignal` / `getSignals` use cases, and `GET /api/sharing/sessions/by-request/:helpRequestId` + `POST/GET /api/sharing/sessions/:id/signals` routes).

---

## Verified Checks

| Check | Tool / Environment | Result |
|---|---|---|
| `pnpm run typecheck` | TypeScript 6.0.3 | Passed (0 errors across api and web) |
| `pnpm run lint` | ESLint 10.14.0 | Passed (0 warnings, 0 errors) |
| `pnpm run format:check` | Prettier 3.10.1 | Passed |
| Web unit tests | Vitest 5.1.0 (jsdom) | Passed (14 test files, 117 passed) |
| API unit tests | Vitest 5.1.0 (node) | Passed (10 test files, 126 passed) |
| Sharing integration tests | Vitest 5.1.0 + PostgreSQL | Passed (11 passed, including signals and session lookup) |

---

## Evidence Boundary & Unverified Items

- **OBSERVED:** Browser media lifecycle, permission denial resilience, track cancellation, persistent stop controls, native browser stop handlers, mobile browser disclosure, and session signalling authorization verified via automated unit and PostgreSQL integration test suites.
- **UNVERIFIED / SEPARATE LEAF:** Cross-network relay NAT traversal between independent external devices (cellular vs fixed broadband) is evaluated under [T3-018-C / #42](https://github.com/EyasuGet/Hackaton/issues/42) and [T3-018-D / #41](https://github.com/EyasuGet/Hackaton/issues/41).
