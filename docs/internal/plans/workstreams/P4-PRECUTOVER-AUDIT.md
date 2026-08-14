# P4-PRECUTOVER-AUDIT

## Role

Independent final Phase-4 pre-cutover auditor. Audit only. Do not implement fixes and do not authorize a cutover by editing product state.

## Exact product target

Audit exact corrected product SHA:

`bde5c1993112678430423ba32e7fb02b9bb5c9a1`

Repository correction PR: #149. Product Verify #1106 / run `31820807687` passed.

Independent correction audit PR #150 at `33919377db8809739baa3860c6145d0e8f831407` passed Verify #1107 / run `31827716722` with P0/P1/P2/P3 = 0/0/0/1 and concluded the prior repository P1/P2 findings are closed.

## Persistent-Mac evidence packet

The final environment evidence is recorded on PR #149 as issue comment `5298760666` and is explicitly bound to exact product `bde5c199...`.

Key evidence to verify against repository invariants:

- Real authoritative bytes unchanged before/after candidate doctor; state root 0700 and main state/database files 0600.
- Real persistent database remains application migration v7 according to `schema_migrations`; candidate doctor correctly reports database attention, schema 7/latest 8, migration healthy/checkpointed, compatibility transitioning, readOnly/redacted true and mutationAllowed false.
- Disposable byte-identical real-data copy upgraded v7 -> v8 with v1-v7 checksums frozen and v8 checksum `ccba4f9a...`.
- Device projection: 212 records, hash `2684b7e7...`.
- Durable sessions: 8 rows, projection hash `9543dac5...`, exact six-column durable schema only.
- Pairing disposable migration/import: 1 row, projection hash `905bd85f...`.
- Backups remained byte-identical; close/reopen and reruns were healthy/already-current; v7-only opener rejected v8 schema-ahead state.
- Actual operator failure matrix on disposable roots covered corrupt, newer/incompatible, missing current-schema table, permission failures, unavailable database, malformed legacy, valid v7, busy/locked, and artifact orphan/manual-review evidence. Outputs were redacted/path-safe and authority-preserving.
- Focused Node 24 evidence: 31/31 passed.
- Candidate helper started/stopped successfully in completely isolated HOME/port; real helper PID 40162 and engine PID 14939 were not disturbed.
- Only real-Mac mutation was SQLite SHM mtime coordination; authoritative bytes did not change.
- Deliberately not executed: live-root v8 migration/helper staging and real installed Homebrew upgrade. These remain approval-gated maintenance-window operations.

SQLite `PRAGMA user_version` / internal `schema_version` are not the Swift-Sim application migration authority; this architecture uses the repository `schema_migrations` history/table.

## Audit questions

Independently determine:

1. Does exact `bde5c199...` satisfy all repository prerequisites for a Phase-4 authority/cutover decision?
2. Is the persistent-Mac evidence sufficient and correctly scoped, or does any claim still require a real live-root/helper or installed-Homebrew maintenance-window proof before cutover?
3. Are live-root v7->v8 migration/helper staging and an installed v0.6.1 -> candidate Homebrew upgrade hard pre-cutover blockers, or may they be performed as the controlled maintenance-window execution immediately before/with a separately authorized cutover?
4. Does the evidence preserve the core invariants: no two writable truths, legacy authority remains active, rollback/readability remains available, no destructive artifact cleanup, no process authority from SQLite, and no secret/path leakage?
5. Is any physical-device, Simulator, or network proof actually required for a Phase-4 persistence-authority claim, rather than being unrelated ceremony?
6. What exact stop conditions and rollback conditions must bind the eventual cutover workstream?
7. What is the minimal next ordered sequence after this audit?

## Required output

Create `docs/internal/reviews/ARCHITECTURE_PHASE4_PRECUTOVER_AUDIT.md`.

Use P0/P1/P2/P3 findings. Every finding needs exact repository/evidence references, affected invariant/gate, and orchestrator action.

End with explicit answers:

- Repository ready for cutover decision: YES/NO.
- Persistent-Mac evidence sufficient for pre-cutover gate: YES/NO.
- Maintenance-window proof required before authority switch: exact list.
- Any repository correction required: YES/NO.
- Is an authority switch authorized by this audit: NO. The audit may recommend readiness only; a separate serialized cutover decision/workstream is required.

Do not modify production code, schema, authority routing, canonical roadmap/registry/progress/current handoff, rollback policy, or cleanup behavior.
