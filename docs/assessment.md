# Independent delivery assessment

Assessed 2026-11-14 against the [official hackathon brief](https://digitalbridge.et/#apply), local specification, architecture and newly split backlog. A separate read-only agent received that URL and repository paths with **no conversation history**. It evaluated coverage, competitiveness, task size and four-person parallel delivery before the revisions below. This is planning feedback, not organiser approval, implemented capability or a guarantee of placing.

**Historical scope note:** this assessment preceded the user-approved Savanna reconciliation and channel reprioritisation. It is not a review of the revised plan. [Current delivery decisions](decisions.md) and [the updated backlog](issues.md) now separate core readiness, time-permitting Telegram/SMS, later production identity and full written-brief coverage; [the reconciliation](savanna-reconciliation.md) records the evidence. Read references below to the old baseline/authentication gate in that historical context.

## Verdict

**Competitive potential if implemented and proved; high schedule risk from a documentation-only start.** The assessor found strong visible-requirement coverage and a defensible small-deployment architecture. The limiting factors are real integrations, user/device evidence, total workload and integration/review time—not lack of feature ideas. A larger ticket count does not make the project faster or guarantee that every task fits one sitting.

Keep the single API/PostgreSQL deployment, shared use cases, narrow provider adapters and honest FAQ fallback. Avoid new infrastructure frameworks, general-purpose dashboards and conferencing features. Required privacy, isolation, consent and capture-stop behaviour are part of the smallest correct solution, not optional hardening.

## Changes made from the assessment

| Finding | Revision in the authoritative backlog |
|---|---|
| Fixture UI and static evaluation unnecessarily waited for production services | T3-006-A now needs only the runnable shell; T3-007-B evaluates approved static passages. Real auth/retrieval proof remains separate and mandatory. |
| SMS adapter work waited for the entire worker | T3-003-A establishes the narrow shared delivery contract; T3-015-A can proceed independently. T3-015-B still proves the integrated worker and real receipt. |
| Real Savanna proof happened too late | T3-026-B proves real launch/authentication early; T3-026-D verifies completed features and media permissions later. |
| Several leaves bundled unrelated work | T3-007-D owns durable request/history behaviour; T3-007-A owns the connected FAQ journey. T3-010-C proves the speech adapter; T3-010-A owns bounded processing ingress. |
| Cross-module deletion became a late build blocked by carrier receipt | Data-owning features implement lifecycle themselves; T3-023-C audits those implementations and no longer waits for live SMS receipt. Defects become small repair leaves, not an unlimited audit task. |
| Translation/calendar/limits/deployment ownership was unclear | T3-006-C/D, T3-024-C and T3-018-D now own these existing requirements explicitly. Every later feature owns its strings and lifecycle. |
| Phone verification was assumed rather than decided | T3-003-E records an approved ownership route before T3-021-A. A host-verified claim is a recommendation only if actually supplied; an alternative needs approval. |
| Review overhead could erase the benefit of small tasks | Implementation leaves keep focused PRs/reviews. Evidence-only leaves attach their result to the owning issue/relevant PR instead of requiring empty PRs; no acceptance is waived. |
| Final checks could omit late features | Final device gates explicitly include career/alert, language, history-clearing and busy/rate-limit surfaces; the release gate traverses every baseline epic/leaf. The privacy audit waits for implemented voice/cache cleanup, not SMS receipt. |
| Breadth competed with demonstrated benefit | Earlier co-design, integration/capacity checkpoints and a protected final verification block are explicit. Prefer optional simple mode over web research after baseline completion. Employer work stays deferred. |

Screen capture remains a single one-to-one desktop share with required stop/disconnect/revocation safety together. Splitting those safeguards away merely to make a ticket look smaller would make the intermediate feature unsafe. Re-slice with an explicit safe boundary if implementation discovery shows it will not fit a focused PR.

## Still unresolved—not fixed by documentation

The [decision register](decisions.md#external-gates-and-remaining-precision-checks) is the source of truth for external gates. Named owners and check-in times must be assigned at kickoff; none are invented here. Savanna access, approved SMS/phone verification, acceptable bilingual providers, authorised HTTPS/relay infrastructure, real co-designer/device availability, retention precision and the organiser's fuller checklist still need evidence.

Mobile browser capture is an acceptance clarification: the public brief does not establish that desktop capture plus a phone help alternative is either accepted or rejected. Get an organiser answer; do not claim an exception has been granted.

The official scoring prioritises user success/co-design and adoption. Early observed task improvement, real constrained-phone use and an independently followed installation are better evidence than feature-count claims. Extra integration levels and optional insights can improve scoring but do not justify delaying the mandatory gate. Submission is listed for **15 November at 16:30**; use the organiser's confirmed schedule when setting the team's final buffer. [Judging and schedule](https://digitalbridge.et/#apply)

The expanded tasks remain a draft execution plan, not a claim that four people can finish all baseline work within the event. Compare estimates plus review/integration time with remaining person-hours at every checkpoint. If infeasible, obtain an explicit scope decision and disclose missing requirements; do not silently weaken acceptance or hide a blocked real integration behind fixtures.

## Follow-up review

The same independent assessor rechecked the revised backlog and found the corrections substantially reflected without weakened mandatory acceptance or a major new feature. It still identified schedule risk and potentially large screen-sharing, speech-output and phone-verification tasks. Required screen safety stays together; a new phone-code flow must be re-sliced after its decision rather than hidden inside the subscription estimate.

Its remaining evidence-only completion contradiction was corrected in the backlog and shared workflow/spec. History cleanup now depends on the history foundation rather than the FAQ UI; Telegram spoken output can start from text answers without waiting for voice input. Separate standards/spec review additionally identified missing final privacy/accessibility prerequisites, now explicit. These are planning corrections, not claims of executed product tests.
