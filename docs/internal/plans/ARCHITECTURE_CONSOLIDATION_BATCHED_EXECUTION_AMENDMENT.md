# Architecture Consolidation Batched Execution Amendment

Status: mandatory execution control

Authorized by Miguel on 2026-08-04.

This document is a normative amendment to:

- `ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md`;
- `ARCHITECTURE_CONSOLIDATION_EXECUTION_GUIDE.md`;
- `ARCHITECTURE_CONSOLIDATION_CHECKPOINT_PROTOCOL.md`;
- `ARCHITECTURE_CONSOLIDATION_PROGRESS.md`.

Where this amendment conflicts with those documents about execution order, scheduled stops, local verification timing, phase merge timing, or who performs local verification, this amendment controls. It does not weaken the product invariants, architecture decisions, phase scopes, fail-closed rules, rollback requirements, or evidence standards.

## 1. Purpose

The repository implementation agent should complete as much of the ten-phase architecture program as can be done through repository inspection, GitHub changes, automated CI, structured self-review, and remote integration tests before requiring another local implementation agent.

Miguel is not expected to run local commands or relay local verification between phases. Local Mac, Homebrew, Simulator, physical-device, network-environment, and release-machine verification is consolidated into one final Luna handoff when Luna usage is available again.

Deferred verification must remain visible. A skipped local gate is `deferred`, never `passed`, `equivalent`, or implied by unrelated CI.

## 2. Responsibilities

### Repository implementation agent

The repository implementation agent owns:

- architecture and implementation decisions within the approved plan;
- source changes, migrations, compatibility layers, tests, documentation, ADRs, and release scripts;
- one bounded adversarial self-review for every phase;
- fixing all introduced or exposed P0/P1/P2 findings that repository evidence can resolve;
- GitHub Actions and every other remotely available validation path;
- draft PR creation, phase declarations, progress-ledger updates, checkpoint reports, and residual tracking;
- creation of the final Luna verification handoff;
- final review of Luna's evidence and any repository corrections it exposes.

The repository implementation agent must not claim to have run a local tool, Mac service, Simulator, iPhone, physical network, or external-user scenario that it did not actually run.

### Luna final local verifier

Luna performs one consolidated local verification program after the repository implementation agent has completed all remotely implementable work and prepared the final handoff.

Luna owns:

- clean local checkout and dependency verification;
- local Node 24, package, Homebrew, service, process, filesystem, SQLite, Xcode, Simulator, Swift package, analyzer, and physical-device checks listed in the handoff;
- reproducing deferred phase gates in the exact final stacked state;
- recording exact commands, environment, results, failures, logs, and evidence;
- fixing verification defects when the required correction is clear and architecture-preserving, or returning a precise blocker when it is not;
- rerunning affected local checks after corrections.

Luna is not authorized to silently redesign settled architecture, weaken tests, bypass fail-closed behavior, delete rollback paths early, or mark unrun evidence as passed.

### Miguel

Miguel is not required to execute commands between phases.

Miguel remains the authority for:

- changing product or architecture goals;
- approving any deliberate deviation that changes a non-negotiable invariant;
- final authorization to merge the verified phase stack;
- arranging evidence that neither repository automation nor Luna can manufacture, especially genuine external-beta-user results.

## 3. Batched phase and branch strategy

Phase 1 may merge after its current repository review because Luna already completed its required local validation.

Beginning with Phase 2:

1. Keep one coherent branch and one draft PR per numbered phase or approved subphase.
2. Preserve the original phase boundaries and rollback instructions.
3. When a predecessor phase is still unmerged, create the next phase branch from the predecessor's exact reviewed head and target the predecessor branch. This is a deliberate stacked-PR program, not an accidental long-lived branch.
4. Record the parent branch, parent SHA, phase implementation SHA, exact PR head, and deferred local gates in every PR body and progress entry.
5. Do not merge Phase 2 or later merely to unblock the next phase. Continue by stacking the next draft PR.
6. Do not combine unrelated phases into one implementation diff.
7. At the end of repository implementation, preserve the exact stack order so the PRs can be retargeted and merged sequentially after final local verification.

A phase may be split into mechanical and semantic sub-PRs when that materially improves reviewability. The final sub-PR remains responsible for the complete phase gate.

## 4. Validation split

### Run during each phase when available remotely

The repository implementation agent runs and records, as applicable:

- TypeScript compilation and strict type checks;
- lint, formatting, source validation, architecture inventory, and ratchets;
- unit, component, contract, migration-fixture, process, and fault-injection tests available in CI;
- compiled-tree and installed-package tests;
- package-content, release-archive, manifest, checksum, YAML, and shell validation;
- GitHub Actions on the exact final PR head;
- static Swift builds or tests available on hosted runners;
- differential analyzer corpus runs;
- authorization matrices and public/private route tests;
- self-review of the actual diff and all relevant compatibility paths.

A remotely run Mac or Simulator check counts as evidence only when the exact runner, command, environment, and result are recorded. It does not automatically replace a final local upgrade, persistent-service, physical-device, accessibility, or network-environment gate.

### Defer to the final Luna handoff

Defer only checks that genuinely require or materially benefit from the real local environment, including:

- clean local Homebrew install, upgrade, uninstall, and service lifecycle on the target Mac;
- persistent helper restart, sleep/wake, stale-process, process-group, filesystem-permission, and local-state recovery behavior;
- representative legacy-state migration, backup, rollback, interruption, corruption, and busy-database exercises on the target filesystem;
- Xcode and Simulator execution not adequately reproduced by hosted CI;
- visual, interaction, accessibility, and actor-safety observations requiring the built companion;
- Swift analyzer packaging and execution in the intended release environment;
- physical iPhone installation, verification, hot reload, signed fallback, Tailscale, Wi-Fi, cellular, USB, signing, and entitlement scenarios;
- compatibility checks across locally available macOS/Xcode/device combinations;
- final release-candidate smoke tests.

External beta-user evidence remains a separate Phase 10 residual when Luna cannot supply genuinely independent users.

## 5. Scheduled checkpoint amendment

Checkpoints 1, 2, and 3 remain mandatory architecture records, but they no longer require Miguel to relay a separate review or authorize continuation between phases during this batched execution program.

At each scheduled checkpoint, the repository implementation agent must:

1. finish the checkpoint phase's remotely implementable scope;
2. run every available remote validation;
3. perform the required bounded adversarial architecture review;
4. create and commit the checkpoint state report and current-state review prompt using exact repository facts;
5. explicitly list every deferred local, hardware, network, visual, migration, and external gate;
6. fix all repository-resolvable P0/P1/P2 findings;
7. leave the checkpoint phase and all dependent PRs draft and unmerged;
8. continue provisionally to the next phase only when the continuation conditions below are satisfied.

### Provisional continuation conditions

The implementation agent may continue after a scheduled checkpoint when all are true:

- no unresolved P0 or P1 finding remains;
- no known data-loss, authorization, wrong-process, public-route, signing, or fail-open regression remains;
- no emergency-stop condition in the original checkpoint protocol applies;
- the phase's architecture boundary is coherent enough for the next phase to depend on it;
- each P2 is fixed or explicitly deferred because only final local evidence can resolve it;
- every deferred gate has an owner and exact final-handoff test;
- the checkpoint state report says `provisional continuation under batched execution amendment` rather than claiming final approval.

### Checkpoint records

The progress ledger should replace the old between-phase approval semantics for this run with:

```text
Batched execution authorized by Miguel: yes, 2026-08-04
Repository checkpoint review complete: yes/no
Repository corrections complete: yes/no
Deferred local gates captured: yes/no
Provisional next phase authorized by amendment: yes/no
Final Luna verification complete: yes/no
Final Miguel merge authorization: yes/no
```

The current-state review prompt remains useful as a complete repository review specification and as context for the final review after Luna returns evidence. It must not falsely say that implementation is waiting for Miguel between phases.

## 6. Safety limits while local verification is deferred

Batched implementation is not permission to cross an irreversible boundary without evidence.

### Phase 4 storage migration

The implementation agent may build the schema, repository APIs, import, backups, resumability, shadow reads, comparison tooling, rollback path, doctor support, and staged cutover logic.

Until final Luna verification succeeds:

- do not delete legacy user state;
- do not expire the rollback window;
- do not remove the legacy reader needed for recovery;
- keep destructive cleanup disabled or explicitly guarded in unmerged code;
- keep migration failure fail-closed and recoverable.

Because the phase stack remains unmerged, a completed cutover implementation may exist on the draft branch, but the final handoff must prove it before merge.

### Phase 5 preload removal

Preloads and monkey patches may be removed in the unmerged phase branch only after repository tests prove their call sites use explicit infrastructure ports and the checkpoint report maps every former guarantee to a visible owner.

Final Luna verification must rerun packaged/raw entrypoint, service, process-ownership, lock, timeout, descendant cleanup, and recovery tests before merge.

### Phase 7 analyzer replacement

The analyzer, protocol, package integration, differential corpus, and fail-closed routing may be implemented remotely.

Any `legacy rebuild -> new hot` result remains disabled and routes to signed rebuild until physical-device proof and explicit review exist. Lack of hardware evidence may reduce permissiveness; it must never increase it.

### Phase 8 companion architecture

The repository implementation agent may complete the structural refactor and deterministic tests. User-visible redesign is not allowed merely to simplify the refactor.

Visual, interaction, and accessibility evidence is deferred to Luna and must be listed screen by screen in the final handoff.

### Phase 10 reliability proof

The implementation agent should complete all automatable preparation upfront:

- compatibility-matrix scripts and fixtures;
- redacted diagnostic bundles;
- structured issue and beta-report templates;
- release checklists;
- install, update, recovery, and removal automation;
- documentation of known limits.

The phase cannot be declared fully complete until the required real-environment and external-beta evidence exists.

## 7. Stop conditions that still block batched continuation

Stop the repository program and return a precise blocker when any of these occurs:

- an invariant cannot be preserved with the approved architecture;
- an implementation would require irreversible user-state deletion before final verification;
- a process can be signaled without exact verified ownership;
- a private capability becomes reachable through a public boundary;
- the analyzer becomes more permissive without physical proof;
- a storage migration cannot be made resumable and rollback-safe;
- a new native dependency materially changes release architecture without an ADR and package proof;
- a phase exposes an unresolved P0/P1;
- the stacked branch structure can no longer preserve a clear rollback or review boundary;
- hosted CI cannot compile or test enough of a foundational abstraction to review it responsibly;
- completing the companion split requires a user-visible redesign;
- the plan itself is no longer the best architecture based on repository evidence.

A normal missing local runner, Simulator, iPhone, Homebrew installation, or Luna availability is not by itself a stop condition. Record it for the final handoff and continue conservatively.

## 8. Completion and merge sequence

After all remotely implementable phase work is complete:

1. Freeze the final integration head and every phase PR head.
2. Create the final Luna handoff specified below.
3. Stop implementation except for defects found during handoff review.
4. Luna performs the consolidated local verification program.
5. Apply fixes to the earliest owning phase branch and propagate or rebuild downstream stacked heads as necessary.
6. Rerun affected GitHub Actions and repository review.
7. Update checkpoint reports, PR bodies, progress ledger, and final handoff with exact corrected SHAs.
8. Obtain Miguel's final merge authorization.
9. Retarget and merge the phase PRs sequentially in plan order, verifying each expected head.
10. Run a final post-merge release and compatibility smoke check.

No later PR may be merged ahead of an unmerged predecessor.

# Final Luna handoff

Before stopping repository implementation, create:

```text
docs/internal/plans/LUNA_FINAL_LOCAL_VERIFICATION_HANDOFF.md
```

This is a required executable handoff, not a narrative summary. It must contain the following sections.

## A. Exact review target

- repository;
- final integration branch and head;
- every phase and subphase PR in merge order;
- each PR's base branch, base SHA, validated repository implementation SHA, and exact head;
- checkpoint report paths;
- all ADRs added or changed;
- dependency, package, database, analyzer, companion, and release versions.

## B. Deferred-evidence ledger

For every phase gate, classify each item as:

- already proven remotely;
- must be rerun locally;
- physical-device-only;
- visual/accessibility-only;
- external-beta-only;
- not applicable, with reason.

Nothing may disappear merely because a later broad command passed.

## C. Clean environment preparation

Provide exact instructions for:

- preserving any existing Swift Sim installation and state;
- creating backups;
- using isolated HOME, ports, prefixes, keychains, derived data, and test devices where possible;
- installing the pinned Node, Homebrew dependencies, Xcode/Swift toolchains, and package dependencies;
- checking out the exact final head with a clean worktree;
- capturing environment versions before running tests.

## D. Automated local command matrix

List exact commands, expected outputs, timeouts, and generated evidence for:

- source, type, lint, format, architecture, and full tests;
- compiled tree and installed package;
- clean Homebrew install, upgrade, service start/restart/stop, uninstall, and launch identity;
- helper and CLI commands;
- package contents and release archives;
- SQLite migration, interruption, rollback, corruption, busy handling, and doctor diagnostics;
- process ownership, stale/reused PID, descendants, deadlines, locks, atomic publication, containment, and redaction;
- Swift package, analyzer build/protocol/version/checksum/differential corpus;
- iOS build and deterministic tests.

## E. Manual Mac and Simulator matrix

List exact scenarios for:

- fresh setup and existing-user upgrade;
- helper restart and Mac sleep/wake;
- paired and unpaired states;
- app library, builds, sessions, cleanup, cancellation, and recovery;
- Simulator session start/stop/reuse;
- every companion feature flow affected by Phase 8;
- visual parity, navigation, loading/error states, accessibility labels, Dynamic Type, and VoiceOver checks;
- local-network and Tailnet behavior available without a physical iPhone.

## F. Physical-device and network matrix

List exact supported scenarios for:

- signed install and verification;
- automatic and manual signing;
- `.xcodeproj` and `.xcworkspace`;
- single and multiple schemes;
- USB, Wi-Fi, private Tailnet, and cellular install links;
- hot reload, proof evaluation, conservative fallback, and structural rebuild;
- app data preservation and replacement;
- expired links, stale pairing, interrupted build, helper restart, and device reconnect;
- representative SwiftUI, UIKit bridge, package, resource, entitlement, and structural edits.

Record failed valid attempts as evidence. Never remove them from the report merely because a later attempt passed.

## G. Correction workflow

For each failure, Luna must report:

- severity;
- exact command or scenario;
- expected versus actual behavior;
- environment and relevant logs;
- owning phase and likely files;
- whether the failure invalidates downstream phases;
- the correction commit if Luna safely fixes it;
- every test rerun after the correction.

Corrections belong on the earliest phase branch that introduced the defect. Downstream stacked branches must then be updated and reverified.

## H. Results and residuals

Return:

- a phase-by-phase pass/fail/deferred table;
- exact final corrected heads;
- checkpoint corrections required;
- remaining P0/P1/P2/P3 findings;
- environment-specific limitations;
- external-beta evidence still missing;
- recommendation: merge, correct and rerun, reduce scope, or stop.

## I. Luna stop rule

Luna must stop and return evidence instead of forcing completion when it finds:

- data loss or unrecoverable migration behavior;
- wrong-process termination or unverifiable ownership;
- public access to a private capability;
- a newly permissive analyzer decision without physical proof;
- signing or installation behavior that contradicts release claims;
- a companion regression that requires product redesign;
- an architectural correction that conflicts with an ADR or this plan;
- an environment requirement the project does not document or support.

## J. Evidence that cannot be delegated to Luna alone

The handoff must end with a separate list of evidence still requiring Miguel or independent users, especially:

- external beta users who did not develop Swift Sim;
- hardware, carrier, macOS, Xcode, or signing configurations Luna cannot access;
- final product judgment on published compatibility limits;
- final merge authorization.

These are honest Phase 10 residuals, not Luna failures.
