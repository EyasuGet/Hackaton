---
name: code-review
description: Run author-led PR review against existing implementations, shared decisions, standards and the issue spec using two independent read-only AI reviewers.
---

# Author-led two-axis review

The PR author owns this review and may merge their own PR after the checks pass; no other teammate PR approval is required. Independent standards/spec AI reviewers are still used. Complete [the PR template](../../../.github/pull_request_template.md); this skill itself does not authorise a merge or waive repository protections.

1. Pin the comparison: user-specified base or the issue branch's merge-base with local `main`. Record base SHA, the current main SHA used for compatibility checking, candidate SHA, and any dirty/untracked files with content fingerprints. Include staged, unstaged, and relevant new files. Do not fetch, alter Git state, or discard changes just to review. Without Git, use an explicit candidate file list and hashes; disclose that this is a file-set review, not a branch diff.
2. Identify the exact issue spec and shared constraints from [AGENTS.md](../../../AGENTS.md), [coding standards](../../../docs/coding-standards.md), [architecture](../../../docs/architecture.md), [decisions](../../../docs/decisions.md), and relevant product requirements. Inspect affected callers, shared contracts, adjacent tests and relevant previously merged implementations; check compatibility, not merely conformity of the new code in isolation. Read the applicable overall decisions even if the issue does not repeat them. Check [test necessity and non-duplication](../../../docs/verification.md#test-writing-rules). Gather actual verification output for this candidate. Missing evidence/spec is UNVERIFIED, not a silent waiver.
3. Freeze the candidate while reviewing. Dispatch two fresh independent read-only agents, preferably in parallel:
   - [Standards reviewer](../../agents/standards-reviewer.md): candidate/diff, existing implementations/callers/contracts, documented rules, test rationale, and raw check evidence.
   - [Spec reviewer](../../agents/spec-reviewer.md): candidate/diff, original issue and approved scope, applicable overall decisions/shared requirements, compatibility context, and raw check evidence.
   Supply facts and artefacts, not the implementer's defence. Neither reviewer receives the other's findings beforehand. There is no third general/neutral reviewer.
4. Report Standards and Spec separately, each as PASS, FAIL, or UNVERIFIED with actionable findings and source locations. Zero findings is valid. Do not manufacture comments, turn style preferences into blockers, or hide one axis behind the other.
5. Fix supported blocking findings, then rerun affected checks and re-review material fixes against the new candidate. Track resolved/open findings. A risky fix to a failed check also follows the implement skill's fix-guard rule. After three unresolved correction rounds, return the blockers to the human instead of claiming readiness or looping indefinitely.
6. Produce the PR template review block with base/main/candidate identity, compatibility findings, verdict per axis, test rationale, fixed/open findings, fix-guard result where applicable, actual verification, and remaining human/device checks. The author personally accounts for the checklist before authorising their own merge. If main advances, inspect its changes and revalidate the integrated candidate before merging; material conflict resolutions require affected checks and renewed review. Material edits after a pass invalidate that pass for the changed behaviour.

If separate reviewer contexts are unavailable, perform/report what is possible as a self-review and mark independent validation UNVERIFIED. Do not represent sequential self-passes as independent agents. Do not mutate remote issues/PRs or merge as part of a review.
