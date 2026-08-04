# Internal Documentation

These documents preserve implementation decisions and completed engineering records. They are not user instructions.

## Active Architecture Program

- [Architecture Consolidation Master Plan](plans/ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md)
- [Architecture Consolidation Invariants](plans/ARCHITECTURE_CONSOLIDATION_INVARIANTS.md)
- [Architecture Consolidation Execution Guide](plans/ARCHITECTURE_CONSOLIDATION_EXECUTION_GUIDE.md)
- [Mandatory Checkpoint Protocol](plans/ARCHITECTURE_CONSOLIDATION_CHECKPOINT_PROTOCOL.md)
- [Batched Execution Amendment](plans/ARCHITECTURE_CONSOLIDATION_BATCHED_EXECUTION_AMENDMENT.md)
- [Architecture Consolidation Progress](plans/ARCHITECTURE_CONSOLIDATION_PROGRESS.md)
- [Next Agent Prompt — Phase 0](plans/NEXT_AGENT_PROMPT_ARCHITECTURE_CONSOLIDATION_PHASE0.md)
- [Architecture Decision Records](adr/README.md)

### Mandatory checkpoint templates

- [Checkpoint 1 — Typed Foundation and Explicit Infrastructure](plans/checkpoints/CHECKPOINT_1_TEMPLATE.md)
- [Checkpoint 2 — Domain State and Hidden Runtime Removal](plans/checkpoints/CHECKPOINT_2_TEMPLATE.md)
- [Checkpoint 3 — Live Architecture and Companion Decomposition](plans/checkpoints/CHECKPOINT_3_TEMPLATE.md)

The architecture program is the current implementation roadmap. Execute it in behavior-preserving phase pull requests rather than as one rewrite.

The batched execution amendment is the active execution control for the current program. After Phase 1, the repository implementation agent may build later phases as a deliberate stack of draft, unmerged PRs, perform the scheduled repository architecture checkpoints, and continue provisionally when the amendment's continuation conditions are met. Miguel is not expected to run local verification or relay checkpoint reviews between phases.

Local Mac, Homebrew, Simulator, physical-device, network-environment, and release-machine verification is deferred to the consolidated Luna handoff required by the amendment. Deferred checks must remain explicitly marked as unproven until Luna runs them. Phase 2 and later PRs remain draft and unmerged until that final verification and Miguel's final merge authorization.

Passing CI, performing self-review, or reaching a provisional checkpoint does not convert a deferred local or hardware gate into a passing result.

## Other Plans

- [Agent Fast-Path Plan](plans/HOT_RELOAD_AGENT_FAST_PATH_PLAN.md)
- [Remote Hot Reload Benchmark Plan](plans/HOT_RELOAD_BENCHMARK_PLAN.md)

## Historical Review Records

- [Codex Workflow Redirect](reviews/CODEX_WORKFLOW.md)
- [Codex Review Merge Readiness](reviews/CODEX_REVIEW_MERGE_READINESS.md)
- [Confirmation Round 5](reviews/CONFIRMATION_ROUND5.md)
- [Main Post-Merge Review](reviews/MAIN_POST_MERGE_REVIEW_ROUND1.md)

Historical review records explain how earlier changes were reached. They are not current product instructions or the architecture roadmap. Verify current behavior in the public guides, implementation, tests, active architecture decisions, checkpoint reports, the batched execution amendment, and final Luna verification evidence.
