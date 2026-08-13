# P4-ARTIFACT-MAINTENANCE

Status: **READY**  
Class: **implementation-ready**  
Phase: **4**

## Goal

Build the explicit historical device-build artifact maintenance core from the already-proven 4Z3–4Z5 policy/audit boundary, while keeping product enablement and central CLI composition separate for orchestrator integration.

## Dependencies

- Phase 4Z2 future-build retention behavior
- Phase 4Z3 canonical planner
- Phase 4Z4 read-only measurement
- Phase 4Z5 doctor audit and real-Mac 212-build proof

## Owns

- new artifact-maintenance application/domain modules
- bounded plan/apply interfaces that consume the canonical planner output
- idempotency/resume/failure-isolation behavior
- focused fixtures/tests
- workstream-specific documentation

## Must preserve

- dry-run remains non-mutating
- live-ready DerivedData remains protected by current policy
- install payloads remain protected by current policy
- orphan/manual-review inventory is never treated as automatically eligible
- path ownership is canonical and containment-safe
- interrupted/repeated operations are safe and observable

## Does not own

- `mac-helper/bin/swift-sim.js`
- `mac-helper/bin/swift-sim-helper.js`
- global SQLite schema/version
- startup scheduling
- canonical roadmap/registry/progress/handoff
- Phase 4 authority transition

Expose a narrow integration seam instead of editing those surfaces.

## Required verification

- focused plan/apply behavioral tests
- failure/retry/idempotency cases
- containment/path-safety cases
- architecture/type/lint/format gates relevant to touched code
- exact-head hosted Verify before recommending integration

## Return to orchestrator

Report exact base/head, draft PR, changed paths, invariant review, verification, residual risks, and the minimal shared wiring requested for integration.
