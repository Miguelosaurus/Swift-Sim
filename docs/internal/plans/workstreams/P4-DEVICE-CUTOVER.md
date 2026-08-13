# P4-DEVICE-CUTOVER

Status: **READY**  
Class: **implementation-ready**  
Phase: **4**

## Goal

Build and test the device-build migration-state, export, compatibility, and rollback abstractions required by the Phase 4 design. This workstream prepares modules and fixtures; canonical integration remains orchestrator-owned.

## Dependencies

- ADR-0003
- pairing migration/rollback precedent already in current ancestry
- Phase 4Y historical compatibility
- real-Mac 212/212 shadow-import evidence
- Phase 4Z5 diagnostics evidence

## Owns

- bounded device-build migration-state modules
- export/compatibility abstractions
- deterministic migration fixtures
- interruption/restart/idempotency tests
- workstream-specific docs

## Constraints

- do not change the currently recorded production source of truth
- preserve explicit rollback/readability semantics in the design
- reuse pairing primitives when semantics match
- expose shared schema/composition requirements to the orchestrator rather than owning them

## Does not own

- global SQLite schema/version ordering
- central helper/CLI composition
- canonical source-of-truth selection
- canonical roadmap/registry/progress/handoff

## Required verification

- focused migration/export/rollback fixtures
- restart/interruption/idempotency cases
- architecture/type/lint/format gates relevant to touched code
- exact-head hosted Verify before recommending integration

## Return to orchestrator

Report exact base/head, draft PR, changed paths, reusable pairing primitives, shared-schema/composition requirements, invariant review, verification, and residual risks.
