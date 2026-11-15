# T3-003-D — Telegram access and callback strategy

**Date:** 2026-11-15  
**Issue:** [#70](https://github.com/EyasuGet/Hackaton/issues/70)  
**Type:** Feasibility evidence  
**Status:** Findings recorded; adapter runnable with prerequisites met

---

## Summary

A team-controlled Telegram bot can be created today using BotFather at no cost. For development, long-polling (getUpdates) is the correct choice because it requires no public HTTPS endpoint. Webhooks are viable for a hosted deployment once a public HTTPS URL is provisioned. Ethiopia-specific access risk exists (documented past internet shutdowns), but Telegram is the dominant messaging platform there and the right channel for this audience.

---

## 1. Bot creation and credential ownership

**Process:**
1. Open Telegram, start a chat with `@BotFather`.
2. Send `/newbot`, supply a display name and a unique username ending in `bot`.
3. BotFather issues a token of the form `<bot_id>:<hash>`.
4. The token can be regenerated at any time via `/revoke` in BotFather; the old token is immediately invalidated.

**Credential ownership:**
- The token is owned by whichever Telegram account created the bot. For this project that must be the team account, not a personal account.
- The token must be stored as an environment secret, never committed to source control.
- Credential transfer between team members is done by revoking and reissuing a token, or by handing over the owning Telegram account.

**Authentication mechanism:**
- Incoming updates from Telegram do not carry an authentication header by default for getUpdates.
- For webhooks, Telegram supports an optional `secret_token` parameter on `setWebhook`; the value is included in every incoming `X-Telegram-Bot-Api-Secret-Token` header, which the adapter must validate.

---

## 2. Incoming-update strategy: long-polling vs webhook

### Long-polling (getUpdates)

The bot polls `https://api.telegram.org/bot<token>/getUpdates` with a timeout parameter (typically 25–30 seconds). Telegram holds the connection open and returns as soon as an update arrives or the timeout elapses.

| Property | Detail |
|---|---|
| Public endpoint required | No — the bot initiates all connections outward |
| HTTPS certificate required | No (uses Telegram's servers over HTTPS) |
| Local development | Works immediately with no tunnel or static IP |
| Update delivery | Sub-second when timeout is set to 25–30 s; comparable to webhooks in practice |
| Acknowledged updates | Each `getUpdates` call must pass `offset = last_update_id + 1`; unacknowledged updates are re-delivered |
| Conflict with webhook | A webhook must be deleted (`deleteWebhook`) before `getUpdates` will return updates |
| Reliability | Polling loop restarts automatically on network error; no external retry infrastructure needed |

Long-polling is the right choice for the development phase and for any deployment without a stable public HTTPS URL.

### Webhooks (setWebhook)

Telegram sends an HTTPS POST to the bot's registered URL for each incoming update.

| Property | Detail |
|---|---|
| Public endpoint required | Yes — Telegram must be able to reach the URL |
| Allowed ports | 443, 80, 88, 8443 |
| TLS version | 1.2 or later |
| Certificate | Trusted CA certificate, or a self-signed certificate uploaded with `setWebhook` |
| Redirects | Telegram does not follow 301/302; the URL must serve the endpoint directly |
| Telegram source IPs | 149.154.160.0/20 and 91.108.4.0/22 (IPv4 only) |
| Local development | Requires a tunnel (e.g. ngrok) to expose a local HTTPS port — additional setup |
| Secret token | Set `secret_token` in `setWebhook` and validate `X-Telegram-Bot-Api-Secret-Token` header |

Webhooks are the correct choice for a production deployment where a stable public HTTPS URL is available, and they eliminate the polling loop from the server process.

### Mutual exclusivity

The two modes are mutually exclusive. `getUpdates` returns nothing while a webhook is registered. Use `deleteWebhook` before switching to polling; use `setWebhook` before switching to webhook mode.

---

## 3. Recommended strategy

| Phase | Strategy | Reason |
|---|---|---|
| Development | Long-polling | No public endpoint needed; works in any environment |
| CI / integration tests | Long-polling or mocked adapter | Avoids certificate and DNS provisioning in test environments |
| Hosted MVP (if implemented) | Webhook | Telegram's preferred production mode; no polling loop holding a connection |

The adapter interface must be stable in both modes. The application use cases must not know which update mechanism is active. The delivery worker described in the architecture (time-permitting) uses the same adapter for outbound replies regardless of the inbound mechanism.

---

## 4. Ethiopia-specific access considerations

**Telegram is the dominant messaging platform in Ethiopia.** Key findings:
- Roughly 20.86 million Telegram users at the start of 2023 (approximately 16.7% penetration), making it the most used messaging app in the country.
- Low bandwidth suitability: users cite cheaper data consumption vs. WhatsApp/Messenger; Telegram's client is significantly smaller (~49 MB vs. ~103–125 MB for competitors).
- Average mobile data speed is approximately 19.1 Mbps (Ookla data), sufficient for Telegram text use.
- Cybercafé access is common outside cities; hourly rates are low (~7–10 ETB).

**Access risk — internet shutdowns:**
- Telegram was blocked in Ethiopia from approximately February 2023 until at least July 2023, alongside Facebook, TikTok, and YouTube.
- VPN usage is common during restriction periods.
- The spec already treats Telegram as time-permitting; learners on the web path are unaffected by Telegram restrictions.

**Conclusion for this project:**
Telegram is the correct channel for Ethiopian learners. The access risk is real but bounded: the Telegram channel supplements the web path and learners are not forced to use it. Generic notifications must not include message bodies or sensitive details per spec R04.5.

---

## 5. Test-account consent and learner linking

The issue requires documenting that bot creation is not equivalent to linked learner access.

- Creating a bot proves the channel is reachable; it does not link any learner to the bot.
- Learner linking requires a secure one-time flow per spec R03: "Secure one-time linking associates a channel account with a learner; names/usernames do not authenticate a learner."
- Duplicate events must not duplicate effects (idempotency required at the use-case level).
- Test-account consent: any test interactions with the bot must be performed by a consenting team member who understands the bot is a development instance. No real learner data or conversations may be used in testing without explicit consent and synthetic-data controls.
- The bot must display a clear description identifying it as a development/demo instance during the test phase.

---

## 6. Prerequisites for implementing the Telegram adapter

The following must be in place before implementation begins:

| # | Prerequisite | Status |
|---|---|---|
| P1 | Team Telegram account holds the bot token; token stored as a secret | Not yet done |
| P2 | Delivery outbox schema (T3-014-A) persists intents | Dependent — check T3-014-A issue status |
| P3 | Application use-case interfaces are defined (channel adapter port) | Dependent on core use-case issues |
| P4 | For hosted deployment: public HTTPS URL with valid TLS certificate on port 443 | Required for webhook mode only; not required for development polling |
| P5 | Test-account consent documented; synthetic fixtures used in tests | Required before any integration test |

---

## 7. Verdict

**Runnable** — the Telegram adapter is feasible and unblocked from a technical standpoint.

- Long-polling for development requires no infrastructure beyond the bot token.
- Webhook for production requires HTTPS hosting (already listed as an external gate in decisions.md under "Hosting").
- Ethiopia access risk is acknowledged and bounded by the time-permitting classification and the existing web fallback path.
- No paid services are required for the bot itself.

This leaf is complete. Creating the bot and storing the token (P1) is the first implementation step, requiring a team action, not code.

---

## References

- [core.telegram.org/bots — official Bot API](https://core.telegram.org/bots/api)
- [core.telegram.org/bots/webhooks — official webhook guide](https://core.telegram.org/bots/webhooks)
- [grammY deployment types: long-polling vs webhook](https://grammy.dev/guide/deployment-types)
- [hostman.com — polling vs webhook comparison](https://hostman.com/tutorials/difference-between-polling-and-webhook-in-telegram-bots/)
- [Quartz — Ethiopia prefers Telegram](https://qz.com/africa/1214381/in-a-continent-dominated-by-whatsapp-ethiopia-says-yes-to-telegram/)
- [addisinsight.net — Why Telegram is popular in Ethiopia](https://addisinsight.net/2022/06/why-telegram-is-so-popular-in-ethiopia)
- [Internet Society — Social media blocking in Ethiopia, February 2023](https://pulse.internetsociety.org/shutdowns/social-media-blocking-in-ethiopia-february-2023)
- [latenode.com — getUpdates vs setWebhook](https://community.latenode.com/t/evaluating-getupdates-versus-setwebhook-in-telegram-bot-api/3850)
