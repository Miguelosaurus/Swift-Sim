# P4-ARTIFACT-EXECUTION-R2

Status: **READY**
Class: **implementation-ready correction**
Phase: **4**

## Why this exists

PR #136 did not land application source. The independent Wave 1 audit also identified a stale-plan hazard that the re-execution must close.

## Goal

Land the historical device-build maintenance core in a normal isolated repository worktree, building on the proven read-only planner/measurement policy.

## Required behavior

- Dry-run remains non-mutating.
- Any apply operation re-reads the current authoritative build record immediately before acting.
- The plan/apply handshake carries enough freshness identity to detect a changed build revision or equivalent state epoch.
- Apply rechecks the current lifecycle state, live-reload protection, canonical artifact root, and current policy eligibility.
- Drift or ambiguity fails closed.
- Orphan/manual-review inventory is never executable.
- Live-ready DerivedData and protected install payloads remain protected.
- Repeated/interrupted execution is idempotent and failure-isolated.
- All mutating tests use disposable fixtures only.

## Ownership

Own new artifact-maintenance application/domain modules and focused fixtures/tests. Do not own central CLI/helper composition, startup scheduling, global schema/version, canonical control documents, or real-user maintenance execution.

## Verification

Run focused behavior, stale-plan/freshness, retry/idempotency, containment/path-safety, architecture/types/lint/format, full `npm run check`, and exact-head hosted Verify.

## Return

Report exact base/head, draft PR, changed paths, fresh-state mechanism, verification, residual risk, and the minimal shared integration seam requested.
