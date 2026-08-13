# Internal Documentation

These documents preserve implementation decisions and completed engineering records. They are not user instructions.

## Active Architecture Program

Read the active architecture controls in this order:

1. [Architecture Consolidation Master Plan](plans/ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md)
2. [Architecture Consolidation Invariants](plans/ARCHITECTURE_CONSOLIDATION_INVARIANTS.md)
3. [Architecture Consolidation Execution Guide](plans/ARCHITECTURE_CONSOLIDATION_EXECUTION_GUIDE.md)
4. [Batched Execution Amendment](plans/ARCHITECTURE_CONSOLIDATION_BATCHED_EXECUTION_AMENDMENT.md)
5. [Parallel Execution Amendment](plans/ARCHITECTURE_CONSOLIDATION_PARALLEL_EXECUTION_AMENDMENT.md)
6. [Parallel Whole-Program Roadmap](plans/ARCHITECTURE_CONSOLIDATION_PARALLEL_ROADMAP.md)
7. [Workstream Registry](plans/ARCHITECTURE_CONSOLIDATION_WORKSTREAM_REGISTRY.md)
8. [Agent Protocol](plans/ARCHITECTURE_CONSOLIDATION_AGENT_PROTOCOL.md)
9. [Architecture Consolidation Progress](plans/ARCHITECTURE_CONSOLIDATION_PROGRESS.md)
10. [Current Architecture Handoff](plans/NEXT_AGENT_HANDOFF_ARCHITECTURE_CONSOLIDATION_CURRENT.md)
11. [Mandatory Checkpoint Protocol](plans/ARCHITECTURE_CONSOLIDATION_CHECKPOINT_PROTOCOL.md)
12. [Architecture Decision Records](adr/README.md)

Root [`AGENTS.md`](../AGENTS.md) points architecture workers into the same control plane.

### Mandatory checkpoint templates

- [Checkpoint 1 — Typed Foundation and Explicit Infrastructure](plans/checkpoints/CHECKPOINT_1_TEMPLATE.md)
- [Checkpoint 2 — Domain State and Hidden Runtime Removal](plans/checkpoints/CHECKPOINT_2_TEMPLATE.md)
- [Checkpoint 3 — Live Architecture and Companion Decomposition](plans/checkpoints/CHECKPOINT_3_TEMPLATE.md)

The numbered Phase 0–10 sequence and mandatory checkpoints remain the canonical integration order. The batched-execution amendment permits the deliberate draft-PR stack; the parallel-execution amendment adds bounded concurrent workstreams beneath that integration spine.

Workers do not self-select from old PRs or branches. The workstream registry determines READY/PREP/BLOCKED work and the agent protocol defines branch, ownership, verification, and return-report rules. Shared schema, central composition, canonical control documents, and phase integration are orchestrator-owned by default.

Hosted CI, persistent-Mac verification, physical-device proof, and external-beta evidence remain distinct evidence classes. A green repository gate never converts an environment-specific requirement into passing evidence.

Phase 2 and later architecture PRs remain draft/unmerged until the controlling verification/authorization process says otherwise.

## Other Plans

- [Agent Fast-Path Plan](plans/HOT_RELOAD_AGENT_FAST_PATH_PLAN.md)
- [Remote Hot Reload Benchmark Plan](plans/HOT_RELOAD_BENCHMARK_PLAN.md)

## Historical Review Records

- [Codex Workflow Redirect](reviews/CODEX_WORKFLOW.md)
- [Codex Review Merge Readiness](reviews/CODEX_REVIEW_MERGE_READINESS.md)
- [Confirmation Round 5](reviews/CONFIRMATION_ROUND5.md)
- [Main Post-Merge Review](reviews/MAIN_POST_MERGE_REVIEW_ROUND1.md)

Historical review records explain how earlier changes were reached. They are not current product instructions or the architecture roadmap. Verify current behavior against the implementation, tests, active architecture decisions, canonical control-plane documents, checkpoint reports, and current evidence.
