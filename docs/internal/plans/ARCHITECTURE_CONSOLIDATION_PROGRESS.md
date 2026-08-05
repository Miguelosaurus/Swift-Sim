# Architecture Consolidation Progress

This is the compact execution ledger for the architecture consolidation program. Pull-request bodies, checkpoint reports, ADRs, and Git history retain the detailed implementation record. Phase rows record validated implementation commits; documentation-only final heads are recorded in the owning PR body after the final metadata commit.

The active execution control is [the batched-execution amendment](ARCHITECTURE_CONSOLIDATION_BATCHED_EXECUTION_AMENDMENT.md), authorized by Miguel on 2026-08-04. It preserves phase boundaries, rollback points, fail-closed behavior, mandatory checkpoint records, final Luna local verification, and final Miguel merge authorization while allowing provisional stacked work between checkpoints.

## Program status

| Phase | Scope | Status | PR or stack | Base | Validated implementation | Key residual |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Baseline and guardrails | Merged | [#23](https://github.com/Miguelosaurus/Swift-Sim/pull/23) | `4dfa15f` | `2a2239c`; merge `6f356df` | Existing debt is baselined and decrease-only |
| 1 | TypeScript and package foundation | Merged | [#24](https://github.com/Miguelosaurus/Swift-Sim/pull/24) | `6f356df` | `2151d35`; merge `820ff2e` | Mixed JS/TS transition remains; compiled `dist` is runtime output |
| 2 | Explicit infrastructure primitives | Checkpoint 1 hosted-green; draft stack unmerged | [#26–#33](https://github.com/Miguelosaurus/Swift-Sim/pull/33) | `820ff2e` | `d441798` | Weak delivery identity and unmigrated command/process call sites |
| 3 | Helper and HTTP decomposition | Not started | — | Phase 2 stack tip after final checkpoint metadata | — | Provisional continuation only after final Checkpoint 1 documentation Verify |
| 4 | Repository interfaces and SQLite migration | Not started | — | — | — | Legacy reader/rollback must remain until final local verification |
| 5 | Preload removal | Not started | — | — | — | Checkpoint 2 required before Phase 6 |
| 6 | Live reload module split | Not started | — | — | — | — |
| 7 | SwiftSyntax analyzer | Not started | — | — | — | Newly permissive cases remain disabled without physical proof |
| 8 | iOS companion feature architecture | Not started | — | — | — | Checkpoint 3 required before Phase 9 |
| 9 | Test, docs, and release consolidation | Not started | — | — | — | — |
| 10 | Product reliability proof | Not started | — | — | — | External-beta evidence cannot be manufactured by repository automation |

## Mandatory architecture checkpoints

| Checkpoint | Trigger | PR / implementation head | Repository review complete | Repository corrections complete | Deferred local gates captured | Provisional next phase authorized by amendment | Final Luna verification | Final Miguel merge authorization | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Phase 2 complete; before Phase 2 merge | PR #33 / `d441798` | Yes | Yes | Yes | Yes, Phase 3 after final metadata Verify | No | No | Hosted-green; stack remains draft and unmerged |
| 2 | Phase 5 complete; before Phase 6 | — | No | No | No | No | No | No | Pending |
| 3 | Phase 8 complete; before Phase 9 | — | No | No | No | No | No | No | Pending |

Checkpoint 1 records:

- [Canonical state report](checkpoints/CHECKPOINT_1_STATE.md)
- [Canonical independent-review prompt](checkpoints/NEXT_AGENT_PROMPT_CHECKPOINT_1_CURRENT_STATE.md)
- Dated audit snapshots remain beside the canonical files.
- Repository verdict: proceed provisionally under the batched-execution amendment.
- Remaining severity: P0 0, P1 0, P2 2, P3 1.
- Merge authorization: not granted; persistent-local/device evidence remains delegated to Luna.

## Current architecture metrics

| Metric | Phase 0 baseline | Current at Checkpoint 1 | Target |
| --- | ---: | ---: | ---: |
| Production source files | 74 | 92 | Responsibility-oriented modules without framework-shaped sprawl |
| Production JavaScript files | 67 | 76 | 0 canonical JS implementation files after migration, excluding intentional wrappers |
| Production TypeScript files | 0 | 9 | Canonical Node implementation |
| Production Swift files | 7 | 7 | Feature-organized |
| Named infrastructure ports | 0 | 10 | Stable narrow boundary |
| Preload/runtime-patch modules | 30 | 30 | 0 |
| Built-in monkey-patch evidence modules | 10 | 10 | 0 |
| Source-text implementation tests | 28 | 28 | 0 |
| Direct `child_process` production importer files | 28 | 28 | Approved composition/infrastructure owners only |
| Legacy destructive-filesystem importer files | 26 | 25 | 0 legacy owners |
| Dedicated destructive-filesystem infrastructure owners | 0 | 3 | Explicit stores only |
| Largest Node production file | 2,821 (`mac-helper/src/liveReload.js`) | 2,821 | <= 800 lines or ADR |
| Largest Swift production file | 2,562 (`Companion/SwiftSimCompanion/SessionStore.swift`) | 2,562 | <= 800 lines or ADR |
| Writable JSON domain-state candidates | 29 | 29 | 0 writable domain stores after migration window |
| Supported Node line | >=20 | 24.x | Supported pinned LTS |

## Phase 0 — Baseline and architectural guardrails

- Status: Merged
- Branch: `agent/architecture-consolidation-phase-0-guardrails`
- PR: [#23](https://github.com/Miguelosaurus/Swift-Sim/pull/23)
- Base SHA: `4dfa15ff76b5bd046f7ad02ee9f8d963d02d62cb`
- Validated implementation: `2a2239c1e49df83b8b75ddc42a363e73a11f0655`
- Merge commit: `6f356df3c1e1e91499b3d05efe4308337cc7ff6b`
- Date: 2026-08-04

### Outcome

- Added generated architecture inventory and immutable Git-history-backed baseline policy.
- Added decrease-only caps and exact ADR-backed/time-bounded exceptions for preload/runtime patches, process/filesystem authority, source-text tests, and oversized production files.
- Added event-safe pull-request/push history selection and extensive scanner bypass regressions.
- Added ADR-0001 through ADR-0005 and architecture navigation.
- Added the architecture gate to the authoritative verification workflow.
- Changed no product runtime behavior.

### Validation

- Architecture inventory was deterministic and passed its focused 28-test suite.
- Final source/release gate passed 456 tests.
- iOS companion tests passed 30/30.
- Post-merge Verify run `30920938939` passed on merge commit `6f356df3c1e1e91499b3d05efe4308337cc7ff6b`.

### Self-review

| Severity | Found | Fixed | Remaining |
| --- | ---: | ---: | ---: |
| P0 | 0 | 0 | 0 |
| P1 | 7 | 7 | 0 |
| P2 | 6 | 6 | 0 |
| P3 | 1 | 1 | 0 |

### Rollback and residuals

- Rollback: revert PR #23; no user state was touched.
- Existing preloads, direct infrastructure access, JSON stores, source-text tests, and oversized files remained deliberately baselined for later phases.
- The lexical inventory scanner remains documented and fail-closed for supported static forms; dynamic/computed forms require later AST-aware enforcement if introduced.

## Phase 1 — TypeScript and package foundation

- Status: Merged
- Branch: `agent/architecture-consolidation-phase-1-typescript-foundation`
- PR: [#24](https://github.com/Miguelosaurus/Swift-Sim/pull/24)
- Base SHA: `6f356df3c1e1e91499b3d05efe4308337cc7ff6b`
- Exact final PR head: `2151d35511dcefec2bef8bd4501560598581d629`
- Merge commit: `820ff2e2863e06eab908da70229c7991fd85c65c`
- Date: 2026-08-04

### Outcome

- Pinned Node 24, TypeScript 5.9.3, Node types, ESLint, and Prettier.
- Established strict NodeNext compilation with `allowJs`, emitted ignored `dist/`, no production runtime transpiler, and compiled package/Homebrew entrypoints.
- Added characterization-backed validators for actual session, build, pairing, invite, delivery, command, process, and runtime-journal records.
- Made source/compiled behavior, hermetic compiled execution, clean npm package installation, package-root resolution, and isolated Homebrew service lifecycle authoritative gates.
- Removed `skipLibCheck` and avoided broad lint/format rewrites.
- Merged the batched-execution amendment into Phase 1 before merge.

### Validation

- Local Node 24 gate passed strict types, formatting, lint, 457 source tests, compiled characterization, hermetic execution, package inspection/install, and safe Homebrew preflight.
- Isolated clean Homebrew install/service/restart proof passed.
- iOS companion tests passed 30/30.
- Exact-final-head Verify run `30943330191` passed at `2151d35511dcefec2bef8bd4501560598581d629`.

### Self-review

| Severity | Found | Fixed | Remaining |
| --- | ---: | ---: | ---: |
| P0 | 0 | 0 | 0 |
| P1 | 5 | 5 | 0 |
| P2 | 3 | 3 | 0 |
| P3 | 0 | 0 | 0 |

### Rollback and residuals

- Rollback: revert PR #24; no data migration occurred.
- Existing JavaScript remained canonical during the mixed-source transition.
- Source checkout wrappers require a build; shipped npm/Homebrew bins execute emitted JavaScript.
- A public tagged-release upgrade remained outside this phase.

## Phase 2 — Explicit infrastructure primitives

- Status: Implementation complete, Checkpoint 1 hosted-green, draft stack unmerged
- Base commit: `820ff2e2863e06eab908da70229c7991fd85c65c`
- Code implementation head: `d44179868fee4b62af5376b3344a40aca0b917d2`
- Dates: 2026-08-04 to 2026-08-05
- Checkpoint relationship: Checkpoint 1 complete for repository-hosted evidence; final Luna verification and final Miguel merge authorization remain pending

### Stack order

| Unit | PR | Base branch / SHA | Exact validated head | Verify run | State |
| --- | ---: | --- | --- | ---: | --- |
| 2A — port contracts | [#26](https://github.com/Miguelosaurus/Swift-Sim/pull/26) | `main` / `820ff2e2863e06eab908da70229c7991fd85c65c` | `f6d5338df4bb392543bb1db7ac9a597e58d040b0` | `30946128136` | Open, draft, unmerged |
| 2B — foundation adapters | [#27](https://github.com/Miguelosaurus/Swift-Sim/pull/27) | Phase 2A / `f6d5338df4bb392543bb1db7ac9a597e58d040b0` | `932241d0b60cbe27aec31db125635bbdec24dc8a` | `30948591408` | Open, draft, unmerged |
| 2C — origin delegation | [#28](https://github.com/Miguelosaurus/Swift-Sim/pull/28) | Phase 2B / `932241d0b60cbe27aec31db125635bbdec24dc8a` | `110b2422ecc5b57fd28bbffaa45762eb518f315b` | `30950707093` | Open, draft, unmerged |
| 2D — persistence adapters | [#29](https://github.com/Miguelosaurus/Swift-Sim/pull/29) | Phase 2C / `110b2422ecc5b57fd28bbffaa45762eb518f315b` | `4b175a472ca009498e27e43950dfb09bd26c9408` | `30952061308` | Open, draft, unmerged |
| 2E — lock manager | [#30](https://github.com/Miguelosaurus/Swift-Sim/pull/30) | Phase 2D / `4b175a472ca009498e27e43950dfb09bd26c9408` | `092ec816b8684f36e3900ed6826eead8d12b29a3` | `30953444594` | Open, draft, unmerged |
| 2F — artifacts/logger | [#31](https://github.com/Miguelosaurus/Swift-Sim/pull/31) | Phase 2E / `092ec816b8684f36e3900ed6826eead8d12b29a3` | `ecb2e7f926787e24bb73e432c436c6b4b11c4574` | `30954907621` | Open, draft, unmerged |
| 2G — command runner | [#32](https://github.com/Miguelosaurus/Swift-Sim/pull/32) | Phase 2F / `ecb2e7f926787e24bb73e432c436c6b4b11c4574` | `4260dbf58cb04a97b991bdd17ae7152f76dcd442` | `30989529025` | Open, draft, unmerged |
| 2H — process supervisor | [#33](https://github.com/Miguelosaurus/Swift-Sim/pull/33) | Phase 2G / `4260dbf58cb04a97b991bdd17ae7152f76dcd442` | `d44179868fee4b62af5376b3344a40aca0b917d2` | `30993626853` | Open, draft, unmerged |

### Outcome

- Added ten narrow typed ports: `CommandRunner`, `ProcessSupervisor`, `AtomicFileStore`, `LockManager`, `RuntimeJournalStore`, `ArtifactStore`, `RequestOriginPolicy`, `Clock`, `IdGenerator`, and `Logger`.
- Added a validated immutable runtime container while prohibiting application services from receiving the complete aggregate.
- Added source-loadable, TypeScript-checked Node adapters without a runtime TypeScript loader.
- Moved request-origin decisions behind `RequestOriginPolicy`; the existing HTTP compatibility preload delegates to it.
- Moved the hardened live-engine lifecycle lock algorithm behind `NodeLockManager`; the compatibility module delegates and retains legacy error mapping.
- Added atomic publication/runtime-journal stores, inode-fenced artifact containment, deterministic redacting structured logging, bounded command execution, and identity-authorized process supervision.
- Preserved all current public routes, package layouts, persisted record shapes, process-role authority distinctions, and compatibility preloads.
- Did not begin helper decomposition, SQLite migration, preload removal, live-reload restructuring, analyzer replacement, or iOS redesign.

### Behavioral and safety guarantees

- Command execution requires explicit environment inheritance, deadlines, output limits, accepted exits, and process-group policy.
- Async cancellation/timeout and accepted-parent lingering descendants trigger bounded cleanup; synchronous new-group execution fails closed because Node cannot establish the required detached ownership through `spawnSync`.
- Strong worker/live-engine records may authorize group operations; weak manager/gateway/tunnel records remain exact-PID only.
- Process identities are captured and atomically journaled before return; identity/publication failure rolls back the process.
- Identity is revalidated before signaling and before KILL escalation. Transient post-kill unverifiability is bounded and never grants authority.
- Atomic publication uses exclusive same-directory temporaries, fsync, exact replace/no-replace semantics, owner modes, and cleanup.
- Lock reclamation retains PID/start-token/nonce ownership, quarantine, claim fencing, and replacement-lock protection.
- Artifact operations require prior containment approval and reject traversal, symlink components, and root replacement.
- Logger redaction/bounds are recursive and logging construction/sink failures cannot alter application outcomes.
- Forwarded origin headers are trusted only for loopback proxy sockets; direct remote origin behavior is preserved.

### Validation

Verify run `30993626853` passed at implementation head `d44179868fee4b62af5376b3344a40aca0b917d2` on macOS 26 ARM64 with Node 24:

- architecture inventory and documentation;
- strict TypeScript, formatting, and lint;
- all 457 source tests;
- compiled contracts and every Phase 2 adapter suite;
- real command/process-group, identity, journal, lock, containment, and fault-injection tests;
- hermetic compiled execution;
- clean npm package/archive installation and entrypoints;
- isolated clean Homebrew install, launcher, setup/doctor, service identity, and restart;
- workflow YAML and release-shell syntax;
- iOS companion tests.

Temporary diagnostic commands were removed before the accepted run. The final documentation-only checkpoint head must pass the same Verify workflow before Phase 3 begins.

### Checkpoint review and residuals

| Severity | Remaining | Residual |
| --- | ---: | --- |
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 2 | Weak delivery identity remains exact-PID only; CommandRunner/ProcessSupervisor are not yet production owners |
| P3 | 1 | Preload count remains at the Phase 0 cap until the planned removal phase |

No emergency-stop condition was found. The repository checkpoint verdict is provisional continuation under the batched-execution amendment.

### Deferred evidence

Before final merge, Luna must execute and record:

- persistent installed npm CLI `version`, `setup`, and `doctor --json`;
- persistent helper start/health/restart/stop and orphan/journal inspection;
- clean local Homebrew install/upgrade/uninstall and service lifecycle on the target Mac;
- representative sleep/wake, stale/reused PID, process-group, filesystem-permission, and local-state behavior;
- physical iPhone build/install/renew and available network/signing scenarios;
- final release-candidate smoke checks.

Hosted isolated Homebrew and Simulator evidence is real but does not replace those persistent-local/device gates.

### Migration and rollback

- Data migration: none.
- Irreversible changes: none.
- Rollback: discard or revert the Phase 2 stack in reverse order; persisted external formats and public contracts are unchanged.
- No Phase 2 PR may merge before the complete stacked state receives final Luna evidence and Miguel authorization.

### Next phase

After the final checkpoint-documentation head passes Verify, create Phase 3 from that exact PR #33 head and target the Phase 2H branch. Phase 3 must decompose helper/HTTP responsibilities through explicit application services and route modules, inject only required Phase 2 ports, preserve route/projection contracts, and keep lifecycle/process authority visible. It must not remove preloads, migrate SQLite, or redesign the companion outside its assigned phase.

## Decision log index

| ADR | Decision | Status |
| --- | --- | --- |
| [ADR-0001](../adr/ADR-0001-typescript-compile-to-dist.md) | TypeScript build and runtime model | Accepted |
| [ADR-0002](../adr/ADR-0002-explicit-infrastructure-ports.md) | Explicit process and filesystem infrastructure ports | Accepted |
| [ADR-0003](../adr/ADR-0003-sqlite-domain-state-filesystem-runtime.md) | SQLite domain state / filesystem runtime journal split | Accepted |
| [ADR-0004](../adr/ADR-0004-swift-analyzer-boundary.md) | SwiftSyntax analyzer boundary | Accepted |
| [ADR-0005](../adr/ADR-0005-companion-feature-architecture.md) | Companion feature-state architecture | Accepted |

## Final completion record

Complete only after Phase 10 and final merge authorization.

- Final release:
- Final main SHA:
- Clean install evidence:
- Upgrade/migration evidence:
- Physical-device evidence:
- External beta evidence:
- Remaining published limitations:
- Deleted compatibility paths:
- Deferred future work:
