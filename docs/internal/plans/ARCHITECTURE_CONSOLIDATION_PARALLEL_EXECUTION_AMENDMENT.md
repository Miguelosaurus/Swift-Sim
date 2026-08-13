# Architecture Consolidation Parallel Execution Amendment

Status: **Mandatory execution control**

Authorized by Miguel on **2026-08-13**.

This amendment augments the canonical master plan, invariants, execution guide, batched-execution amendment, checkpoint protocol, and progress ledger. It does **not** replace numbered phases, architectural invariants, rollback requirements, local/hardware evidence, checkpoint records, or final merge authorization. Where the older execution guide assumes a single implementation agent or serial preparation, this amendment controls concurrency.

## Execution model

The architecture program now uses two layers:

1. a **serial integration spine** for phase completion, authority changes, shared schema/protocol changes, and mandatory checkpoints; and
2. a **parallel implementation DAG** for bounded workstreams with explicit ownership and dependencies.

The canonical integration spine remains:

`0 -> 1 -> 2 -> checkpoint 1 -> 3 -> 4 -> 5 -> checkpoint 2 -> 6 -> 7 -> 8 -> checkpoint 3 -> 9 -> 10`

Parallel work does not permit an agent to skip a gate. A later-phase workstream may be prepared early only when its contract classifies it as preparatory or advance implementation and states what remains blocked from canonical integration.

## Workstream classes

Every registered workstream has one class:

- **implementation-ready** — prerequisites are validated; production code may change only inside the assigned ownership surface.
- **advance-implementation** — disjoint implementation may be built and tested early, but canonical routing/integration waits for its numbered phase.
- **preparatory** — analysis, characterization, fixtures, differential tests, prototypes, inventories, or docs; no production behavior switch.
- **integration** — shared schema/protocol, central composition, canonical ledger/handoff, authority sequencing, conflict resolution. Orchestrator-owned unless explicitly delegated.
- **evidence** — persistent-machine, physical-device, upgrade, external-beta, or other environment-specific proof. Evidence agents report; they do not fix unless separately assigned.

## Orchestrator role

The orchestrator owns the whole-program dependency graph and must:

- assign and pin each workstream base;
- prevent overlapping ownership;
- control READY/PREP/BLOCKED/INTEGRATING/VERIFIED/SUPERSEDED/DONE transitions;
- review worker PRs and reconcile discovered dependencies;
- own or explicitly delegate shared/red-zone changes;
- integrate accepted work in numbered phase order;
- preserve exactly one authoritative source of truth during migrations;
- maintain the canonical roadmap, registry, progress ledger, and current handoff;
- schedule checkpoint reviews and irreducible local/hardware evidence;
- refuse advancement while a relevant invariant or gate is unresolved.

Workers do not self-promote their work into the canonical phase stack.

## Worker role

Before implementation, a worker must read:

1. `AGENTS.md`
2. `ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md`
3. `ARCHITECTURE_CONSOLIDATION_INVARIANTS.md`
4. `ARCHITECTURE_CONSOLIDATION_BATCHED_EXECUTION_AMENDMENT.md`
5. this amendment
6. `ARCHITECTURE_CONSOLIDATION_PARALLEL_ROADMAP.md`
7. `ARCHITECTURE_CONSOLIDATION_WORKSTREAM_REGISTRY.md`
8. `ARCHITECTURE_CONSOLIDATION_AGENT_PROTOCOL.md`
9. the assigned workstream file

Workers must use the registry/current handoff as the source for current program state instead of reconstructing it from old PR titles or stale branches.

## Branch and PR rules

- Workstream branches use `agent/arch-ws-<ID>-<slug>` unless the registry says otherwise.
- Start from the exact base SHA/ref pinned by the registry/orchestrator.
- Never force-push or rewrite validated ancestry.
- Corrections are ordinary child commits.
- Product work uses draft PRs and remains unmerged until the orchestrator/integration plan says otherwise.
- A dependent workstream may stack from an unmerged predecessor's exact validated head when the registry marks the dependency provisionally satisfied.
- Workers do not edit canonical roadmap/registry/progress/current-handoff files unless their contract explicitly grants control-plane ownership.
- Workers record results in their workstream file or PR body; the orchestrator updates canonical program state.

## Shared/red-zone ownership

These surfaces are orchestrator-owned by default because concurrent edits create disproportionate integration risk:

- canonical progress ledger, parallel roadmap, workstream registry, and current handoff
- global SQLite schema/version and shared migration ordering
- `mac-helper/bin/swift-sim-helper.js`
- `mac-helper/bin/swift-sim.js`
- root package manifests/lockfiles and TypeScript compiler configuration
- architecture baseline policy/global exceptions
- authoritative CI/release workflows
- cross-workstream protocol/schema definitions
- final authority selectors, cutover switches, rollback-window expiry, legacy deletion, or other irreversible transitions

A workstream may touch a red-zone surface only when its contract grants explicit ownership and identifies the integration consequence.

## Gate restrictions parallel work cannot bypass

### Phase 4

Until the Phase 4 gate is complete:

- JSON/device-build authority remains exactly as recorded by the current canonical stack.
- No worker independently activates SQLite authority.
- No worker deletes legacy state or expires rollback paths.
- Historical artifact deletion requires a separately reviewed explicit operator action; startup/background historical cleanup may not be invented by a worker.

### Phase 5 / checkpoint 2

Preload-removal preparation may run early, but production removal cannot be declared complete until replacement capabilities are explicit, call sites are migrated, raw/package behavior matches, monkey-patch/import-order safety is gone, and checkpoint 2 is produced.

### Phase 6 and 7

Live-reload decomposition and analyzer preparation may proceed in parallel where ownership is disjoint. Production analyzer replacement still follows the Phase 6 integration gate. Newly permissive analyzer output remains disabled until required physical-device proof exists.

### Phase 8 / checkpoint 3

Feature-architecture work may be prepared in disjoint iOS modules, but the integrated Phase 8 must preserve behavior and checkpoint 3 remains mandatory before Phase 9.

### Phase 10

Repository automation may prepare matrices, harnesses, diagnostics, and report templates. It cannot manufacture physical-device, external-beta, or long-lived reliability evidence.

## Dependency and conflict rule

If a worker discovers an unlisted shared dependency or required red-zone edit, it must stop that portion, document the dependency, and continue only independent work. It must not silently broaden scope.

If two workstreams overlap in production ownership, the orchestrator resolves the overlap before either integrates.

## Verification rule

Focused tests alone do not make a workstream VERIFIED. Product work normally requires the exact-head hosted Verify unless its contract explicitly says the result is preparatory only. Environment-specific evidence is recorded separately from hosted-green repository evidence.

## Integration rule

Parallel worker PRs are inputs to the canonical phase stack, not independent release lines. The orchestrator integrates accepted work by ordinary child/integration commits in dependency order, reruns exact-head verification, then updates canonical program state. Shared schema/composition integration is intentionally serialized even when feeder implementations were produced concurrently.

## Checkpoint rule

Checkpoint 1 remains historical and valid. Checkpoints 2 and 3 evaluate the **integrated canonical phase head**, never a collection of individually green worker branches.

## Stop conditions

Stop advancement for:

- a P0/P1 correctness, privacy, authorization, process-ownership, or data-loss defect;
- two writable truths for one domain;
- destructive filesystem behavior outside a proven canonical root;
- authority/cutover changes without rollback/evidence;
- newly permissive analyzer output without required proof;
- work based on the wrong/stale ancestor;
- unresolved red-zone ownership conflict;
- a relevant exact-head gate failure.

## Relationship to previous controls

The older execution guide remains authoritative for architecture, phase gates, self-review, and evidence. Its assumption that one implementation agent must personally finish each phase before unrelated later-phase preparation begins is superseded here.

The batched-execution amendment remains active; this amendment adds concurrency and explicit workstream ownership on top of its stacked-PR model.
