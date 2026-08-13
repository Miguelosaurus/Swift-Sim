# P9 Consolidation Inventory — Preparatory Result

Status: **PREP result; inventory/planning only**
Workstream: `P9-CONSOLIDATION-INVENTORY`
Dispatch base: `38eee4bfb1eabc2184d92aa3e52fee28b139cbf5`
Branch: `agent/arch-ws-P9-CONSOLIDATION-INVENTORY-consolidation-map`

## Scope and guardrails

This document inventories Phase 9 consolidation candidates at the exact dispatch base. It does **not** authorize Phase 9 implementation, delete or move any historical material, modify canonical program state, or weaken checkpoint governance.

Phase 9 remains gated behind checkpoint 3. The classifications below mean:

- **canonical/current** — actively authoritative or behaviorally useful now; do not remove in Phase 9 merely because the file is old or broad;
- **historical-retain** — completed evidence or rationale whose removal would erase useful provenance; may later move to a clearly historical location, but must remain recoverable and linked;
- **consolidate-later** — useful content or coverage that should be merged, renamed, split, or replaced only after its invariant is preserved elsewhere;
- **safe-deletion-candidate-after-checkpoint-3** — no longer operationally current and apparently superseded by durable canonical/evidence material, but deletion still requires a final inbound-link/content-delta check after checkpoint 3.

## Executive inventory totals

At the dispatch base:

- architecture policy reports **27 source-text implementation-test paths**: 24 under `test/` and 3 under `benchmarks/test/`;
- targeted audit finds **6 files with real production-source/layout assertions**, **1 mixed repository-structure/text file** (`test/cli.test.js`), and **20 scanner false positives** whose `readFile*` calls are on fixtures or temporary state rather than production source;
- the three benchmark files are all scanner false positives and should remain behavioral/generated-output coverage;
- there are **4 major semantic-test consolidation clusters**;
- there are **6 material package/release verification overlap edges**;
- there are **4 architecture-document overlap groups**, most of which are intentional while the architecture program is active;
- there are **4 strong safe-deletion documentation candidates after checkpoint 3**, plus completed prompts/notes that should be retained or relocated based on evidence value rather than age;
- there are **7 proposed disjoint Phase 9 implementation packages**.

No candidate below is recommended for deletion in this preparatory lane.

## 1. Source-text and implementation-structure test inventory

The architecture inventory's policy list is useful as a monotonic debt cap, but its current detector is file-wide: a test is reported when it both reads a file and contains a production path reference anywhere in the same file. It does not prove that the read targets production source. This explains the large false-positive set.

| Path | Audit finding | Classification | Phase 9 treatment |
| --- | --- | --- | --- |
| `benchmarks/test/liquidGlass.test.js` | Reads materialized benchmark fixture sources and asserts generated replacement output; no production-source read. | canonical/current | Keep. Correct the scanner so fixture reads do not count as implementation-source debt. |
| `benchmarks/test/mechanisms.test.js` | Same: corpus fixtures plus generated replacement assertions. | canonical/current | Keep; scanner correction only. |
| `benchmarks/test/nativeSurfaces.test.js` | Same: corpus fixtures plus generated replacement assertions. | canonical/current | Keep; scanner correction only. |
| `test/artifactCleanupBoundaryPreload.test.js` | Reads temporary persisted state/artifacts and exercises cleanup containment behavior. | canonical/current | Preserve behavioral coverage; rename/move only if Phase 5 removes the preload implementation. |
| `test/buildValidation.test.js` | Reads temporary preferences/PID fixtures; runtime behavior only. | canonical/current | Keep; scanner correction only. |
| `test/cli.test.js` | Does not read production JS source, but mixes behavioral CLI tests with textual checks over Homebrew formula, Xcode project metadata, README, skill docs, and plugin manifests. | consolidate-later | Split behavior from release/docs metadata checks; move structure checks into purpose-built verification where possible. |
| `test/confirmationRound2State.test.js` | Reads temporary state; behavioral delivery/session invariants. | consolidate-later | Move cases into stable delivery/session suites, deduplicating equivalent cases. |
| `test/confirmationRound3FailClosed.test.js` | Mixed: malformed-runtime behavior plus a production `swift-sim-device-delivery.js` source-order assertion. | consolidate-later | Replace source-order assertion with observable startup/publication behavior; then move behavioral case to stable domain suite. |
| `test/confirmationRound3Lifecycle.test.js` | Temporary process/state fixtures; behavioral lifecycle/delivery recovery. | consolidate-later | Move to stable lifecycle/delivery suites after duplicate-case review. |
| `test/confirmationRound4CrossProcess.test.js` | Temporary session/runtime state; behavioral cross-process ownership. | consolidate-later | Consolidate under simulator/session ownership tests. |
| `test/confirmationRound4FinalReview.test.js` | Temporary session state and device-inventory timing; behavioral fail-closed/deadline cases. | consolidate-later | Move to stable session/device-inventory suites. |
| `test/confirmationRound4Lifecycle.test.js` | Temporary lifecycle/session state; behavioral restart/orphan/claim invariants. | consolidate-later | Consolidate under simulator/session lifecycle tests. |
| `test/confirmationRound5UpgradeRecovery.test.js` | Temporary helper/Homebrew fixtures; behavioral upgrade/recovery coverage. | consolidate-later | Preserve as upgrade/recovery behavior, preferably under a stable release/runtime suite. |
| `test/confirmationRuntimePreload.test.js` | Mixed: production source-order checks for hardened/gateway boundary installation plus two spawned-child behavioral tests. | consolidate-later | Replace source-order checks with entrypoint/child behavior, retain spawned-child tests. |
| `test/deviceBuilderTimeout.test.js` | Reads temporary process PID files; behavioral timeout/cancellation/process-group tests. | canonical/current | Keep; scanner correction only. |
| `test/deviceBuildStore.test.js` | Reads temporary persisted build state; repository/state behavior. | canonical/current | Keep; scanner correction only. |
| `test/deviceDelivery.test.js` | Reads temporary generation state/logs; delivery behavior. | canonical/current | Keep; scanner correction only. |
| `test/liveEngineOwnershipPreload.test.js` | Mixed: extensive real process/ownership behavior plus source-slice assertions for rollback and fail-closed identity branches. | consolidate-later | Replace only source-slice assertions; retain ownership/process-group behavior. Phase 5/6 may later rename the suite as the preload disappears. |
| `test/liveReloadWorkspacePackage.test.js` | Three parser/selection behavior cases plus one `liveReload.js` textual call-flow assertion. | consolidate-later | Replace one source assertion with an observable selected-target inspection seam; keep parser behavior. |
| `test/liveSessionDescriptor.test.js` | Reads disposable project/session/capture fixtures; descriptor behavior. | canonical/current | Keep; scanner correction only. |
| `test/lockOwnershipPreload.test.js` | Reads temporary lock/claim/journal files; cross-process lock behavior. | consolidate-later | Preserve semantics through Phase 5 preload removal; later rename/move to the replacement lock boundary suite. |
| `test/mainPostMergeIntegration.test.js` | Large mixed integration suite: many good live-routing/parser/signing behaviors plus several direct `liveReload.js`/`deviceBuilderCore.js` source-text assertions. | consolidate-later | Split by stable domain, replace source assertions behaviorally, and eliminate the historical catch-all name. |
| `test/ownedWorkerHandshake.test.js` | Reads temporary handshake marker/journal; spawned-worker behavior. | canonical/current | Keep; scanner correction only. |
| `test/pairingStore.test.js` | Reads temporary pairing/invite state; persistence/concurrency/security behavior. | canonical/current | Keep; scanner correction only. |
| `test/releaseRuntimeSource.test.js` | Directly reads CLI/helper/preload production sources and asserts import/call ordering; package script string is also asserted exactly. | consolidate-later | Highest-priority true source-text replacement. Replace with entrypoint composition/behavioral release tests, then delete this source-only suite. |
| `test/renewalShutdownPreload.test.js` | Reads temporary renewal markers; shutdown behavior. | consolidate-later | Preserve semantics through Phase 5 preload removal, then rename/move. |
| `test/sessionStore.test.js` | Reads temporary session JSON and permissions; store behavior. | canonical/current | Keep; scanner correction only. |

### True implementation-source subset

The six files that actually assert production implementation text/layout at this base are:

1. `test/releaseRuntimeSource.test.js`
2. `test/confirmationRuntimePreload.test.js`
3. `test/confirmationRound3FailClosed.test.js`
4. `test/liveEngineOwnershipPreload.test.js`
5. `test/liveReloadWorkspacePackage.test.js`
6. `test/mainPostMergeIntegration.test.js`

`test/cli.test.js` is a separate structural-text concern: it asserts repository/package/configuration text, but is not a production-JS source-reader. It should still be decomposed because exact formula/project/README/skill strings make unrelated changes noisy.

### Required end-state

Phase 9 should not claim success by merely shrinking `baseline-policy.json`. The intended order is:

1. make the scanner distinguish production-source reads from fixture/state reads;
2. replace the six real production-source assertion sites with behavioral or purpose-built structural contracts;
3. retain the 20 behavioral false-positive suites and the three benchmark suites;
4. then tighten the architecture policy to zero real production-source implementation assertions.

## 2. Duplicate/redundant semantic test coverage

These are consolidation clusters, not deletion lists. Each cluster contains distinct edge cases worth preserving.

### Cluster T1 — Simulator/session lifecycle and ownership

Candidates:

- `test/sessionStore.test.js`
- `test/confirmationRound2State.test.js`
- `test/confirmationRound3Lifecycle.test.js`
- `test/confirmationRound4CrossProcess.test.js`
- `test/confirmationRound4Lifecycle.test.js`
- `test/confirmationRound4FinalReview.test.js`

Overlap: duplicate-start exclusion, runtime/session reconciliation, stale/invalid ownership, restart handoff, orphan protection, and fail-closed recovery are spread across historical review-round filenames and stable store/lifecycle APIs.

Disposition: **consolidate-later**. Move invariant-specific cases into stable `sessionStore`/simulator-lifecycle suites, preserving cross-process cases that are not equivalent to in-process unit tests.

### Cluster T2 — Delivery state, manager ownership, and fail-closed recovery

Candidates:

- `test/deviceDelivery.test.js`
- `test/confirmationRound2State.test.js`
- `test/confirmationRound3FailClosed.test.js`
- `test/confirmationRound3Lifecycle.test.js`

Overlap: malformed-state preservation, generation/reference persistence, manager process publication/cleanup, and readiness timeout recovery.

Disposition: **consolidate-later**. Keep public-route and process-lifecycle distinctions; collapse only cases with the same observable invariant.

### Cluster T3 — Runtime/preload ownership boundaries

Candidates:

- `test/releaseRuntimeSource.test.js`
- `test/confirmationRuntimePreload.test.js`
- `test/liveEngineOwnershipPreload.test.js`
- `test/lockOwnershipPreload.test.js`
- `test/renewalShutdownPreload.test.js`
- `test/ownedWorkerHandshake.test.js`

Overlap: boundary installation, process identity, process-group ownership, durable publication, lock/cancellation protections, and raw child behavior are split between source-order assertions and real spawned-child tests.

Disposition: **consolidate-later**. Prefer the spawned-child/observable tests as the surviving contract. Phase 5 preload removal must not erase the ownership invariants these suites currently encode.

### Cluster T4 — Live reload routing/configuration integration

Candidates:

- `test/mainPostMergeIntegration.test.js`
- `test/liveReloadWorkspacePackage.test.js`
- `benchmarks/test/liquidGlass.test.js`
- `benchmarks/test/mechanisms.test.js`
- `benchmarks/test/nativeSurfaces.test.js`

Overlap: classification safety, selected host target/package configuration, generated replacement validity, availability preservation, and route behavior.

Disposition: **consolidate-later** for the two catch-all Node tests; **canonical/current** for the benchmark suites. Benchmarks cover corpus-level behavior and must not be collapsed into unit tests simply because some route assertions look similar.

## 3. Package/release verification duplication map

All items here are **consolidate-later**; none is a safe deletion until one authoritative artifact pipeline exists.

### R1 — Repeated builds in the authoritative check chain

`npm run check` runs `check:compiled`, which builds, and later `check:package`, whose command begins with another `npm run build`.

Future target: produce the compiled release tree once per verification graph and make downstream checks consume an explicit artifact/root instead of silently rebuilding it.

### R2 — Three separate package materializations

- `scripts/verify-package-content.sh` runs `npm pack --dry-run --json`;
- `scripts/verify-package-install.sh` runs a fresh `npm pack` and installs it;
- clean `scripts/verify-homebrew-package.sh` calls `scripts/release/create-archive.sh`, which builds and runs another `npm pack` before re-tarring the package.

Future target: one staged npm archive/package manifest, then consumers for content, npm-install, and Homebrew archive checks.

### R3 — Static Homebrew validation runs twice in hosted verification

`npm run check` invokes `verify-homebrew-package.sh` without destructive installation. The workflow then invokes the same script again with `SWIFT_SIM_RUN_CLEAN_HOMEBREW=1`, repeating its formula syntax/Node/entrypoint checks before the clean install.

Future target: separate a cheap static formula check from the opt-in clean Homebrew install gate, or make the clean gate consume the static result without rerunning equivalent work.

### R4 — Installed-package layout is asserted in two places

`verify-package-content.sh` checks required/prohibited package paths. `verify-installed-package.mjs` again checks compiled entrypoint/skill presence and absence of `mac-helper/src` after installation.

Future target: retain one package-manifest contract and make installed-package verification focus on resolution/runtime behavior.

### R5 — Setup/doctor behavior is repeated across npm-install and Homebrew verification

`verify-installed-package.mjs` runs isolated installed-package setup/doctor with fake agents. Clean Homebrew verification also runs setup/doctor plus launcher/service/health checks.

Future target: a shared installed-artifact verifier that can run against an npm installation root or Homebrew prefix, with Homebrew-specific service assertions layered on top.

### R6 — Release archive production and package verification are coupled by rebuilds rather than artifact identity

`release/create-archive.sh` rebuilds and repacks independently. This is correct for standalone release use, but in the full validation graph it prevents proof that npm-content, clean-install, and Homebrew checks exercised the same staged bytes.

Future target: allow the release script to accept a verified staged package/archive input while preserving standalone release behavior.

## 4. Swift package/release normalization inventory

Current package surface:

- `Package.swift` uses Swift tools 6.0, iOS 16/macOS 13, exposes one `SwiftSimLive` library, and pins `InjectionNext` to immutable revision `abdf646`;
- `Package.resolved` is checked in;
- `Tests/SwiftSimLiveTests/SwiftSimLiveTests.swift` contains one root-modifier availability smoke test.

Classification: **canonical/current**, with **consolidate-later** normalization work required by Phase 9. The pinned engine fork comment is important compatibility rationale and must survive any package cleanup. Swift package normalization should be a separate file-ownership lane from Node/Homebrew harness consolidation.

## 5. Documentation and handoff inventory

### Canonical/current operational documents

These remain active program controls and are not Phase 9 deletion candidates merely because they overlap:

- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_INVARIANTS.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_EXECUTION_GUIDE.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_BATCHED_EXECUTION_AMENDMENT.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PARALLEL_EXECUTION_AMENDMENT.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PARALLEL_ROADMAP.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_WORKSTREAM_REGISTRY.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_AGENT_PROTOCOL.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_BRANCH_INDEX.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PROGRESS.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_CHECKPOINT_PROTOCOL.md`
- `docs/internal/plans/NEXT_AGENT_HANDOFF_ARCHITECTURE_CONSOLIDATION_CURRENT.md`
- checkpoint 1/2/3 templates while the architecture program remains active
- workstream contracts while their phases remain pending/in progress
- ADRs as durable architecture decisions

Classification: **canonical/current**.

`HOT_RELOAD_AGENT_FAST_PATH_PLAN.md` is marked fast-path release gates complete, while `HOT_RELOAD_BENCHMARK_PLAN.md` still says implementation in progress. Both are explicitly consumed by the Phase 6 preparation lane and therefore remain **canonical/current inputs** at this dispatch base. After Phase 6/8 completion they may become **consolidate-later** or historical records, but not before the consuming workstreams finish.

### Historical-retain evidence/rationale

| Path | Why it must survive cleanup |
| --- | --- |
| `docs/internal/plans/checkpoints/CHECKPOINT_1_PHASE_2_INFRASTRUCTURE_2026-08-05.md` | Timestamped checkpoint evidence. |
| `docs/internal/plans/checkpoints/CHECKPOINT_1_REVIEW_PROMPT_2026-08-05.md` | Records the independent review question/evidence contract used at checkpoint 1. |
| `docs/internal/plans/PHASE4Y_LOCAL_IMPORT_NOTE.md` | Preserves the exact compatibility rationale for reconstructing absent historical `signing.style` as `""` while remaining fail-closed. |
| `docs/internal/plans/PHASE4Z1_RETENTION_NOTE.md` | Records why retention started unwired/non-destructive and why existing historical artifacts were protected. |
| `docs/internal/plans/PHASE4Z2_FUTURE_RETENTION_NOTE.md` | Records the future-build retention boundary and the deliberate exclusion of historical/live ownership cleanup. |
| `docs/internal/plans/PHASE4Z2_LOCAL_VERIFICATION_RESULT.md` | Detailed real-Mac evidence: 212/212 import, state hashes/permissions, retention proof, 42.099 GiB audit, reclaimable estimate, and unresolved live ownership ambiguity. |
| completed review records under `docs/internal/reviews/` that contain actual review findings | Explain how earlier changes were reached; internal README already labels them historical. |

Classification: **historical-retain**. A later documentation package may move them under an explicit historical/evidence index, but should preserve names/links or a redirect/index trail sufficient to recover provenance.

### Strong safe-deletion candidates after checkpoint 3

| Path | Reason | Required pre-delete check |
| --- | --- | --- |
| `docs/internal/plans/NEXT_AGENT_PROMPT_ARCHITECTURE_CONSOLIDATION_PHASE0.md` | Phase 0 bootstrap prompt is superseded by current master/invariants/protocol/registry/checkpoint governance and Phase 0 is complete. | Confirm no unique decision exists only in the prompt and no current inbound links consume it. |
| `docs/internal/plans/NEXT_LOCAL_VERIFICATION_PHASE4Z2.md` | One-shot verification instruction is superseded by the completed `PHASE4Z2_LOCAL_VERIFICATION_RESULT.md`. | Diff prompt requirements against result/progress and retain any unmet residual before deletion. |
| `docs/internal/plans/checkpoints/NEXT_AGENT_PROMPT_CHECKPOINT_1_CURRENT_STATE.md` | “Next” review prompt for completed checkpoint 1 is no longer operational; the dated checkpoint report/review prompt are durable evidence. | Confirm checkpoint state/progress and dated prompt preserve the actual review/authorization record. |
| `docs/internal/reviews/CODEX_WORKFLOW.md` | Contains only a “Moved” redirect to `AGENT_WORKFLOWS.md`, not historical review substance. | Remove/update the internal README inbound link and confirm no other relative links depend on the redirect. |

Classification: **safe-deletion-candidate-after-checkpoint-3**. The checkpoint gate is necessary but not sufficient; each pre-delete check above is mandatory.

### Exact duplicate checkpoint content

At the dispatch base:

- `docs/internal/plans/checkpoints/CHECKPOINT_1_STATE.md`
- `docs/internal/plans/checkpoints/CHECKPOINT_1_PHASE_2_INFRASTRUCTURE_2026-08-05.md`

resolve to the same blob content.

Disposition: **consolidate-later**, but not by deleting the dated record. `CHECKPOINT_1_STATE.md` is the operational/current alias while the architecture program runs; the dated file is the immutable historical evidence. After consumers no longer need a materialized state copy, the current alias may become a short pointer/index entry or be retired, while the dated report remains retained.

## 6. Architecture-document overlap map

### A1 — Master plan / invariants / execution guide

Overlap: scope, gates, testing expectations, and safety language recur across all three.

Current disposition: **canonical/current**, intentional separation of plan, non-negotiable invariants, and execution procedure. Do not flatten them during active Phases 5–10.

Future disposition: **consolidate-later only after the program no longer depends on separate control roles**. Prefer an archival index over destructive rewriting of the historical master plan.

### A2 — Batched amendment / parallel amendment / roadmap / registry / agent protocol

Overlap: branch ownership, concurrency, readiness, and integration rules.

Current disposition: **canonical/current**. The amendments change execution semantics without rewriting the original master plan, the roadmap gives ordering, the registry gives live workstream state, and the protocol defines worker obligations.

Future disposition: **consolidate-later** after program completion, preserving the amendments as historical explanation of how execution changed.

### A3 — Registry / branch index / progress / current handoff

Overlap: live branch/head/status/current-wave facts appear in multiple documents and can drift.

Current disposition: **canonical/current**, but this is the highest-staleness overlap group.

Future disposition: **consolidate-later**. Choose one machine/human source for live workstream state and make the others derived summaries or stable historical ledgers. Do not perform that authority change in this prep lane.

### A4 — Checkpoint state / dated report / review prompt / templates

Overlap: checkpoint head, evidence, review requirements, and authorization state.

Current disposition: mixed: templates and current state are **canonical/current**; dated report/review prompt are **historical-retain**; the byte-identical state/report pair is **consolidate-later**.

Future disposition: preserve immutable dated evidence, keep templates reusable, and retire only ephemeral “next prompt” aliases once all current consumers are gone.

## 7. Obsolete temporary guidance still in canonical paths

The main issue is not that completed artifacts exist; it is that one-shot prompts and historical notes live beside active control-plane plans and can look operational to a new worker.

Candidates:

- Phase 0 next-agent prompt — obsolete operational guidance; **safe-deletion-candidate-after-checkpoint-3**;
- Phase 4Z2 next-local-verification prompt — completed one-shot instruction; **safe-deletion-candidate-after-checkpoint-3**;
- checkpoint 1 “next agent” current-state prompt — completed one-shot instruction; **safe-deletion-candidate-after-checkpoint-3**;
- Phase 4Y/4Z1/4Z2 notes and result — no longer “next instructions,” but contain compatibility/retention evidence; **historical-retain**, preferably relocated/indexed later rather than deleted;
- `CODEX_WORKFLOW.md` redirect under historical reviews — **safe-deletion-candidate-after-checkpoint-3** after link cleanup.

A future docs package should make lifecycle explicit in path/metadata: active control, immutable checkpoint/evidence, historical rationale, or disposable prompt. Age alone is not a deletion criterion.

## 8. Historical-evidence loss hazards

Phase 9 cleanup must explicitly protect these cases:

1. **Migration compatibility rationale:** `PHASE4Y_LOCAL_IMPORT_NOTE.md` explains why one absent legacy field is reconstructed and why malformed values still fail closed. Deleting it before the importer/ADR/history captures that rationale would make a future “simplification” risky.
2. **Artifact-retention safety boundary:** the 4Z1/4Z2 notes and real-Mac result explain why live `DerivedData` and historical artifact roots were deliberately retained. Cleanup must not reinterpret old disk usage as automatically deletable data.
3. **Independent checkpoint evidence:** dated checkpoint reports and review prompts prove what was reviewed and under which constraints. Keep these even if live state aliases are consolidated.
4. **Benchmark provenance:** fast-path and hot-reload benchmark plans contain distinctions between static, simulated, physical-device, and real-workflow evidence. Do not collapse them into a single success claim.
5. **Preload-era safety semantics:** tests named after preloads encode ownership, fail-closed deletion, process identity, and cancellation invariants that must survive Phase 5 even when the preload file no longer exists.
6. **Release upgrade evidence:** confirmation/release tests may look historical by filename but encode service restart, stale listener, and installed-artifact behavior. Consolidate by invariant, not by deleting “round” files wholesale.
7. **Pinned engine-fork rationale:** `Package.swift` documents why `InjectionNext` is pinned to an immutable revision. Preserve that rationale in any package normalization.

## 9. Proposed disjoint Phase 9 implementation packages

The packages below are designed for non-overlapping primary file ownership. Shared canonical program-state docs remain orchestrator-owned unless explicitly delegated.

### P9-A — Source-text classifier correction

Primary ownership:

- `scripts/architecture/inventory.js`
- `scripts/architecture/baseline-policy.json`
- `test/architectureInventory.test.js`
- architecture-inventory fixtures only

Work:

- make `analyzeTest` associate a read with its actual target rather than treating unrelated production imports/path literals as evidence;
- distinguish production implementation source from temporary state, benchmark fixtures, package metadata, and docs/config text;
- prove all 20 identified false positives disappear without hiding the six real production-source files;
- keep the monotonic gate resistant to new true source-text assertions.

Dependencies: checkpoint 3 authorization.
Blocks: P9-B, because P9-B needs an accurate zero-debt measurement.

### P9-B — True source-text assertion replacement

Primary ownership:

- the source-text assertion sections in the six true files listed above;
- new narrowly named behavioral test files needed to replace those assertions

Work:

- replace import/call ordering and source-slice assertions with executable entrypoint, injected-seam, process, or public-API behavior;
- keep non-source behavioral cases in mixed files unchanged;
- delete `test/releaseRuntimeSource.test.js` only after equivalent runtime/release composition behavior exists;
- reach zero true production-source implementation assertions under the corrected P9-A scanner.

Dependencies: checkpoint 3, P9-A.
Blocks: P9-C for any historical catch-all file that also contains source assertions.

### P9-C — Semantic test consolidation

Primary ownership:

- historical `confirmationRound*` and `mainPostMergeIntegration` cases **after P9-B has removed their source-text debt**;
- stable domain test files receiving moved cases, excluding P9-A-owned architecture tests and benchmark files

Work:

- move tests from review-round/catch-all names to stable invariant/domain suites;
- deduplicate only behaviorally equivalent cases;
- preserve cross-process, fail-closed, migration, deadline, and process-group cases that exercise distinct failure modes;
- leave benchmark corpora/suites intact.

Dependencies: checkpoint 3, P9-A, P9-B.
Can run in parallel with: P9-D/P9-E after file-ownership review.

### P9-D — Package/release verification pipeline consolidation

Primary ownership:

- package verification scripts (`verify-package-content.sh`, `verify-package-install.sh`, `verify-installed-package.mjs`, `verify-homebrew-package.sh`)
- `scripts/release/create-archive.sh`
- release/package script entries in `package.json`
- `.github/workflows/verify.yml` only for the verification invocations owned by this package

Work:

- create one explicit staged artifact identity for content/install/Homebrew verification;
- remove duplicate builds/packs and repeated static Homebrew checks;
- share installed-artifact setup/doctor verification while keeping Homebrew service/restart checks specific;
- preserve standalone release script behavior;
- integrate previous-release/upgrade evidence produced by Phase 4 work rather than inventing a new compatibility oracle.

Dependencies: checkpoint 3; consume the stable package surface from P9-E before finalizing clean-install/upgrade gates.
Blocks: final Phase 9 release-verification signoff.

### P9-E — Swift package normalization

Primary ownership:

- `Package.swift`
- `Package.resolved`
- `Tests/SwiftSimLiveTests/**`
- Swift-package-specific verification only

Work:

- normalize package settings required by the Phase 9 master plan;
- retain the immutable `InjectionNext` fork/revision rationale;
- strengthen the Swift package smoke/compatibility test surface where needed;
- expose a stable package verification input for P9-D without taking ownership of Node/Homebrew scripts.

Dependencies: checkpoint 3.
Feeds: P9-D.

### P9-F — Historical evidence index/preservation

Primary ownership:

- new historical/evidence index/location under `docs/internal/` only;
- historical Phase 4 notes/results and dated checkpoint evidence if relocation is chosen

Work:

- inventory inbound links before moves;
- make active-vs-historical lifecycle explicit;
- preserve checkpoint, migration, retention, benchmark, and verification provenance;
- add redirects/index references as needed so future cleanup cannot silently erase evidence.

Dependencies: checkpoint 3.
Blocks: P9-G.

### P9-G — Stale prompt/handoff retirement and architecture-doc overlap cleanup

Primary ownership:

- the four strong safe-deletion candidates listed above;
- documentation navigation/link updates required by those deletions;
- current-state aliases chosen for consolidation only after their consumers are proven absent

Work:

- perform final content-delta/inbound-link checks;
- remove only genuinely superseded one-shot prompts/redirects;
- optionally replace byte-duplicate/current aliases with pointers while retaining immutable dated evidence;
- reduce live-status duplication only where one authority remains clear;
- do **not** flatten master/invariants/amendments while they still govern Phase 9/10.

Dependencies: checkpoint 3, P9-F.
Recommended sequencing: after P9-A/B/C/D/E so cleanup cannot delete evidence or instructions still needed by other Phase 9 workers.

## 10. Dependency graph

```text
Checkpoint 3 authorization
  ├─> P9-A Source-text classifier correction
  │     └─> P9-B True source-text replacement
  │            └─> P9-C Semantic test consolidation
  ├─> P9-E Swift package normalization
  │     └─> P9-D Package/release verification consolidation
  └─> P9-F Historical evidence preservation
        └─> P9-G Stale prompt/handoff retirement

P9-C, P9-D, and P9-F may otherwise proceed in parallel once their dependencies
and file ownership are satisfied. P9-G should be the last destructive docs lane.
```

## 11. Checkpoint-3 entry criteria for actual cleanup

Before any package above performs deletion or authority consolidation:

- checkpoint 3 must explicitly authorize Phase 9;
- the integration head used for cleanup must be re-inventoried rather than assuming these exact-base counts still hold;
- source-text test counts must be regenerated from the live tree;
- all docs selected for deletion must receive an inbound-link and unique-content check;
- historical evidence must have an explicit retained destination/index;
- package/release harness work must identify which artifact bytes each verification step actually exercises;
- cleanup must preserve observable behavior and the architecture invariants.

This preparatory result intentionally does not update the registry, progress ledger, current handoff, roadmap, master plan, or any other canonical program-state document.
