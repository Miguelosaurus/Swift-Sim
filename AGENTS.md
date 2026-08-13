# Agent Instructions

For architecture-consolidation work, do not infer current state from old branches or PR titles.

Read these files in order before editing:

1. `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md`
2. `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_INVARIANTS.md`
3. `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_BATCHED_EXECUTION_AMENDMENT.md`
4. `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PARALLEL_EXECUTION_AMENDMENT.md`
5. `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PARALLEL_ROADMAP.md`
6. `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_WORKSTREAM_REGISTRY.md`
7. `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_AGENT_PROTOCOL.md`
8. your assigned file under `docs/internal/plans/workstreams/`

The workstream registry and current control-plane handoff are canonical for assignment/current-state questions.

Architecture workers must stay inside their assigned ownership surface, keep draft PRs unmerged, never rewrite validated ancestry, and leave shared schema/composition/control-plane edits to the orchestrator unless the workstream explicitly grants ownership.

Outside the architecture-consolidation program, follow the repository's normal documentation and contribution guidance.
