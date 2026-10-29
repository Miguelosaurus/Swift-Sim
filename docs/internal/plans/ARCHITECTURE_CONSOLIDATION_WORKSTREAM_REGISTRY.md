# Architecture Consolidation Workstream Registry

Status: **Canonical assignment registry**

The orchestrator owns this registry. Workers use it to determine what may run now and which workstream contract to read.

## Main integration override — 2026-10-29

Miguel explicitly authorized merging reviewed work to main and closing the accumulated PR stack by 2:09 PM Central. This current authorization supersedes the earlier draft-only restriction. See [the integration record](MAIN_INTEGRATION_2026_10_29.md) and [current handoff](NEXT_AGENT_HANDOFF_ARCHITECTURE_CONSOLIDATION_CURRENT.md). Historical wave tables below are records, not active assignments. Real installation/state acceptance remains unproven; authority activation stays separately gated.

## Current continuation overlay — 2026-10-29

The old dispatch baseline and first-wave table below are historical. Their completed feeder assignments must not be restarted. The [current handoff](NEXT_AGENT_HANDOFF_ARCHITECTURE_CONSOLIDATION_CURRENT.md) and [reconciliation report](P4_CUTOVER_RECONCILIATION_2026_10_29.md) record the recovered product lineage.

| ID | Status | Current owner / boundary |
| --- | --- | --- |
| P4-CUTOVER-CORRECTIONS-R2 | REVIEW | Codex continuation `codex/swift-sim-p4-reconcile`, exact base #156 `fdd2b72dc1ecc9f93163ca60fcea809cef13c0a5`; remaining R1 findings corrected, bounded review 0/0/0/2, final exact-head Verify required. |
| P4-MAINTENANCE-REQUALIFICATION | BLOCKED | Separate real-root and installed-release upgrade gates after final repository verification and explicit maintenance-window authorization. |
| P4-AUTHORITY-ACTIVATION | BLOCKED | Separate decision after both environment gates; this correction does not authorize it. |

Shared correction/composition/package-policy and control-plane reconciliation in this continuation are orchestrator-owned under the user's request to finish and reconcile the recovered chunk. Prior product/audit PRs remain unchanged, draft and unmerged. Phase 5 production work is outside this continuation.

## Status vocabulary

- **READY** — bounded implementation may begin after dispatch.
- **PREP** — preparatory work may begin; canonical production integration remains gated.
- **BLOCKED** — a prerequisite or ownership conflict prevents execution.
- **ACTIVE** — assigned to a worker at a recorded exact base.
- **REVIEW** — worker result is awaiting orchestrator review.
- **VERIFIED** — workstream verification passed; canonical integration may still be pending.
- **INTEGRATING** — accepted work is being composed into the numbered phase spine.
- **SUPERSEDED** — retained for history but replaced by newer work.
- **DONE** — accepted into canonical integrated ancestry and recorded in the progress ledger.

## Dispatch baseline

Current product baseline: Phase 4Z5 exact head `0be8234583e9c989b1831c9bce5e042b19b3d46c`.

Control-plane branch: `agent/architecture-consolidation-program-orchestration`.

Before a wave starts, the orchestrator freezes the control-plane branch and records its exact dispatch SHA in each worker assignment. Workers must not use an implicit moving `latest` after beginning work.

Default branch form: `agent/arch-ws-<ID>-<slug>`.

## Current registry

| ID | Phase | Class | Status | Primary responsibility | Contract |
| --- | --- | --- | --- | --- | --- |
| P4-ARTIFACT-EXECUTION | 4 | implementation-ready | READY | explicit historical artifact maintenance core based on the proven audit policy | `workstreams/P4-ARTIFACT-EXECUTION.md` |
| P4-DEVICE-CUTOVER | 4 | implementation-ready | READY | device-build cutover/rollback/export machinery, initially non-authoritative | `workstreams/P4-DEVICE-CUTOVER.md` |
| P4-SESSIONS-DOMAINS | 4 | implementation-ready | READY | sessions and remaining transactional-domain repositories/importers/shadow fixtures | `workstreams/P4-SESSIONS-DOMAINS.md` |
| P4-DIAGNOSTICS | 4 | implementation-ready | READY | SQLite/shadow/cutover support diagnostics and recovery reporting | `workstreams/P4-DIAGNOSTICS.md` |
| P4-UPGRADE-EVIDENCE | 4 | implementation-ready | READY | previous-release migration/rollback/crash-restart/package verification harnesses | `workstreams/P4-UPGRADE-EVIDENCE.md` |
| P4-INTEGRATION | 4 | integration | BLOCKED | shared schema/composition, authority sequencing, final Phase 4 gate | orchestrator-owned |
| P5-PRELOAD-INVENTORY | 5 | preparatory | PREP | current preload/runtime-patch/call-site inventory and dependency map | `workstreams/P5-PRELOAD-INVENTORY.md` |
| P6-LIVE-DECOMP-PREP | 6 | preparatory | PREP | live-reload responsibility/extraction/fixture map | `workstreams/P6-LIVE-DECOMP-PREP.md` |
| P7-ANALYZER-PREP | 7 | preparatory | PREP | analyzer protocol, differential corpus, packaging/degraded-mode preparation | `workstreams/P7-ANALYZER-PREP.md` |
| P8-COMPANION-PREP | 8 | preparatory | PREP | typed-helper/API and iOS feature-boundary characterization | `workstreams/P8-COMPANION-PREP.md` |
| P9-CONSOLIDATION-INVENTORY | 9 | preparatory | PREP | docs/test/release consolidation inventory | `workstreams/P9-CONSOLIDATION-INVENTORY.md` |
| P10-RELIABILITY-HARNESS | 10 | preparatory | PREP | reliability matrix, harness, diagnostics/report preparation | `workstreams/P10-RELIABILITY-HARNESS.md` |

## Shared integration ownership

Global SQLite ordering, central helper/CLI composition, canonical authority selection, root package/compiler policy, architecture baseline policy, authoritative workflows, and canonical roadmap/registry/progress/handoff remain orchestrator-owned unless a workstream contract explicitly says otherwise.

## Worker result contract

Every worker returns:

- workstream ID;
- exact base SHA;
- branch and draft PR;
- exact candidate/final SHA;
- changed paths;
- invariant review;
- migration/rollback impact if any;
- focused and hosted verification evidence required by its class;
- residual risk and newly discovered dependencies;
- shared-integration edits requested or deliberately avoided;
- recommendation: ready for integration, needs correction, or blocked.

The orchestrator changes canonical registry state after review.
