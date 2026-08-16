# Phase-4 authority cutover maintenance runbook

Status: repository runbook only. This document does **not** authorize a live cutover. It is intended for the later explicitly approved maintenance window after the cutover implementation has exact-head hosted Verify and an independent cutover-code audit.

## Authority model and v9 migration decision

Phase 4 uses one product-global durable authority epoch in `state.sqlite` migration v9. Product routing reads that selector once per operation and selects exactly one durable backend.

v9 is required because v1-v8 contain only pairing-local authority/preparation state. Device-build and durable-session state exist by v8, but there is no semantically correct durable decision that can atomically select authority for all three domains. Reusing the pairing row as a product selector would overload pairing-only source/projection evidence and permit contradictory domain interpretation. v9 therefore adds exactly one global authority/transition/fencing row plus the bounded hybrid-session create-intent recovery table; it changes no pairing, device-build, or session domain columns. `session_records` columns remain exactly the frozen six.

Migrations v1-v8 remain immutable in name, order, statements, and checksum. `session_records` remains exactly `id`, `token`, `project`, `scheme`, `simulator_udid`, and `created_at`. Because the accepted persistent-Mac pre-cutover evidence qualified schema v8, the new v9 maintenance target requires independent migration-target requalification before any real-root migration.

State graph:

```text
legacy
  -> preparing

preparing
  -> legacy             (cancel/abort before activation)
  -> sqlite-rollback    (single atomic activation)

sqlite-rollback
  -> rollback-preparing (begin current-state rollback; still SQLite-authoritative)

rollback-preparing
  -> legacy             (only after verified current-state export)

sqlite-final            (representation reserved for a later workstream only)
```

There is deliberately no transition surface to `sqlite-final`. There is no rollback-expiry, legacy-deletion, or finalization command in this workstream.

`preparing` remains legacy-authoritative. `sqlite-rollback` and `rollback-preparing` remain SQLite-authoritative. Migration, helper startup, shadow import, `doctor`, and `status` never activate SQLite. A newly migrated v9 row initializes to `legacy`.

Pairing's pre-existing authority row is retained only as a pairing-local revision/source/projection fence. The global v9 selector is the only product routing selector. During activation and final rollback authority restoration, the global selector and pairing-local fence are changed inside the same SQLite `BEGIN IMMEDIATE` transaction.

## Explicit operator surface

The maintenance-only entrypoint is:

```text
<installed-libexec>/dist/mac-helper/bin/swift-sim-phase4-cutover.js <action> --state-root <explicit-private-root> ...
```

Actions are `status`, `prepare`, `activate`, `cancel`, and `rollback`. There is deliberately no `finalize` action.

The installed npm/Homebrew candidate contains this exact compiled entrypoint at
`libexec/dist/mac-helper/bin/swift-sim-phase4-cutover.js`, and Homebrew also
writes a `swift-sim-phase4-cutover` launcher. Plain `swift-sim`/`swift-sim-helper`
launchers never expose the maintenance surface; the executor must invoke this
path explicitly and always pass an explicit private `--state-root`.

`status` opens the supplied SQLite database read-only with `PRAGMA query_only = ON`. Every mutating action requires an explicit state root, expected revision, and maintenance-evidence JSON object. `activate` additionally requires the exact preparation id/evidence hash and an explicit rollback-window duration. `rollback` additionally requires the exact cutover epoch.

Do not substitute an implicit `~/.swift-sim` path. Do not run these commands on the real user root until the later maintenance window is explicitly authorized.

## Evidence file

The operator must create maintenance evidence only from measurements made during the authorized window. The code rejects a missing/false required condition. PID alone is invalid: `processIdentity` must contain both PID and the exact process start identity.

Required preparation evidence includes the candidate SHA, hosted Verify run id, exact process identity, **zero unresolved shadow mismatches**, and the stop-condition booleans enforced by `phase4CutoverPreflight.js`. Activation additionally requires final locked projection equality, immediate final freshness, and atomic-transition readiness.

Never pre-fill these booleans before performing the corresponding check.

## All 25 PR #151 stop conditions

The executor must stop before activation if any item is false, unavailable, stale, or ambiguous.

1. **Exact candidate ancestry/SHA.** Confirm the installed/repository candidate is the independently audited exact cutover-code SHA and descends from the frozen Phase-4 parent as reviewed.
2. **Exact-head hosted Verify.** Require the exact candidate head's hosted Verify to be green with no unresolved P0/P1/P2 finding.
3. **Explicit maintenance authorization.** Confirm a single serialized executor and explicit authorization for the live window.
4. **Installed provenance and rollback package/service material.** Prove installed candidate provenance and preserve the known-good package/service rollback material before changing installation state.
5. **Exact helper process identity.** Record PID plus exact process start identity. PID alone is forbidden. Recheck identity before assuming a process has been quiesced.
6. **Writer quiescence and exact locks.** Quiesce external writers, then prove the exact pairing credential, pairing invitation, device-build, and session locks can be acquired. Do not activate while any writer is ambiguous.
7. **Private permissions.** Require the state root and sensitive state/backup/database material to retain private owner-only permissions.
8. **Current live source fingerprints/revisions.** Capture current authoritative legacy hashes/revisions only after quiescence.
9. **Coherent `schema_migrations`.** Verify contiguous v1-v9 history, expected names, and checksums. v1-v8 identities are frozen; v9 is `phase4_global_authority_epoch`.
10. **Database integrity/WAL/FK.** Require integrity `ok`, WAL journal mode, foreign keys enabled, zero FK violations, and all required tables present.
11. **Verified SQLite-consistent pre-migration database snapshot.** Preserve and verify the DB rollback snapshot using the repository's SQLite-consistent snapshot procedure before live migration.
12. **Verified legacy backups.** Require pairing/device/session backups to reproduce the exact locked source bytes used for preparation/import.
13. **Live migration/reopen/idempotency.** Migrate the live private database to v9, close/reopen it, and prove migration idempotency before preparation is treated as current.
14. **Installed candidate helper health.** Prove the installed candidate helper and normal `swift-sim doctor` are healthy without mutating authority.
15. **Final locked projection equality.** While all four exact legacy locks are held, reread current pairing/device/session legacy authority, apply the locked import, and require exact SQLite projection equality for all three durable domains.
16. **Zero unresolved shadow mismatches.** Require zero unresolved Phase-4 shadow mismatch evidence at preparation and again immediately before activation.
17. **Rollback readability.** Prove preserved legacy representations, rollback readers, package/service material, and current SQLite state needed for rollback are readable.
18. **No cleanup.** Do not drain cleanup jobs, delete artifact roots, execute orphan/manual-review cleanup, or otherwise couple historical cleanup to cutover.
19. **No SQLite process authority.** SQLite owns no PID/port/runtime URL/worker/process/engine claim. Process/runtime decisions remain runtime/filesystem-owned.
20. **Immediate final freshness recheck.** With exact locks still held, reread source hashes/projections immediately after equality and immediately before the selector transaction. Any difference aborts.
21. **One atomic authority transition.** Commit the global selector to `sqlite-rollback` once. Pairing's local fence is synchronized in the same SQLite transaction. Do not release legacy locks before this commit completes.
22. **Post-switch transaction/read/reopen health.** Immediately close/reopen the shared database and prove expected authority mode, DB health, and readable pairing/device/session SQLite state. Then perform the separately approved transactional product smoke checks through normal product APIs.
23. **Executable rollback before switch.** Do not activate unless current-state rollback can be executed for pairing, device builds, and sessions and package/service rollback material is available.
24. **Fail-closed abort classes.** Busy, corrupt, incompatible, permission, identity, stale-source, mismatch, or rollback-material failure aborts the transition. Never fall back to the other durable backend.
25. **No unrelated Phase work.** Do not combine cutover with artifact cleanup, rollback expiry/finalization, Phase 5, or unrelated architecture changes.

## Preparation procedure

After conditions 1-14 and 17-19, 23-25 are proven, run `prepare` with the current global revision and evidence file. Preparation:

- keeps product authority on legacy;
- places pairing and global authority in restartable preparing states;
- takes locked current pairing/device/session snapshots;
- creates and verifies legacy backups;
- imports into SQLite and records checkpoints;
- compares durable projections;
- requires zero unresolved shadow mismatch evidence;
- records source revision, projection hash, record count, candidate SHA, and Verify run in v9 preparation evidence.

If preparation fails, do not activate. Repair only the identified precondition, then retry with the exact current revision/preparation id. If abandoning a globally committed preparation, use `cancel` before activation. Cancellation does not delete backups.

## Activation procedure

Only after conditions 15, 16, and 20 have also been proven should the executor run `activate` with:

- exact current preparing revision;
- exact preparation id;
- exact evidence hash;
- explicit rollback-window minutes;
- activation-stage evidence.

The coordinator acquires all exact legacy locks in deterministic path order, rereads current sources, rejects stale preparation/source/projection evidence, reapplies the locked imports, verifies all three SQLite projections, performs a second immediate freshness reread, and only then commits the global `sqlite-rollback` selector plus pairing-local fence in one SQLite transaction. Locks are released only after that commit returns.

The operator entrypoint then reopens the DB and reports post-switch DB/authority/domain-read health. If post-switch health fails after the selector commit, SQLite remains authoritative; use the rollback procedure. Never manually write legacy state or make an implicit fallback decision.

## Crash/restart matrix

| Crash point | Durable global state | Product authority after restart | Required action |
| --- | --- | --- | --- |
| Before `prepare` writes | `legacy` | legacy | restart preflight |
| Pairing preparing/import work before global preparation | global `legacy`; local pairing may be preparing | legacy | rerun `prepare` with the same recovered preparation id/fence |
| Global `preparing` committed | `preparing` | legacy | rerun `prepare`/`activate` after evidence is current, or `cancel` |
| During final locked import/equality/freshness before selector commit | `preparing` | legacy | abort/retry; stale evidence is rejected |
| Immediately after activation transaction commits | `sqlite-rollback` | SQLite | reopen/health check; rollback if post-switch proof fails |
| Before rollback-preparing commit | `sqlite-rollback` | SQLite | restart rollback preflight |
| During current-state rollback export | `rollback-preparing` | SQLite | rerun rollback with current revision/epoch; exports are idempotently republished from current SQLite state |
| Rollback window expires during export | `rollback-preparing` | SQLite | fail closed; do not restore legacy authority |
| Immediately after rollback selector commits | `legacy` | legacy | reopen/health check; stale epoch/revision tokens cannot replay |

No crash state uses two product selectors. `preparing` always routes legacy; `sqlite-rollback` and `rollback-preparing` always route SQLite.

## Production routing

Every normal helper/service operation and every extracted one-shot storage command reads the global authority row once for that operation and calls exactly one selected backend. The inactive backend is lazy. A selected backend error propagates. There is no read merge, silent fallback, or permanent JSON+SQLite dual write.

- Pairing durable credential/invitation reads and writes use SQLite after activation.
- Device build/app/cleanup durable state uses SQLite after activation. Artifact bytes remain filesystem-owned. Cutover orchestration itself never runs cleanup.
- Sessions use SQLite only for `id`, `token`, `project`, `scheme`, `simulatorUDID`, and `createdAt`. The runtime session file continues to own legitimate runtime/process fields. Reconstruction overlays the six current SQLite fields over runtime material so runtime-only saves cannot redefine durable authority.

Explicit user-requested product cleanup commands retain their existing semantics; merely preparing, activating, diagnosing, starting the helper, or rolling back authority does not invoke historical/orphan/manual-review cleanup.

## Current-state rollback procedure

Rollback is permitted only while `now < rollbackExpiresAt` and only for the exact current global revision/cutover epoch. The interval is half-open: `[cutoverAt, rollbackExpiresAt)`. At the expiry instant rollback fails closed.

1. Persist `rollback-preparing` first. The revision increments and product routing remains SQLite.
2. Pairing exports the **current** SQLite credential/invitations through the accepted locked pairing writer and verifies the published legacy representation. Never restore a stale pre-cutover pairing backup over newer SQLite state.
3. Device builds export the **current** SQLite build/app/cleanup durable snapshot under the exact device lock, preserve/verify the prior legacy file as a backup, atomically publish the legacy-compatible current snapshot, and reread/verify projection equality. Artifact bytes are not cleaned.
4. Sessions acquire the exact existing session lock, read **current** runtime/file state, read **current** six-field SQLite durable state, overlay SQLite durable fields through the frozen projection, preserve legitimate runtime-only fields, atomically publish, reread, and verify durable equality.
5. Recheck rollback expiry immediately before the selector commit. Crossing the expiry during export fails closed in `rollback-preparing`, leaving SQLite authoritative.
6. Only after all three exports succeed does one global transaction restore `legacy` while synchronizing pairing's local fence.
7. Close/reopen and prove legacy selector state and DB health. A later epoch cannot be rolled back with an older epoch/revision token.

A crash in `rollback-preparing` is restartable: retry requires the current revision and cutover epoch and republishes current SQLite state before attempting the selector commit. Rollback does not delete SQLite, legacy backups, migration snapshots, package/service rollback material, or rollback readers.

## Diagnostics

Normal `swift-sim doctor` uses the accepted `storage.phase4Support` support model. It remains `readOnly=true`, `redacted=true`, and `mutationAllowed=false`.

It reports the global mode/revision/epoch, active preparation or rollback preparation, rollback availability/window, migration/database/shadow/compatibility health, and authority-preserving recovery actions. Read-only diagnostics deliberately report final preparation freshness as unknown until the activation coordinator performs the mandatory locked freshness check; doctor never acquires mutation locks or pretends that stale evidence is fresh.

Diagnostics never prepare/import/activate/rollback, execute cleanup, delete legacy state, or terminate processes.

## Finalization is out of scope

This implementation does not provide a finalization command. `sqlite-final`, rollback-material deletion, legacy deletion, or rollback expiry/cleanup requires a later separate decision and workstream after the real rollback window and evidence requirements have been satisfied.

## Remaining live maintenance work

Repository implementation and tests cannot satisfy the two environment P3 items from PR #151. The later authorized window still must perform:

1. live-root migration/helper staging against the real private state root, including independent v9 migration-target requalification;
2. the real installed Homebrew v0.6.1-to-candidate upgrade/provenance/service proof.

## Stage-gated execution

The executor performs the following stages in order, and no migration-capable
database open may occur before stage 5:

1. read-only pre-migration inspection;
2. authorization/provenance binding;
3. process/quiescence/private-permission/state checks;
4. verified SQLite-consistent pre-migration snapshot;
5. migration-capable open v7 -> corrected v9;
6. close/reopen;
7. prove corrected v9 migration identity/idempotency/integrity;
8. remaining post-migration/preparation checks;
9. only then allow preparation.

The entrypoint binds the operator evidence file to independently measured
machine-observable facts before any migration-capable open. Hand-authored
`true` values cannot override a contradictory measurable fact; the preflight
inspector and the evidence binding both run read-only.

Those operations were not performed by the P4-CUTOVER-IMPLEMENTATION worker.
