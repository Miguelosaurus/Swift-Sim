# Checkpoint 1 Template — Typed Foundation and Explicit Infrastructure

Use this template only after Phase 2 is complete, fully validated, self-reviewed, and still unmerged.

Create `NEXT_AGENT_PROMPT_CHECKPOINT_1_CURRENT_STATE.md` beside this file. Replace every placeholder with current facts. Delete all instructional comments before presenting it to Miguel.

---

Use the GitHub plugin to perform an independent architecture review of the actual Swift Sim repository and PR. Do not rely only on this summary.

## Review target

- Repository: `Miguelosaurus/Swift-Sim`
- Checkpoint: 1 — typed foundation and explicit infrastructure
- PR: `<number and URL>`
- Branch: `<branch>`
- Base SHA: `<sha>`
- Head SHA: `<sha>`
- State report: `docs/internal/plans/checkpoints/CHECKPOINT_1_STATE.md`

The implementation agent has stopped. Do not authorize Phase 3 until you have inspected the repository and returned a written decision.

## Required reading

Read these completely:

- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_INVARIANTS.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_EXECUTION_GUIDE.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_CHECKPOINT_PROTOCOL.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PROGRESS.md`
- `docs/internal/plans/checkpoints/CHECKPOINT_1_STATE.md`
- all ADRs added or changed in Phases 0–2
- the TypeScript/package configuration, runtime composition root, infrastructure ports, compatibility preloads, and their tests

## What changed

<Concise factual Phase 0–2 summary, including which behavior remained unchanged.>

## Evidence

<Exact CI run, local commands, package/archive tests, process integration tests, and any failures or skipped external gates.>

## Current metrics

<JS/TS counts, preload count, source-text-test count, direct child-process/fs/fetch call sites, largest files, compiled package size, test counts, and delta from Phase 0.>

## Deviations and residuals

<Every deviation from the plan, temporary shim, unsafe type boundary, broad lint exception, test gap, package caveat, and unresolved lifecycle behavior.>

## Decisions and questions

Ask concrete questions about actual implementation choices, including at minimum:

1. Are the boundaries between `CommandRunner` and `ProcessSupervisor` correct, or has responsibility been duplicated?
2. Is the runtime container explicit and small enough, or has it become a service locator?
3. Are runtime validators at untrusted/persisted boundaries sufficient without duplicating all TypeScript types manually?
4. Do compatibility preloads merely delegate, or do they still contain independent safety logic that could drift?
5. Is the selected Node LTS/package strategy appropriate for Homebrew and clean-release execution?
6. Which abstractions should be corrected before helper/HTTP decomposition begins?

Add any state-specific questions.

## Requested output

Return:

- an honest architecture verdict;
- P0/P1/P2/P3 findings with exact files and reasoning;
- required corrections before this PR may merge;
- decisions explicitly approved or rejected;
- abstractions that should be simplified, merged, split, or removed;
- missing invariants or tests;
- whether Checkpoint 1 passes;
- one of these exact continuation decisions:
  - `AUTHORIZED: merge the corrected Phase 2 PR and begin Phase 3`
  - `NOT AUTHORIZED: correct and resubmit Checkpoint 1`
  - `REPLAN REQUIRED: stop and revise the architecture program`

## Stop declaration

Implementation is stopped. The Phase 2 PR remains draft and unmerged. No Phase 3 production work will begin until Miguel returns your review and explicit continuation approval.

---
