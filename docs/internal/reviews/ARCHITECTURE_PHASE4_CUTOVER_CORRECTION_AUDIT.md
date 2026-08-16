# Architecture Phase 4 Cutover Correction Audit

**Audit role:** independent P4-CUTOVER-CORRECTION-AUDIT  
**Repository:** `Miguelosaurus/Swift-Sim`  
**Audit date:** 2026-08-16  
**Correction PR:** #154 — `P4-CUTOVER-CORRECTIONS-R1: serialized authority transition corrections`  
**Exact corrected product head audited:** `24c8905c80a02dbacbf507e704142ee816e8aca1`  
**Exact audited parent:** `3a1fb02c9ace97dfdd0637fc5ecb391e3570a77e`  
**Corrected-product Verify:** #1139 / run `31961047044` — **SUCCESS** on the exact corrected product head  
**Parent audit:** PR #153 / `273105b347d9068e0ae306a4e7690d85fba8488c` / Verify #1136 / run `31941939456` — PASS

## Executive result

PR #154 materially improves the serialized Phase-4 cutover implementation. It closes the product-wide routing bypass, makes the maintenance executor genuinely installed/reachable, and removes destructive artifact cleanup from ordinary startup. It also correctly strengthens the v9 SQL CHECK constraint itself and adds bounded session-create intent metadata without broadening the six-field durable session aggregate.

It does **not** close every repository finding from PR #153.

Final severity counts:

- **P0: 0**
- **P1: 1**
- **P2: 3**
- **P3: 2**

Open repository findings are:

1. **P1-3** — maintenance preflight remains unusable for a valid v8→v9 transition and does not independently/fail-closed bind several machine-observable facts.
2. **P2-1** — the corrected v9 SQL constraint is sound, but the independent repository row parser still accepts multiple corrupted/constraint-bypassed authority rows that violate the intended mode/evidence/timestamp/storage invariant.
3. **P2-2** — hybrid session create recovery remains vulnerable to a cross-process reconciliation race because reopen reconciliation runs outside the exact session lock.
4. **New P2** — five new source-text implementation tests were allowlisted despite the active architecture invariant forbidding new source-text implementation tests and requiring their count to decrease monotonically.

No live-root migration, installed upgrade, helper stop/restart, authority activation, rollback finalization, legacy deletion, artifact cleanup, or Phase 5 work is authorized by this audit.

## Evidence discipline and live topology

This was a GitHub-only independent architecture/code audit. No product fix was implemented, no local repository was materialized, and no local execution is claimed. Evidence came from immutable GitHub SHAs, exact repository files, PR diffs, tests, release/package scripts, workflow definitions, and hosted verification.

PR #154 was re-fetched before audit publication. Live topology remained:

- base branch: `agent/arch-ws-P4-CUTOVER-IMPLEMENTATION-serialized-authority-transition`
- base SHA: `3a1fb02c9ace97dfdd0637fc5ecb391e3570a77e`
- head branch: `agent/arch-ws-P4-CUTOVER-CORRECTIONS-R1`
- head SHA: `24c8905c80a02dbacbf507e704142ee816e8aca1`
- commits: 3
- changed files: 39

The three ordinary correction commits are:

1. `012f4d72d433c8595ecbfcd905237696f1e6f7a1` above `3a1fb02c9ace97dfdd0637fc5ecb391e3570a77e`;
2. `3218e996c53c497049dcfa3c5c4479952d4c6cf7` above `012f4d72d433c8595ecbfcd905237696f1e6f7a1`;
3. `24c8905c80a02dbacbf507e704142ee816e8aca1` above `3218e996c53c497049dcfa3c5c4479952d4c6cf7`.

PR #154’s body still says the correction is “one ordinary commit above” its parent. GitHub ancestry shows three ordinary commits. This is a PR-body metadata discrepancy, not a product finding.

## Disposition matrix

| Finding | Disposition | Current severity | Audit result |
|---|---|---:|---|
| P1-1 reachable production authority bypass | **CLOSED** | — | Product-wide authority routing accepted. |
| P1-2 maintenance executor not installed | **CLOSED** | — | Installed executor reachability accepted. |
| P1-3 forgeable/unordered maintenance preflight | **OPEN** | **P1** | Ordering improved, but valid execution is blocked and measured truth is incomplete/self-derived/fail-open. |
| P1-4 startup artifact-cleanup drain | **CLOSED** | — | Cleanup-inert ordinary startup accepted. |
| P2-1 impossible v9 authority rows | **OPEN** | **P2** | SQL repair accepted; repository corruption parser remains incomplete. |
| P2-2 hybrid session publication crash recovery | **OPEN** | **P2** | Sequential recovery improved; concurrent reopen race remains. |
| New source-text test-integrity regression | **OPEN** | **P2** | Five new implementation-text exceptions violate the active invariant. |

# 1. P1-1 — product-wide authority routing

**Disposition: CLOSED / ACCEPTED.**

The audit traced real production composition rather than accepting `test/phase4CorrectionsHttpBoundary.test.js` as a facade proof.

`mac-helper/bin/swift-sim-helper-entry.js` installs the corrected HTTP/device boundary preloads before entering the compatibility helper. `deviceBuildCapabilityBoundaryPreload.js` and `helperHttpBoundaryPreload.js` now resolve pairing, invitations, and device builds through `http/phase4BoundaryStoreFactory.js`, which delegates to `createPhase4ProductionStoreFactories()` with automatic device maintenance disabled. The device gateway and renewal-shutdown preload use the same routed construction.

`mac-helper/src/infrastructure/compatibilityHelperRuntime.js` composes the normal long-running helper from `createPhase4ProductionStoreFactories()`. `mac-helper/src/helperCliRuntime.js` uses the same factory for ordinary extracted CLI storage operations. The device-delivery manager launches the routed device gateway rather than owning an independent persistence path.

The correction leaves a few unused legacy-store imports in preload source, but no reachable constructor/fallback path was found behind those dead imports.

`Phase4AuthorityRouter` re-reads the global v9 selector per operation and selects exactly one backend:

- `legacy` / `preparing` → legacy;
- `sqlite-rollback` / `rollback-preparing` / representable `sqlite-final` → SQLite.

Selected-backend errors propagate. There is no merged read, no fallback to inactive legacy after SQLite selection, and no permanent dual write. Inactive backends are lazy.

The corrected HTTP-boundary tests correspond to the production store bundle traced above and establish post-activation pairing/device behavior: SQLite reads/writes, unchanged legacy bytes, no merged legacy token read, selected SQLite error propagation, and preserved SQLite authority after reopen. Invitations use the same routed factory.

**Product-wide authority routing: ACCEPTED.**

# 2. P1-2 — installed maintenance executor

**Disposition: CLOSED / ACCEPTED.**

`scripts/build-dist.sh` copies the reviewed source executor to:

`dist/mac-helper/bin/swift-sim-phase4-cutover.js`

The package-content verifier requires it. Homebrew installs the distribution below `libexec`, yielding the documented supported path:

`libexec/dist/mac-helper/bin/swift-sim-phase4-cutover.js`

and creates a `swift-sim-phase4-cutover` launcher.

This is not source-tree-presence-only proof. `scripts/verify-package-install.sh` installs the packed candidate and executes installed `status` against a disposable state root. `scripts/verify-homebrew-package.sh` executes read-only `status` through both the launcher and exact installed libexec entrypoint. Those checks verify the read-only/non-mutating status surface. Homebrew service startup still starts the ordinary helper; install/start does not implicitly call prepare/activate/cancel/rollback.

Corrected-product Verify #1139/run `31961047044` succeeded on exact SHA `24c8905c80a02dbacbf507e704142ee816e8aca1`, including the clean Homebrew installation gate.

The P1-3 defects below make mutating maintenance execution unacceptable, but they do not reopen the narrower installed-reachability finding.

**Installed executor reachability: ACCEPTED.**

# 3. P1-3 — measured maintenance preflight

**Disposition: OPEN — P1.**

The correction fixes one important structural issue: `swift-sim-phase4-cutover.js` now binds evidence and runs `Phase4CutoverPreflightInspector` before constructing `SwiftSimSqliteDatabase`. The inspector uses read-only `DatabaseSync` plus `PRAGMA query_only = ON`; it does not itself migrate. False conditions can therefore fail before a migration-capable owner exists.

That does not make the final executor safe or usable.

## 3.1 Valid preflight is currently blocked

`Phase4CutoverPreflightInspector.inspect()` returns `permissionsMissing: permissions.missing`, where `permissions.missing` is an array. The executor tests `if (values.permissionsMissing)`. An empty array is truthy in JavaScript, so even a successful private-permission inspection is rejected.

The executor also generically rejects `measured.rollbackReadable === false`. `measurePhase4MaintenanceFacts()` defines rollback readability only for current `sqlite-rollback` authority with rollback material. A legitimate pre-activation `legacy` or `preparing` state therefore fails a condition that cannot yet be true.

The binder adds another pre-migration dead end: `failClosedAbortClassesVerified` is true only when migration history length is `0` or equals the **final expected v9 length**. A legitimate pre-cutover v8 database therefore measures false before the executor is allowed to open the migration-capable owner that would create v9.

The tests demonstrate rejection before migration for false evidence, but the “matching facts” fixture is already v9. There is no behavior-level valid v8→v9 maintenance path proving that the applicable gates can all pass before migration.

## 3.2 Candidate and hosted Verify identity are self-derived

The executor obtains `candidateSHA` from the submitted evidence and passes that same value to the binder as the candidate identity to “measure.” `measurePhase4MaintenanceFacts()` then returns:

- `hostedVerifyGreen: true` unconditionally;
- `installedProvenanceVerified: candidateSHA !== undefined`;
- `verifyRunID: undefined`.

That is not an independent binding of installed candidate bytes/provenance to the exact external Verify run/SHA tuple. Hosted Verify may reasonably be external operator evidence in an offline maintenance window, but it cannot simultaneously be classified as a locally measured constant `true`.

## 3.3 Wrong process identity is measured

Both preflight implementations measure `process.pid` and `/bin/ps -p <pid> -o lstart=` for the **maintenance executor itself**. The maintenance contract requires exact identity/quiescence evidence for the helper/writer process being stopped or proven absent. Self-PID identity proves neither helper identity nor helper quiescence.

The correction tests use `process.pid`, so they characterize the wrong process boundary rather than the required helper boundary.

## 3.4 Migration/shadow facts do not fail closed enough

The evidence binder does compute expected migration checksums, but its coherence boolean compares names/checksums by array position and does not validate the recorded version values themselves. Its separate “fail closed” boolean mainly checks row count. The read-only inspector has a distinct contiguous-version check, but the executor does not enforce that inspector field in `assertPreflightStops()`.

Shadow mismatch readers catch query errors and return zero mismatches. Authority observation similarly catches failures and returns null-like state. Missing/corrupt/unqueryable required state can therefore be converted into benign-looking measurements instead of a hard preflight failure.

## 3.5 Snapshot/backup/source identity is insufficient

The required pre-migration database snapshot is “verified” by reading the SQLite file as UTF-8 text and hashing that decoded string. That is not a byte identity for a binary SQLite database and does not prove a SQLite-consistent snapshot tied to the exact starting DB/WAL/migration state.

Legacy backup verification checks JSON readability for pairing, pairing-invites, and device-build backup filenames. It does not include sessions and does not prove equality to the exact locked live source bytes/hashes. `liveSourceHashesCaptured` likewise does not require all four legacy domains.

## 3.6 P1-3 required repository correction

Before maintenance-window requalification, a separate product correction must:

1. fix `permissionsMissing` enforcement to use the actual missing-entry count/explicit success state;
2. make each stop condition stage-specific so pre-activation stages do not require post-cutover rollback facts, while every deferred fact is required before the stage that relies on it;
3. allow a valid v7/v8 pre-migration state to pass the pre-migration gate without requiring final v9 history before the migration-capable open;
4. independently bind installed candidate identity/provenance to the exact expected SHA and external hosted Verify run/SHA evidence rather than treating submitted SHA/constant true as measurement;
5. measure the actual helper/writer PID plus exact process-start identity, or prove helper absence/quiescence;
6. enforce exact `schema_migrations` version/name/order/checksum identity before migration and fail closed on migration/shadow/authority observation errors;
7. prove a SQLite-consistent pre-migration snapshot using byte-safe identity tied to the exact starting database state;
8. prove all four legacy backups, including sessions, reproduce the exact locked source bytes/hashes used for preparation/import;
9. add realistic behavior-level v7/v8 valid-path and falsification coverage proving false evidence fails before byte mutation and valid applicable evidence reaches the intended next stage without implicit authority or cleanup actions.

**Maintenance preflight enforcement: REJECTED.**

# 4. P1-4 — cleanup-inert startup

**Disposition: CLOSED / ACCEPTED.**

The correction removes destructive artifact cleanup from ordinary device-build store construction and recurring startup maintenance. `runMaintenance()` now owns non-destructive reconciliation/compaction/stale-renewal recovery; destructive filesystem removal remains in `drainArtifactCleanupJobs()` behind explicit command/user-authorized boundaries.

The Phase-4 production factory disables automatic device maintenance for authority-routed helper/HTTP/CLI construction. Doctor and cutover `status` use read-only paths.

`test/phase4CleanupInert.test.js` seeds a due cleanup job plus a sentinel artifact and proves preservation across legacy startup, reopen, SQLite-routed construction, doctor, prepare, activate, and rollback. The production source trace agrees with those sentinels: no ordinary authority construction/reopen/cutover transition drains artifact cleanup.

Delivery-reference maintenance is distinct from destructive artifact-root deletion.

**Cleanup-inert behavior: ACCEPTED.**

# 5. P2-1 — corrected v9 invariant

**Disposition: OPEN — P2.**

The **SQL repair itself is correct**. No v10 was introduced. v9 remains named `phase4_global_authority_epoch`, and its final corrected checksum identity is accepted as:

`1e7bae961d793a3ed8228499bb7b0996a6797964cff5349dcbe9dc43f989f37b`

Migration composition continues to freeze v1-v8 and initializes only legacy authority. The v9 SQL CHECK now requires:

- legacy/preparing → `cutover_epoch = 0`;
- sqlite-rollback/rollback-preparing/sqlite-final → `cutover_epoch > 0`;
- legacy transition/evidence/timestamp fields null;
- preparing evidence present with no cutover/expiry/finalization;
- rollback modes with cutover and later rollback expiry;
- sqlite-final with finalization at/after expiry.

That closes the original SQL-level epoch defect.

The audit requirement, however, explicitly requires the **repository row parser/validator** to reject invalid rows even when SQLite CHECK constraints are bypassed or state is corrupted. The corrected parser does not fully do that.

## 5.1 Constraint-bypass rows still accepted by the repository parser

`parseAuthorityRow()` converts `preparation_id`, `evidence_hash`, evidence/timestamps, and storage version using permissive string/non-negative-integer helpers, then `requireModeLayout()` relies on:

`preparedFields = preparationID !== null && evidenceHash !== null && evidenceJSON !== null && preparedAt !== null`

For `legacy`, it rejects `preparedFields` only when **all four** preparation fields are non-null. A corrupted legacy row with only `preparation_id` non-null therefore has `preparedFields === false` and is accepted if the cutover/expiry/finalization fields are null. That violates the legacy layout invariant once SQL CHECKs are bypassed.

Additional corruption gaps remain:

- `storage_version` is parsed as any non-negative safe integer; the parser does not independently require the SQL invariant `storage_version = 1`;
- `preparation_id` and `evidence_hash` are accepted as arbitrary strings by the parser instead of independently requiring their 64-character lowercase digest form;
- parsed `evidence_json` is required to be valid JSON, but its content is not re-hashed and compared with `evidence_hash` on read;
- `prepared_at`, `cutover_at`, `rollback_expires_at`, and `finalized_at` are accepted as arbitrary strings by `nullableString` rather than canonical UTC timestamps;
- rollback/finalization ordering uses `Date.parse(...)` comparisons without first requiring finite valid dates, so an invalid timestamp can produce `NaN` and evade the `<=`/`<` rejection checks.

`test/phase4AuthorityAdversarial.test.js` covers the zero-epoch contradiction and selected full-layout/timestamp-order contradictions, but it does not exercise these partial-field/digest/storage-version/invalid-date corruption cases.

Therefore SQL CHECK constraints are strong, but the required second independent corruption barrier is incomplete.

## 5.2 P2-1 required repository correction

A follow-up product correction must make the row parser independently enforce the complete durable invariant under CHECK bypass/read corruption:

1. require `storage_version === 1`;
2. require every preparation/evidence field to be **all-null** in legacy, not merely reject the all-present case;
3. validate preparation ID/evidence hash digest syntax on read and, where the persisted contract requires it, verify evidence JSON/hash consistency;
4. require every non-null authority timestamp to be a valid canonical UTC timestamp before performing ordering comparisons;
5. require complete mode-specific null/non-null layout and timestamp ordering after those validations;
6. extend `phase4AuthorityAdversarial.test.js` with constraint-bypassed partial legacy evidence, bad storage version, malformed digest, malformed/non-canonical timestamp, and evidence-corruption cases.

**Final corrected v9 checksum: ACCEPTED.**  
**P2-1 repository invariant closure: REJECTED.**

# 6. P2-2 — hybrid session create recovery

**Disposition: OPEN — P2.**

The correction preserves the frozen durable session boundary. `session_records` still contains exactly:

- `id`
- `token`
- `project`
- `scheme`
- `simulator_udid`
- `created_at`

No revision, updatedAt, stream/build/logs, orientation, remote URL, PID, port, process identity, worker/runtime claim, or other runtime field entered the durable aggregate.

`session_create_intents` contains the same six durable create values plus only `intent_version` and `created_intent_at`. It is not exposed as session state and is correctly shaped as bounded transaction/protocol recovery metadata rather than a second durable session aggregate.

Sequential recovery is materially improved: intent stage → durable upsert → runtime publish allows compensation after failed runtime publication and reopen cleanup of abandoned unpublished rows. Existing tests cover sequential failure/reopen/retry and preserve runtime-only fields.

## 6.1 Cross-process reconciliation race

`createSqliteDurableSessionStore()` overrides `load()` to read raw runtime IDs and call `durableRepository.reconcileCreateIntents(runtimeIDs)` **before** inherited load. That reconciliation is not protected by the exact `sessions.json` lock.

The inherited `SessionStore.create()` does hold that exact lock while the hybrid write path performs separate SQLite transactions for intent staging and durable upsert before publishing the runtime file.

A concurrent opener can therefore race a valid in-flight create:

1. Process A holds `sessions.json.lock` and stages a create intent.
2. Before A publishes the runtime file, Process B constructs/reopens a hybrid store.
3. B does not acquire the session lock before reading the old runtime file/reconciling intents.
4. If B runs after intent stage but before durable upsert, B can delete the intent as stale; A can then commit the durable row and crash before runtime publication, recreating an abandoned durable row with no intent available for compensation.
5. If B runs after durable commit but before runtime publication, B can delete A’s durable row + intent as “unpublished” while A is still the legitimate lock owner; A can then publish runtime state or fail at another boundary with mismatched durable/runtime ownership.

The existing tests are sequential and do not open a second store/process during the locked create window.

## 6.2 P2-2 required repository correction

A follow-up product correction must:

1. reconcile create intents against runtime state while holding the same exact session lock that fences create/publication, with documented lock ordering relative to SQLite to avoid deadlock;
2. ensure reconciliation cannot compensate an in-flight/current create owned by another process;
3. keep `session_records` frozen to the exact six durable fields and keep intents bounded protocol metadata;
4. add cross-process/concurrent interleaving tests at intent-stage, durable-commit, runtime-publication, post-publication/pre-return, reopen, and equivalent retry boundaries;
5. prove successful publication remains visible, abandoned unpublished creates are compensated, retries do not duplicate, runtime-only state survives, and another successful/current session cannot be deleted.

**Hybrid session recovery: REJECTED.**

# 7. Preservation of previously accepted cutover architecture

The open findings above block maintenance-window requalification but do not overturn the core architecture that PR #153 had accepted.

## 7.1 Selector and authority modes

- one product-global v9 selector remains necessary/minimal;
- ordinary migration initializes legacy only;
- `preparing` remains legacy-authoritative;
- `sqlite-rollback` remains SQLite-authoritative;
- `rollback-preparing` remains SQLite-authoritative;
- pairing’s local authority row remains a domain-local fence;
- no permanent dual-write mode was introduced.

## 7.2 Activation atomicity/freshness

`Phase4CutoverCoordinator.activate()` still acquires all four exact legacy locks—pairing credential, pairing invitations, device builds, sessions—and holds them through locked reread, SQLite application, exact projection equality, and a second final freshness reread. Pairing local activation executes inside the same SQLite transaction as the global selector activation.

Selected-backend failure remains fail-closed with no fallback.

## 7.3 Rollback

`Phase4RollbackCoordinator` still exports **current SQLite state** to legacy under the domain locks. It durably enters `rollback-preparing` first, which remains SQLite-authoritative, so partial legacy exports stay inactive if rollback is interrupted.

Rollback completion remains revision/epoch fenced. The rollback window remains exactly half-open:

`[cutoverAt, rollbackExpiresAt)`

The coordinator rejects restoration at/after expiration. Pairing local rollback remains inside the same SQLite transaction as global selector restoration.

No callable `sqlite-final`/finalization command, rollback-expiry/deletion operation, or legacy deletion operation was introduced.

## 7.4 Process authority

SQLite still owns durable domain state and bounded transaction metadata only. PID/process/termination/runtime claim authority remains filesystem/runtime-owned. Session create intents add no process authority.

**Rollback/global atomicity: ACCEPTED.**

# 8. Diagnostics

**ACCEPTED.**

Normal `storage.phase4Support` remains:

- `readOnly=true`
- `redacted=true`
- `mutationAllowed=false`

Recovery guidance is also non-mutating.

The operator diagnostics collector deliberately does not construct `SwiftSimSqliteDatabase` or the compatibility runtime. It opens `state.sqlite` read-only, enables query-only mode, and projects database/migration/shadow/compatibility/artifact/authority observations through the accepted Phase-4 support schema.

Authority diagnostics continue to report mode, revision, cutover epoch, rollback availability/expiry. Locked final freshness remains deliberately unknown to doctor rather than being forged. The diagnostics path has no migration/import/prepare/activate/rollback, cleanup drain, artifact/legacy deletion, or process termination operation.

# 9. New P2 — source-text test-integrity regression

Correction commit `3218e996c53c497049dcfa3c5c4479952d4c6cf7` modifies `scripts/architecture/baseline-policy.json` to add source-text implementation-test allowlist entries for:

- `test/phase4CleanupInert.test.js`
- `test/phase4CorrectionsHttpBoundary.test.js`
- `test/phase4HybridSessionCreate.test.js`
- `test/phase4MaintenanceEvidence.test.js`
- `test/phase4MaintenanceExecutor.test.js`

This contradicts the active architecture invariant:

- no production regression is accepted merely because a source-text assertion passes;
- no new test may assert exact implementation source snippets/function/import ordering;
- existing source-text implementation tests must be replaced and their count must decrease monotonically;
- tests should exercise compiled production entrypoints.

Adding policy exceptions makes the inventory ratchet pass while increasing the exact test class the invariant requires the project to eliminate. At least `phase4MaintenanceExecutor.test.js` directly reads executor source and regex-asserts absence of finalization symbols despite also having behavior-level unknown-action coverage.

Required correction: remove the five new allowlist exceptions and replace their implementation-text assertions with behavior-level compiled/installed-boundary assertions while preserving the useful fault-injection/sentinel coverage. The source-text implementation-test count must return to the pre-correction baseline or lower.

# 10. Hosted verification

Corrected product head was re-fetched before this audit commit and remained exactly:

`24c8905c80a02dbacbf507e704142ee816e8aca1`

Corrected-product Verify #1139/run `31961047044` remained **SUCCESS** on that exact SHA.

Its hosted `verify` job covered full `npm run check`, clean isolated Homebrew installation, YAML load, shell syntax, and iOS tests. Green CI materially supports packaging/reachability and regression status, but it does not falsify the repository findings above because the missing adversarial/concurrent/valid-maintenance cases are not covered by the current tests.

The audit commit’s own hosted Verify is reported by the audit PR after this single audit commit; it cannot be self-recorded in the document without adding a second audit commit.

# 11. Remaining environment-only gates

Exactly two P3 gates remain. They are not repository fixes and were not performed by this audit:

1. **Real live-root migration/helper staging against the FINAL corrected v9**, after the repository blockers above are fixed and independently audited.
2. **Real installed Homebrew v0.6.1 → FINAL corrected candidate upgrade/provenance/service proof**, after the repository blockers above are fixed and independently audited.

No physical-device, Simulator, or network ceremony is added by this correction audit.

# 12. Exact final report

- exact corrected product SHA: `24c8905c80a02dbacbf507e704142ee816e8aca1`
- exact corrected-product Verify: #1139 / run `31961047044` — SUCCESS
- P0/P1/P2/P3: **0/1/3/2**
- P1-1: **CLOSED / ACCEPTED**
- P1-2: **CLOSED / ACCEPTED**
- P1-3: **OPEN / REJECTED**
- P1-4: **CLOSED / ACCEPTED**
- P2-1: **OPEN / REJECTED**
- P2-2: **OPEN / REJECTED**
- final corrected v9 checksum `1e7bae961d793a3ed8228499bb7b0996a6797964cff5349dcbe9dc43f989f37b`: **ACCEPTED**
- product-wide authority routing: **ACCEPTED**
- maintenance preflight enforcement: **REJECTED**
- installed executor reachability: **ACCEPTED**
- cleanup-inert behavior: **ACCEPTED**
- hybrid session recovery: **REJECTED**
- rollback/global atomicity: **ACCEPTED**
- newly discovered finding: **P2 source-text test-integrity regression**
- remaining environment-only gates: exactly the two P3 gates in section 11

# NOT READY, with exact repository corrections required.
