# Architecture Consolidation Progress

This is the compact execution ledger for the architecture consolidation program. Pull-request bodies, checkpoint reports, ADRs, and Git history retain the detailed implementation record. Phase rows record validated implementation commits; documentation-only final heads are recorded in the owning PR body after the final metadata commit.

The active execution control is [the batched-execution amendment](ARCHITECTURE_CONSOLIDATION_BATCHED_EXECUTION_AMENDMENT.md), authorized by Miguel on 2026-08-04. It preserves phase boundaries, rollback points, fail-closed behavior, mandatory checkpoint records, final Luna local verification, and final Miguel merge authorization while allowing provisional stacked work between checkpoints.

## Program status

| Phase | Scope | Status | PR or stack | Base | Validated implementation | Key residual |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Baseline and guardrails | Merged | [#23](https://github.com/Miguelosaurus/Swift-Sim/pull/23) | `4dfa15f` | `2a2239c`; merge `6f356df` | Existing debt is baselined and decrease-only |
| 1 | TypeScript and package foundation | Merged | [#24](https://github.com/Miguelosaurus/Swift-Sim/pull/24) | `6f356df` | `2151d35`; merge `820ff2e` | Mixed JS/TS transition remains; compiled `dist` is runtime output |
| 2 | Explicit infrastructure primitives | Checkpoint 1 hosted-green; draft stack unmerged | [#26–#33](https://github.com/Miguelosaurus/Swift-Sim/pull/33) | `820ff2e` | `d441798` | Weak delivery identity and unmigrated command/process call sites |
| 3 | Helper and HTTP decomposition | Partial implementation through 3G; draft stack unmerged | [#34–#40](https://github.com/Miguelosaurus/Swift-Sim/pull/40) | Phase 2 final metadata / `f21e344` | `7367fa2` | The 2,135-line compatibility helper still owns the main router, process work, persistence, and service orchestration; the Phase 3 gate is not met |
| 4 | Repository interfaces and SQLite migration | Pairing tranche implemented through E4; full phase incomplete and draft | [#41, #44–#50, #52–#54](https://github.com/Miguelosaurus/Swift-Sim/pull/54) | Phase 3G / `7367fa2` | Pairing rollback implementation `7ce31e6`; final E4 head `b1fac0d` | Non-pairing domain repositories, production composition, doctor/export, previous-release upgrade, and full cutover evidence remain required |
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

The live Checkpoint 1 PR head is `f21e344ea18eb0a976630a4ce38cf52bf30a3f47`; `d441798` is the code implementation head. PR #33 metadata must keep those roles distinct.

## Current architecture metrics

| Metric | Phase 0 baseline | Current at Checkpoint 1 | Target |
| --- | ---: | ---: | ---: |
| Production source files | 74 | 95 | Responsibility-oriented modules without framework-shaped sprawl |
| Production JavaScript files | 67 | 79 | 0 canonical JS implementation files after migration, excluding intentional wrappers |
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

Current audit at the PR #55 parent records 122 production files (104 JavaScript, 11 TypeScript, 7 Swift), 30 preload/runtime-patch entries, 28 source-text implementation tests, 28 direct child-process importers, and 27 writable JSON-state candidates. The table above remains the Checkpoint 1 snapshot rather than a claim that those counts describe the current tip.

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

## Phase 3 — Helper and HTTP decomposition

- Status: Partially implemented in draft PRs #34–#40; the master-plan Phase 3 gate is not met.
- Stack base: Checkpoint 1 final metadata head `f21e344ea18eb0a976630a4ce38cf52bf30a3f47`.
- Current Phase 3G head: `7367fa2574ff8fa88499be7c8b02ece72ff11ffa`.

### Implemented slices

- #34–#35 extract seven bounded one-shot CLI commands and command-specific composition.
- #36–#37 add typed request context plus pairing-fallback and public-build capability handlers.
- #38–#40 extract delivery maintenance and HTTP server/timer behavior and make the compatibility boundary installation explicit.

### Gate correction

The 2026-08-09 independent stack audit found that PR #40's earlier Phase 3 completion claim was broader than the implemented scope. `mac-helper/bin/swift-sim-helper.js` remains a 2,135-line compatibility implementation that constructs module-global stores, owns the main helper router, directly imports child-process APIs, and combines session, Simulator, build, delivery, recovery, persistence, and lifecycle behavior. Therefore:

- the helper entrypoint is not yet primarily wiring for the complete product surface;
- routes have not all been separated by authorization boundary;
- route/service code can still directly own process and persistence work;
- service startup, timers, sockets, and graceful shutdown do not yet have the complete target lifecycle owner.

Phase 3 must be completed in bounded corrective slices before the stack may claim the Phase 3 gate or use Phase 4 completion as authority to start Phase 5. Existing validated PR history remains unchanged; the correction must be recorded transparently in later ancestry.

## Phase 4 — Repository interfaces and SQLite migration

- Status: The pairing migration tranche through E4 is locally complete in the draft stack; full Phase 4 is incomplete and all production cutover and rollback wiring remains disabled.
- Full Phase 4 stack base: Phase 3G head `7367fa2574ff8fa88499be7c8b02ece72ff11ffa`.
- Pairing E stack base: Phase 4D2 head `1364fa1ea570840e779b4f6b65195b3bb4433ac6`.
- Validated E4 implementation: `7ce31e6f859180af213d7d3d52e2dd564bcbd63d`.
- Remaining Phase 4 finalization is required by the master plan. The local E5 label is not an optional waiver for unfinished domain repositories, composition, diagnostics, upgrade, or phase-gate evidence.

### Stack order and live state

| Unit | PR | Base | Validated implementation head | Verify evidence | State |
| --- | ---: | --- | --- | --- | --- |
| 4A — SQLite foundation | [#41](https://github.com/Miguelosaurus/Swift-Sim/pull/41) | Phase 3G / `7367fa2` | `d653b3f` | `31026437268` passed | Open, draft, unmerged |
| 4B — pairing repositories | [#44](https://github.com/Miguelosaurus/Swift-Sim/pull/44) | #41 / `d653b3f` | `0f8e65a` | `31028680549` passed | Open, draft, unmerged |
| 4C — pairing import/resume | [#45](https://github.com/Miguelosaurus/Swift-Sim/pull/45) | #44 / `0f8e65a` | `6781dea` | `31033205619` passed | Open, draft, unmerged |
| 4D1 — pairing shadow comparison | [#46](https://github.com/Miguelosaurus/Swift-Sim/pull/46) | #45 / `6781dea` | `7443e7e` | `31036122449` passed | Open, draft, unmerged |
| 4D2 — pairing shadow observer | [#47](https://github.com/Miguelosaurus/Swift-Sim/pull/47) | #46 / `7443e7e` | `1364fa1` | `31039161870` passed | Open, draft, unmerged |
| E1 — pairing authority state | [#48](https://github.com/Miguelosaurus/Swift-Sim/pull/48) | Phase 4D2 / `1364fa1` | `974db19` | `31041703590` passed | Open, draft, unmerged |
| E2 — locked legacy snapshot | [#50](https://github.com/Miguelosaurus/Swift-Sim/pull/50) | #48 / `974db19` | `bf7830c` | `31043513490` passed | Open, draft, unmerged |
| E2 — authority selector | [#49](https://github.com/Miguelosaurus/Swift-Sim/pull/49) | #50 / `bf7830c` | `ff96203` | `31045149408` passed | Open, draft, unmerged |
| E3 — cutover preparation | [#52](https://github.com/Miguelosaurus/Swift-Sim/pull/52) | #49 / `ff96203` | `8ff4ae8` | `31047728488` passed | Open, draft, unmerged |
| E3B — cutover coordinator | [#53](https://github.com/Miguelosaurus/Swift-Sim/pull/53) | #52 / `8ff4ae8` | `ec1bd4e` | `31315600274` passed | Open, draft, unmerged |
| E4 — rollback export | [#54](https://github.com/Miguelosaurus/Swift-Sim/pull/54) | #53 / `ec1bd4e` | `3100bc0` | `31316795096` passed | Open, draft, unmerged |

PRs #42 and #43 are closed and superseded by clean PR #44. PR #51 (`7615de6`) is closed and superseded by the clean E3 PR #52; none is part of the live ancestry. The initial E4 Verify run `31316632344` at `7ce31e6` and the ledger-only run `31316708706` failed on the architecture source-text-test cap; `3100bc0` removed that classification by using the injected file-store reader, Verify `31316795096` passed, and the final documentation head `b1fac0d` passed `31317114243`.

### E3B completion record

- Preserved the existing history, including diagnostic commit `7083ad2`; applied the canonical Prettier output in normal commit `ec1bd4e` without rewriting or force-pushing.
- Restored the repository-wide formatter gate and passed the focused coordinator suite (8/8), the full local Node 24 check, the isolated Homebrew gate, workflow YAML/shell gates, and iOS Simulator tests (30/30).
- PR #53 Verify run `31315600274` passed at the exact `ec1bd4e` head.

### E4 outcome and invariants

- Added an unwired `PairingLockedLegacyWriter` and `PairingRollbackCoordinator` that keep credential and invitation locks held in bytewise order through SQLite read, pre-overwrite backups, atomic 0600 writes, 0600 backup publication under 0700 parents, rereads, validators, normalization, projection-hash comparison, and the revision/source/window-fenced rollback CAS.
- The exporter requires a non-null SQLite credential, preserves the PairingStore credential object and PairingInviteStore invitation-array shapes, uses the current SQLite snapshot (including post-import changes), never deletes backups, and recognizes only the exact completed legacy epoch on retry.
- Real temporary filesystem/SQLite fault-injection coverage passed 14/14 focused tests: backup publication; credential and invitation writes; credential and invitation rereads; projection verification; interruption immediately before CAS; interruption immediately after successful CAS; SQLite CAS failure; missing credential; expiry/finalization refusal; contention; lock ordering/release; immutable results; and retry behavior.
- No production composition, migration invocation, service, credential, installation, or real `~/.swift-sim` state was touched.

### E4 local validation

- Node 24 `npm run check`: passed syntax for 452 JavaScript files, architecture inventory for 122 production sources, 55 Markdown links, strict TypeScript, formatting, lint, 463 source tests, 139 compiled tests, hermetic/compiled runtime checks, 261 package paths, isolated package install, and formula validation.
- `SWIFT_SIM_RUN_CLEAN_HOMEBREW=1 bash scripts/verify-homebrew-package.sh`: passed isolated archive installation, Node 24 launchers, unique-port service identity/restart, assets, setup, and doctor. Existing Homebrew launchers remained untouched; the known dylib header warning remains diagnostic only.
- All four workflow YAML files and the required release shell scripts passed their syntax gates.
- The exact workflow iOS Simulator command passed 30/30 tests with 0 failures on simulator `FC06262E-96E4-4B4E-ADAB-C9D5FFE8927D`.

### E4 self-review and residuals

| Severity | Found | Fixed | Remaining |
| --- | ---: | ---: | ---: |
| P0 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 |
| P2 | 0 | 0 | 0 |
| P3 | 0 | 0 | 0 |

The E4 pairing rollback slice has no remaining finding from its focused audit. Full Phase 4 nevertheless remains incomplete: non-pairing domain repositories, staged production composition, legacy read-only handling, schema/migration/permission/orphan diagnostics, redacted export, corruption guidance, and previous-tag upgrade proof are still required. Production rollback/cutover remains unauthorized, and final persistent-local/device evidence and Miguel merge authorization remain pending.

## Cross-phase reliability correction — helper state growth

- Source fix preserved at `origin/codex/fix-helper-state-growth` / `36d3fd4d03495f0c373a85d55e0a01e1a272cbe0`.
- Active-ancestry port: [PR #55](https://github.com/Miguelosaurus/Swift-Sim/pull/55), stacked from PR #54 final head `b1fac0df3360fdc68ca76d910e467b8a1f4944d7`.
- Initial behavior port: `9d49cdfa97c27fb152914e73a454e80e4f188376`.
- Corrected implementation after independent adversarial review: `97c305b`.

The port preserves the original 500-line/64-KiB newest diagnostic tail, version-6 legacy compaction, healthy-helper startup short circuit, and disposable-HOME compiled-runtime verification. It replaces the old source-text startup assertions with compiled-package behavior evidence and does not increase the architecture ratchets. Independent review found three P2 evidence/durability gaps in the initial port: bespoke publication lacked fsync/fault proof, duplicate-start proof needed the real process entrypoint, and verifier-HOME isolation needed a behavioral mutation sentinel. The final implementation uses `NodeAtomicFileStore` publication with file and directory synchronization, proves byte-identical legacy state after injected publication failure, exercises the official compiled entrypoint against a healthy helper, and verifies caller state remains unchanged before cleaning the isolated probe root. The corrective re-review reported no remaining P0–P3 findings.

Local Node 24 validation passed 46/46 focused device-build tests, 468/468 source tests, 139/139 compiled tests, the hermetic compiled runtime, 122-source architecture inventory, 55-file documentation check, strict types, formatting, lint, 261 package paths, isolated package installation, and formula validation. The clean Homebrew gate passed isolated archive installation, Node 24 launchers, unique-port service identity/restart, assets, setup, and doctor while preserving existing launchers; the known dylib-header/link warning remained diagnostic only. Workflow YAML and required shell syntax gates passed. The exact workflow iOS Simulator command passed 30/30 tests with 0 failures on simulator `FC06262E-96E4-4B4E-ADAB-C9D5FFE8927D`. The PR remains draft and requires its natural exact-head Verify plus later persistent-service/release-candidate evidence before merge.

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
