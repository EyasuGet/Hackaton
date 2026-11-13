---
name: to-spec
description: Turn settled project decisions into a local issue specification without reopening the interview or starting implementation.
---

# Write the settled spec

1. Read [AGENTS.md](../../../AGENTS.md), the original request, current issue (if any), [product spec](../../../docs/spec.md), [architecture](../../../docs/architecture.md), and relevant [decisions](../../../docs/decisions.md). Inspect current code only where needed. Do not interview again about approved choices.
2. Synthesize the agreed behaviour into [the local backlog](../../../docs/issues.md). Keep shared product requirements in the product spec and shared architectural rules in architecture; link instead of duplicating their full text. Preserve stable local IDs and the original ask's intent. For a broad spec, map it into independently verifiable slices with the `to-tickets` instructions.
3. Include: goal; scope/out of scope; affected modules and interfaces; dependency/phase prerequisites; observable acceptance criteria; automated verification with expected outcomes; human Verify story; external blockers; bounded choices delegated to implementation. Name actual commands only if they exist. Before code exists, state the checks the implementation must provide, clearly labelled planned.
4. Dispatch a fresh read-only spec reviewer using [its prompt](../../agents/spec-reviewer.md), the raw request/approved decisions and the written draft—not a persuasive explanation. Ask it to account for every requested outcome, scope creep, contradictions, and testability. Correct supported findings before marking the spec ready. If independent review is unavailable, report it as unverified rather than self-certifying.
5. Read back the changed local sections. Report the spec location, key done criteria, proposed verification, unresolved blockers, and whether decomposition still needs approval. A new implementation detail not entailed by the agreement remains a labelled proposal, not a retrospective “approved” decision.

Writing a spec does not authorise application implementation, assignment/status changes, GitHub publication, paid provisioning, or repository mutation beyond requested local documentation. GitHub migration needs explicit destination/action approval and preserves local IDs; after migration, declare one authoritative issue body.
