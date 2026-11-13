---
name: grilling
description: Resolve or challenge unsettled project decisions before specifying work; use for grill-me requests or design-impact gaps found during implementation.
---

# Grill unresolved decisions

Read the selected issue plus [the shared decisions](../../../docs/decisions.md) and [architecture](../../../docs/architecture.md). Inspect current code, callers, and constraints before asking questions. Treat already approved choices as constraints, not invitations to restart the design.

Map a decision tree. In each round ask only the frontier: decisions whose prerequisites are settled. Use 3–5 concise questions when that many are open, each with a reasonable recommendation and a concrete tradeoff/failure case. Phrase each so “yes” accepts the recommendation. A dependent question waits for the answer it needs.

Find discoverable facts yourself, using read-only exploration or a scoped subagent when helpful; ask the human for preferences and approvals, not repository facts. Current provider/library claims need primary-source verification. Record uncertain external capabilities as unresolved evidence, not assumptions.

Stop when remaining choices are either settled or explicitly delegated as bounded implementation-time evaluations. Summarise the chosen behaviour, scope exclusions, interfaces, failure handling, acceptance checks, and who performs human/device verification. Wait for confirmation of shared understanding before producing the spec or implementing. A request to write the spec after that discussion is permission to synthesise it, not to start application code or external actions.

For implementation discoveries, reopen only the affected decision and its dependants. Continue unrelated authorised work where safe; do not silently weaken a mandatory acceptance criterion.
