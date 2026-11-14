---
name: to-tickets
description: Decompose an agreed project spec into dependency-ordered local issue drafts, one independently verifiable implementation slice per PR.
---

# Slice the spec locally

Turn an oversized issue into an epic while retaining its ID and integrated acceptance criteria. Give its children stable IDs such as `T3-001-A`; keep already-small issues as leaves. Epics track completion, are not claimable implementation tasks, and never imply one giant PR. Claimable children each deliver one independently verifiable outcome. Preserve completed/history-bearing IDs and append new child IDs rather than silently renumbering work.

Read [the product spec](../../../docs/spec.md), [architecture](../../../docs/architecture.md), and existing [local issues](../../../docs/issues.md). Preserve IDs, approved exclusions, and other people's ownership. The local file is the tracker until the user authorises a specific GitHub migration.

For each leaf slice record:
- Stable ID, parent epic if any, title, phase, priority, planned status, and owner (unassigned unless explicitly claimed).
- Explicit blocking IDs and genuine external prerequisites, with no cycles. Baseline phases are delivery milestones, not implicit all-prior-phase blockers. Final release checks must explicitly cover their prerequisites; true Phase 5 stretch still depends on the full written-brief gate, not merely core readiness. Use the backlog’s approved priority/gate definitions; mixed-priority epics must not put deferred siblings on a core leaf’s critical path.
- One complete observable behaviour across the layers it needs, not separate database/backend/frontend tickets for the same behaviour. Prefer focused work blocks; split a leaf when it grows into unrelated outcomes. Do not invent minute-sized busywork or duplicate tests merely to increase the ticket count.
- Scope and exclusions, acceptance criteria, an automated verification expectation, a short human Verify story, and external evidence required.

Foundation work and operational evidence checks can be separate issues when they have independently verifiable outputs. Keep them small. A risk check may finish by documenting a blocker; the live feature it blocks cannot pass on that documentation or on a mock.

Check every original acceptance criterion is retained by the parent and assigned to a child or integrated epic proof, or trace an explicitly approved amendment; delivery deferral is not an organiser waiver. Check dependencies on the smallest sufficient child, no child depending on its own epic, no cycles through epic completion edges, complete final-release coverage, and realistic parallel work across baseline phases. Show a first-ready-task table. An epic closes only when all children and its integrated acceptance pass; completed-child counts do not prove end-to-end success. Use [the blocked-work procedure](../../../docs/issues.md#when-work-is-blocked) for blockers and agreed contract-first splits; do not weaken real integration acceptance or create speculative interfaces. Separate mandatory acceptance from optional improvements; lowest-priority future work stays unready until its own design is settled. Present the breakdown and material new choices for approval before treating drafts as implementation-ready. Never automatically assign every issue or set the backlog to In Progress.

On an explicit later migration request, confirm repository/visibility and approved issue bodies, create blockers before dependants, keep an ID-to-URL mapping, and verify the resulting links. Check existing IDs before creating anything to prevent duplicate publication. Merely invoking this skill does not authorise remote creation.
