# ADR-0003 — SQLite domain state and filesystem runtime records

- Status: Accepted
- Date: 2026-08-04

## Context

JSON files currently hold transactional domain records alongside process journals, leases, locks, artifacts, and early-start handoff records. These categories have different durability and authority requirements.

## Decision

SQLite is the transactional source of truth for domain state such as apps, builds, sessions, pairing metadata, recipes, observations, and cleanup jobs. Exact process-ownership journals, runtime leases, lock owner records, engine handoff records, artifacts, manifests, logs, and generated packages remain explicit private filesystem records. SQLite never authorizes process termination without independent identity proof.

## Rejected alternatives

- Permanent JSON/SQLite dual writes create an unbounded consistency problem.
- Putting process ownership in SQLite confuses domain state with kernel identity.
- Replacing all records with one opaque database blob preserves the old custom database rather than improving its boundaries.

## Consequences

Migration needs validation, backup, idempotent import, shadow comparison, rollback, corruption handling, and a clear single-writer cutover. Filesystem permissions and atomic publication remain first-class concerns.

## Migration strategy

Freeze legacy readers, validate and back up legacy data, import transactionally, compare projections, switch writes after shadow evidence, and keep legacy data read-only for the defined rollback window. Remove it only through an explicit later migration.

## Revisit conditions

Revisit if the supported Node SQLite API cannot provide the required transaction, busy, permission, and upgrade behavior on a clean supported install, or if a record's authority classification changes with new product requirements.
