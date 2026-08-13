# P4-SESSION-BOUNDARY

Status: **READY**
Class: **implementation-ready foundation**
Phase: **4**
Supersedes the design direction attempted in PR #137.

## Goal

Freeze the durable session-domain projection and compatibility boundary before any session SQLite repository/import/shadow implementation is accepted.

## Required analysis

Derive the current `SessionRecord` shape from the actual tree and classify every field as one of:

1. durable domain state eligible for repository migration;
2. transient stream/runtime ownership that remains filesystem/runtime state;
3. derived presentation data that should be reconstructed rather than independently persisted;
4. ambiguous — requiring explicit orchestrator decision before repository work.

The classification must include the nested stream fields and explain the lifecycle/ownership consequences of each choice.

## Required implementation

- Introduce a narrow typed durable-session projection/parser/normalizer and round-trip fixtures.
- Define the join/projection seam that combines durable session information with the existing runtime/stream record for current consumers without creating two independently writable copies of transient ownership.
- Reuse/generalize the existing proven Darwin legacy process-identity adapter for session legacy locking/snapshot compatibility.
- Characterize matching process-start identity and PID-reuse with different start identity.
- Add source/behavior tests proving transient stream/process/runtime fields are excluded from the durable projection.

Do **not** implement the replacement SQLite session repository in this workstream. That becomes P4-SESSIONS-DOMAINS-R2 after this boundary is verified.

## Boundaries

Do not change global schema/version, central helper/CLI composition, current production source-of-truth selection, or canonical control documents. Do not carry forward PR #137's full-record `record_json` storage model.

## Verification

Run focused projection/join/identity tests, architecture/types/lint/format, full `npm run check`, and exact-head hosted Verify.

## Return

Report exact base/head, field-by-field classification, changed paths, durable projection contract, runtime join contract, reused identity primitive, verification, and any ambiguous field requiring orchestrator decision.
