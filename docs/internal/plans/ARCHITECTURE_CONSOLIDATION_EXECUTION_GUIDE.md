# Architecture Consolidation Execution Guide

This guide is written for the implementation agent. Read it together with:

- `ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md`
- `ARCHITECTURE_CONSOLIDATION_INVARIANTS.md`
- `ARCHITECTURE_CONSOLIDATION_PROGRESS.md`

The master plan makes the architecture decisions. Do not reopen settled decisions casually. Raise a deviation only when repository evidence shows the planned approach cannot preserve an invariant or cannot ship through the supported release path.

## 1. Operating mode

You are implementing an architecture program, not conducting unlimited review rounds.

For each phase:

1. Refresh from current `main` and record the exact SHA.
2. Re-read the phase, invariants, and previous progress entry.
3. Inspect the current implementation because main may have changed since the plan was written.
4. Create a fresh `agent/architecture-consolidation-phase-<n>-<scope>` branch.
5. Add characterization tests before moving behavior whose contract is not already testable.
6. Perform mechanical extraction before semantic changes.
7. Keep compatibility paths explicit and time-bounded.
8. Run the required validation.
9. Perform your own deep review of the actual diff.
10. Fix findings in the same phase before presenting the result.
11. Open a draft PR with the required declaration block.
12. Update the progress record with exact evidence and residuals.

Do not ask an external Codex reviewer to perform the review. The implementation and review are your responsibility. Use GitHub review state only when an actual human or already-configured repository review produces feedback.

## 2. Scope discipline

A phase PR must be understandable independently.

Allowed scope expansion:

- a prerequisite test seam;
- a type or contract needed by the phase;
- a direct bug exposed by the migration that would make behavior equivalence impossible;
- a documentation or release update required to keep shipped behavior accurate.

Not allowed:

- unrelated feature work;
- aesthetic UI redesign during companion decomposition;
- speculative hardening unrelated to the phase;
- broad dependency upgrades;
- renaming the entire repository for consistency;
- sweeping formatting mixed with semantic changes;
- another review ledger containing every hypothetical edge case.

When a genuine unrelated defect is found, record it as a follow-up issue or bounded residual unless it blocks the phase invariant.

## 3. Branch and PR strategy

Use one fresh branch per phase or coherent subphase.

Preferred sequence:

```text
main
  -> phase 0 guardrails
main after merge
  -> phase 1 TypeScript foundation
main after merge
  -> phase 2 infrastructure primitives
...
```

Do not build a ten-PR stack unless the user explicitly requests it. Long stacks make ownership, CI, and rollback harder.

PRs remain draft until:

- the phase gate passes;
- the self-review is complete;
- compatibility and rollback are documented;
- temporary scripts and transformers are removed;
- the branch contains no unrelated files.

Do not merge a phase automatically unless the user explicitly asks.

## 4. Commit strategy

Use commits that expose the migration logic:

1. characterization or contract tests;
2. new abstraction or module extraction;
3. call-site migration;
4. old-path removal;
5. docs/release updates.

A purely mechanical move may be one commit if it preserves history cleanly.

Avoid dozens of tiny AI-review commits. Before requesting review, consolidate fixup churn into a readable series without rewriting already-shared history destructively unless the branch is private and safe to force-update.

Never commit temporary handoff logs, generated diagnostic dumps, local absolute paths, real tokens, signing IDs, device identifiers, or build products.

## 5. Characterization-before-refactor rule

Before extracting a behavior, determine which category applies:

### Already behavior-tested

Move it and keep the existing test green.

### Tested only through source text

Add a real behavior or process test first. Remove the source assertion in the same PR when possible.

### Not tested and safety-critical

Add focused characterization tests before moving code. Include at least one failure path.

### Not tested and trivial presentation-only code

Mechanical extraction is allowed, but preserve screenshots/accessibility checks where relevant.

Never use source-text tests to prove a new architecture.

## 6. TypeScript migration rules

### Canonical configuration

Use Node ESM and `module`/`moduleResolution: NodeNext`.

The build should support mixed `.js` and `.ts` while migration is incomplete. Production executes emitted JavaScript.

Recommended configuration progression:

#### Foundation

- `allowJs: true`
- `checkJs: false`
- `declaration: false`
- `sourceMap: true`
- `strict: true` for `.ts`
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `useUnknownInCatchVariables: true`
- `forceConsistentCasingInFileNames: true`

#### Tightening

- add `noUncheckedIndexedAccess: true`;
- add `exactOptionalPropertyTypes: true`;
- enable `checkJs` only for explicitly selected remaining JavaScript modules or finish renaming them to TypeScript;
- remove temporary compatibility declarations.

### Runtime validation

TypeScript types do not validate JSON, HTTP input, process output, files, or environment variables.

Use small explicit validators at boundaries. Do not introduce a broad schema framework without proving that its weight is justified. Shared validators should return typed success/failure results with stable error codes.

### Unsafe escape hatches

- Prefer `unknown` over `any`.
- Do not use repository-wide `skipLibCheck` as a substitute for fixing first-party types. It may be enabled only if third-party declarations require it and the reason is documented.
- Do not add broad `@ts-nocheck` headers to production files.
- A narrow `@ts-expect-error` must explain the expected compiler limitation and have a removal condition.

### Compiled-tree testing

At least one authoritative CI path must:

1. start from a clean checkout;
2. install dependencies with the lockfile;
3. build `dist/`;
4. run tests against the built package or execute built entrypoints;
5. inspect package contents;
6. verify no source-only import accidentally makes production work.

## 7. Infrastructure migration rules

### Explicit ports before call-site movement

Define interfaces and production implementations first. Add fakes for tests. Then migrate call sites.

Do not create a generic god-object runtime. The composition root may hold separate dependencies, but application services should receive only the ports they need.

### CommandRunner

Every command policy must be visible in the call:

- executable and arguments;
- interactive versus noninteractive;
- timeout class;
- output cap;
- environment allowlist/overrides;
- cancellation signal;
- process-group policy;
- acceptable exit codes.

No command-specific behavior may be inferred by globally intercepting `spawn`, `spawnSync`, or `execFileSync` in the final architecture.

### ProcessSupervisor

Use one structured `ProcessIdentity` contract containing the strongest available identity fields already proven by the repository. Verification precedes signal delivery.

Do not downgrade to PID-only identity during cleanup, testing, or migration.

### AtomicFileStore and LockManager

Keep durability and mutual exclusion separate:

- atomic publication handles fsync/rename/permissions;
- locks handle ownership, waiting, stale proof, quarantine, and release.

A lock replacement race must remain covered by a real process or filesystem test.

### Architecture enforcement

After the infrastructure phase, add static checks preventing direct imports of:

- `node:child_process` outside approved infrastructure and narrowly justified scripts/tests;
- destructive `node:fs` operations outside approved stores;
- generic global `fetch` use where an authenticated client is required.

Use an AST-aware lint rule or import-boundary rule where practical. A grep-only check may bootstrap the transition but cannot be the permanent enforcement mechanism.

## 8. Helper decomposition rules

### Composition root

The entrypoint may:

- parse top-level startup mode;
- create dependencies;
- create the command dispatcher or service;
- register top-level signal handling;
- map an uncaught failure to a process exit.

It may not contain the full command implementations, HTTP routes, storage logic, build pipeline, or HTML templates.

### HTTP routes

Each route module declares:

- exposure boundary;
- authentication requirement;
- input validator;
- application service called;
- output projection;
- stable errors.

Keep public-gateway route registration separate from full-helper route registration. Do not pass a mode flag into one giant router and hope every route checks it correctly.

### Timers and background work

Create one lifecycle owner for timers and active tasks. Startup returns a service handle with `close()`/`shutdown()`.

Tests must prove:

- startup does not await maintenance that can block listening;
- shutdown stops scheduling new work;
- active tasks are cancelled or bounded;
- sockets and children close within the hard deadline.

## 9. SQLite migration rules

### Adapter boundary

All SQL and selected Node SQLite API calls live in one infrastructure package. Domain and application modules see repositories and transactions, not SQL statements.

### Schema design

Use normalized identity columns and explicit foreign keys. Store JSON only for genuinely opaque versioned payloads, not as a way to recreate the old JSON database inside one column.

Recommended entities:

- `schema_migrations`
- `installations`
- `pairing_credentials`
- `pairing_invitations`
- `apps`
- `device_builds`
- `device_build_logs` or bounded log blobs with explicit retention
- `delivery_generations`
- `delivery_references`
- `install_observations`
- `build_recipes`
- `idempotency_keys`
- `simulator_sessions`
- `cleanup_jobs`

Exact tables may differ after examining current data, but app identity, ownership authority, and ordered history must remain representable without ambiguous JSON merging.

### Migration sequence

1. Read legacy JSON through frozen legacy readers.
2. Validate before import.
3. Create a backup with owner-only permissions.
4. Import inside a transaction.
5. Record source fingerprints and migration version.
6. Compare public/domain projections between legacy and SQLite.
7. Run shadow reads in tests and, if useful, one beta release.
8. Switch writes to SQLite.
9. Keep legacy files read-only for the rollback window.
10. After the window, archive or remove them through an explicit command/migration.

Never dual-write permanently. Dual-write creates a new consistency problem.

### Failure behavior

- Database unavailable or malformed: fail closed with `doctor` guidance.
- Migration interrupted: resume or restart idempotently.
- Schema newer than runtime: refuse to run destructively.
- Busy timeout: return a typed retry/defer result where safe; do not crash the helper for maintenance contention.
- Domain transaction failure: no partial public state.

## 10. Preload removal rules

Maintain a machine-readable inventory:

```json
{
  "preloads": [
    { "path": "...", "capabilities": ["..."], "remainingCallSites": 0 }
  ]
}
```

A preload is removed only when:

- its capabilities exist behind explicit ports;
- all production call sites use those ports;
- packaged and raw entrypoints are tested;
- the corresponding regression tests no longer depend on import order;
- an architecture test confirms built-ins are unchanged.

Do not keep an empty or mostly empty preload forever for reassurance. Delete it when its responsibility is gone.

## 11. Swift analyzer execution rules

### First isolate, then replace

Do not rewrite parsing while `liveReload.js` still owns the whole pipeline.

First create the analyzer interface and move the current classifier behind it unchanged. Differentially test the facade.

### Swift analyzer protocol

Use newline-delimited or single-document JSON with:

- protocol version;
- analyzer build/version;
- request ID;
- source file identities;
- parse diagnostics;
- normalized declaration surface;
- unsupported constructs;
- stable classification inputs.

No private source text should be included in persisted normal logs.

### Packaging decision

Prefer a release-built analyzer binary shipped with Swift Sim rather than compiling SwiftSyntax on the user's first normal command. Verify checksum/version before use.

If the release process cannot support that cleanly, stop at the analyzer boundary and present evidence before choosing a fallback. Do not silently retain two permissive analyzers.

### Differential acceptance

For every case:

- old hot / new rebuild: acceptable but record the conservatism;
- old rebuild / new rebuild: acceptable;
- old hot / new hot: must preserve the same structural reasoning or improve it safely;
- old rebuild / new hot: prohibited without physical proof and explicit review.

## 12. Companion execution rules

Refactor one feature at a time:

1. networking contracts/client;
2. pairing;
3. app library and local persistence;
4. device build/install flow;
5. Simulator session flow;
6. navigation/coordinator;
7. final compatibility-store removal.

Do not split files solely by line count. Extract cohesive behavior with protocols and tests.

Feature models should not know URL construction details. The API client should expose typed operations.

Persistence repositories should not mutate UI state. Feature models should not serialize directly to `UserDefaults`.

Use injected `URLSession` or transport protocol. Preserve current cancellation and revision fencing explicitly.

## 13. Self-review procedure

Before completing each phase, inspect the diff as an adversarial senior maintainer.

Review these dimensions:

- behavior drift;
- authorization drift;
- process ownership and shutdown;
- crash windows;
- storage migration and rollback;
- stale async responses;
- package/runtime path drift;
- type holes and validator gaps;
- tests coupled to implementation;
- compatibility layers without deletion plans;
- documentation contradictions;
- accidental secrets or local paths.

Classify findings conservatively, but do not inflate every theoretical edge case to P1. Severity means:

- P0: active catastrophic compromise/data destruction across ordinary use;
- P1: likely release blocker causing security boundary failure, data loss, wrong-process action, or core workflow break;
- P2: meaningful correctness/maintainability issue with bounded impact or uncommon trigger;
- P3: polish, clarity, or low-risk debt.

Fix P0/P1/P2 findings introduced or exposed by the phase. Record unrelated bounded residuals without starting a new unplanned hardening campaign.

## 14. Validation matrix per phase

Minimum for documentation/guardrail-only phases:

- documentation links;
- architecture inventory generation;
- existing full Node suite;
- existing companion tests;
- workflow/shell validation.

Minimum for Node architecture phases:

- TypeScript build;
- lint/format check;
- unit tests;
- process integration tests;
- compiled-tree/package tests;
- companion tests if contracts changed;
- `git diff --check` equivalent;
- clean package content inspection.

Minimum for storage phases:

- all above;
- previous-version migration fixtures;
- interruption/retry/rollback tests;
- permissions tests;
- clean Homebrew upgrade smoke.

Minimum for live phases:

- all relevant Node/Swift tests;
- complete static corpora;
- differential analyzer report;
- engine protocol compatibility;
- selected physical-device lanes for changed claims.

Minimum for companion phases:

- Swift build/test;
- deterministic feature-model tests;
- accessibility/visual smoke for affected screens;
- old/new helper protocol compatibility where affected.

## 15. Stop conditions

Stop the phase and report rather than improvising when:

- preserving an invariant appears impossible;
- current main materially contradicts the plan;
- the selected Node/SQLite packaging path fails on a clean supported install;
- a migration cannot be made idempotent and recoverable;
- the Swift analyzer cannot be shipped without an unacceptable first-run build or dependency burden;
- physical evidence contradicts the intended live-routing policy;
- a compatibility path would need to become permanent;
- the phase requires a product decision rather than an engineering choice.

A stop report must include evidence, attempted alternatives, the smallest decision required, and a recommended choice.

## 16. Definition of done for the executing agent

Do not report only that files were moved or tests passed.

Report:

- what responsibility moved;
- which hidden behavior became explicit;
- which old mechanism was deleted;
- which compatibility mechanism remains and its deadline;
- exact validation;
- self-review findings and fixes;
- residuals outside scope;
- the next phase and why it is now safer.