# Architecture Consolidation Parallel Roadmap

Status: **Canonical whole-program navigation**

This roadmap maps the original Phase 0–10 master plan onto the parallel-execution model. It does not redefine phase completion criteria; it identifies which bounded work can run concurrently and where integration must serialize.

## Current canonical program point

Control-plane base: Phase 4Z5 exact hosted-green product head `0be8234583e9c989b1831c9bce5e042b19b3d46c`.

Real-Mac evidence on that ancestry already proves:

- 212/212 legacy device-build records imported into the SQLite shadow;
- schema 7, WAL, foreign keys, integrity, and shadow comparison health;
- legacy JSON remained byte-identical and production-authoritative;
- future-build retention behavior is bounded and tested;
- the historical artifact audit is exposed read-only through `swift-sim doctor`;
- all 212 real builds measured with zero measurement issues;
- historical device-build footprint: 44,144,176 KiB;
- conservative reclaimable estimate: 9,495,592 KiB / 9.055702 GiB;
- live-ready DerivedData and install payloads remain protected;
- real helper/state invariants remained unchanged during audit verification.

Phase 4 is **not complete**. Authority transition, remaining domains, final upgrade/recovery evidence, and the integrated Phase 4 gate still remain.

## Original plan vs current state

| Phase | Original objective | Current state | Parallel posture |
| --- | --- | --- | --- |
| 0 | Baseline and guardrails | Merged and validated | Historical foundation |
| 1 | TypeScript/package foundation | Merged and validated | Historical foundation |
| 2 | Explicit infrastructure primitives | Checkpoint 1 hosted-green; draft stack unmerged | Validated foundation for stacked work |
| 3 | Helper/HTTP decomposition | Implementation gate complete; draft stack unmerged | Validated foundation for current work |
| 4 | Repository interfaces + SQLite migration | In progress through 4Z5 plus real-Mac evidence | Multiple implementation-ready lanes plus one serialized integration lane |
| 5 | Remove preload/runtime-patch architecture | Production phase not started | Inventory/dependency preparation may run now |
| 6 | Split live-reload responsibilities | Production phase not started | Characterization/contracts/fixtures preparation may run now |
| 7 | SwiftSyntax analyzer | Production replacement not started | Differential corpus/protocol/packaging preparation may run now |
| 8 | iOS companion feature architecture | Not started | Boundary/client characterization may run now |
| 9 | Test/docs/release consolidation | Not started | Inventory and consolidation planning may run now |
| 10 | Product reliability proof | Not started | Harness/matrix/report preparation may run now |

## Integration spine

Only the integrated canonical phase head advances the numbered program:

`0 -> 1 -> 2 -> checkpoint 1 -> 3 -> 4 -> 5 -> checkpoint 2 -> 6 -> 7 -> 8 -> checkpoint 3 -> 9 -> 10`

Parallel workstreams feed this spine; they do not create alternate phase histories.

## Current parallel wave

### Phase 4 completion — implementation-ready

1. **P4-ARTIFACT-EXECUTION** — explicit historical artifact maintenance core built from the proven read-only planner; no automatic startup behavior and no shared CLI ownership.
2. **P4-DEVICE-CUTOVER** — device-build authority/cutover/rollback/export machinery modeled on pairing, initially unwired and non-authoritative.
3. **P4-SESSIONS-DOMAINS** — sessions and remaining transactional-domain repositories/importers/shadow fixtures; shared schema integration remains orchestrator-owned.
4. **P4-DIAGNOSTICS** — corruption/busy/export/recovery/doctor support and redacted operator diagnostics.
5. **P4-UPGRADE-EVIDENCE** — previous-release upgrade, migration, rollback, crash/restart, package/Homebrew verification harnesses and fixtures.
6. **P4-INTEGRATION** — orchestrator-only lane for global schema ordering, helper/CLI composition, authority sequencing, final local proof, and the Phase 4 gate.

### Future-phase preparation — preparatory only

1. **P5-PRELOAD-INVENTORY** — refresh preload/runtime-patch/call-site ownership map and removal dependency graph. No production removal in this workstream.
2. **P6-LIVE-DECOMP-PREP** — characterize live-reload responsibilities, extraction seams, behavioral fixtures, and benchmark-sensitive paths. No production routing change.
3. **P7-ANALYZER-PREP** — analyzer protocol, differential corpus/tooling, SwiftSyntax packaging experiment, degraded-mode fixtures. No production analyzer routing change.
4. **P8-COMPANION-PREP** — typed helper API/protocol characterization and iOS feature-boundary map. No coordinator cutover or redesign.
5. **P9-CONSOLIDATION-INVENTORY** — stale docs/handoffs/tests/release-boundary inventory and proposed consolidation set.
6. **P10-RELIABILITY-HARNESS** — compatibility-matrix tooling, diagnostics/report templates, deterministic failure harnesses. No claim of final physical/external evidence.

## Dependency graph

```text
CURRENT: hosted-green + locally verified Phase 4Z5

  +--> P4-ARTIFACT-EXECUTION --------+
  +--> P4-DEVICE-CUTOVER ------------+
  +--> P4-SESSIONS-DOMAINS ----------+--> P4-INTEGRATION --> Phase 4 gate
  +--> P4-DIAGNOSTICS ----------------+          |
  +--> P4-UPGRADE-EVIDENCE -----------+          v
  |                                           Phase 5 integration
  +--> P5-PRELOAD-INVENTORY ------------------->  |
  |                                               v
  +--> P6-LIVE-DECOMP-PREP ------------------> Checkpoint 2
  |                                               |
  +--> P7-ANALYZER-PREP --------------------------+--> Phase 6 --> Phase 7
  |                                                            |
  +--> P8-COMPANION-PREP ---------------------------------------+--> Phase 8 --> Checkpoint 3
  |
  +--> P9-CONSOLIDATION-INVENTORY ---------------------------------------------> Phase 9
  |
  +--> P10-RELIABILITY-HARNESS -------------------------------------------------> Phase 10
```

An arrow from a preparation lane to a later phase means reusable input once that phase becomes eligible, not permission to integrate early.

## Later parallel waves

### After the Phase 4 gate

Phase 5 production work may split by capability group with disjoint module/call-site ownership. A single integration lane owns final raw/package parity, architecture-count proof, and checkpoint 2.

### After checkpoint 2

Phase 6 may split into contracts/classification, Xcode orchestration, engine/session ownership, patch/proof, delivery/fallback, and benchmark-support lanes. Canonical composition and physical non-regression proof integrate serially.

### Phase 7

Analyzer core, Node boundary/packaging, differential corpus, and benchmark/evidence support can run in parallel. Production routing integrates only after required gates/evidence.

### Phase 8

Networking/pairing, app/build library, device-build/install, simulator/live preview, and feature-model/view-model boundaries can be developed in parallel. Coordinator/shared API integration remains serialized and is followed by checkpoint 3.

### Phase 9

Docs/handoff cleanup, semantic test consolidation, package/release normalization, and architecture-document consolidation can be prepared in parallel against the checkpoint-3 ancestry.

### Phase 10

Evidence lanes may run in parallel for packaging/upgrade, physical device, simulator, remote hot reload, corruption/rollback/failure recovery, and external beta. Final reliability verdict remains evidence-based and serial.

## Canonical vs reference-only branches

The repository contains many architecture-consolidation branches because the program used stacked PRs plus corrective and handoff children. Agents must not infer authority from recency alone.

- The current product ancestry is the chain ending at the Phase 4Z5 head above.
- Final Phase 3 ancestry, pairing rollback work, and helper-state-growth corrections are confirmed ancestors of that head.
- Older handoff/documentation siblings are reference-only once a newer canonical handoff exists on the orchestration ancestry.
- Temporary publisher/reconciliation branches and superseded sibling handoffs are not worker bases unless the registry explicitly names them.
- Historical branches remain useful for audit and rollback; branch cleanup is a separate repository-maintenance decision.

## Red-zone integration surfaces

Workers design around, rather than concurrently owning:

- global SQLite schema/version/order;
- helper and CLI composition roots;
- canonical authority selectors/cutover state;
- package/compiler/global architecture policy;
- canonical roadmap/registry/progress/handoff;
- shared release/CI configuration.

The registry may explicitly grant ownership for a bounded integration task.

## Evidence boundaries

- Hosted Verify proves repository/package/service/iOS gates supported by CI.
- Persistent-Mac proof validates real legacy state, permissions, upgrades, and environment interactions.
- Physical-device proof remains mandatory wherever the master plan requires real-device behavior or performance evidence.
- External-beta evidence remains a Phase 10 product/human gate.

## Agent usage

Do not self-select work from this roadmap. The workstream registry determines what is READY, PREP, or BLOCKED and pins the exact base and ownership contract. This roadmap exists so every worker understands the whole dependency structure around its bounded task.
