# Contributing to Track 3 Assistant

This document contains team instructions, agent workflows, architecture reference links, and execution guides for developers contributing to the repository.

---

## Architecture & Backlog Overview

- [Product Specification](docs/spec.md): Required behaviors, constraints, and scope boundaries.
- [Architecture Guide](docs/architecture.md): Clean Architecture layer definitions, module dependency rules, and port/adapter contracts.
- [Decision Register](docs/decisions.md): Settled technical choices and project direction.
- [Issue Index & Execution Guide](docs/issues.md): Stable IDs, leaf task dependencies, and procedure for blocked tasks.
- [Verification Rules](docs/verification.md): Automated and live evidence standards.
- [Accessibility Conformance Template](docs/conformance.md): Evaluation criteria for WCAG 2.2 AA.
- [Agent Instructions](AGENTS.md): Author-led review workflow and execution limits.

---

## Agent Workflow & PR Rules

1. **One Leaf per PR**: Claim exactly one leaf task; never implement an entire epic in one PR.
2. **Reviewing Your Own PR**: PR authors conduct self-reviews using independent spec and coding standard checks before signing off.
3. **CI Gate**: 100% green CI required on branch candidate before merging.
4. **No Direct Commits to `main`**: Use short-lived issue branches into `main`.

---

## Local Development & Package Scripts

```sh
pnpm install                  # Install pinned dependencies
pnpm typecheck                # Strict TypeScript check across all packages
pnpm lint                     # ESLint checks
pnpm format:check             # Verify Prettier formatting
pnpm test                     # Run unit tests
pnpm test:integration         # Run PostgreSQL integration suite
pnpm test:e2e                 # Playwright Chromium E2E + axe-core accessibility suite
```
