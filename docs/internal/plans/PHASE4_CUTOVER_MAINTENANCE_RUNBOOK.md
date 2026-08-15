# Phase-4 authority cutover maintenance runbook

Status: repository runbook only. This document does **not** authorize a live cutover. It is intended for the later explicitly approved maintenance window after the cutover implementation has exact-head hosted Verify and an independent cutover-code audit.

## Authority model

Phase 4 uses one product-global durable authority epoch in `state.sqlite` migration v9. Product routing reads that selector once per operation and selects exactly one durable backend.

State graph:

```text
legacy
  -> preparing
  -> sqlite-rollback

preparing
  -> legacy          (cancel/abort before activation)

sqlite-rollback
  -> legacy          (current-state rollback inside the half-open rollback window)
  -> sqlite-final    (reserved for a later, separate finalization decision; no finalization surface is shipped by this workstream)
```

`preparing` is still legacy-authoritative. Migration, helper startup, shadow import, `doctor`, and `status` do not activate SQLite. A new v9 row is initialized to `legacy`.

Pairing's pre-existing authority row is retained only as a pairing-local revision/source/projection fence. The global v9 selector is the only product routing selector. During activation and rollback, the global selector and pairing-local fence are changed inside the same SQLite `BEGIN IMMEDIATE` transaction.

## Explicit operator surface

The maintenance-only entrypoint is:

```text
node <installed-libexec>/mac-helper/bin/swift-sim-phase4-cutover.js <action> --state-root <explicit-private-root> ...
```

Actions are `status`, `prepare`, `activate`, `cancel`, and `rollback`. There is deliberately no `finalize` action.

`status` is read-only. Every mutating action requires an explicit state root, expected revision, and a maintenance-evidence JSON object. `activate` additionally requires the exact preparation id/evidence hash and an explicit rollback-window duration. `rollback` additionally requires the exact cutover epoch.

Do not substitute an implicit `~/.swift-sim` path. Do not run these commands on the real user root until the later maintenance window is explicitly authorized.

## Evidence file

The operator must create maintenance evidence only from measurements made during the authorized window. The code rejects a missing/false required condition. PID alone is invalid: `processIdentity` must contain both PID and the exact process start identity.

Required evidence includes the candidate SHA, hosted Verify run id, exact process identity, zero shadow mismatch count, and the stop-condition booleans enforced by `phase4CutoverPreflight.js`. Activation requires the stronger final equality/freshness/atomicity fields.

Never pre-fill these booleans before performing the corresponding check.

## All 25 PR #151 stop conditions

The executor must stop before activation if any item is false, unavailable, stale, or ambiguous.

1. **Exact candidate ancestry/SHA.** Confirm the installed/repository candidate is the independently audited exact cutover-code SHA and descends from the frozen Phase-4 parent as reviewed.
2. **Exact-head hosted Verify.** Require the exact candidate head's hosted Verify to be green with no unresolved P0/P1/P2 finding.
3. **Explicit maintenance authorization.** Confirm a single serialized executor and explicit authorization for the live window.
4. **Installed provenance and rollback package/service material.** Prove the installed candidate provenance and preserve the known-good package/service rollback material before changing installation state.
5. **Exact helper process identity.** Record PID plus exact process start identity. PID alone is forbidden. Recheck identity before assuming a process has been quiesced.
6. **Writer quiescence and exact locks.** Quiesce external writers, then prove the exact pairing credential, pairing invitation, device-build, and session locks can be acquired. Do not activate while any writer is ambiguous.
7. **Private permissions.** Require the state root and sensitive state/backup/database material to retain private owner-only permissions.
8. **Current live source fingerprints/revisions.** Capture current authoritative legacy hashes/revisions only after quiescence.
9. **Coherent `schema_migrations`.** Verify contiguous v1-v9 history, expected names, and checksums. v1-v8 identities are frozen; v9 is `phase4_global_authority_epoch`.
10. **Database integrity/WAL/FK.** Require integrity `ok`, WAL journal mode, foreign keys enabled, zero FK violations, and all required tables present.
11. **Verified SQLite-consistent pre-migration database snapshot.** Preserve and verify the DB rollback snapshot using the repository's SQLite-consistent snapshot procedure before live migration.
12. **Verified legacy backups.** Require pairing/device/session backups to reproduce the exact locked source bytes used for preparation/import.
13. **Live migration/reopen/idempotency.** Migrate the live private database to v9, close/reopen it, and prove the migration is idempotent before preparation may be treated as current.
14. **Installed candidate helper health.** Prove the installed candidate helper and normal `swift-sim doctor` are healthy without mutating authority.
15. **Final locked projection equality.** While all four exact legacy locks are held, reread current pairing/device/session legacy authority, apply the locked import, and require exact SQLite projection equality for all three durable domains.
16. **Zero unresolved shadow mismatches.** Require zero unresolved Phase-4 shadow mismatch evidence immediately before activation.
17. **Rollback readability.** Prove the preserved legacy representations, rollback readers, package/service material, and current SQLite state needed for rollback are readable.
18. **No cleanup.** Do not drain cleanup jobs, delete artifact roots, execute orphan/manual-review cleanup, or otherwise couple historical cleanup to cutover.
19. **No SQLite process authority.** SQLite owns no PID/port/runtime URL/worker/process/engine claim. Process/runtime decisions remain runtime/filesystem-owned.
20. **Immediate final freshness recheck.** With the exact locks still held, reread source hashes/projections immediately after equality and immediately before the selector transaction. Any difference aborts.
21. **One atomic authority transition.** Commit the global selector to `sqlite-rollback` once. Pairing's local fence is synchronized in the same SQLite transaction. Do not release the legacy locks before this commit completes.
22. **Post-switch transaction/read/reopen health.** Immediately close/reopen the shared database and prove expected authority mode, DB health, and readable pairing/device/session SQLite state. Then perform the separately approved transactional product smoke checks.
23. **Executable rollback before switch.** Do not activate unless current-state rollback can be executed for pairing, device builds, and sessions and package/service rollback material is available.
24. **Fail-closed abort classes.** Busy, corrupt, incompatible, permission, identity, stale-source, mismatch, or rollback-material failure aborts the transition. Never fall back to the other durable backend.
25. **No unrelated Phase work.** Do not combine the cutover with artifact cleanup, rollback expiry/finalization, Phase 5, or unrelated architecture changes.

## Preparation procedure

After conditions 1-14 and 17-19, 23-25 are proven, run the explicit `prepare` action with the current global revision and evidence file. Preparation:

- keeps product authority on legacy;
- places pairing and global authority in restartable preparing states;
- takes locked current pairing/device/session snapshots;
- creates and verifies legacy backups;
- imports into SQLite and records checkpoints;
- records source revision, projection hash, record count, candidate SHA, and Verify run in v9 preparation evidence.

If preparation fails, do not activate. Repair only the identified precondition, then retry with the exact current revision/preparation id. If abandoning the attempt, use `cancel` while still pre-activation. A cancelled preparation returns product authority to legacy and does not delete backups.

## Activation procedure

Only after conditions 15, 16, and 20 have also been proven should the executor run `activate` with:

- exact current preparing revision;
- exact preparation id;
- exact evidence hash;
- explicit rollback-window minutes;
- activation-stage evidence.

The coordinator acquires all exact legacy locks in deterministic path order, rereads current sources, rejects stale preparation/source/projection evidence, reapplies the locked imports, verifies all three SQLite projections, performs a second immediate freshness reread, and only then commits the global `sqlite-rollback` selector plus pairing-local fence in one SQLite transaction. Locks are released only after that commit returns.

The operator entrypoint then reopens the DB and reports post-switch DB/authority/domain-read health. If that post-switch health fails after the selector commit, treat SQLite as authoritative and use the rollback procedure; never manually write legacy state or make an implicit fallback decision.

## Crash/restart matrix

| Crash point | Durable state | Product authority after restart | Required action |
| --- | --- | --- | --- |
| Before `prepare` writes | `legacy` | legacy | restart preflight |
| Pairing preparing/import work before global preparation | local pairing may be preparing; global `legacy` | legacy | rerun `prepare`; preparation id is recovered/fenced |
| Global `preparing` committed | `preparing` | legacy | rerun `prepare`/`activate` after all evidence is current, or `cancel` |
| During final locked import/equality/freshness before selector commit | `preparing` | legacy | abort/retry; stale evidence is rejected |
| Immediately after selector transaction commits | `sqlite-rollback` | SQLite | reopen/health check; rollback if post-switch proof fails |
| During rollback export before selector commit | `sqlite-rollback` | SQLite | rerun rollback; exports are current-state/idempotent |
| Immediately after rollback selector commits | `legacy` | legacy | reopen/health check; do not replay stale rollback epoch |

No crash state uses two product selectors. `preparing` always routes legacy; `sqlite-rollback` always routes SQLite.

## Post-cutover routing

For every product operation, the global authority row is reread once and one backend is chosen. A selected backend error propagates. There is no read merge, silent fallback, or permanent JSON+SQLite dual write.

- Pairing durable credential/invitation reads and writes use SQLite after activation.
- Device build/app/cleanup durable state uses SQLite after activation. Artifact bytes remain on the filesystem and the existing cleanup policy is unchanged; cutover orchestration itself never runs cleanup.
- Sessions use SQLite only for `id`, `token`, `project`, `scheme`, `simulatorUDID`, and `createdAt`. The runtime session file continues to own runtime/process fields. Reconstruction overlays the six current SQLite fields over runtime material so runtime-only saves cannot redefine durable authority.

## Rollback procedure

Rollback is permitted only while `now < rollbackExpiresAt` and only for the exact current global revision/cutover epoch. The interval is half-open: `[cutoverAt, rollbackExpiresAt)`. At the expiry instant rollback fails closed.

Before returning global authority to legacy:

1. Pairing exports the **current** SQLite credential/invitations through the accepted locked pairing writer and verifies the published legacy representation. Never restore a stale pre-cutover pairing backup over newer SQLite state.
2. Device builds export the **current** SQLite build/app/cleanup durable snapshot under the exact device lock, preserve/verify the prior legacy file as a backup, atomically publish the legacy-compatible current snapshot, and reread/verify projection equality. Artifact bytes are not cleaned.
3. Sessions acquire the exact existing session lock, read **current** runtime/file state, read **current** six-field SQLite durable state, overlay the SQLite durable fields through the frozen projection, preserve valid runtime-only fields, atomically publish, reread, and verify durable equality.
4. Only after all three exports succeed does the global transaction return the selector to legacy while synchronizing pairing's local fence.
5. Close/reopen and prove legacy selector state and DB health. A later epoch cannot be rolled back with an older epoch/revision token.

Rollback does not delete SQLite, legacy backups, migration snapshots, package/service rollback material, or rollback readers.

## Finalization is out of scope

This implementation does not provide a finalization command. `sqlite-final`, rollback-material deletion, legacy deletion, or rollback expiry/cleanup requires a later separate decision and workstream after the real rollback window and evidence requirements have been satisfied.

## Remaining live maintenance work

Repository implementation and tests cannot satisfy the two environment P3 items from PR #151. The later authorized window still must perform:

1. live-root migration/helper staging against the real private state root;
2. the real installed Homebrew v0.6.1-to-candidate upgrade/provenance/service proof.

Those operations were not performed by the P4-CUTOVER-IMPLEMENTATION worker.
