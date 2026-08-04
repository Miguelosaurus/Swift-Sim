# Next Agent Prompt — Architecture Consolidation Phase 0

Copy the prompt below into the implementation agent after this planning PR is merged.

---

Use the GitHub plugin to work on `Miguelosaurus/Swift-Sim` from the latest `main`.

You are beginning the architecture-consolidation program. Read these files completely before modifying code:

- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_INVARIANTS.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_EXECUTION_GUIDE.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PROGRESS.md`

Execute **Phase 0 — Baseline and architectural guardrails only**.

Do not begin TypeScript migration, helper decomposition, SQLite migration, preload removal, live analyzer replacement, or iOS feature refactoring in this phase.

## Required branch and PR

Create a fresh branch from current `main`:

```text
agent/architecture-consolidation-phase-0-guardrails
```

Open a draft PR targeting `main` when complete. Do not merge it.

## Required deliverables

### 1. Generated architecture inventory

Add a deterministic repository script under an appropriate `scripts/architecture/` directory that inspects the current tracked source tree and emits a stable machine-readable inventory.

The inventory must at minimum record:

- production JavaScript files;
- production TypeScript files;
- production Swift files;
- line counts and the largest production files;
- all modules whose names or imports identify them as preload/runtime patch modules;
- all production imports of `node:child_process`;
- all production imports of destructive or mutation-capable `node:fs` APIs;
- all tests that read production source and assert implementation text, regex, import order, or exact function layout;
- all direct uses of global `fetch` in production;
- all writable JSON domain-state stores and their owning modules;
- package entrypoints and workflow badge targets.

Exclude generated output, dependencies, `.git`, build products, benchmark result artifacts, and fixtures that are not production code. Define production/test/script path rules explicitly in the script rather than relying on an undocumented ad hoc search.

The script must support:

```text
--json
--check
```

`--json` prints the current inventory.

`--check` compares the current tree against a checked-in baseline policy and fails only when architecture debt increases outside an explicit allowlist. Existing debt is baselined, not hidden.

Do not make a hand-edited inventory the source of truth. The checked-in baseline may contain generated counts or allowed paths, but the script must recompute them.

### 2. Monotonic architecture fitness gates

Add a check that is included in the authoritative repository validation path.

The initial gate must prevent:

- new preload/monkey-patch modules;
- new production call sites importing `node:child_process` outside the current generated allowlist;
- new production call sites using destructive filesystem APIs outside the current generated allowlist;
- new source-text implementation tests;
- new production files exceeding 800 lines without an explicit ADR allowlist entry;
- new stale workflow badge references.

Important:

- The baseline must allow current debt so Phase 0 is behavior-preserving.
- The check must be monotonic: later phases can reduce allowlists/counts without reauthorizing deleted debt.
- Do not use fragile substring matching when a small parser or reliable import scan can identify imports. A narrow bootstrap scan is acceptable if it handles ESM imports and CommonJS requires correctly and documents limitations.
- Do not create a gate that fails whenever any existing file changes line count by one. Gate new or increasing debt, not normal edits.

### 3. ADR structure and initial decisions

Create an ADR directory and concise initial ADRs for the settled decisions in the master plan:

1. TypeScript mixed-source compile-to-`dist` migration with no production runtime transpiler.
2. Explicit infrastructure ports replacing preload monkey patches.
3. SQLite for domain state while runtime process journals/leases remain filesystem-backed.
4. Swift analyzer boundary with SwiftSyntax/SwiftParser as the target and fail-closed routing.
5. Feature-scoped iOS companion architecture.

Each ADR must include context, decision, rejected alternatives, consequences, migration strategy, and revisit conditions.

Do not copy the entire master plan into every ADR.

### 4. Documentation navigation

Update internal documentation navigation to link the architecture program, ADRs, and progress ledger clearly.

Keep review-round records under an explicitly historical section. Do not delete them in Phase 0.

### 5. Repository polish verification

Inspect actual workflow files and README badges on current main.

Fix stale badge targets or inaccurate architecture/release links only when verified against the current repository. Do not make broad copy changes.

### 6. Progress ledger

Update `ARCHITECTURE_CONSOLIDATION_PROGRESS.md` with generated baseline metrics and a Phase 0 entry containing:

- exact base and head;
- files added/changed;
- behavior change (`None` expected);
- invariants touched;
- validation;
- self-review findings;
- residuals;
- exact next step for Phase 1.

## Required tests

Add focused tests for the inventory/fitness tooling, including fixtures proving it detects:

- a new preload;
- a new direct child-process importer;
- a new destructive filesystem importer;
- a new source-text implementation assertion;
- a new oversized production file without an ADR exception;
- an invalid badge workflow target;
- allowed current debt without false failure.

Tests must use temporary fixture trees rather than mutating the real repository.

## Validation

Run the complete authoritative validation available on the branch, including:

- architecture inventory tests;
- architecture `--check`;
- existing Node/release suite;
- documentation links;
- workflow YAML validation;
- release shell syntax validation;
- iOS companion tests;
- diff/whitespace check.

If an external hardware gate is impossible, state that clearly; Phase 0 should not require physical-device behavior changes.

## Self-review

Perform your own deep review of the final diff. Do not ask Codex or another automated reviewer to do this work.

Review for:

- baselines that can be manually gamed;
- false positives that would block ordinary development;
- false negatives caused by path or import syntax variants;
- generated files accidentally committed;
- platform-dependent path ordering;
- check behavior that differs locally and in CI;
- stale documentation links;
- accidental behavior changes in package scripts.

Fix all P0/P1/P2 findings introduced or exposed by this phase.

Use the severity definitions in the execution guide; do not inflate every polish issue to P1.

## Prohibited shortcuts

Do not:

- start migrating source to TypeScript;
- rename or split production modules;
- add SQLite;
- delete preloads;
- replace source-text tests without first understanding the invariant they protect;
- introduce broad lint/format churn;
- commit generated local diagnostics or absolute paths;
- add temporary workflows or source transformers and leave them in the branch;
- ask for another open-ended review round.

## Final report

Return:

- draft PR number and link;
- branch and exact head;
- baseline metrics;
- files added/changed;
- validation results;
- self-review severity table;
- residual risks;
- a concise Phase 1 handoff recommendation.

Do not begin Phase 1 in the same turn.

---