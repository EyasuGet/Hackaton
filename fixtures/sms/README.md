# Approved Ethiopian SMS Route Fixtures

Documented provider fixtures for AfroMessage (the approved Ethiopian SMS gateway identified in `docs/architecture.md`).
Used for deterministic contract verification (T3-015-A, #83) without making unconsented live outbound calls or leaking server-side credentials.

## Route Specification

- **Provider:** AfroMessage (https://afromessage.com/developers)
- **Base URL:** `https://api.afromessage.com`
- **Send endpoint:** `POST /api/send`
  - Headers:
    - `Authorization: Bearer <AFROMESSAGE_API_TOKEN>`
    - `Content-Type: application/json`
  - Payload schema:
    ```json
    {
      "to": "+2519XXXXXXXX",
      "message": "Message text...",
      "sender": "Track3",
      "callback": "https://api.example.com/api/sms/callback"
    }
    ```
- **Status endpoint:** `GET /api/status?id={MESSAGE_ID}`
  - Headers:
    - `Authorization: Bearer <AFROMESSAGE_API_TOKEN>`
- **Delivery Report (DLR) webhook callback:** `POST /api/delivery/sms/webhook`
- **Inbound SMS / Opt-Out callback:** `POST /api/delivery/sms/inbound`

## Fixture Inventory

- `afromessage-send-success.json`: Successful dispatch queuing response from `/api/send`.
- `afromessage-send-error-unverified-sender.json`: Sender ID rejection error response.
- `afromessage-send-error-invalid-recipient.json`: Destination validation error response.
- `afromessage-status-delivered.json`: Status query response confirming `DELIVRD`.
- `afromessage-status-undeliv.json`: Status query response indicating `UNDELIV`.
- `afromessage-status-expired.json`: Status query response indicating `EXPIRED`.
- `afromessage-status-rejected.json`: Status query response indicating `REJECTD`.
- `afromessage-status-in-progress.json`: Status query response indicating queued/in-progress.
- `afromessage-status-not-found.json`: Status query error for non-existent message ID.
- `afromessage-dlr-webhook-delivered.json`: DLR webhook callback payload for confirmed delivery (`DELIVRD`).
- `afromessage-dlr-webhook-undeliv.json`: DLR webhook callback payload for failed delivery (`UNDELIV`).
- `afromessage-dlr-webhook-expired.json`: DLR webhook callback payload for expired validity (`EXPIRED`).
- `afromessage-dlr-webhook-rejected.json`: DLR webhook callback payload for policy rejection (`REJECTD`).
- `afromessage-inbound-opt-out-stop.json`: Inbound MO SMS webhook carrying English `STOP` opt-out.
- `afromessage-inbound-opt-out-amharic.json`: Inbound MO SMS webhook carrying Amharic `አቁም` opt-out.

## Provider Status Mapping

AfroMessage envelopes every response with `acknowledge` (`"success"` | `"error"`):

| AfroMessage Status | Envelope `acknowledge` | Normalized `SmsDeliveryStatus` | Semantic Meaning |
|---|---|---|---|
| `"Send in progress..."` | `"success"` | `'queued'` | Accepted by gateway; dispatch to carrier in progress |
| `"DELIVRD"` / `"Delivered"` | `"success"` | `'delivered'` | Handset receipt confirmed by carrier |
| `"UNDELIV"` / `"Undelivered"`| `"success"` | `'undelivered'` | Carrier unable to deliver to destination |
| `"EXPIRED"` | `"success"` | `'expired'` | Expired before handset delivery |
| `"REJECTD"` / `"Rejected"` | `"success"` | `'rejected'` | Rejected by gateway or operator |
| `"FAILED"` | `"success"` | `'failed'` | Gateway transmission failure |
| Network error / 5xx / 429 | N/A | `'unknown'` | In-flight / uncertain; safe for status polling |

## Live Verification Boundary

These contract fixtures prove payload validation, encoding calculation, and provider response mapping. Real outbound transmission to a consenting Ethiopian destination handset with verified credentials belongs to **T3-015-B** (#84).
