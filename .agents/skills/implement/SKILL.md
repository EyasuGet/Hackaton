---
name: implement
description: Implement an explicitly requested approved issue from the current project state, with focused verification, independent reviews, and a human-gated PR.
---

# Implement one approved issue

Start from a fresh session with the issue, not the design conversation. Read [AGENTS.md](../../../AGENTS.md), the selected [local issue](../../../docs/issues.md) (or authoritative GitHub body after migration), its parent/shared spec and relevant architecture decisions.

## Before changing code

1. Confirm implementation was requested, the issue is approved/claimed by the current human, dependencies are complete, and the phase gate permits it. Respect existing work and another owner's claim. A spec-writing request is not implementation approval.
2. Inspect current behaviour, callers, tests, configuration, and Git state. Once Git exists, use an issue branch into `main` according to the user's action authorisation; do not initialise/publish a repository as a side effect. If the issue depends on repository setup that has not happened, report that prerequisite.
3. State the smallest implementation plan and the issue's proving check. Reopen only unresolved choices that change agreed scope, interfaces, privacy, cost, external dependencies, or acceptance. Ordinary internal decisions stay with the implementer.
4. For a consequential unfamiliar model/provider/library choice, verify current primary documentation and evaluate against the feature's language quality, correctness, accessibility, portability, failure behaviour, latency, and cost constraints. Record dated evidence/alternatives in the relevant issue or shared decision record. Existing supported choices need not be re-researched on every edit. A benchmark or marketing claim is not proof for our Amharic/device use case.

## Build and verify

5. Run relevant existing checks before editing and preserve the results. For new behaviour, add a focused test that reaches the real interface; for a regression, demonstrate failure without the fix where practical. No runnable project yet means foundation checks are planned, not passed.
6. Implement the narrow vertical slice. Follow feature-first Clean Architecture and the project's formatting; introduce only required layers, classes, dependencies, and tests. Run the focused checks while iterating. Obtain exact commands from package scripts/README/CI, not a generic tool recipe.
7. A correction to an unexpected failing check that alters assertions, fixtures, error handling, concurrency, retries, or externally visible behaviour needs a blind [fix-guard](../../agents/fix-guard.md) pass. Preserve the first failure, pre-fix snapshot and complete fix diff. Planned red-first tests are not a failed-fix round. The guard receives failures, diff, relevant spec, and necessary raw code/evidence—not the implementer's rationale. After three rejected correction rounds, stop and hand back the unresolved cause rather than looping or weakening the check.
8. Run documented pre-PR checks, inspect the final diff, and account for every acceptance criterion. Capture real external/device evidence where required. A mocked integration, skipped check, or missing credential remains explicitly unverified/blocked.

## Review and hand off

9. Follow [code-review](../code-review/SKILL.md). Fix blocking findings; rerun affected checks and obtain fresh review of material changes. Reviews and evidence must identify the same candidate revision; a changed candidate is not covered by an older pass.
10. Fill [the PR template](../../../.github/pull_request_template.md). Commit/push/open a PR only within explicit user action authorisation; otherwise leave a local diff and ready-to-use PR draft in the response. Never merge without human approval.
11. Report files changed, why new files/helpers/tests are necessary, checks passed/failed/unrun, reviewer verdicts, outstanding blockers, and the human Verify story. Close the issue only after merge and integrated acceptance evidence through the authorised tracker workflow.
