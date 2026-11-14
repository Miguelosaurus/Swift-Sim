# P4-SESSIONS-DOMAINS-R2

Status: **ACTIVE**  
Class: **implementation-ready**  
Phase: **4**

Dispatch base: `41269235243f836a2575de3f306ebb4ca342cad8`

This base is the fully hosted-green P4-SESSION-BOUNDARY head. It freezes the durable/runtime split and exact legacy Darwin process-start identity semantics before repository work begins.

## Goal

Implement the bounded repository/import/shadow foundation for the **durable session projection only**. Do not persist the mixed legacy session aggregate wholesale.

The frozen durable fields are exactly:

- `id`
- `token`
- `project`
- `scheme`
- `simulatorUDID`
- `createdAt`

`mac-helper/src/contracts/durableSession.ts` and `mac-helper/src/persistence/sessionBoundaryProjection.js` are authoritative for this workstream.

## Owns

- a session SQLite schema fragment for the durable projection only;
- durable session repository abstractions/implementation;
- locked legacy snapshot/import logic that projects legacy records through `projectDurableSession`;
- durable shadow comparison/mismatch primitives where appropriate;
- deterministic import/restart/idempotency fixtures;
- focused tests and workstream documentation.

## Must preserve

- JSON/session compatibility state remains the currently recorded production authority;
- runtime/process/stream ownership stays outside SQLite;
- `updatedAt` and `revision` from the mixed legacy aggregate are not copied into the durable repository unless a later orchestrator decision creates a new domain-specific epoch;
- `stream`, `build`, logs, orientation, remote URLs, PIDs, ports, process identities, worker/runtime claims and other transient presentation/runtime fields are not stored in the durable session table;
- presentation joins remain an explicit boundary operation rather than making SQLite a second owner of runtime state;
- legacy locking reuses `createSessionLegacyProcessIdentity` and the proven Darwin `/bin/ps -p <pid> -o lstart=` identity semantics; PID alone is insufficient;
- import/restart behavior is idempotent and fails closed on malformed durable fields;
- no two writable truths are introduced.

## Reference-only prior work

PR #137 may be inspected for useful mechanical ideas such as repository/import/shadow test structure, but its whole-record `record_json`, mixed `revision`/`updatedAt`, and `stream_state` persistence design was explicitly rejected by the Wave 1 audit and must not be carried forward.

## Does not own

- global SQLite schema/version/order;
- central helper/CLI composition;
- production authority selection or routing;
- runtime/process ownership persistence;
- canonical roadmap/registry/progress/current handoff;
- Phase 4 integration sequencing.

Expose exact shared-schema statements/requirements for orchestrator integration rather than editing the global migration list.

## Required verification

At minimum cover:

- exact six-field durable round trip;
- legacy mixed record projects to durable-only SQLite data;
- runtime-only changes do not create durable differences;
- durable field changes are detected by shadow comparison;
- malformed durable data fails safely;
- import/restart/idempotency behavior;
- exact legacy lock identity and PID-reuse behavior;
- proof that runtime/process fields are absent from persisted durable rows;
- relevant architecture/type/lint/format gates;
- full `npm run check` and exact-head hosted Verify.

## Return to orchestrator

Report exact base/head, draft PR, changed paths, schema fragment requested for integration, durable field proof, lock identity proof, verification evidence, residual risks, and any shared composition requested. Do not self-integrate.
