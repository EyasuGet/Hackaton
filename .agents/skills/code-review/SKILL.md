---
name: code-review
description: Review project changes against standards and the approved issue spec using two independent read-only reviewers before PR readiness or on a review request.
---

# Two-axis review

1. Pin the comparison: user-specified base or the issue branch's merge-base with local `main`. Record base SHA, candidate SHA, and any dirty/untracked files with content fingerprints. Include staged, unstaged, and relevant new files. Do not fetch, alter Git state, or discard changes just to review. Without Git, use an explicit candidate file list and hashes; disclose that this is a file-set review, not a branch diff.
2. Identify the exact issue spec and shared constraints from [AGENTS.md](../../../AGENTS.md), [architecture](../../../docs/architecture.md), [decisions](../../../docs/decisions.md), and relevant product requirements. Gather actual verification output for this candidate. Missing evidence/spec is UNVERIFIED, not a silent waiver.
3. Freeze the candidate while reviewing. Dispatch two fresh independent read-only agents, preferably in parallel:
   - [Standards reviewer](../../agents/standards-reviewer.md): candidate/diff, relevant source, documented rules, and raw check evidence.
   - [Spec reviewer](../../agents/spec-reviewer.md): candidate/diff, original issue and approved scope, shared requirements, and raw check evidence.
   Supply facts and artefacts, not the implementer's defence. Neither reviewer receives the other's findings beforehand. There is no third general/neutral reviewer.
4. Report Standards and Spec separately, each as PASS, FAIL, or UNVERIFIED with actionable findings and source locations. Zero findings is valid. Do not manufacture comments, turn style preferences into blockers, or hide one axis behind the other.
5. Fix supported blocking findings, then rerun affected checks and re-review material fixes against the new candidate. Track resolved/open findings. A risky fix to a failed check also follows the implement skill's fix-guard rule. After three unresolved correction rounds, return the blockers to the human instead of claiming readiness or looping indefinitely.
6. Produce the PR review block with base/candidate identity, verdict per axis, fixed/open findings, fix-guard result where applicable, actual verification, and remaining human checks. Material edits after a pass invalidate that pass for the changed behaviour.

If separate reviewer contexts are unavailable, perform/report what is possible as a self-review and mark independent validation UNVERIFIED. Do not represent sequential self-passes as independent agents. Do not mutate remote issues/PRs or merge as part of a review.
