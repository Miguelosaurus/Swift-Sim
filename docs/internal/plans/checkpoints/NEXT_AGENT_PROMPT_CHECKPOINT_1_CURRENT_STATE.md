# Checkpoint 1 — Independent Review Prompt

Review the complete stacked Phase 2 architecture consolidation in `Miguelosaurus/Swift-Sim`.

## Exact review target

- Stack-tip PR: #33
- Branch: `agent/architecture-consolidation-phase-2h-process-supervisor`
- Phase 2 implementation head before checkpoint docs: `d44179868fee4b62af5376b3344a40aca0b917d2`
- Checkpoint report: `docs/internal/plans/checkpoints/CHECKPOINT_1_STATE.md`
- Parent stack: PRs #26 through #32, all draft and unmerged
- Hosted code validation: Verify run `30993626853` passed

Do not merge any PR and do not begin Phase 3 as part of this review.

## Review objective

Determine whether Phase 2 established a correct, bounded, compatible infrastructure boundary that is safe for provisional Phase 3 work under the batched-execution amendment.

Rank every finding P0, P1, P2, or P3. Report zero-count severities explicitly.

## Required review areas

### 1. Scope and stack integrity

- Confirm PRs #26–#33 form a linear stack with the exact heads listed in the checkpoint report.
- Confirm all remain open, draft, unmerged, and based on the immediately preceding phase branch.
- Confirm Phase 2 did not start helper decomposition, preload removal, SQLite migration, or unrelated iOS redesign.
- Confirm no generated `dist` content is committed.

### 2. Contract and compatibility integrity

- Compare typed contracts against actual current runtime and persisted records.
- Confirm session, build, pairing, invite, delivery, worker, live-engine, runtime-journal, and delivery-process shapes remain compatible.
- Confirm public HTTP paths and request-origin behavior are unchanged.
- Confirm npm/Homebrew compiled entrypoints and integration roots remain correct.
- Look for optional-property, integer/range, discriminator, and legacy-record compatibility gaps.

### 3. Infrastructure ownership

Review all ten ports:

- `CommandRunner`
- `ProcessSupervisor`
- `AtomicFileStore`
- `LockManager`
- `RuntimeJournalStore`
- `ArtifactStore`
- `RequestOriginPolicy`
- `Clock`
- `IdGenerator`
- `Logger`

For each, verify:

- the interface is narrow enough;
- the Node adapter has one coherent responsibility;
- runtime boundaries validate unknown or untrusted inputs;
- no adapter imports a compatibility preload or domain service;
- child-process and filesystem authority is not expanded through architecture-policy exceptions unless the report identifies and justifies it;
- application call-site migration is not falsely claimed where only an adapter exists.

### 4. Command execution

Adversarially review:

- explicit environment inheritance, overrides, and unset precedence;
- executable/argument/cwd/input validation;
- accepted exit codes;
- combined byte-bounded output;
- timeout and cancellation races;
- inherited versus new process groups;
- descendant cleanup after accepted parent exits;
- synchronous fail-closed behavior for cancellation and new process groups;
- spawn errors, invalid PIDs, and unconfirmed termination.

Confirm tests exercise real emitted code and real process groups without relying on source-tree fallbacks.

### 5. Process supervision

Adversarially review:

- role-specific spawn contracts;
- worker and live-engine strong record compatibility;
- delivery weak-record compatibility and exact-PID-only authority;
- identity capture before journal publication;
- rollback when identity capture or journal publication fails;
- PID/process-group validation;
- identity checks before TERM and before KILL escalation;
- leader exit while descendants remain;
- PID/PGID reuse and replacement detection;
- zombie/transient post-kill behavior;
- `waitForExit` classification of exited, timeout, replaced, and unverifiable states;
- abort behavior;
- whether any path can signal without current identity evidence.

Treat the existing delivery identity (`startedAt` plus command fragments) as an explicit residual, not as strong ownership.

### 6. Filesystem, lock, and artifact safety

Verify:

- atomic replacement/no-replace authority belongs to the filesystem operation;
- file and directory fsync behavior is accurate;
- cleanup cannot falsely report publication failure after success;
- lock stale-owner recovery, quarantine, claim/inode fencing, and replacement-lock protection remain intact;
- artifact containment rejects traversal, symlink components, unapproved paths, and root replacement;
- recursive cleanup cannot follow an external symlink target;
- modes and temporary-file cleanup are bounded;
- structured architecture exceptions are exact, ADR-backed, expiring, and do not modify the immutable baseline.

### 7. Origin and logging safety

Verify:

- forwarded headers are trusted only for loopback proxy sockets;
- malformed host/protocol and explicit-base behavior match characterization tests;
- the compatibility preload delegates rather than duplicating policy;
- logger event/value bounds and recursive redaction are sufficient;
- secret-bearing field names, error messages, getters, circular values, and sink failures cannot leak or alter application outcomes.

### 8. Validation truthfulness

- Inspect Verify run `30993626853` and confirm it belongs to the exact implementation head.
- Confirm the authoritative suite includes architecture, types, formatting, lint, all source tests, compiled adapter tests, hermetic execution, package/archive checks, isolated clean Homebrew, release-shell/YAML checks, and iOS tests.
- Confirm temporary diagnostic commands were removed at the reviewed head.
- Confirm the checkpoint report does not claim persistent-local or physical-iPhone evidence that was not executed.

### 9. Architecture metrics and residuals

Validate the checkpoint metrics where practical:

- 95 production source files;
- 9 production TypeScript files;
- 10 named ports;
- 30 preload/runtime-patch modules;
- 28 child-process importers;
- 28 source-text implementation tests;
- 25 legacy destructive-filesystem importers plus 3 dedicated infrastructure owners.

Call out any metric that is inaccurate or misleading.

## Required response format

1. Verdict: `proceed`, `targeted rework`, or `architectural rewrite`.
2. Exact reviewed head and PR state.
3. Severity table with P0/P1/P2/P3 found and fixed counts.
4. Findings ordered by severity, each with concrete file/function evidence and failure scenario.
5. Compatibility and schema verdict.
6. Infrastructure-boundary verdict.
7. Validation evidence verdict.
8. Residual risk register.
9. Whether the batched-execution conditions permit provisional Phase 3 work.
10. Explicit statement that no merge was performed.

A `proceed` verdict requires zero P0/P1 findings and no emergency-stop condition. P2/P3 residuals must remain explicit and assigned to a later phase or external validation owner.
