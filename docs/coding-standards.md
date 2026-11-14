# Coding standards

Read this when implementing or reviewing code. This is our project style guide, not a claim that TypeScript has a universal PEP 8 equivalent. [Architecture](architecture.md) owns module/dependency rules; [verification](verification.md#test-writing-rules) owns test rules. The tooling below is configured in the repository root (`eslint.config.js`, `.prettierrc.json`) and run by CI; see the [README checks](../README.md#checks).

## Occam's razor: simplest adequate implementation

Choose the simplest readable implementation that meets the current acceptance criteria, including security, accessibility, reliability and measured performance needs. Simplicity means fewer unnecessary concepts and moving parts, not the fewest characters or skipped requirements.

- Inspect existing behaviour and reuse a suitable implementation before adding another. Prefer a direct function, conditional, query or explicit constructor wiring over a new framework or indirection.
- Every new helper, class, interface, dependency and file must solve a present problem. Be able to name that problem in review; hypothetical future reuse is insufficient.
- Keep the agreed feature modules and inward dependency direction. Clean Architecture/SOLID do not require a class or interface per function, pass-through service layers, generic base repositories, or empty folders. Use classes for the agreed application use cases and meaningful stateful/domain behaviour; leave simple transformations as functions and React as functional React.
- Extract an abstraction when it removes meaningful current duplication, isolates a real external dependency, or enforces a genuine invariant. A little straightforward code is better than a complicated general solution for imagined variants.
- Prefer clear names, early returns and explicit control flow to clever one-liners, nested ternaries, or heavy type-level machinery. Keep a readable one-line expression when it is sufficient.
- Do not refactor unrelated code, add speculative configuration, or create extension points just because they might be useful. Fix the requested behaviour and its meaningful regression risks.

## Comments at file, block and line level

- **Files:** give nontrivial, non-generated implementation files a short opening comment describing their responsibility and important context. Do not repeat the filename, enumerate every symbol, or add boilerplate to trivial re-export/generated files.
- **Blocks:** comment the intent or invariant of important logical sections, especially permission checks, transactions, retry/idempotency handling, and non-obvious ordering. Explain why steps belong together rather than narrating each statement.
- **Lines:** use a short adjacent/inline comment for a surprising condition, unit conversion, security constraint, workaround or other subtle decision. Obvious assignments, loops and returns do not need narration.
- **Public interfaces:** use concise TSDoc where callers need behaviour the types cannot express, such as preconditions, side effects, failure modes, ownership or units. Do not duplicate parameter/return types in prose.
- Keep comments accurate when code changes. Remove obsolete comments and commented-out code. A necessary TODO identifies the actual remaining issue/constraint rather than speculative work. Never put secrets or private learner data in comments.

Comments should make the code easier to understand, not compensate for confusing naming or create a wall of text. Refactor only the relevant confusing logic when a simpler implementation removes the need for a long explanation.

## TypeScript conventions

### Formatting and naming

Bootstrap establishes one shared Prettier configuration for TypeScript/TSX: two-space indentation, semicolons, single-quoted JavaScript strings, double-quoted JSX attributes, and a 100-column print-width preference. Let the formatter handle wrapping/trailing commas; print width is not a hard line-length limit. Use its stable defaults for other options rather than a long custom style configuration. Preserve established formatting outside the change; do not run a repository-wide rewrite for a small feature.

| Kind | Convention |
|---|---|
| Variables, parameters, functions, methods and properties | `camelCase`; use descriptive names and verbs for actions |
| Classes, interfaces, type aliases and React components | `PascalCase`; no redundant `I` prefix on interfaces |
| Module-level fixed configuration constants | `UPPER_SNAKE_CASE` where it communicates a true constant; ordinary `const` locals stay `camelCase` |
| Source filenames | `kebab-case.ts` / `kebab-case.tsx`, consistent with the agreed layout; preserve framework-required filenames |

Use `const` unless reassignment is needed; use `let` for actual reassignment, not `var`. Prefer explicit named exports for project modules; respect framework entry-point conventions. Use type-only imports for type-only dependencies. Remove unused imports/variables in the changed code without unrelated renaming.

### Types and contracts

- Enable TypeScript `strict`; do not disable strict checks to make a feature compile.
- Type public module/use-case contracts and their return values explicitly. Let TypeScript infer obvious local values instead of annotating everything. Use the existing shared transport schemas rather than duplicate DTO shapes.
- Treat untrusted input as `unknown` and validate/narrow it at the real ingress. Type annotations and `as` casts are not runtime validation. Reuse the established schema instead of repeatedly validating already trusted internal values.
- Avoid `any`, unchecked casts and non-null assertions as shortcuts. A necessary third-party typing escape hatch must be narrow, explained, and backed by the relevant runtime check/guarantee; do not leak it into domain interfaces or broadly disable lint rules.
- Represent expected alternatives clearly, for example with a small discriminated union when outcomes differ. Handle `null`/`undefined` deliberately; do not hide an invalid state behind optional chaining or fallback values.
- Prefer composition and simple types. Use generics only for an actual reusable relationship, not to create a universal abstraction. Use `readonly` where the contract requires non-mutation; it is not a claim of deep runtime immutability.

### Correctness and efficient execution

- Keep business rules in their owning module; channel/HTTP adapters translate input/output rather than duplicate those rules. Handle expected failures explicitly and preserve useful error context without logging sensitive content.
- Await asynchronous work or deliberately manage its lifetime and failure handling. Avoid floating promises, swallowed errors and unbounded retries. Independent I/O may run concurrently with limits appropriate to the provider/workload; do not use unbounded `Promise.all` over large input.
- Avoid obvious waste: duplicate network/database calls, unnecessary full-table/in-memory scans, blocking synchronous work in request paths, and fetching fields/rows that are not needed. Bound collections and use the existing pagination/limits where relevant.
- When adding complexity solely for performance, measure a real bottleneck before introducing caching, complex algorithms, memoisation, extra queues or new infrastructure. Caches/queues/infrastructure already justified by functional or reliability requirements (such as offline FAQs, durable delivery or a required screen-sharing relay) do not need a performance bottleneck to justify them. Prefer a clear adequate implementation over premature optimisation, while meeting the issue's actual performance criteria.

## Enforcement and review

T3-001 must establish TypeScript strict checking, ESLint with compatible typescript-eslint recommended rules, and Prettier format checking through documented package commands and CI. Select compatible versions from current official documentation; this document does not install them. Formatting belongs to Prettier, semantic checks to the compiler/linter; avoid conflicting formatting rules or unnecessary plugins.

Implementation and standards review must consult this file. Before merge, account for any new abstraction/dependency, check useful file/block/line comments, run the actual configured checks, and apply the focused test-writing rules. An exception needs a concrete reason tied to the current requirement; 'best practice' or 'SOTA' alone is not a justification for complexity.

## Primary references

- [TypeScript strict checking](https://www.typescriptlang.org/tsconfig/strict.html) and [narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html).
- [typescript-eslint setup](https://typescript-eslint.io/getting-started/) for compatible recommended lint configuration.
- [Prettier options](https://prettier.io/docs/options) for formatter behaviour. The style choices above are project choices, not universal TypeScript rules.
