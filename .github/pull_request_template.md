## Issue and scope

- Local ID / GitHub issue:
- Goal:
- Deliberately out of scope:

## Acceptance criteria

<!-- Account for each issue criterion with implementation and evidence. Mark blocked/unverified honestly. -->

## Verify

<!-- Required setup, then numbered user actions and observable expected results. Use synthetic data. -->

## Evidence

<!-- Exact commands, results, environment, and revision; before/after when relevant. Separate real integration checks from mocked checks. List failed/skipped/unavailable checks. -->

## Test rationale

<!-- For each added/changed test, identify the distinct behaviour/risk, existing coverage reused, and why this test layer is necessary. Explain intentional cross-layer overlap; do not add tests just to fill this section. For docs-only work, record appropriate document checks instead of artificial application tests. -->

## Author-led review

<!-- The author runs the code-review skill and completes this template; another teammate's PR approval is not required. Independent AI reviewers remain read-only. -->

Author sign-off means completing this checklist, not submitting a GitHub **Approve** review on your own PR ([GitHub restriction](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)). If branch protections require another approving reviewer, raise that configuration conflict with the maintainer; do not bypass or silently change the rule.

- Reviewed base and candidate revision / dirty-tree fingerprint:
- Latest `main` checked against; affected existing implementations/callers/contracts examined:
- Applicable shared spec/decision IDs and compatibility findings:
- Standards: PASS / FAIL / UNVERIFIED; findings:
- Spec: PASS / FAIL / UNVERIFIED; findings:
- Material fixes and re-review evidence:
- Fix guard: not required / PASS / REJECT / UNVERIFIED; reason and evidence:

## Author merge checklist

- [ ] Required issue-specific human/device checks completed with recorded results.
- [ ] Explicit dependencies satisfied; required external evidence complete; applicable release/stretch gates respected.
- [ ] Existing behaviour, shared contracts and applicable overall decisions remain compatible with current `main`.
- [ ] Added tests cover distinct necessary risks without redundant cases or implementation-detail assertions.
- [ ] Blocking review findings resolved; checks/CI and reviews cover the current candidate, including material conflict resolutions.
- [ ] No unrelated cleanup or sensitive data in the diff/evidence.
- [ ] I, the PR author, have reviewed this PR using the template and sign off on my own merge; required repository protections are satisfied.
- Post-merge integrated verification and rollback considerations:
