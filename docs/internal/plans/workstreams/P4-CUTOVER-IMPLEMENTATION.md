# P4-CUTOVER-IMPLEMENTATION

## Role

Serialized Phase-4 authority-transition implementation worker. This workstream may implement the production cutover/rollback orchestration and red-zone composition needed to move durable domain authority from legacy JSON to SQLite, but it MUST NOT perform the real maintenance-window migration, installed Homebrew upgrade, or authority switch on the user's Mac.

## Exact audited base

Base product: `bde5c1993112678430423ba32e7fb02b9bb5c9a1`.

Required independent pre-cutover audit: PR #151 at `f39da9c6bd5c1bfca9b9e4147d2bbc2c1439d4d3`, Verify #1108 / run `31848127993` PASS, P0/P1/P2/P3 = 0/0/0/2, verdict READY FOR A SEPARATE CUTOVER DECISION/WORKSTREAM.

The two P3 items are mandatory pre-authority-switch maintenance-window preflights, not part of repository implementation:

1. live-root migration/helper staging;
2. real installed Homebrew v0.6.1 -> candidate upgrade.

## Required implementation outcome

Implement the smallest coherent production authority-transition architecture that can be independently reviewed and later executed inside the maintenance window.

The implementation must provide:

- one explicit, durable, restart-safe authority decision for each durable Phase-4 domain or one clearly justified global authority epoch that cannot produce partial contradictory domain authority;
- operation-scoped read routing to exactly one authoritative backend;
- write routing to exactly one authoritative durable backend;
- no permanent dual write;
- final locked legacy snapshot/import/projection equality immediately before activation;
- rollback-window state and revision/epoch fencing;
- executable rollback that exports the CURRENT SQLite durable state back to legacy-compatible form before returning legacy authority where required;
- restart/idempotency behavior across preparation, activation, rollback, and retry;
- central helper/runtime composition using the authority boundary rather than hard-coded legacy compatibility;
- operator-visible status/doctor evidence for current authority, rollback readiness/window, and failed/blocked transition state without making diagnostics mutating.

Reuse the validated pairing primitives already in ancestry where their semantics fit: `SqlitePairingAuthorityRepository`, `PairingAuthorityReadRepository`, `PairingCutoverCoordinator`, `PairingRollbackExport`, locked legacy snapshots, exact evidence fencing, and rollback-window vocabulary. Do not duplicate a second pairing authority model.

Device builds currently hard-code compatibility authority to legacy. Sessions currently have only the frozen six-field durable SQLite projection while runtime/process state remains filesystem-owned. The implementation must close those authority-routing gaps without broadening durable session ownership.

## Session boundary is frozen

SQLite may own exactly the durable session fields already accepted:

- id
- token
- project
- scheme
- simulatorUDID
- createdAt

Runtime/process/session claims remain filesystem/runtime state. After cutover, any filesystem session record that still exists for runtime ownership must not remain an independent writable authority for those durable fields. Rollback must merge/export current SQLite durable values through the frozen projection under the existing session lock without losing legitimate runtime-only state.

## Schema rule

Do not alter migrations v1-v8, their names, statements, order, or checksums.

If durable authority state cannot be implemented safely without new persistent schema, append the minimum new migration(s) after v8 and explain why. A new schema version changes the final maintenance-window migration target and MUST be called out for independent requalification; do not hide it.

Prefer reusing existing validated state where semantically correct rather than inventing schema merely for convenience.

## Maintenance-window stop conditions that the implementation must support

The code/runbook must make the PR #151 stop conditions enforceable, including:

- exact frozen candidate and exact-head Verify;
- explicit serialized maintenance authorization;
- installed release provenance and exact helper/process identity;
- writer quiescence and exact locks;
- private permissions;
- current authoritative fingerprints/revisions;
- coherent `schema_migrations` and DB integrity/FK/WAL health;
- verified SQLite-consistent pre-migration rollback snapshot;
- verified legacy backups;
- successful live migration/reopen/idempotency;
- installed candidate helper health;
- final locked current pairing/device/session projection equality;
- zero unresolved shadow mismatches;
- rollback readability;
- no cleanup or process authority from SQLite;
- final freshness recheck immediately before switch;
- one atomic single-authority transition;
- post-switch transactional read/write/reopen proof;
- executable rollback;
- fail-closed abort on busy/corrupt/incompatible/permission/identity/mismatch/rollback-material failure.

## Deliberately forbidden in this worker

Do not:

- run the real Homebrew upgrade;
- stop/restart the real helper;
- migrate the live real state root;
- change the real authority selector/state;
- delete/rename/expire legacy state or rollback material;
- execute historical/orphan/manual-review artifact cleanup;
- remove rollback readers;
- finalize/expire the rollback window;
- start Phase 5 production work;
- merge draft architecture PRs.

All environment-mutating proof belongs to the later explicitly authorized maintenance window after this implementation has exact-head Verify and an independent code audit.

## Verification

Add strong behavior/component/process tests for:

- legacy authority remains default on upgrade;
- prepare/import/activate sequence with locks and evidence fencing;
- stale source/revision/epoch rejection;
- each domain routes reads/writes to exactly one authority;
- no fallback to the non-authoritative backend after selected-backend failure;
- no permanent dual write;
- restart before/after activation;
- current-state rollback export and authority restoration;
- session rollback merge preserves runtime-only fields while durable SQLite fields are authoritative;
- rollback-window boundary semantics;
- failure at every important crash boundary;
- post-switch reopen/read/write transactionality;
- diagnostics/status remains read-only and accurately reflects authority/rollback state;
- no artifact cleanup or process termination authority is introduced.

Run focused tests, architecture, strict types, formatting/lint, full `npm run check`, and exact-head hosted Verify including clean Homebrew/service, YAML/shell, and iOS.

## Handoff

Open one draft PR against `agent/arch-ws-P4-INTEGRATION-CORRECTIONS-R1-operator-diagnostics`. Do not merge.

The PR must state:

- exact base/head;
- all authority states and transition graph;
- whether schema remains v8 or any new migration was appended;
- every production reader/writer routing change;
- exact lock/freshness/evidence boundary;
- crash/restart semantics;
- rollback procedure and retained material;
- confirmation real maintenance-window operations were NOT executed;
- exact Verify result;
- exact remaining steps before maintenance execution.

Final status can only be READY FOR INDEPENDENT CUTOVER-CODE AUDIT, never authority-switch authorized.