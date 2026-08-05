# ADR-0003 — SQLite domain state and filesystem runtime records

- Status: Accepted
- Date: 2026-08-04
- Implementation selection: 2026-08-05

## Context

JSON files currently hold transactional domain records alongside process journals, leases, locks, artifacts, and early-start handoff records. These categories have different durability and authority requirements.

## Decision

SQLite is the transactional source of truth for domain state such as apps, builds, sessions, pairing metadata, recipes, observations, and cleanup jobs. Exact process-ownership journals, runtime leases, lock owner records, engine handoff records, artifacts, manifests, logs, and generated packages remain explicit private filesystem records. SQLite never authorizes process termination without independent identity proof.

Phase 4 uses the synchronous `DatabaseSync` API from the built-in Node 24 `node:sqlite` module. Swift Sim already pins Node 24 across its package and installation gates, and the built-in module avoids a native addon, postinstall compiler, or separate binary compatibility matrix. The API remains isolated behind one database owner so it can be replaced without leaking driver types into domain repositories.

The Node 24 API is still documented as release-candidate stability. That risk is contained by the pinned runtime, migration checksum fencing, clean package/Homebrew verification, and the fact that Phase 4A does not switch any production reader or writer. Production cutover remains blocked on repository parity, recovery evidence, and the later Phase 4 gates.

## Rejected alternatives

- Permanent JSON/SQLite dual writes create an unbounded consistency problem.
- Putting process ownership in SQLite confuses domain state with kernel identity.
- Replacing all records with one opaque database blob preserves the old custom database rather than improving its boundaries.
- A native SQLite addon adds install-time compilation and platform packaging risk without a demonstrated capability gap on the pinned Node 24 runtime.

## Consequences

Migration needs validation, backup, idempotent import, shadow comparison, rollback, corruption handling, and a clear single-writer cutover. Filesystem permissions and atomic publication remain first-class concerns.

The database owner must fail closed on non-contiguous history, changed migration names or bodies, missing required schema tables, failed transactional upgrades, unavailable WAL/foreign-key behavior, foreign-key violations, and integrity-check failures. Asynchronous transaction callbacks and rollback uncertainty permanently close the owning connection so delayed work cannot escape the transaction boundary. Domain repositories consume typed contracts rather than `DatabaseSync` directly.

## Migration strategy

Freeze legacy readers, validate and back up legacy data, import transactionally, compare projections, switch writes after shadow evidence, and keep legacy data read-only for the defined rollback window. Remove it only through an explicit later migration.

Phase 4A creates only schema history and normalized legacy-import checkpoint evidence. Later Phase 4 subphases add typed domain tables and repositories, then temporary dual-read/shadow comparison. No generic domain blob table or production dual write is introduced.

## Revisit conditions

Revisit if the supported Node SQLite API cannot provide the required transaction, busy, permission, and upgrade behavior on a clean supported install, if Node 24 packaging no longer includes the required API, or if a record's authority classification changes with new product requirements.

## Reference

- Node.js v24 SQLite API: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
