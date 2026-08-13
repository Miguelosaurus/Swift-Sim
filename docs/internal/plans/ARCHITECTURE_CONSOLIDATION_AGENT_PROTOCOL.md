# Architecture Consolidation Agent Protocol

Status: **Mandatory worker protocol**

This protocol is for agents assigned a registered architecture-consolidation workstream. It is intentionally operational: a worker should be able to start from this file and its workstream contract without needing the orchestration chat.

## Required reading order

1. `/AGENTS.md`
2. `ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md`
3. `ARCHITECTURE_CONSOLIDATION_INVARIANTS.md`
4. `ARCHITECTURE_CONSOLIDATION_BATCHED_EXECUTION_AMENDMENT.md`
5. `ARCHITECTURE_CONSOLIDATION_PARALLEL_EXECUTION_AMENDMENT.md`
6. `ARCHITECTURE_CONSOLIDATION_PARALLEL_ROADMAP.md`
7. `ARCHITECTURE_CONSOLIDATION_WORKSTREAM_REGISTRY.md`
8. this protocol
9. your assigned file under `docs/internal/plans/workstreams/`

If any older handoff or PR body conflicts with the canonical control documents above, stop and report the conflict instead of guessing.

## Start procedure

Before editing:

1. confirm the assigned workstream ID and status;
2. record the exact dispatch SHA supplied by the orchestrator;
3. confirm that SHA descends from the base required by the workstream;
4. create/use only the assigned branch;
5. inspect the workstream's owned paths and explicit non-goals;
6. identify any requested shared/red-zone edit before implementation;
7. run the focused baseline checks named by the workstream when practical.

Do not silently switch to a newer branch head after beginning work.

## Scope discipline

A worker may:

- implement the bounded responsibility assigned by the workstream;
- add focused behavioral tests/fixtures;
- add modules that keep shared composition thin;
- document findings in the workstream result/PR.

A worker may not, unless explicitly assigned:

- edit the canonical roadmap, registry, progress ledger, or current handoff;
- change global SQLite migration ordering/version;
- change root package/compiler policy;
- refactor unrelated code encountered nearby;
- activate a production authority transition;
- collapse multiple workstreams into one PR for convenience;
- broaden a preparatory workstream into a production behavior switch;
- merge its own draft PR or parent phase stack.

When a required dependency falls outside scope, record it as a dependency for the orchestrator and continue only independent work.

## Shared/red-zone procedure

If implementation appears to require a red-zone path:

1. determine whether the work can expose a narrow module/interface instead;
2. if yes, implement the module and leave central wiring to integration;
3. if no, stop that portion and report the exact shared edit needed;
4. do not create competing edits to central composition merely to make a local test convenient.

This is the main mechanism that allows multiple agents to work simultaneously without merge contention.

## Architecture and safety review

Every worker must review its result against relevant invariant groups, not just tests. At minimum report:

- authority/source-of-truth impact;
- filesystem/process ownership impact;
- privacy/redaction impact;
- migration/rollback compatibility when relevant;
- raw-source vs packaged-runtime impact when relevant;
- behavior/performance evidence deferred to local/physical environments;
- whether a temporary compatibility bridge was introduced and when it should disappear.

## Verification expectations

### Implementation-ready/advance-implementation

Normally require:

- focused tests;
- architecture/type/lint/format gates relevant to touched code;
- exact-head hosted Verify before the worker recommends integration.

If hosted verification cannot run for a legitimate reason, report that explicitly; do not call the work VERIFIED.

### Preparatory

Require deterministic checks for generated inventories/fixtures/prototypes, plus architecture/doc checks as relevant. A preparatory workstream must not imply that its future phase gate has passed.

### Evidence

Do not fix failures while collecting evidence unless the assignment explicitly includes repair. Preserve before/after state and report exact commands/environment/SHA.

## PR rules

- Draft PR only.
- PR title starts with the workstream ID.
- PR body records exact base and current head.
- Keep the PR narrowly scoped to assigned ownership.
- No force-push of validated ancestry.
- Corrections are child commits.
- Do not merge.

## Required return report

Use this structure:

```text
Workstream: <ID>
Base SHA: <exact>
Branch: <branch>
Draft PR: <number/url>
Final candidate SHA: <exact>

Outcome:
- ...

Changed paths:
- path — reason

Invariant review:
- source of truth: ...
- process/filesystem authority: ...
- privacy/redaction: ...
- migration/rollback: ...
- compatibility bridge/deadline: ...

Verification:
- focused: ...
- hosted exact-head: ...
- deferred local/physical evidence: ...

Dependencies discovered:
- ...

Red-zone/shared edits:
- avoided: ...
- requested for integration: ...

Residual risks:
- ...

Recommendation:
- ready for orchestrator integration | needs correction | blocked
```

## Definition of success

A successful worker leaves the orchestrator with a reviewable, bounded, verified input that can be integrated without reverse-engineering the worker's reasoning or untangling unrelated edits.
