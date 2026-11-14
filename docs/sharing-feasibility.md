# HTTPS and cross-network sharing feasibility

Evidence for [T3-003-C / #7](https://github.com/EyasuGet/Hackaton/issues/7), parent [T3-003 / #72](https://github.com/EyasuGet/Hackaton/issues/72), checked 2026-11-14. This is a research record, not a deployment guide or competing issue specification. GitHub remains authoritative for ownership/status. No host, relay, paid service or application feature was provisioned here.

## Outcome and evidence boundary

**A possible route exists; actual deployment and media connectivity are UNVERIFIED.** Evaluate an authorised public host running the existing Fastify/PostgreSQL application behind HTTPS, with authenticated signalling and a separately reachable TURN service when needed. No provider, budget or infrastructure account is selected. Desktop sharing remains the approved target; unsupported mobile browsers retain asynchronous text help, not equivalent screen sharing.

- **OBSERVED — repository:** base `dcb17b5ec5bf8afd0c744d53cb809b1b2013005f` (fast-forwarded from initial `8698504` after main advanced). `compose.yaml` starts only PostgreSQL on loopback; `apps/web/vite.config.ts` proxies the development API; `apps/api/src/bootstrap/app.ts` exposes health/readiness and the new demo identity/fixture routes. Main now also has the fixture-driven conversation shell and, since #119 merged, protected browser demo sessions (#9) whose exact-origin, single-use handoff applies to the hosted origin too. There is no deployed HTTPS endpoint, sharing/signalling implementation or TURN configuration in these files. Foundation, identity and fixture-shell tests cannot establish media feasibility.
- **OBSERVED — tracker:** #7 was open, Planned, unassigned with no comments; all returned PRs were checked and none implemented #7. The user then authorised assignment to `abnsol`. #41 and #42 were open/unassigned, with no comments. #5 explicitly remains open because organiser questions have not been sent. Do not duplicate its outreach.
- **DOCUMENTED:** external technical claims below come from current primary sources checked on the date above, not experiments on our service.
- **NOT RUN:** even a local capture/same-LAN probe was not run in this investigation. The earlier [starter HTTP rendering observations](static-starter-boundary.md#runtime-observations) are not media or public reachability evidence.
- **BLOCKED / UNVERIFIED:** no approved host/domain/relay access, second-network participants or organiser answer has been supplied. No actual mobile, desktop picker, TLS, callback, TURN allocation or cross-network media pass is claimed.

## HTTPS route and prerequisites

**Candidate, not adoption:** an approved VM with public ingress, Caddy for HTTPS/reverse proxy, the built web assets and Fastify backend, and persistent private PostgreSQL storage. This preserves [the agreed runtime](architecture.md#runtime-shape); production asset serving/packaging still needs implementation. Do not expose Vite's development server as the deployment.

[Caddy's HTTPS documentation](https://caddyserver.com/docs/automatic-https) describes public DNS certificate automation, renewal, challenge reachability and persistent certificate storage. For this candidate, obtain a controlled DNS name pointing at the host, public TCP 80/443 for its default challenge/HTTPS path, and durable writable Caddy storage. DNS challenges are an alternative requiring authorised DNS integration, not a reason to assume ingress works. Local certificates trusted on the developer's machine do not prove trust on another device.

Before [T3-018-D / #41](https://github.com/EyasuGet/Hackaton/issues/41) can deploy, its owner needs explicit deployment permission, account operator, DNS control, firewall authority, host resources, budget/egress cap, secret injection, storage/backups and restart ownership. Preserve private database access; document retention and operational metadata with the operator. Use only protected synthetic sessions until the real-data gates pass. Publishing starter pages additionally requires approved assets and removal of captured profiles/tokens, as recorded in [T3-002](static-starter-boundary.md).

**Alternative:** an organiser-provided managed HTTPS application host plus an approved managed TURN service can avoid VM/certificate/relay operation. Verify persistent database support, authenticated signalling transport, timeouts, outbound/inbound policy, processing region, metadata retention, credential expiry and cost before selecting one. A static-only host cannot run Fastify/PostgreSQL; an HTTP reverse proxy or tunnel is not by itself a TURN relay. Free credits are not confirmed capacity or spending approval. Evaluation result: neither route is access-tested; prefer evaluating supplied infrastructure first, otherwise request a bounded VM/relay proposal rather than provisioning speculatively.

Public callback reachability is distinct from outbound web access and media. A successful documentation fetch proves only access to that documentation site. #41 must record the real endpoint and external health/readiness response; any enabled callback must additionally prove its actual incoming request/authentication path. Telegram callbacks remain a separate time-permitting capability, not a prerequisite for core sharing.

## Capture, embed and mobile constraints

The [W3C Screen Capture working draft](https://www.w3.org/TR/screen-capture/) specifies secure-context display capture, user activation, browser-mediated source selection and non-persistent capture permission. A method existing is not a successful capture: denial, OS restrictions, unavailable sources and policy blocks need an honest fallback. Fresh learner action is required; no automatic resume after disconnect.

[Secure Contexts](https://www.w3.org/TR/secure-contexts/) distinguishes trustworthy loopback development contexts from ordinary HTTP origins and considers ancestor contexts. Therefore a localhost pass is not an HTTP LAN-IP or public HTTPS pass. Test the actual HTTPS host and iframe, not just the standalone page. Check CSP/frame restrictions and `display-capture` delegation (default allowlist `self` in the Screen Capture draft); permission delegation cannot override a blocking ancestor policy or add a missing browser API. Microphone delegation is separate. Keep exact-origin authentication and the protected synthetic-session boundary; never accept `null`/`file://` as an authentication shortcut.

Browser compatibility must be checked per platform/version, not inferred from desktop WebRTC or camera support. The current [MDN compatibility source for MediaDevices](https://github.com/mdn/browser-compat-data/blob/main/api/MediaDevices.json) marks `getDisplayMedia` unsupported on Chrome Android and Firefox Android. It lists Safari iOS support starting at 27; that data alone is not tested device availability or evidence for this project. Do not generalise Android limitations to every future phone browser. Receiving a remote video also does not establish the ability to capture that phone's screen.

No target phone was exercised here. In #40/#42, record actual OS/browser versions and capability/permission outcome. On unsupported browsers, keep the bilingual asynchronous inbox usable and explain the limitation; test with actual Android/TalkBack. A native app or third-party meeting service would change scope/privacy and is not adopted as an automatic workaround. Organiser approval of the fallback remains missing.

## Signalling and relay prerequisites

[WebRTC's TURN guidance](https://webrtc.org/getting-started/turn-server) distinguishes direct connections from relayed traffic when peers cannot connect directly. STUN discovery alone does not guarantee traversal. Authenticated backend signalling authorises the participants and exchanges negotiation data; media uses the direct/relay path, not the tutor or an application recording service. Existing project requirements for short-lived signalling permission and temporary relay credentials remain binding.

**Candidate relay:** coturn on authorised public infrastructure. Its [configuration reference](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf) documents the usual 3478 listener, 5349 TLS listener, configurable UDP relay allocation range (default 49152–65535), external/private address mapping and time-limited credential support. The deployment owner must choose and open the actual protocols/ports and relay range, map advertised addresses correctly behind NAT, configure certificates for TLS, and test them from the intended networks. Do not blindly open defaults or assume HTTPS port 443 covers media. TURN/TLS on 443, if needed for restricted networks, needs a compatible listener/IP arrangement separate from a normal HTTPS proxy; it is not a promise to traverse every firewall.

Keep shared credential-issuing secrets server-side, issue expiring credentials only to authorised participants, and do not run an anonymous relay. Bound allocations/bandwidth, restrict prohibited peer destinations and review metadata logging/retention and egress cost with the operator. Credential expiry is not sufficient to stop an already active sharing session: enforce application/session revocation and stop tracks on stop, closure, access loss or disconnect. No capture frames, SDP, ICE addresses, tokens or credentials belong in routine evidence/logs.

## Available probes and proof required later

All steps in this table are **planned, NOT RUN**. Use synthetic content and consenting participants; do not paste secrets into third-party diagnostic sites.

| Layer | Minimal check after approval/implementation | What it does not prove |
|---|---|---|
| Browser capability | On each actual device/origin, record `isSecureContext` and whether `navigator.mediaDevices?.getDisplayMedia` exists; user clicks a capture control and grants/denies permission | Method presence is not picker success, mobile acceptance or connectivity |
| Local / same LAN | Authorised learner/staff sessions capture a synthetic tab and stop; label both network locations | No public callback, NAT traversal or relay evidence |
| Public HTTPS | From a different network run `curl --fail --show-error https://APPROVED_HOST/api/health` and `/api/ready`; expect valid certificate and correct response. Inspect the actual embedded origin/headers in a browser | A 200 or TLS handshake is not capture, signalling authorisation or media |
| Relay availability | Using approved expiring credentials, gather relay candidates and verify an actual TURN allocation | A relay candidate alone does not establish media flowed through it |
| Cross-network media | Two actual devices on independent networks (e.g. fixed broadband and cellular, not the same Wi-Fi) share a synthetic tab through the real authorised workflow; staff verifies visible updates | A direct connection pass does not prove the TURN fallback |
| Forced relay | In a controlled diagnostic configuration use `iceTransportPolicy: 'relay'`; verify selected relay candidate pair and increasing media counters alongside visible updates | Does not prove all networks, all browsers or production capacity |
| Lifecycle / accessibility | Stop from app and browser; deny picker; disconnect; revoke staff; close request; attempt stale rejoin. Verify capture/session end and no silent resume. Check keyboard, visible state and real phone text-help path | Automated/fake lifecycle tests do not replace actual device/co-designer acceptance |

Use [WebRTC statistics](https://www.w3.org/TR/webrtc-stats/) to identify the selected candidate pair, candidate type and media counters. Record only sanitised summaries: date, application revision, exact device/browser versions, network categories, direct/relay transport, observed start/stop result and verifier. Do not retain raw SDP/ICE dumps, IPs, screen recordings or credential-bearing logs. A failing/restricted network must remain a reported failure, not be replaced silently with a same-LAN run.

## Missing answers, owner and next actions

These are evidence findings and proposed escalations, not remote status edits. #41 deployment and #42 live acceptance are currently blocked by the listed prerequisites; #7 is not ready to close until its outreach/human evidence and review/completion workflow are satisfied. Do not mark the mixed parent epic complete or start unrelated leaves in this scoped task.

| Missing item | Responsible contact / next action | Downstream gate |
|---|---|---|
| Approved host, DNS, secret/storage operator and spending/network authority | `abnsol` coordinates with the organiser technical contact (identity/channel not supplied). Ask whether infrastructure is supplied; otherwise present the candidate and request explicit deployment/budget approval | #41; final publication remains separately authorised in #67 |
| Usable relay or justified direct-only environment | #41 owner when claimed, coordinated by `abnsol`: obtain operator, endpoints, transport/range, credential lifecycle, retention and egress cap; run actual relay/blocked-UDP tests where applicable | #42 and core sharing evidence; no unsupported universal traversal claim |
| Mobile fallback acceptance | `abnsol` coordinates with the #5 owner to send its existing screen-sharing question once; record date/channel, exact answer and affected acceptance in #7/#42 | #42 and full-brief #100; no waiver inferred |
| Devices / two independent networks / human verifier | `abnsol` arranges consenting learner/staff testers and actual Android/TalkBack device; #42 owner records results after #39–41 land | V04, #42 and applicable accessibility/core gates |

**Next check-in:** 2026-11-15 at 12:00 Africa/Addis_Ababa (UTC+03:00), proposed for `abnsol` to record organiser-contact and infrastructure-access progress on #7; not a scheduled reminder. Escalate missing permission/access rather than spending or claiming a pass.

**Outreach handoff — NOT SENT:** reuse [the existing organiser question](static-starter-boundary.md#questions-still-to-send-to-the-organisers): is learner-controlled supported-desktop sharing plus asynchronous text help on unsupported phones acceptable for Track 3? Add: will an approved public HTTPS host/domain and TURN relay be supplied; who controls DNS/firewall/secrets, what budget/egress/retention constraints apply, and which mobile/browser/device surface is required? Request a written answer with date/channel. No verified organiser destination was supplied, so this investigation has prepared, not delivered, that request.

## Verification and completion limits

Environment: macOS (`uname -s` → `Darwin`), branch `codex/issue-7-sharing-feasibility`, base above. Baseline `git diff --check` passed. `command -v node` found no Node executable; `test -d node_modules` found no installed workspace dependencies. No packages were installed. Application checks (`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`) were not run: this documentation-only change uses source/link/instruction consistency checks under verification rule 9, and application dependencies are absent. Markdown is excluded by `.prettierignore`. CI and post-merge verification remain pending, not inferred from earlier foundation runs.

Human Verify: read this record and identify the candidate host/relay route, why local success cannot pass cross-network acceptance, the unsupported-phone fallback, and who must obtain each missing answer. No teammate read-through or organiser acceptance is recorded yet. The independent review results and exact candidate fingerprint belong in #7 or its eventual PR, not an invented live test pass.
