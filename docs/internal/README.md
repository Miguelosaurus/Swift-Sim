# Internal Documentation

These documents preserve implementation decisions and completed engineering records. They are not user instructions.

## Active Architecture Program

- [Architecture Consolidation Master Plan](plans/ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md)
- [Architecture Consolidation Invariants](plans/ARCHITECTURE_CONSOLIDATION_INVARIANTS.md)
- [Architecture Consolidation Execution Guide](plans/ARCHITECTURE_CONSOLIDATION_EXECUTION_GUIDE.md)
- [Mandatory Checkpoint Protocol](plans/ARCHITECTURE_CONSOLIDATION_CHECKPOINT_PROTOCOL.md)
- [Architecture Consolidation Progress](plans/ARCHITECTURE_CONSOLIDATION_PROGRESS.md)
- [Next Agent Prompt — Phase 0](plans/NEXT_AGENT_PROMPT_ARCHITECTURE_CONSOLIDATION_PHASE0.md)
- [Architecture Decision Records](adr/README.md)

### Mandatory checkpoint templates

- [Checkpoint 1 — Typed Foundation and Explicit Infrastructure](plans/checkpoints/CHECKPOINT_1_TEMPLATE.md)
- [Checkpoint 2 — Domain State and Hidden Runtime Removal](plans/checkpoints/CHECKPOINT_2_TEMPLATE.md)
- [Checkpoint 3 — Live Architecture and Companion Decomposition](plans/checkpoints/CHECKPOINT_3_TEMPLATE.md)

The architecture program is the current implementation roadmap. Execute it in small, behavior-preserving phase pull requests rather than as one rewrite.

The executing agent must stop after Phases 2, 5, and 8, leave the checkpoint phase draft and unmerged, create a current-state report and pasteable review prompt, and return that prompt to Miguel. Miguel will send it to the designated architecture-review conversation and return the decision. Work may continue only after the progress ledger records required corrections and Miguel's explicit authorization.

Passing CI, performing another self-review, or asking another automated reviewer does not satisfy a checkpoint.

## Other Plans

- [Agent Fast-Path Plan](plans/HOT_RELOAD_AGENT_FAST_PATH_PLAN.md)
- [Remote Hot Reload Benchmark Plan](plans/HOT_RELOAD_BENCHMARK_PLAN.md)

## Historical Review Records

- [Codex Workflow Redirect](reviews/CODEX_WORKFLOW.md)
- [Codex Review Merge Readiness](reviews/CODEX_REVIEW_MERGE_READINESS.md)
- [Confirmation Round 5](reviews/CONFIRMATION_ROUND5.md)
- [Main Post-Merge Review](reviews/MAIN_POST_MERGE_REVIEW_ROUND1.md)

Historical review records explain how earlier changes were reached. They are not current product instructions or the architecture roadmap. Verify current behavior in the public guides, implementation, tests, active architecture decisions, and mandatory checkpoint reviews.
