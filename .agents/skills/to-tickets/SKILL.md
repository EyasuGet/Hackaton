---
name: to-tickets
description: Decompose an agreed project spec into dependency-ordered local issue drafts, one independently verifiable implementation slice per PR.
---

# Slice the spec locally

Read [the product spec](../../../docs/spec.md), [architecture](../../../docs/architecture.md), and existing [local issues](../../../docs/issues.md). Preserve IDs, approved exclusions, and other people's ownership. The local file is the tracker until the user authorises a specific GitHub migration.

For each slice record:
- Stable ID, title, phase, priority, planned status, and owner (unassigned unless explicitly claimed).
- Explicit blocking IDs and genuine external prerequisites, with no cycles. Baseline phases are delivery milestones, not implicit all-prior-phase blockers. Final release checks must explicitly cover their prerequisites; stretch work still depends on baseline acceptance.
- One complete observable behaviour across the layers it needs, not separate database/backend/frontend tickets for the same behaviour.
- Scope and exclusions, acceptance criteria, an automated verification expectation, a short human Verify story, and external evidence required.

Foundation work and operational evidence checks can be separate issues when they have independently verifiable outputs. Keep them small. A risk check may finish by documenting a blocker; the live feature it blocks cannot pass on that documentation or on a mock.

Check coverage against the original spec, dependency validity, final release gates, and realistic parallel work across baseline phases. Use [the blocked-work procedure](../../../docs/issues.md#when-work-is-blocked) for blockers and agreed contract-first splits; do not weaken real integration acceptance or create speculative interfaces. Separate mandatory acceptance from optional improvements; lowest-priority future work stays unready until its own design is settled. Present the breakdown and material new choices for approval before treating drafts as implementation-ready. Never automatically assign every issue or set the backlog to In Progress.

On an explicit later migration request, confirm repository/visibility and approved issue bodies, create blockers before dependants, keep an ID-to-URL mapping, and verify the resulting links. Check existing IDs before creating anything to prevent duplicate publication. Merely invoking this skill does not authorise remote creation.
