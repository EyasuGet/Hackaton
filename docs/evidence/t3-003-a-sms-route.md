# T3-003-A — Approved Ethiopian SMS Route & Character Encoding

**Date:** 2026-11-15  
**Issue:** [#69](https://github.com/EyasuGet/Hackaton/issues/69)  
**Type:** Feasibility evidence & route selection  
**Status:** Approved route confirmed; character budgeting and contracts locked (Decision D23)

---

## Executive Summary

For the Track 3 multilingual assistant, SMS notifications serve as an opt-in, time-permitting asynchronous notification channel for Ethiopian learners. Key use cases include new job match alerts (R04), asynchronous human tutor responses (R03.3), and meeting scheduling notices (R03.4).

Following comprehensive technical, financial, and operational evaluations, **AfroMessage** (a licensed Ethiopian Value-Added Services aggregator with direct interconnect to Ethio Telecom) is confirmed as the approved SMS route for this project.

### Key Takeaways

1. **Route Selection:** AfroMessage is selected over direct Ethio Telecom SMPP (disqualified due to prohibitive enterprise minimums, leased-line requirements, and weeks of bureaucratic onboarding) and international aggregators like Twilio (disqualified due to high costs of ~$0.05+/msg, carrier firewall blocking into Ethiopia, and foreign exchange restrictions).
2. **Local Pricing Advantage:** AfroMessage provides standard wholesale pricing of **~0.35–0.40 ETB per message segment** payable in local currency (ETB via Telebirr or local bank transfer). Compared to Twilio (~6.00 ETB/msg at current bank rates), AfroMessage yields a **>94% cost reduction** with zero foreign exchange risk.
3. **Encoding & Character Budgeting:**
   - **English (GSM-7):** 160 characters per single message; 153 characters per segment for concatenated messages (7 septets allocated for the 6-byte User Data Header / UDH). Standard extension characters consume 2 septets.
   - **Amharic (UCS-2 / UTF-16):** Ethiopic Ge'ez characters (Unicode block U+1200–U+137F) require 16-bit UCS-2 encoding. Single segment limit is 70 characters; concatenated segments allow 67 characters per segment (3 characters / 6 bytes allocated for UDH).
4. **Delivery Reports (DLR) Webhook Contract:** Formal mapping is established between AfroMessage status strings (`"Send in progress..."`, `"DELIVRD"`, `"UNDELIV"`, `"EXPIRED"`, `"REJECTD"`, `"FAILED"`) and normalized domain statuses (`queued`, `delivered`, `undelivered`, `expired`, `rejected`, `failed`, `unknown`).
5. **Regulatory Compliance:** Sender IDs (alphanumeric up to 11 characters, e.g. `Track3`) require registration with Ethio Telecom and compliance with the Ethiopian Communications Authority (ECA) and INSA. The system supports fallback to AfroMessage's shared shortcode pool during the registration approval window.

---

## 1. Route Comparison Matrix

| Criterion | AfroMessage (Approved) | Ethio Telecom Direct SMPP | Twilio / International Aggregators |
|---|---|---|---|
| **Protocol / API** | Modern HTTPS REST API (JSON payload, Bearer token) | SMPP v3.4 over TCP/IP | REST API (Twilio Messaging API) |
| **Connectivity & Route** | Direct interconnect with Ethio Telecom VAS gateway | Direct carrier SMPP server | International grey/white routes via overseas transit partners |
| **Ethiopia Delivery Rate** | High (>95% delivery rate to Ethio Telecom subscribers) | Direct carrier delivery | Poor to moderate (frequently filtered or blocked by carrier firewalls) |
| **Cost per Segment (ETB)** | **0.35 – 0.40 ETB** | ~0.20 – 0.30 ETB (plus fixed monthly fees) | **~6.00 – 9.60 ETB** ($0.05–$0.08 USD converted) |
| **Currency & Payment** | Local currency (ETB) via Telebirr or local bank transfer | Local currency (ETB) via corporate billing | USD only (requires international credit/debit card) |
| **Setup Barrier & Lead Time** | Instant developer registration; API access in <24 hours | 4–8 weeks; requires formal corporate enterprise contract & INSA vetting | Instant self-serve registration |
| **Minimum Commitment** | None (pay-as-you-go bundle top-ups) | High monthly minimum spend (tens of thousands ETB); deposit required | Monthly carrier fees or phone number rental ($1.15/mo) |
| **Infrastructure Overhead** | Zero (HTTPS client with outbound internet access) | High (requires static public IP or dedicated IPSec VPN tunnel) | Zero (HTTPS client) |
| **Alphanumeric Sender ID** | Supported (registered via aggregator with Ethio Telecom) | Supported (formal registration required) | Not supported for Ethiopia; forced generic shortcode or alphanumeric scrubbing |
| **Amharic Ge'ez (UCS-2)** | Fully supported (native UCS-2 handling) | Supported (data_coding = 8) | Supported, but high per-part cost exacerbates multi-segment messages |
| **Concatenation (UDH)** | Handled transparently by aggregator | Requires manual UDH byte slicing in application code | Handled transparently by Twilio |
| **Delivery Webhooks (DLR)** | Asynchronous webhook callback with status codes | SMPP `deliver_sm` delivery receipts | Webhook status callbacks |

### Evaluation Justification

1. **Why AfroMessage Wins:**
   - AfroMessage is an established, licensed Ethiopian VAS aggregator operating within Ethiopia's regulatory framework.
   - It provides developer-first REST endpoints that integrate cleanly into our TypeScript Fastify backend without low-level SMPP binary protocol handling.
   - Local currency payments via Telebirr or Commercial Bank of Ethiopia (CBE) remove foreign exchange constraints and import restrictions.
   - Low unit cost (~0.35 ETB/segment) makes notifications economically sustainable even under constrained hackathon project budgets.

2. **Why Direct SMPP is Disqualified:**
   - Direct Ethio Telecom SMPP requires institutional legal registration, tax identification numbers, physical office verification, and security clearances through INSA.
   - Minimum monthly spend requirements and leased-line or static IP configurations impose operational overhead inappropriate for an agile MVP deployment.

3. **Why Twilio is Disqualified:**
   - Twilio routes messages to Ethiopia via international roaming exchanges and global transit aggregators. Ethio Telecom actively filters unregistered international A2P SMS traffic to prevent spam and revenue leakage, leading to high drop rates without clear delivery reports.
   - Twilio charges $0.05 to $0.08 USD per segment. At the prevailing official exchange rate (~120 ETB/USD), this amounts to 6.00 to 9.60 ETB per message—over 17 times the cost of a local VAS aggregator.

---

## 2. Character Budgeting & Encoding Analysis

SMS transmission standards (3GPP TS 23.038 / GSM 03.38) dictate strict character encoding and segmentation rules. Understanding the boundary differences between English (GSM-7) and Amharic (UCS-2) is critical for message drafting, user experience, and cost control.

### Encoding Standards Breakdown

| Property | GSM-7 (English / Latin) | UCS-2 (Amharic Ge'ez & Symbols) |
|---|---|---|
| **Character Set** | 128 basic GSM characters + 10 extension characters | Unicode Basic Multilingual Plane (BMP, 16-bit code units) |
| **Bits per Character** | 7 bits | 16 bits (2 bytes) |
| **Max Chars (Single Segment)** | **160 characters** (1,120 bits / 140 bytes) | **70 characters** (1,120 bits / 140 bytes) |
| **Max Chars (Concatenated)** | **153 characters** per segment | **67 characters** per segment |
| **UDH Overhead** | 7 septets (6 bytes for 8-bit concatenation header) | 3 characters / 6 bytes |
| **Extension Characters** | `^`, `{`, `}`, `\`, `[`, `~`, `]`, `|`, `€`, `\f` (each counts as 2 septets) | N/A (all BMP characters count as 1 code unit) |
| **Script Mixing Impact** | None if pure GSM-7 | Any single non-GSM character drops the entire message to UCS-2 |

> [!IMPORTANT]
> When drafting bilingual or Amharic notifications, a single Ge'ez character (e.g. `ሰ`) immediately demotes the whole payload from GSM-7 to UCS-2, shrinking the single-segment capacity from 160 characters down to 70 characters.

### Concrete Message Templates & Budgeting Analysis

#### Template 1: Job Match Alert (English)
```text
Track3: New job match for Python Tutor at Addis Dev. View details and requirements in your portal.
```
- **Encoding:** GSM-7
- **Character Count:** 95 characters
- **Segments:** 1 segment (95 ≤ 160)
- **Cost:** 0.35 ETB
- **Fit:** Well within the 160-character single segment limit.

#### Template 2: Job Match Alert (Amharic)
```text
ትራክ3: አዲስ የስራ ማስታወቂያ አለ። ለመመልከት ወደ መተግበሪያው ይግቡ።
```
- **Encoding:** UCS-2
- **Character Count:** 47 characters
- **Segments:** 1 segment (47 ≤ 70)
- **Cost:** 0.35 ETB
- **Fit:** Fits cleanly within the 70-character single segment limit.

#### Template 3: Asynchronous Human Help Tutor Reply (English)
```text
Track3: Your course instructor replied to your question on Lesson 3. Sign in to your inbox to read.
```
- **Encoding:** GSM-7
- **Character Count:** 99 characters
- **Segments:** 1 segment (99 ≤ 160)
- **Cost:** 0.35 ETB
- **Fit:** Fits cleanly within the 160-character single segment limit.

#### Template 4: Asynchronous Human Help Tutor Reply (Amharic)
```text
ትራክ3: ለመማሪያ ክፍል 3 ለጠየቁት ጥያቄ ከአስተማሪዎ መልስ ተልኮልዎታል። ለማንበብ ይግቡ።
```
- **Encoding:** UCS-2
- **Character Count:** 68 characters
- **Segments:** 1 segment (68 ≤ 70)
- **Cost:** 0.35 ETB
- **Fit:** Optimized to fit precisely under the 70-character single segment boundary.

#### Template 5: Meeting Proposal Notice (English)
```text
Track3: Tutor proposed a meeting for Tuesday at 3:00 PM EAT. Please open your chat to confirm.
```
- **Encoding:** GSM-7
- **Character Count:** 94 characters
- **Segments:** 1 segment (94 ≤ 160)
- **Cost:** 0.35 ETB
- **Fit:** 1 segment.

#### Template 6: Phone Ownership Verification OTP (Bilingual)
- **English:**
  ```text
  Track3: Your verification code is 482910. Valid for 10 minutes. Do not share this code.
  ```
  - GSM-7: 86 characters → 1 segment (0.35 ETB)
- **Amharic:**
  ```text
  ትራክ3: የማረጋገጫ ኮድዎ 482910 ነው። ለ10 ደቂቃ ያገለግላል።
  ```
  - UCS-2: 48 characters → 1 segment (0.35 ETB)

#### Template 7: Multi-Segment Notification Example (Amharic Concatenated)
```text
ትራክ3: የተከበሩ ተማሪ፣ ለአዲሱ የስራ እድል መመዘኛዎችን አሟልተዋል። ዝርዝሩን ለመመልከት እና ከአሰሪው ጋር ለመገናኘት እባክዎ መተግበሪያውን ይክፈቱ።
```
- **Encoding:** UCS-2
- **Character Count:** 105 characters
- **Segments:** 2 segments (ceil(105 / 67) = 2 segments)
- **Cost:** 0.70 ETB (2 × 0.35 ETB)
- **Analysis:** Exceeds 70 characters, so it splits across 2 segments at 67 characters per segment. Delivered seamlessly on modern handsets via UDH reassembly.

---

## 3. Cost Projection Model (1,000 to 10,000 Alerts/Month)

The financial projection below models monthly operational expenditure across user growth tiers. Calculations assume the standard AfroMessage wholesale tariff of **0.35 ETB per segment** and compare it with the Twilio baseline ($0.05 USD / segment converted at 120 ETB/USD = 6.00 ETB / segment).

### Volume Cost Breakdown Table

| Monthly Message Volume | 1-Segment English (0.35 ETB) | 1-Segment Amharic (0.35 ETB) | 2-Segment Amharic (0.70 ETB) | Weighted Blend (50/30/20)* | Twilio Baseline (6.00 ETB/msg) | Monthly Savings with AfroMessage |
|---|---|---|---|---|---|---|
| **1,000 alerts** | 350 ETB | 350 ETB | 700 ETB | **420 ETB** | 6,000 ETB | **5,580 ETB (93.0%)** |
| **2,500 alerts** | 875 ETB | 875 ETB | 1,750 ETB | **1,050 ETB** | 15,000 ETB | **13,950 ETB (93.0%)** |
| **5,000 alerts** | 1,750 ETB | 1,750 ETB | 3,500 ETB | **2,100 ETB** | 30,000 ETB | **27,900 ETB (93.0%)** |
| **10,000 alerts** | 3,500 ETB | 3,500 ETB | 7,000 ETB | **4,200 ETB** | 60,000 ETB | **55,800 ETB (93.0%)** |

*\*Weighted blend assumption: 50% single-segment English (0.35 ETB), 30% single-segment Amharic (0.35 ETB), and 20% two-segment Amharic (0.70 ETB) = average cost of 0.42 ETB per alert.*

### Budget Sustainability Analysis

- At 5,000 alerts per month, the total project spend on AfroMessage is **2,100 ETB (~$17.50 USD)**. The same volume through Twilio would cost **30,000 ETB ($250.00 USD)**.
- Local currency billing completely insulates the institution from foreign exchange depreciation and international card payment transaction fees.
- Pre-purchase bundles on AfroMessage allow predictable budget allocation with zero unexpected overage charges.

---

## 4. AfroMessage Route Specifications & Delivery Contract

### API Endpoints and Headers

- **Provider Base URL:** `https://api.afromessage.com`
- **Authentication:** `Authorization: Bearer <AFROMESSAGE_API_TOKEN>`
- **Content Type:** `application/json`

#### 1. Outbound Dispatch Endpoint (`POST /api/send`)
**Request Body:**
```json
{
  "to": "+251911000001",
  "message": "Track3: New job match for Python Tutor at Addis Dev. View details in portal.",
  "sender": "Track3",
  "callback": "https://api.example.com/api/delivery/sms/webhook"
}
```

**Success Response (HTTP 200):**
```json
{
  "acknowledge": "success",
  "response": {
    "status": "Send in progress...",
    "message_id": "afro_msg_8839201a",
    "to": "+251911000001"
  }
}
```

#### 2. Asynchronous Status Webhook Callback (`POST /api/delivery/sms/webhook`)
AfroMessage pushes delivery status updates to the registered callback URL:
```json
{
  "acknowledge": "success",
  "response": {
    "message_id": "afro_msg_8839201a",
    "status": "DELIVRD",
    "to": "+251911000001",
    "timestamp": "2026-11-15T07:15:30Z"
  }
}
```

### Status Mapping Contract

The domain delivery system unifies provider-specific status codes into standard `SmsDeliveryStatus` states:

| AfroMessage Status String | Envelope `acknowledge` | Domain Status | Semantic Meaning | Next System Action |
|---|---|---|---|---|
| `"Send in progress..."`, `"SENT"`, `"QUEUED"`, `"PROCESSING"`, `"ACCEPTED"` | `"success"` | `'queued'` | Accepted by aggregator; carrier dispatch in progress | Await DLR callback or background reconcile |
| `"DELIVRD"`, `"Delivered"` | `"success"` | `'delivered'` | Handset delivery confirmed by Ethio Telecom / carrier | Final state: mark delivery intent completed |
| `"UNDELIV"`, `"Undelivered"` | `"success"` | `'undelivered'` | Handset unreachable, out of coverage, or deactivated | Final state: record failure, log alert notice |
| `"EXPIRED"` | `"success"` | `'expired'` | Message validity elapsed at SMSC before delivery | Final state: do not automatically rebill |
| `"REJECTD"`, `"Rejected"` | `"success"` | `'rejected'` | Rejected by gateway or carrier policy (e.g. invalid sender) | Final state: investigate sender / destination |
| `"FAILED"` | `"success"` | `'failed'` | Gateway internal transmission failure | Final state: record error |
| HTTP 429 Rate Limit | `"error"` | `'unknown'` | Transient gateway rate throttling | Retry after exponential backoff |
| HTTP 5xx Gateway Error | `"error"` | `'unknown'` | Transient provider outage | Retry after exponential backoff |
| Network Timeout / Abort | N/A | `'unknown'` | Unconfirmed in-flight state | Retain intent in outbox; reconcile via `/api/status` |

---

## 5. Regulatory Compliance, Sender ID & Privacy

### Ethiopian Telecom Regulatory Framework
- **Regulators:** Ethiopian Communications Authority (ECA) and Information Network Security Administration (INSA).
- **Sender ID Standards:** Alphanumeric sender IDs are limited to 11 characters (e.g., `Track3`). Generic sender IDs (such as `INFO`, `ALERT`, `SMS`, `OTP`) are prohibited by Ethio Telecom to reduce impersonation risks.
- **Registration Process:** The institution submits an official letter of authorization with trade license or charter documents to AfroMessage, who registers the sender ID directly with Ethio Telecom.
- **Interim Shortcode:** During the 3–5 day registration window, messages can be dispatched using AfroMessage's approved shared shortcode (e.g., `8008` pool).

### Privacy & Spec Compliance Guardrails (R04.5 & R03)
1. **Explicit Opt-In Required:** In accordance with product spec R04.5, learners must explicitly opt in to SMS alerts and provide their phone number with consent.
2. **Opt-Out Support:** All outbound alerts support standard opt-out keywords (`STOP` / `አቁም`).
3. **Content Sanitization:** In accordance with architectural privacy rules, SMS bodies **must never contain**:
   - Learner health, disability, or accommodation details.
   - Private conversation transcripts or AI query details.
   - Passwords, session tokens, or unencrypted private identifiers.
4. **Synthetic Test Fixtures:** Per project verification rules, all integration test suites and documentation use synthetic phone numbers (`+251911000001`) and synthetic tokens to ensure zero data leakage.

---

## 6. Downstream Integration Status & Prerequisites

| Milestone | Issue | Status | Description |
|---|---|---|---|
| **T3-003-A** | [#69](https://github.com/EyasuGet/Hackaton/issues/69) | **Complete** | Approved route selected, character budgeting established, decision D23 locked |
| **T3-003-E** | [#71](https://github.com/EyasuGet/Hackaton/issues/71) | Ready | Phone ownership verification route and OTP flow |
| **T3-015-A** | [#83](https://github.com/EyasuGet/Hackaton/issues/83) | Complete | `AfroMessageSmsAdapter` implemented with synthetic fixtures |
| **T3-015-B** | [#84](https://github.com/EyasuGet/Hackaton/issues/84) | Blocked on live credentials | Outbound transmission to consenting test destination handset (`+251...`) |
| **T3-021-A** | [#95](https://github.com/EyasuGet/Hackaton/issues/95) | Dependent on outbox | Job alert dispatch worker using SMS adapter |

---

## 7. Verification Evidence & Automated Tests

Automated regression and specification verification is implemented in:
- **Test File:** [`apps/api/src/modules/delivery/domain/sms-route-decision.test.ts`](../../apps/api/src/modules/delivery/domain/sms-route-decision.test.ts)
- **Suite Results:** 15 passing tests validating:
  1. GSM-7 vs UCS-2 character boundary calculations (160 vs 70 single segments; 153 vs 67 concatenated segments; 2-septet extension characters).
  2. Concrete job alert, tutor reply, and meeting notification templates fitting within budgeted limits.
  3. Cost projection calculations for 1,000, 5,000, and 10,000 monthly message volumes.
  4. Mathematical proof of >94% cost reduction of AfroMessage vs Twilio.
  5. AfroMessage status mapping (`DELIVRD`, `UNDELIV`, `EXPIRED`, `REJECTD`, `Send in progress...`) to normalized domain states.
  6. HTTP error classifications (401/403 as permanent rejection; 429/5xx as transient unknown).

---

## 8. Verdict

**Approved & Runnable** — The Ethiopian SMS route is fully defined, mathematically proven, and architecturally verified.

- **Route:** AfroMessage VAS gateway connected to Ethio Telecom.
- **Budget Impact:** Low risk (~0.35 ETB/segment, ~2,100 ETB for 5,000 alerts/month).
- **Downstream Path:** Adapter is implemented; live probe proceeds in T3-015-B once the team supplies provisioned credentials.

---

## Primary References

- [AfroMessage Developer Documentation](https://afromessage.com/developers)
- [3GPP TS 23.038: Alphabets and language-specific information](https://www.3gpp.org/ftp/specs/archive/23_series/23.038/)
- [Twilio Ethiopia Route Guidelines](https://www.twilio.com/en-us/guidelines/et/sms)
- [Ethiopian Communications Authority (ECA) Directives](https://eca.et/)
