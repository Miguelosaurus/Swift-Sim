# Architecture Consolidation — Current Handoff

Status: **parallel orchestration mode**

Do not use older handoff branches or PR titles to infer current program state.

## Current product boundary

- Hosted-green Phase 4Z5 product head: `0be8234583e9c989b1831c9bce5e042b19b3d46c`
- PR: #124
- Hosted Verify: #955 / run `31616562330`, passed end to end
- Phase 4 remains incomplete, draft, and unmerged
- Real-Mac 4Z5 audit verification passed on the exact product head: 212/212 builds measured, zero measurement issues, and the prior conservative artifact estimate was reproduced exactly
- Current recorded device-build source-of-truth behavior was unchanged by that verification

## Canonical control plane

Read in this order before architecture work:

1. `/AGENTS.md`
2. `ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md`
3. `ARCHITECTURE_CONSOLIDATION_INVARIANTS.md`
4. `ARCHITECTURE_CONSOLIDATION_BATCHED_EXECUTION_AMENDMENT.md`
5. `ARCHITECTURE_CONSOLIDATION_PARALLEL_EXECUTION_AMENDMENT.md`
6. `ARCHITECTURE_CONSOLIDATION_PARALLEL_ROADMAP.md`
7. `ARCHITECTURE_CONSOLIDATION_WORKSTREAM_REGISTRY.md`
8. `ARCHITECTURE_CONSOLIDATION_AGENT_PROTOCOL.md`
9. your assigned file under `workstreams/`

Control-plane branch: `agent/architecture-consolidation-program-orchestration`.

The registry determines which work is READY, PREP, or BLOCKED. Workers do not self-select from historical branches.

## Whole-program position

- Phase 0: complete/merged
- Phase 1: complete/merged
- Phase 2: Checkpoint 1 hosted-green; draft stack retained
- Phase 3: implementation gate complete in current ancestry; draft stack retained
- Phase 4: in progress through 4Z5 plus persistent-Mac evidence
- Phases 5–10: canonical production integration not started
- Preparatory work for Phases 5–10 may run only where the registry marks it PREP
- Checkpoint 2 remains after Phase 5; checkpoint 3 remains after Phase 8

The current 4Z5 ancestry has been reconciled against the final Phase 3 ancestry, pairing migration/rollback work, and the helper-state-growth correction. Older handoff siblings and temporary reconciliation/publisher branches are reference-only unless the registry explicitly names them.

## Integration ownership

Shared SQLite ordering, central helper/CLI composition, canonical authority selection, root package/compiler policy, authoritative workflows, and canonical roadmap/registry/progress/handoff remain orchestrator-owned by default.

Workers should expose narrow integration seams and report shared dependencies rather than competing to edit those surfaces.

## Current wave

Implementation-ready Phase 4 work and preparatory future-phase work are listed in `ARCHITECTURE_CONSOLIDATION_WORKSTREAM_REGISTRY.md`. `P4-INTEGRATION` remains orchestrator-owned and is not eligible until feeder work has been reviewed.
