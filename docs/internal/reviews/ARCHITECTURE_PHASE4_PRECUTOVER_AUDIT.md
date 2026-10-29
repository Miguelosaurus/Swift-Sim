# Architecture Phase 4 Pre-Cutover Audit

**Audit workstream:** `P4-PRECUTOVER-AUDIT`  
**Auditor role:** independent final Phase-4 pre-cutover auditor; no product fixes and no authority switch  
**Assigned branch:** `agent/arch-ws-P4-PRECUTOVER-AUDIT-independent-review`  
**Assignment head:** `119f289a58f0b74e7fdc2b1117fc9d8b8ba399c5`  
**Exact frozen product audited:** `bde5c1993112678430423ba32e7fb02b9bb5c9a1`  
**Correction PR:** #149  
**Independent correction audit:** PR #150 at `33919377db8809739baa3860c6145d0e8f831407`  
**Exact product Verify:** #1106 / run `31820807687` — PASS  
**Correction-audit Verify:** #1107 / run `31827716722` — PASS

## Executive verdict

The exact frozen repository `bde5c1993112678430423ba32e7fb02b9bb5c9a1`, its exact-head hosted verification, the independent correction audit, and the final persistent-Mac evidence packet are sufficient to **enter a separately authorized, serialized Phase-4 cutover workstream**.

They do **not** authorize an authority switch now.

Repository inspection found no remaining P0, P1, or P2 defect that must be corrected before that workstream is created. The prior integration-audit P1 and P2 are closed. The repository still preserves the intended pre-cutover architecture: legacy pairing/device/session authority remains active, SQLite is migration/shadow evidence rather than an accidental read or write authority, the session database boundary remains exactly six durable fields, runtime/process authority remains outside SQLite, historical cleanup remains explicit/nonautomatic, and diagnostics remain read-only/redacted/mutation-disabled.

The final persistent-Mac packet is also sufficient for the **pre-cutover gate** because it proves real-state readability and nonmutation, real-data migration correctness on a byte-identical disposable copy, backup preservation, reopen/idempotency, projection equality, failure/recovery behavior, operator diagnostics, and isolated candidate-helper lifecycle without disturbing the installed helper or authoritative state.

Two environment operations remain deliberately unexecuted and are mandatory before any authority selector changes:

1. live-root v7 -> v8 migration with candidate helper staging/restart;
2. real installed Homebrew v0.6.1 -> candidate upgrade.

Both are correctly classified as **mandatory pre-authority-switch maintenance-window preflights**, not as prerequisites to creating the cutover workstream. Performing them early would mutate the real installed/runtime environment outside the very serialized window whose purpose is to quiesce writers, capture exact rollback material, bind evidence to the current authoritative bytes, and abort safely before the switch if any result differs.

| Severity | Count | Disposition |
| --- | ---: | --- |
| P0 | 0 | No catastrophic safety, authority, privacy, or data-loss defect found. |
| P1 | 0 | No release-blocking repository defect found; prior diagnostics finding is closed. |
| P2 | 0 | No bounded repository correction remains; prior `pair` gate finding is closed. |
| P3 | 2 | Two mandatory maintenance-window pre-authority-switch environment gates remain. |

**Overall result:** **READY FOR A SEPARATE CUTOVER DECISION/WORKSTREAM.** Phase 4 is not complete and this audit does not authorize or perform the switch.

---

# 1. Audit provenance, basis, and evidence classification

## Assignment provenance

The assignment shape is exact. Comparing `bde5c1993112678430423ba32e7fb02b9bb5c9a1` with assignment head `119f289a58f0b74e7fdc2b1117fc9d8b8ba399c5` shows the assignment head is exactly one ordinary commit ahead of the frozen product, with the sole change being the docs-only workstream contract `docs/internal/plans/workstreams/P4-PRECUTOVER-AUDIT.md`.

The product audited throughout this report is therefore exactly `bde5c1993112678430423ba32e7fb02b9bb5c9a1`, never an older PR #147 integration SHA or a moving branch tip.

The audit runtime could not resolve `github.com` from the local sandbox, so a literal local `git worktree` could not be materialized and no local command is represented as having run. Isolation was preserved by immutable exact-SHA GitHub reads and by restricting the sole write to this assigned audit branch. Hosted verification is treated separately from local/persistent-Mac evidence.

## Control plane read

The audit reconciled the frozen product and evidence against the active architecture control plane, including:

- `AGENTS.md`;
- the original `ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md`, especially Phase 4;
- `ARCHITECTURE_CONSOLIDATION_INVARIANTS.md`;
- execution guide and checkpoint protocol;
- batched- and parallel-execution amendments;
- parallel roadmap, workstream registry, and agent protocol;
- ADRs, especially `ADR-0003-sqlite-domain-state-filesystem-runtime.md`;
- Wave 1 independent audit PR #132;
- Wave 1 orchestrator review / Wave 2 registry PR #138;
- Wave 2 independent audit PR #144;
- PR #147 serialized Phase-4 integration handoff;
- PR #148 full independent integration audit at `27902f55910ba06bb65bb7074c62553379f8f1d5`;
- PR #149 correction history and final persistent-Mac evidence comment `5298760666`;
- PR #150 independent correction audit at `33919377db8809739baa3860c6145d0e8f831407`;
- `docs/internal/plans/workstreams/P4-PRECUTOVER-AUDIT.md`.

## Hosted evidence independently confirmed

GitHub records Verify run `31820807687`, run number #1106, as successful on exact product `bde5c1993112678430423ba32e7fb02b9bb5c9a1`. GitHub likewise records Verify run `31827716722`, run number #1107, as successful on correction-audit head `33919377db8809739baa3860c6145d0e8f831407`.

## Evidence classes — do not conflate them

The final packet contains four distinct useful evidence classes:

1. **Real persistent-root proof.** Candidate doctor ran against the real authoritative root while the real helper and engine remained untouched. Main database and legacy authority bytes remained unchanged; state/root modes remained private; WAL stayed empty; SHM bytes stayed unchanged apart from normal reader-coordination mtime movement.
2. **Disposable byte-identical copy of real data.** A copy of the real v7 state proved actual v7 -> v8 migration, migration-history preservation, six-column session schema, pairing/device/session projection equality, byte-identical backups, reopen, rerun idempotency, and old-opener schema-ahead refusal. This is real-data compatibility proof, but it is not a claim that the live root was migrated.
3. **Repository/failure-fixture proof.** Disposable roots exercised corrupt, incompatible/newer, structurally incomplete, permission-denied, unavailable, malformed legacy, valid-v7, busy/locked, and orphan/manual-review states through the actual operator support surface. Focused Node 24 evidence passed 31/31.
4. **Isolated helper proof.** The candidate helper started, reached `/health`, performed only disposable v8/session work under a fully isolated HOME/port, and stopped cleanly. This proves the candidate lifecycle in isolation; it is not an installed-service upgrade proof.

What remains absent is **real installed-service proof of the candidate after upgrading the actual Homebrew v0.6.1 installation**, and **live-root migration/staging proof**. Those are deliberately retained as maintenance-window preflights below rather than silently upgraded into a stronger evidence class.

---

# 2. Repository readiness — PASS

## Shared SQLite v1-v8 history remains coherent

Exact frozen file: `mac-helper/src/persistence/phase4SqliteSchema.js`.

`PHASE4_SQLITE_MIGRATIONS` is the complete shared Phase-4 history and appends only migration v8, `durable_session_domain_state`, to the accepted device-build prefix. PR #148 independently verified the complete migration names as:

1. `legacy_import_checkpoints`
2. `pairing_state`
3. `pairing_shadow_mismatch_evidence`
4. `pairing_authority_state`
5. `pairing_cutover_preparation`
6. `device_build_domain_state`
7. `device_build_shadow_mismatch_evidence`
8. `durable_session_domain_state`

PR #148 also verified that the v1-v7 provider files were byte-identical to their accepted feeder versions. PR #149 changes only eight bounded diagnostics/test paths and does not touch any schema/history provider. The final real-data migration packet independently confirmed unchanged v1-v7 checksums and v8 checksum `ccba4f9a...`.

Exact frozen database owner: `mac-helper/src/persistence/swiftSimSqliteDatabase.js`.

The application schema authority is the `schema_migrations` history. `SwiftSimSqliteDatabase.migrate()` validates contiguous versions, exact migration names, and exact checksums; a newer recorded version is refused. `health()` derives `schemaVersion` and migration count from `schema_migrations`, not from SQLite `PRAGMA user_version` or internal `PRAGMA schema_version`. This matches both the architecture and final evidence packet.

**Affected gate/invariant:** durable-state migration history, fail-closed incompatible schema behavior, migration checksum fencing.  
**Result:** PASS.

## Every production shared opener still understands v1-v8

Exact frozen files:

- `mac-helper/src/persistence/deviceBuildShadowRuntime.js`;
- `mac-helper/src/persistence/sessionDurableShadowRuntime.js`.

Both import and pass the complete `PHASE4_SQLITE_MIGRATIONS` list to `SwiftSimSqliteDatabase`. PR #148's whole-tree audit found no other current production shared-state opener using a shorter history. PR #149 does not modify those files.

**Affected gate/invariant:** one coherent shared database history; no same-build schema-ahead self-conflict.  
**Result:** PASS.

## Durable sessions remain exactly six columns

Exact frozen file: `mac-helper/src/persistence/sessionDurableSqliteSchema.js`.

`session_records` contains exactly:

- `id`
- `token`
- `project`
- `scheme`
- `simulator_udid`
- `created_at`

There is no whole-record JSON, revision, `updatedAt`, stream/build/log/orientation/URL/port/PID/process/runtime claim. The final real-data v8 migration independently re-inspected these exact columns.

Exact frozen staged observer: `mac-helper/src/persistence/sessionDurableShadowRuntime.js`. Its own contract states SQLite is migration evidence and authorizes no business decision; the result reports `authority: "legacy-json"`. Snapshot/import/comparison remains under the exact sessions lock and reuses `createSessionLegacyProcessIdentity`, which preserves the Darwin `/bin/ps -p <pid> -o lstart=` start-token semantics.

**Affected gate/invariant:** ADR-0003 durable/runtime split; PID reuse safety; no process authority in SQLite.  
**Result:** PASS.

## Legacy authority is still active; no permanent dual write or accidental reader cutover

Exact frozen file: `mac-helper/src/persistence/deviceBuildCutoverCompatibility.js`.

`DEVICE_BUILD_COMPATIBILITY_AUTHORITY` is exactly `legacy`. `DeviceBuildCompatibilityReader.read()` returns the legacy reader; SQLite is optional inspection evidence and never a fallback. A non-legacy authority value is explicitly rejected.

PR #148 independently verified that pairing remains backed by the legacy pairing store and that the runtime session controller remains filesystem/legacy-session based. PR #149 does not touch pairing, device authority routing, session runtime routing, or any authority selector.

ADR-0003 explicitly rejects permanent JSON/SQLite dual writes. The parallel-execution amendment reserves final authority selectors/cutover for serialized orchestrator ownership. The frozen tree is therefore in the intended pre-cutover state rather than accidentally halfway through the switch.

**Affected gate/invariant:** exactly one writable truth; no implicit reader/writer cutover; rollback preserved.  
**Result:** PASS.

## SQLite cannot authorize process termination

The six-column session table contains no process identity. `sessionLegacyProcessIdentity.js` reuses the exact Darwin legacy process identity outside SQLite. PR #148 independently inspected the session runtime controller and found process/runtime ownership remains in the filesystem/runtime layer. PR #149 changes none of those surfaces.

**Affected gate/invariant:** ADR-0003 and durable-state invariant that database state never authorizes process termination without independent identity proof.  
**Result:** PASS.

## Artifact cleanup remains explicit and nonautomatic

PR #148 verified the accepted freshness-fenced maintenance service remains behind the contained `NodeArtifactStore` boundary and found no startup/background historical cleanup, orphan cleanup, or manual-review cleanup. PR #149 only projects the existing read-only artifact audit into diagnostics; the final real-root doctor packet explicitly reports cleanup disabled and one orphan/manual-review item without execution.

**Affected gate/invariant:** artifact containment; no destructive cleanup smuggled into migration or diagnostics.  
**Result:** PASS.

## Diagnostics remain operator-reachable and nonmutating

Exact frozen file: `mac-helper/src/commands/phase4OperatorDiagnostics.js`.

The operator probe:

- opens `DatabaseSync(databasePath, { readOnly: true })`;
- executes `PRAGMA query_only = ON`;
- does not construct `SwiftSimSqliteDatabase`, import coordinators, authority routers, cleanup executors, or process supervisors;
- derives application migration version from `schema_migrations`;
- checks private root/database permissions before opening;
- reduces legacy authority to readability/validity observations rather than exposing contents;
- delegates to the accepted `collectPhase4SupportDiagnostics` model;
- restores the prior umask in `finally`.

PR #150 independently closed the prior operator-reachability finding. The final real-root doctor run then proved the normal JSON/human paths return read-only/redacted/mutation-disabled support evidence without changing authoritative bytes.

**Affected gate/invariant:** Phase-4 doctor/support/corruption recovery; diagnostics privacy; no support-path mutation.  
**Result:** PASS.

## No Phase-5 production leakage

The exact correction diff contains only its eight documented Phase-4 diagnostics/test paths. No preload-removal, analyzer, companion, package-policy, authority, schema, cleanup, or later-phase production path changed.

**Affected gate/invariant:** numbered phase boundary and parallel-execution control.  
**Result:** PASS.

---

# 3. Environment evidence quality — sufficient for the pre-cutover gate

## Real-state compatibility and authoritative-byte preservation

The final PR #149 evidence packet binds the following to exact product `bde5c199...` on Node 24:

- real state root mode 0700;
- real `state.sqlite` mode 0600 and hash `f7661e3e...` unchanged before/after doctor;
- real `device-builds.json` hash `380329dd...` unchanged;
- real `sessions.json` hash `838716e09...` unchanged;
- real `pairing.json` hash `97bc0a70...` unchanged;
- WAL empty/unchanged;
- SHM bytes unchanged, with only expected SQLite reader-coordination mtime change;
- real helper PID 40162 and engine PID 14939 untouched.

Candidate doctor correctly read the actual application database as migration v7 and reported v7/latest-v8 as attention/checkpointed/transitioning rather than corrupt. Both human and JSON doctor exited zero without stderr and were checked for secrets, raw contents, and absolute state paths.

This is strong real-root compatibility/nonmutation evidence. It is not a live migration claim, and this audit does not treat it as one.

## Real-data v7 -> v8 migration, backups, reopen, and idempotency

A byte-identical disposable copy of the real state proved:

- v1-v7 migration checksum identity remained frozen;
- v8 `durable_session_domain_state` applied with checksum `ccba4f9a...`;
- the session table remained exactly six columns;
- device domain: 212 records, already-current, projection `2684b7e7...`;
- sessions: 8 records, applied, projection `9543dac5...`;
- pairing: 1 record, applied, projection `905bd85f...`;
- legacy backups were byte-identical;
- close/reopen remained healthy;
- reruns were already-current/idempotent;
- a v7-only opener refused the v8 schema-ahead database;
- legacy rollback/readability material remained intact.

This proves migration correctness against actual user data without crossing the live authority boundary.

## Failure and recovery matrix

Disposable roots exercised the actual operator surface for:

- corrupt database -> blocked / restore verified backup;
- newer/incompatible database -> blocked / use compatible build;
- current-schema missing required table -> blocked;
- state-root permission failure;
- `state.sqlite` permission failure;
- unavailable database;
- malformed legacy authority -> compatibility blocked;
- valid v7 -> not falsely blocked;
- busy/locked -> attention without authority mutation;
- artifact orphan/manual-review evidence.

Outputs remained path-safe/redacted and preserved authority. Only expected private SQLite reader coordination occurred.

## Candidate helper lifecycle

The candidate helper was started under a fully disposable HOME and independent port, reached `/health`, performed only disposable v8/session work, and stopped cleanly. The real helper PID and engine PID remained untouched.

This is sufficient isolated candidate-helper evidence. It does not prove the installed Homebrew service after an in-place upgrade; that remains Finding P3-02.

**Environment verdict:** the packet is sufficient to pass the final pre-cutover evidence gate and create the serialized workstream. It is intentionally insufficient to switch authority without the maintenance-window preflights below.

---

# Findings

## P3-01 — Live-root v7 -> v8 migration and real helper staging/restart remain mandatory maintenance-window preflight

**Severity:** P3 as a repository finding because no repository defect is identified; **hard stop condition before authority switch**.

### Exact repository/evidence reference

- PR #149 final evidence comment `5298760666`: live-root v7 -> v8 with the real helper staged/restarted was deliberately not executed.
- `mac-helper/src/persistence/swiftSimSqliteDatabase.js`: migration is transactional/checksummed and refuses newer/incompatible history.
- `mac-helper/src/persistence/phase4SqliteSchema.js`: exact current shared history is v1-v8.
- `mac-helper/src/persistence/deviceBuildShadowRuntime.js` and `sessionDurableShadowRuntime.js`: real production staged openers use the full v1-v8 history while legacy authority remains active.
- Final real-data packet: a v7-only opener correctly refuses the migrated v8 database.

### Affected invariant/gate

- Phase-4 migration must be idempotent/interruption-safe.
- Existing state must remain rollback-readable through the defined window.
- Exactly one writable source of truth is required after transition.
- Authority/cutover changes require rollback/evidence and serialized ownership.

### Why it matters

Only the live root can prove that the actual current bytes, current locks, installed helper lifecycle, filesystem state, and current legacy revisions all survive the real migration boundary. But performing this mutation before a cutover workstream exists is less safe, not more conservative: the proof could immediately become stale as the legacy writer continues, and it would advance the production database outside the maintenance window that is supposed to own quiescence, rollback material, and abort behavior.

The correct architecture is to perform the live migration after the cutover worker has acquired the maintenance window and quiesced writers, but **before** changing any authority selector. If it fails, the operation aborts while legacy authority is still the only business authority.

An additional rollback consequence follows directly from the verified schema-ahead refusal: before mutating the live v7 database, the worker must create and verify a **consistent pre-migration v7 database rollback snapshot** after writer quiescence. Merely preserving legacy JSON is not enough for a rollback build/path that expects v7 SQLite. A raw copy of an actively changing WAL database is not acceptable; the snapshot must be captured with the database quiesced/closed or with a proven SQLite-consistent backup/checkpoint mechanism.

### Exact orchestrator action

Classify this as **mandatory pre-authority-switch maintenance-window preflight**. The serialized cutover worker must:

1. quiesce the real old writer/helper using exact process identity, not PID existence;
2. acquire/verify the relevant state locks and reject contention;
3. record current legacy hashes/revisions and current v7 application migration history;
4. create and verify a consistent pre-migration v7 DB rollback snapshot plus legacy backups;
5. run the live v7 -> v8 migration/staging under the exact approved candidate;
6. reopen and rerun to prove healthy/already-current behavior;
7. stage/restart the candidate helper and verify exact binary/process identity, `/health`, and operator doctor;
8. recompute current locked imports/checkpoints/projection equality and require zero unresolved shadow mismatch;
9. abort without switching authority on any busy/corrupt/incompatible/permission/migration/health/mismatch failure.

Do not do this before the cutover workstream exists; do not switch authority merely because it succeeds.

## P3-02 — Real installed Homebrew v0.6.1 -> candidate upgrade remains mandatory maintenance-window preflight

**Severity:** P3 as a repository finding because the repository/package gates are green; **hard stop condition before authority switch**.

### Exact repository/evidence reference

- Original master plan Phase 4 gate: “clean Homebrew upgrade from the previous tagged release succeeds.”
- Architecture invariants, packaging/release: Homebrew remains the supported installation path and an upgrade from the previous tagged release is a release gate.
- PR #142 `P4-UPGRADE-EVIDENCE-FIX`: pins published v0.6.1 provenance and proves repository-level historical pairing/device imports, but explicitly does not claim real persistent Homebrew/service upgrade evidence.
- PR #149 final evidence comment `5298760666`: real installed Homebrew v0.6.1 -> candidate upgrade was deliberately not executed.
- Final isolated-helper evidence proves a candidate process in a disposable HOME/port, not an installed candidate launch/service upgrade.

### Affected invariant/gate

- Original Phase-4 Homebrew previous-release upgrade gate.
- Package/runtime path consistency and supported Node/runtime policy.
- Installed helper/service identity before authority transition.

### Why it matters

An authority switch must not depend on an unproven installed binary/service path. The real upgrade must establish that the supported Homebrew path installs the intended candidate, starts/restarts the intended helper, and does not leave an old or duplicate writer/service active.

It does not need to occur before a cutover workstream can be created. The workstream is exactly where the installed upgrade can be serialized with pre-upgrade backups, service quiescence, exact process identity, and the live schema preflight. Running it earlier would alter the real installation while legacy activity can continue and would make the evidence stale relative to the later cutover moment.

### Exact orchestrator action

Classify this as **mandatory pre-authority-switch maintenance-window preflight**. Inside the authorized window, before any authority selector changes:

1. verify the currently installed v0.6.1 provenance/service identity;
2. preserve the rollback package/binary/service configuration;
3. perform the supported Homebrew upgrade to the exact candidate;
4. prove installed CLI/helper version/path and Node/runtime agreement;
5. prove there is no duplicate/stale old helper writer;
6. start/restart the installed candidate service under controlled conditions;
7. verify `/health`, doctor JSON/human output, permissions, database health, and exact process identity;
8. abort and restore the prior installed runtime while legacy authority is still active if the upgrade/service proof fails.

Do not infer this pass from repository archive fixtures or the isolated-helper run.

---

# 4. Critical maintenance-window classification

## Live-root v7 -> v8/helper staging

**Classification: mandatory pre-authority-switch maintenance-window preflight.**

It is a real mutating operation whose value depends on exact current writer quiescence, source hashes/revisions, backup state, and service identity. Those facts are freshest and safest inside the serialized window. Failure must leave legacy authority untouched.

## Real installed Homebrew v0.6.1 -> candidate upgrade

**Classification: mandatory pre-authority-switch maintenance-window preflight.**

It is an original Phase-4 gate and cannot be waived, but it is logically a precondition to the switch, not a precondition to creating the worker that will safely execute and evaluate it. The supported installation path should be proven in the same controlled window before authority changes.

Neither operation is classified “not required.” Neither is required before creating the cutover workstream.

---

# 5. Exact cutover stop conditions

The future serialized cutover worker must treat every item below as a stop condition immediately before changing authority. Failure of any item means **do not switch**.

1. **Exact frozen ancestry.** The cutover implementation must be based on exact frozen product `bde5c1993112678430423ba32e7fb02b9bb5c9a1`. Any product drift must be independently reviewed and requalified; do not silently substitute another PR tip.
2. **Exact-head hosted verification.** The exact cutover candidate/head must have current hosted Verify green. No unresolved P0/P1/P2 may remain.
3. **Explicit maintenance authorization and single executor.** A serialized maintenance window must be explicitly authorized; no second cutover or cleanup worker may operate concurrently.
4. **Installed release provenance.** The real Homebrew v0.6.1 installation must be identified before upgrade, the exact candidate installation must be identified after upgrade, and rollback package/service material must be retained.
5. **Exact helper/service identity.** Before migration/switch, identify the real helper/service binary and process using exact process identity. PID alone is insufficient. Refuse duplicate, stale, or unverifiable helper/service writers.
6. **Writer quiescence and locks.** Stop or otherwise fence legacy writers, acquire the exact pairing/device/session state locks appropriate to their existing protocols, and abort on busy/lock contention. No concurrent old writer may survive into the final import/switch boundary.
7. **Private permissions.** State root must remain owner-only (0700) and database/legacy/backup material owner-only (0600 or the repository-required equivalent). Permission weakening aborts the cutover.
8. **Current source fingerprints.** Capture current pairing/device/session authoritative hashes/revisions/source versions immediately after quiescence. The old packet's record counts/hashes are historical evidence, not a substitute for recomputing the current live values.
9. **Application migration identity.** Read the application version from `schema_migrations`. Starting history must be the expected coherent v1-v7 history with exact names/checksums; newer, noncontiguous, renamed, or checksum-drifted history aborts.
10. **Database integrity.** Require integrity OK, WAL mode as expected, foreign keys enabled, zero FK violations, and no unexplained/missing required table for the current application migration. Corrupt, unavailable, incompatible, or structurally invalid state aborts.
11. **Consistent pre-migration v7 rollback snapshot.** After quiescing writers and before v8 migration, create and verify a restorable, SQLite-consistent v7 database snapshot. Because the verified v7-only opener refuses v8, this is mandatory rollback material. Do not rely on an unsafe raw copy of a live WAL database.
12. **Legacy backups present and verified.** Pairing/device/session pre-import backups must exist, match the locked authoritative bytes, remain private, and be retained through the rollback window.
13. **Live v7 -> v8 migration passes.** The exact candidate must migrate the live database, preserve v1-v7 history, append exact v8, reopen healthy, and rerun as already-current/idempotent. Any partial/uncertain result aborts.
14. **Installed candidate helper lifecycle passes.** After the real Homebrew upgrade/staging, the exact candidate helper must start/restart cleanly, reach `/health`, and produce healthy/expected doctor output without unauthorized authority or cleanup mutation.
15. **Final locked import/checkpoint equality.** Under current locks/quiescence, run the final pairing/device/session durable import/checkpoint path. Every durable projection must equal the current authoritative legacy projection. Recompute current record counts/hashes; do not hard-code 212/8/1 if legitimate state changed since evidence collection.
16. **Zero unresolved shadow mismatches.** All durable-domain shadow mismatch evidence must be zero for the final current snapshot. An unexplained mismatch, even if a prior packet was clean, aborts.
17. **Compatibility and rollback readability.** Legacy readers must still read the preserved authority material. The rollback build/path and pre-migration DB snapshot restore procedure must remain available. No rollback-window expiry or legacy deletion may have occurred.
18. **No artifact cleanup.** Historical cleanup, orphan reclamation, manual-review deletion, legacy deletion, and rollback-material cleanup remain disabled/out of scope for the window.
19. **No process authority from SQLite.** No selector or transition code may infer process ownership/termination permission from durable SQLite rows. Existing independent process identity remains mandatory.
20. **Final freshness recheck immediately before switch.** Recheck source hashes/revisions, DB health, schema history, helper identity, lock ownership, and zero-mismatch state after all staging and immediately before the selector changes. Any drift returns to import/check or aborts.
21. **Atomic single-authority transition.** The authority transition must be one explicit serialized change from legacy authority to SQLite authority; it must not create a period in which two independent writers are both accepted as authoritative. If the implementation cannot fence the old writer before enabling the new writer, abort.
22. **Post-switch transactional health.** Once SQLite becomes the selected domain authority, the cutover worker must prove the selected domain write/read path is transactional and reopens correctly before ending the maintenance window. Failure triggers rollback rather than dual writing.
23. **Rollback action is executable, not aspirational.** Before switch, have exact steps/material to restore prior installed runtime, restore the consistent v7 DB snapshot where required, re-enable legacy authority, and preserve failed v8 material for diagnosis. Do not discover the rollback procedure after the switch.
24. **Abort classes remain fail-closed.** Busy/locked, corrupt, incompatible/newer, permission-denied, missing/invalid schema, import mismatch, helper identity uncertainty, package upgrade failure, or rollback-material failure all stop the switch.
25. **No unrelated phase work.** No Phase-5 preload removal, analyzer routing, companion changes, package redesign, cleanup expansion, or other unrelated production change belongs in the authority window.

---

# 6. Two-writable-truths analysis

The current frozen product does **not** have two independent writable truths. The business authority remains legacy while SQLite is populated/observed as migration and shadow evidence.

The staged architecture supports the required safe sequence:

`legacy authority -> quiesce/fence legacy writers -> final locked import/checkpoint/projection equality -> explicit authority transition -> SQLite authority`

The critical property is that the final import/check occurs while legacy is still authoritative but no unfenced legacy mutation can race it. Only after equality and every stop condition pass may the selector change. Once the selector changes, the old legacy writer must remain stopped/fenced; preserved legacy files become rollback material, not a second independent writer.

No permanent dual write is needed or permitted. A temporary shadow read is not a second writable truth. A migration/import transaction into non-authoritative SQLite is also not a second product authority so long as product decisions still come only from legacy and no SQLite writer is independently accepted as authoritative.

The frozen repository provides the migration, backup, shadow, compatibility, durable-session boundary, and recovery primitives needed for this sequence. The actual selector switch is intentionally a red-zone integration responsibility for the future serialized cutover workstream. Its absence from `bde5c199...` is therefore not a blocker; an implementation that attempted to enable SQLite while leaving an unfenced legacy writer active would be a blocker.

---

# 7. Rollback requirements

After cutover, rollback remains possible only if the following material is retained until a separately proven/authorized rollback-window expiry decision:

- the preserved legacy pairing/device/session authority files and verified pre-import backups;
- the consistent pre-migration v7 `state.sqlite` rollback snapshot required for any v7-only rollback opener;
- the previous installed Homebrew package/binary/service configuration or another exact proven rollback installation path;
- the legacy readers and compatibility code needed to interpret preserved state;
- source fingerprints/projection hashes/checkpoint evidence required to validate restoration;
- exact process/service identity evidence needed to stop the candidate safely and restart the rollback runtime;
- failed/candidate v8 state retained for diagnosis rather than destroyed as part of rollback.

This audit does **not** authorize:

- deleting legacy state;
- deleting the v7 rollback snapshot;
- expiring the rollback window;
- removing rollback readers;
- automatically cleaning rollback material;
- historical artifact cleanup as part of cutover.

Those are separate later decisions and require their own evidence.

---

# 8. Physical device, Simulator, and network evidence

**No additional physical-device, Simulator, or network proof is required before the Phase-4 authority cutover.**

Reason: the authority claim being decided here is local durable-state migration/source-of-truth behavior, installed helper lifecycle, rollback, permissions, SQLite health, and operator recovery. It does not change or claim physical-device install verification, hot-reload permissiveness, Simulator process ownership, signing, public/private network routing, or companion behavior.

The master plan requires physical-device gates for claims that only hardware can prove. No such hardware-only claim is newly introduced by this persistence-authority switch. Requiring an unrelated phone/Simulator/network ceremony would not improve proof of v7 -> v8 migration, one-writer authority, rollback, or database integrity.

If the future cutover workstream expands scope into a hardware/network behavior change, that new claim must bring its own evidence; that would be scope expansion, not a prerequisite created by the current Phase-4 persistence design.

---

# 9. Original Phase-4 completion gate reconciliation

This audit reconciles against the original master plan rather than treating the parallel registry as a substitute.

## Already satisfied before the cutover workstream

- Typed/bounded repository and migration primitives exist for the accepted Phase-4 durable domains.
- Shared SQLite migration history is coherent and checksum-fenced.
- One-time import primitives provide validation, backup, checkpointing, and idempotency.
- Shadow comparison exists and the final evidence exercises projection equality.
- Durable-session scope is explicitly separated from runtime/process state.
- Runtime journals/process identity remain outside SQLite under ADR-0003.
- Operator doctor/support covers schema, migration/checkpoint, permissions, shadow/compatibility, corruption/busy/incompatible/unavailable recovery, and orphan/manual-review evidence.
- Support output is redacted/path-safe/read-only/mutation-disabled.
- Repository and real-data disposable evidence proves interruption/retry/reopen/idempotency/backup behavior sufficiently to enter cutover.
- Database corruption/recovery behavior fails closed with actionable guidance.
- No missing fourth durable domain was found by PR #148's original-plan inventory; derived/live/runtime/ephemeral stores identified there remain intentionally outside SQLite.

## Intentionally deferred to the authorized maintenance-window cutover

- real live-root v7 -> v8 migration;
- real installed Homebrew v0.6.1 -> candidate upgrade;
- installed candidate helper staging/restart against the real root;
- final current locked import/checkpoint/projection equality;
- zero-mismatch recheck against the immediately current authoritative bytes;
- explicit source-of-truth/write-authority transition;
- proof that post-switch selected domain mutations are transactional under the real installed candidate;
- establishing the rollback window with preserved live rollback material.

These are not missing repository corrections. They are the work the separate cutover is supposed to serialize and prove.

## Required only after the authority switch / later explicit decision

- rollback-window expiry;
- legacy-state deletion/archive;
- cleanup of rollback material;
- any expansion of historical artifact cleanup.

They must not be bundled into the initial switch.

## Actually later-phase work

- Phase-5 preload/monkey-patch removal;
- Phase-6 live architecture split;
- Phase-7 analyzer replacement and newly permissive hardware proof;
- Phase-8 companion architecture;
- Phase-9 consolidation cleanup;
- Phase-10 external-beta/long-lived reliability evidence beyond what is specifically required to make the Phase-4 authority change safe.

**Original-gate conclusion:** the only original Phase-4 requirements not yet completed are correctly located at or immediately after the serialized authority transition, with the real Homebrew upgrade explicitly mandatory before the switch. No hidden original Phase-4 repository requirement remains that should block creating the cutover workstream.

---

# Required final answers

## 1. Repository ready for cutover decision: YES / NO

**YES.** Exact frozen product `bde5c1993112678430423ba32e7fb02b9bb5c9a1` is repository-ready for a separate serialized cutover decision/workstream.

## 2. Persistent-Mac evidence sufficient for pre-cutover gate: YES / NO

**YES.** The evidence is sufficient to enter the cutover workstream because it proves real-root compatibility/nonmutation, real-data disposable migration/backups/reopen/idempotency/projection equality, failure/recovery diagnostics, and isolated candidate-helper lifecycle while preserving evidence-class boundaries. It does not itself prove or authorize the live switch.

## 3. Repository corrections required before cutover workstream: YES / NO

**NO.** No P0/P1/P2 repository correction remains.

## 4. Live-root v7->v8/helper staging

**mandatory pre-authority-switch maintenance-window preflight**

## 5. Real installed Homebrew upgrade

**mandatory pre-authority-switch maintenance-window preflight**

## 6. Physical-device/Simulator/network proof required before cutover: YES / NO, with reason

**NO.** Phase 4 is changing local durable-state authority and proving migration/rollback/helper persistence semantics; it is not changing or making new hardware-, Simulator-, signing-, live-reload-, or network-specific claims. Hardware evidence remains required only for claims that actually depend on hardware.

## 7. Exact remaining blockers

There are **no repository blockers to creating the cutover workstream**. Before authority may switch, the blockers are:

1. the real installed Homebrew v0.6.1 -> exact candidate upgrade/service proof must pass inside the maintenance window;
2. the live real-root v7 -> v8 migration/helper staging/restart must pass inside the maintenance window;
3. a verified consistent pre-migration v7 DB rollback snapshot and verified legacy backups must exist;
4. the final current locked pairing/device/session import/checkpoint/projection comparison must have zero unresolved mismatch;
5. all stop conditions in Section 5 must remain satisfied immediately before the selector change.

## 8. Exact cutover stop conditions

The exact stop conditions are the 25 conditions in Section 5: frozen ancestry; current exact-head Verify; explicit serialized maintenance authority; installed release provenance; exact helper/process identity; writer quiescence/locks; private permissions; current source fingerprints; coherent `schema_migrations`; DB integrity/WAL/FK health; consistent v7 DB rollback snapshot; verified legacy backups; successful live v8 migration/reopen/idempotency; installed candidate helper health; final locked current-domain equality; zero shadow mismatches; rollback readability; no cleanup; no SQLite process authority; final freshness recheck; atomic one-authority transition; post-switch transactional health; executable rollback; fail-closed abort classes; and no unrelated phase work.

## 9. Minimal ordered next sequence

1. Accept this audit only as authorization to **create** a separate serialized Phase-4 cutover workstream; keep product `bde5c199...` frozen as its audited base.
2. Implement/review only the bounded authority-transition orchestration and rollback procedure needed by that workstream; obtain exact-head hosted Verify and independent review of any new authority code before maintenance execution.
3. Open the explicitly approved maintenance window; capture environment/service/version evidence, quiesce old writers, acquire exact locks, and create/verify legacy backups plus a consistent pre-migration v7 database rollback snapshot.
4. Perform the real Homebrew v0.6.1 -> exact candidate upgrade and controlled candidate helper staging; abort on package/service/identity failure while legacy remains authoritative.
5. Perform/complete the live-root v7 -> v8 migration, reopen/idempotency/doctor checks, and final locked current pairing/device/session import/checkpoint/projection comparison; require zero mismatch and all stop conditions green.
6. Recheck hashes/revisions, DB health, service identity, rollback readability, and one-writer fencing immediately before the selector change.
7. Only under a **separate explicit authority-switch authorization**, execute the single serialized authority transition; prove post-switch transactional/read health while the old writer remains fenced.
8. Retain all legacy/rollback material and the rollback window. Do not delete legacy state, expire rollback, or execute historical cleanup as part of the switch.

## 10. Is an authority switch authorized by THIS audit: NO

**NO.** This audit concludes only **READY FOR A SEPARATE CUTOVER DECISION/WORKSTREAM**. The authority switch itself still requires the separately authorized serialized cutover, its exact-head review/Verify, all maintenance-window preflights, all stop conditions, and an explicit switch decision after those checks pass.
