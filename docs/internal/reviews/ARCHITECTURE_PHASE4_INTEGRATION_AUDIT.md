# Architecture Phase 4 Integration Audit

**Audit workstream:** `P4-INTEGRATION-AUDIT`  
**Independent audit branch:** `agent/arch-ws-P4-INTEGRATION-AUDIT-independent-review`  
**Assignment head:** `f4a19240617333d5152bf8a70fee4a28e6f25b04`  
**Exact product head audited:** `eaa44b0f74e3bbea2dadbfe0b03db44cdd8fba66`  
**Integrated PR:** #147  
**Pinned hosted Verify evidence:** #1084 / Actions run `31799660233` — PASS on exact `eaa44b0f74e3bbea2dadbfe0b03db44cdd8fba66`

## Executive verdict

The exact integrated product head `eaa44b0f74e3bbea2dadbfe0b03db44cdd8fba66` preserves the accepted Phase-4 feeder ancestry, the unified v1-v8 SQLite history, legacy production authority, the frozen six-field durable-session boundary, device-build compatibility semantics, artifact freshness fencing, and ADR-0003's prohibition on deriving runtime/process termination authority from SQLite.

I found **no P0 product-safety defect** and no evidence that the older `82e0f998...` integration candidate was substituted for the requested exact head.

I found three readiness findings:

- **P1:** the broader Phase-4 database/migration/shadow/compatibility/recovery diagnostics exist as read-only/redacted modules but are not composed into a normal operator-facing CLI path. The normal `swift-sim doctor` exposes the artifact audit but not the complete original Phase-4 doctor/support contract. This is a hard repository blocker before declaring Phase 4 complete or making a cutover/authority decision.
- **P2:** the corrected `swift-sim pair` source path is sound, but there is still no behavior-level CLI regression test that executes `pair`. The previously integrated stray doctor-only `includeStorage` reference caused a runtime failure while the full hosted gate still passed, so this is a demonstrated whole-tree gate blind spot. Add behavior coverage before cutover.
- **P3:** Verify #1084 is hosted CI/macOS evidence only. Persistent-Mac evidence for real legacy-state migration, previous-release upgrade, restart/idempotency, busy/corruption/permissions/recovery, rollback/readability, and installed helper/service persistence is still required before any authority switch.

**Persistent-Mac evidence collection may begin on `eaa44b0f...` now**, because the current head remains legacy-authoritative and the core migration/shadow machinery is suitable for evidence gathering. However, evidence used for final cutover acceptance must be repeated or bound to the final corrected candidate after P1/P2 repository corrections. **It is not safe to make an authority/cutover decision now.**

## Scope, method, and independence

I read the active architecture control plane before making findings: `AGENTS.md`; the full architecture master plan; architecture invariants; execution and checkpoint protocols; batched and parallel execution amendments; the parallel roadmap, registry, and agent protocol; ADRs 0001-0005 with particular attention to ADR-0003; Wave-1 audit/review material; Wave-2 audit/review/registry material; `P4-INTEGRATION.md`; `P4-INTEGRATION-AUDIT.md`; PR #147 handoff; and the exact integrated tree.

The branch precondition was verified before substantive audit work. Assignment commit `f4a19240617333d5152bf8a70fee4a28e6f25b04` has exactly one parent, `eaa44b0f74e3bbea2dadbfe0b03db44cdd8fba66`. All product reads in this audit were then pinned to immutable accepted feeder SHAs or the exact product SHA rather than mutable worker branch tips.

The available audit environment did not expose an authenticated local checkout/worktree for this private repository. I therefore could not truthfully materialize a local filesystem worktree. I preserved isolation by using the dedicated remote audit branch plus immutable GitHub commit/tree reads and comparisons. This is a tooling limitation of the audit session, not a product finding. The exact-parent precondition and exact-head pinning were still verified before review.

The audit is intentionally whole-tree. It does not treat PR #147's changed-file set as the security boundary, and it specifically revisits legacy CLI/helper composition because the pre-audit `pair` regression demonstrated that integration assumptions can break untouched product paths.

## Severity summary

| Severity | Count | Summary |
| --- | ---: | --- |
| P0 | 0 | No immediate integrity/authority/process-safety defect found. |
| P1 | 1 | Required Phase-4 operator diagnostics/support are not composed into an operator-facing path. |
| P2 | 1 | `pair` runtime path lacks behavior-level regression coverage after a demonstrated missed integration defect. |
| P3 | 1 | Persistent-Mac/installed-service evidence remains outstanding before cutover. |

---

# 1. Feeder ancestry and serialization

`docs/internal/plans/workstreams/P4-INTEGRATION.md` freezes the accepted feeder inputs and intended serialization order as:

1. PR #141 — `41269235243f836a2575de3f306ebb4ca342cad8`
2. PR #139 — `d0b88d5b4f9bf616ee0edfca26d5f7a75290412c`
3. PR #142 — `ec7b909199eea5adc62f4114b74463ad7f1d4c05`
4. PR #130 — `5313b17d1949ceced7830034c5f46e3ac0581baa`
5. PR #140 — `c8edbb57b94dfb291a7cada84ae6a097408352cc`
6. PR #143 regression semantics — `32884c768ecd1e048170d4672d4bf407e2d95303`
7. PR #145 — `48d0ec2af9608522ff0e8cdb15a631cec29bb7e8`

Each exact accepted SHA is an ancestor of `eaa44b0f74e3bbea2dadbfe0b03db44cdd8fba66`; comparisons report the feeder as the merge base with `behind_by: 0`. This is important because several worker PR branches have advanced since integration. Current mutable PR tips are not evidence for what #147 serialized, and I did not substitute them.

The feeder branches were sibling workstreams off the Wave-2 control base, so pairwise feeder ancestry is not an ordering signal. The intended order is the frozen order above. I verified integration-sensitive semantics in the resulting exact tree rather than inferring correctness from merge ancestry alone:

- accepted #139's `swiftSimSqliteDatabase.js`, `pairingSqliteSchema.js`, and `deviceBuildSqliteSchema.js` are byte-identical in the exact integrated tree;
- #142 consumes the #139 compatibility vocabulary while preserving legacy authority;
- #140 freshness fencing remains present in the combined artifact executor/service;
- #143's regression semantics are present while package-script registration is integration-owned;
- #145's durable sessions are added after the previously frozen session boundary and the combined schema appends v8 rather than rewriting v1-v7.

**Result:** PASS. I found no stale/sibling substitution or semantic conflict loss in the accepted feeder set.

# 2. Shared SQLite history and production openers

## Migration identity

Exact integrated file: `mac-helper/src/persistence/phase4SqliteSchema.js`  
Symbol: `PHASE4_SQLITE_MIGRATIONS`

The unified Phase-4 history contains v1-v8, where v8 is the appended durable-session migration. The existing histories remain:

1. `legacy_import_checkpoints`
2. `pairing_state`
3. `pairing_shadow_mismatch_evidence`
4. `pairing_authority_state`
5. `pairing_cutover_preparation`
6. `device_build_domain_state`
7. `device_build_shadow_mismatch_evidence`
8. `durable_session_domain_state`

The v1-v7 provider files in accepted #139 and the exact integrated head have identical blob identities:

- `mac-helper/src/persistence/swiftSimSqliteDatabase.js` — `cc9a19dad1308c3224e004a49db8ef02127b5c93`
- `mac-helper/src/persistence/pairingSqliteSchema.js` — `cc58cbb826af40c688f6a1378698b13c9397c4ca`
- `mac-helper/src/persistence/deviceBuildSqliteSchema.js` — `40e3deb4c038fd98532699d16d33657eb8a5fcb2`

That is stronger than a version-number assertion: migration names, statements, ordering inputs, and checksum inputs for v1-v7 were not rewritten during integration.

Exact test evidence: `test/phase4Integration.test.js` verifies strict v1-v7 identity, the eight-name history, v7 -> v8 upgrade, exact v8 session columns, close/reopen behavior, and latest-schema operation.

## Production openers of `~/.swift-sim/state.sqlite`

The current production shadow openers I found are:

- `mac-helper/src/persistence/deviceBuildShadowRuntime.js`
- `mac-helper/src/persistence/sessionDurableShadowRuntime.js`

Both construct `SwiftSimSqliteDatabase` with the unified `PHASE4_SQLITE_MIGRATIONS`, so neither attempts to open a v8 database with a shorter v1-v5 or v1-v7 migration list.

The standalone `createPairingDatabase` and `createDeviceBuildDatabase` schema constructors retain their bounded provider histories, but I found no current product composition path that uses those shorter lists to reopen the shared production `state.sqlite`. The live helper composition instead uses the combined Phase-4 migration list for the shared SQLite observers.

**Result:** PASS. No hidden production shared-state opener was found that would reject a legitimate v8 database.

# 3. Authority and rollback posture

## Pairing

Exact production composition: `mac-helper/bin/swift-sim-helper.js` and `mac-helper/src/infrastructure/compatibilityHelperRuntime.js`.

Live pairing behavior remains backed by the legacy `PairingStore`. I found no SQLite reader cutover in request routing, no deletion of the legacy pairing store, and no cutover-window expiry encoded into the exact integrated tree.

## Device builds

Exact file: `mac-helper/src/persistence/deviceBuildCutoverCompatibility.js`  
Symbols: `DEVICE_BUILD_COMPATIBILITY_AUTHORITY`, `DeviceBuildCompatibilityReader.read`

`DEVICE_BUILD_COMPATIBILITY_AUTHORITY` is `legacy`. `read()` reads the legacy authority and permits SQLite only as comparison/inspection evidence. The compatibility implementation rejects an authority selection other than the accepted legacy vocabulary rather than silently failing over to SQLite.

## Sessions

The live runtime controller remains filesystem/legacy-session based. Exact file: `mac-helper/src/sessionRuntimeController.js`. It composes `SessionStore` and process/runtime ports; it does not use durable-session SQLite rows to establish process ownership or termination authority.

The v8 session table deliberately excludes PID/start identity, port, URL, worker/engine state, stream/build/log/orientation/runtime claims, and other process state. The durable session shadow observer therefore cannot become kill authority through its schema.

## No permanent dual authority

SQLite shadow/import paths are present as preparation and comparison mechanisms, but I found no route that makes SQLite the production reader of record and no code that removes legacy readability as part of #147. This matches the parallel-execution rule that cutover remains a later serialized decision.

**Result:** PASS. Legacy JSON/filesystem authority remains intact where #147 claims it does, and ADR-0003's process-authority boundary is preserved.

# 4. Durable sessions

## Frozen durable schema

Exact file: `mac-helper/src/persistence/sessionDurableSqliteSchema.js`  
Table: `session_records`

The table contains exactly:

- `id`
- `token`
- `project`
- `scheme`
- `simulator_udid`
- `created_at`

It does not persist `record_json`, `revision`, `updatedAt`, `stream`, `build`, `logs`, `orientation`, `remoteBaseUrl`, PID, port, URL/runtime claims, worker/process/engine state, or equivalent runtime ownership data.

## Frozen projection before persistence/comparison

Exact files:

- `mac-helper/src/persistence/sessionBoundaryProjection.js`
- `mac-helper/src/persistence/sessionDurableProjection.js`
- `mac-helper/src/persistence/sessionDurableShadowComparison.js`

Mixed legacy records are projected through the frozen durable boundary before persistence and comparison. Runtime-only changes therefore cannot enter the durable hash/comparison through whole-record serialization.

Exact integration tests in `test/phase4Integration.test.js` independently mutate each durable field (`id`, `token`, `project`, `scheme`, `simulatorUDID`, `createdAt`) and require a mismatch. The same test suite characterizes runtime-only churn—including revision/update metadata and runtime URL/orientation/build/log/stream/process fields—as not creating a durable mismatch.

## Locked import and process identity

Exact files/symbols:

- `mac-helper/src/persistence/sessionLegacyImport.js`
- `mac-helper/src/persistence/sessionLockedLegacySnapshot.js`
- `mac-helper/src/infrastructure/sessionLegacyProcessIdentity.js`
- `createSessionLegacyProcessIdentity`

The Darwin process identity command is exactly:

`/bin/ps -p <pid> -o lstart=`

The returned non-empty start token participates in process identity; PID alone is not accepted as sufficient identity.

The session legacy lock remains held across the synchronous source snapshot, verified backup, durable projection/import, SQLite verification, checkpoint publication, and checkpoint verification. A concurrent legacy mutation cannot be silently checkpointed as though it belonged to the locked snapshot.

Exact tests: `test/sessionDurablePersistence.test.js` and the session cases in `test/phase4Integration.test.js` cover restart/resume/idempotency/frozen-field behavior at repository level.

**Result:** PASS.

# 5. Device cutover, upgrade, and rollback

Accepted #139 remains the provider of the cutover vocabulary; accepted #142 consumes that vocabulary rather than redefining a second authority model. The exact integrated compatibility reader remains legacy-authoritative.

Repository-level characterization covers:

- restart/import idempotency;
- shadow comparison behavior;
- compatibility reads that do not fall back to SQLite as authority;
- rollback parsing/readability of preserved legacy bytes;
- previous-release archive/tag provenance in `test/previousReleaseUpgradeEvidence.test.js`.

No code path found in the combined tree selects SQLite before an explicit later cutover decision.

The previous-release test is useful deterministic repository proof, but it is not a real Homebrew upgrade on a persistent machine. That distinction is carried into Finding P3 rather than promoted into real-machine evidence.

**Result:** PASS at repository/CI evidence level; real-machine acceptance remains open.

# 6. Artifact maintenance and freshness fencing

Exact files:

- `mac-helper/src/deviceBuildArtifactMaintenanceService.ts`
- `mac-helper/src/deviceBuildArtifactMaintenanceExecutor.ts`
- `mac-helper/src/infrastructure/nodeArtifactStore.js`

The #140 freshness contract survived integration. Before executable reclamation, `validateFreshAction` re-reads authoritative state after asynchronous measurement/replanning and validates the action against current revision/root/path/policy/measurement evidence. Stale authoritative state fails closed rather than proceeding with the previously planned deletion.

Deletion remains constrained to the proven `NodeArtifactStore` boundary: callers obtain a contained approval/resolution and reclamation revalidates the contained target before recursive removal. I found no raw product-level recursive deletion path bypassing that boundary for the maintenance action.

I also found no automatic:

- startup historical cleanup;
- background historical cleanup;
- orphan cleanup;
- manual-review cleanup.

The normal helper composes artifact auditing/doctor evidence, not automatic reclamation. #143 regression semantics remain represented, and test/package registration is present in `package.json` as integration-owned composition.

**Result:** PASS.

# 7. Diagnostics and operator reachability

This is where the exact integrated tree does not yet satisfy the original Phase-4 completion contract.

The implementation modules are individually strong:

- `mac-helper/src/commands/phase4SupportDiagnostics.js` — `collectPhase4SupportDiagnostics`
- `mac-helper/src/commands/phase4DiagnosticFailure.js` — redacted/classified database diagnostic failures
- `mac-helper/src/commands/phase4SupportRecovery.js` — actionable recovery guidance
- `test/phase4SupportDiagnostics.test.js` — read-only/redacted behavior and no cleanup mutation

The support collector covers database/migration/shadow/compatibility/artifact evidence and is intentionally read-only. Recovery helpers distinguish corruption, permission, incompatibility, busy/unavailable, and authority-preserving recovery posture.

However, exact executable composition in `mac-helper/bin/swift-sim.js` imports and displays the device-build artifact doctor section while it does **not** import or call `collectPhase4SupportDiagnostics`. `swift-sim doctor`/`status` therefore do not expose the broader Phase-4 database/migration/shadow/compatibility support collector. `mac-helper/bin/swift-sim-helper.js` likewise does not turn that collector into an operator-facing endpoint.

The master Phase-4 plan requires the operator-facing doctor/support surface to cover schema checks, migration checks, permissions checks, orphan artifact checks, database corruption with actionable recovery guidance, and redacted diagnostic/export support. Artifact audit reachability alone does not satisfy that contract.

See **Finding P1**.

# 8. Reconciliation against original Phase-4 scope and ADR-0003

I did not assume that the parallel registry perfectly enumerated the older master-plan wording. I separately inventoried surviving state that could superficially look like a missing SQLite migration.

## Correctly filesystem/runtime-owned

### Device delivery generation state

Exact file: `mac-helper/src/deviceDeliveryState.js`

This state includes runtime delivery URL/generation information plus process identity (`ownerPid`, `ownerStartIdentity`) and related execution claims. Under ADR-0003, this is runtime/process authority and belongs outside SQLite.

### Pairing invites

Exact file: `mac-helper/src/pairingInviteStore.js`

`pairing-invites.json` is an expiring, consumed security-capability store with a bounded short TTL. It is ephemeral coordination/security state rather than durable domain authority. Migrating it into SQLite would contradict the Phase-4/ADR boundary rather than complete it.

### Simulator profile / device inventory

Exact files:

- `mac-helper/src/simulatorProfile.js`
- `mac-helper/src/deviceInventory.js`

Simulator profile data is derived from current `simctl`/Xcode state and cached; device inventory is obtained from current `devicectl` evidence. These are derived/live environment observations, not missing durable domain records.

## Durable domains represented

The durable Phase-4 inventory represented in the integrated tree is pairing domain state, device-build domain state, and the frozen six-field durable-session state. I did not find a fourth required durable domain whose omission would block Phase 4 under ADR-0003.

The master-plan phrase about removing the custom JSON database must therefore be read together with ADR-0003 and the explicit migration/cutover sequence: runtime journals, leases, process identity, ephemeral security capabilities, and native-file/runtime truth are intentionally left outside SQLite. Legacy JSON also remains temporarily authoritative until the explicit later cutover decision.

**Result:** PASS. No missing durable domain found. Remaining runtime/ephemeral filesystem state is intentional; authority removal is a later serialized cutover step, not work that should be smuggled into this integration audit.

# 9. Whole-tree regressions

I reviewed legacy CLI/helper composition rather than only #147's integration files.

## Corrected `pair` regression

Exact file/symbol: `mac-helper/bin/swift-sim.js` — `pair(args)`.

The pre-audit whole-tree defect was a stray doctor-only `includeStorage` reference in the `pair` path. In exact `eaa44b0f...`, that reference has been removed from `pair`; the correction is source-correct and does not alter pair authority or protocol semantics.

The remaining problem is test reachability. Exact `test/cli.test.js` exercises doctor/status/setup-related CLI behavior but does not execute the actual `pair` command path. The prior full hosted Verify passed while the now-corrected `pair` path contained a runtime `ReferenceError`, proving that the existing gate does not exercise this command strongly enough.

See **Finding P2**.

## Helper/database lifecycle and authority routing

The live helper continues to compose legacy authority stores and optional shadow observers. The shared production SQLite observers use the unified v1-v8 migration list. I found no helper startup/shutdown path that reopens shared v8 state with a shorter migration list and no failure path that promotes SQLite to authority merely because legacy state is unavailable.

No whole-tree regression was found in current authority routing, SQLite process-termination authority, or artifact automatic cleanup.

# 10. Evidence classification

## Hosted/repository evidence already available

Verify #1084 / run `31799660233` is a successful GitHub Actions run whose head SHA is exactly `eaa44b0f74e3bbea2dadbfe0b03db44cdd8fba66`. This is valid hosted CI/macOS evidence for the tested repository state.

Repository fixtures also provide deterministic characterization for migration sequencing, idempotency, session projection, rollback parsing, artifact fencing, and previous-release artifact provenance.

These fixtures must not be promoted into claims about a persistent installed Mac.

## Persistent-Mac evidence still required before authority switch

Against the final corrected/frozen cutover candidate, collect and retain evidence for at least:

1. **Real legacy state -> unified v8 migration** using an actual persistent `~/.swift-sim` state root, including verified pre-import backup and resulting v8 schema/history.
2. **Previous-release upgrade** from a clean installed previous tagged/Homebrew release into the candidate while preserving real legacy state; repository archive provenance alone is insufficient.
3. **Close/reopen and restart/idempotency** across helper/service restarts, repeated imports, and checkpoint resume; no duplicate pairing/device-build/session durable rows.
4. **Busy/locked database handling** with legacy authority preserved and no accidental SQLite fallback/cutover.
5. **Corruption handling** that fails closed, preserves legacy authority, and produces actionable recovery guidance through the operator-facing diagnostic surface.
6. **Permissions/ownership handling** on the private state root/database, including the normal operator-visible doctor result and recovery path.
7. **Redacted support/export evidence** proving support output does not disclose tokens, secrets, sensitive paths/identifiers, or raw unsafe database errors.
8. **Rollback/readability** proving preserved legacy state remains readable by the rollback/previous-release path during the allowed window and that no migration action destroys that path.
9. **Installed helper/service persistence** across real launchd/helper stop/start/reboot-style lifecycle where applicable, including stable shared migration open/close behavior.
10. **Simulator/device evidence only where it proves a Phase-4 claim.** For example, a real device-build state transition can be useful evidence that legacy authority and SQLite shadow state coexist across restart. Physical-device evidence is not a substitute for, nor automatically required to prove, pure schema/checksum properties.

Preliminary migration/restart/rollback evidence may be collected on exact `eaa44b0f...` now. Final acceptance evidence for diagnostics and command-gate behavior must be attached to the corrected frozen SHA after P1/P2 are resolved.

---

# Findings

## P1 — Required Phase-4 doctor/support diagnostics are implemented but not operator-reachable

**Severity:** P1 — hard blocker before Phase-4 completion/cutover; not P0 because current product authority remains legacy and no immediate data-loss/termination path is created.

### Exact file / symbol / evidence

- `mac-helper/src/commands/phase4SupportDiagnostics.js` — `collectPhase4SupportDiagnostics`: read-only/redacted Phase-4 support collector exists.
- `mac-helper/src/commands/phase4DiagnosticFailure.js`: classifies database failure states without exposing raw unsafe errors.
- `mac-helper/src/commands/phase4SupportRecovery.js`: produces authority-preserving recovery guidance, including corruption/permission/incompatibility cases.
- `test/phase4SupportDiagnostics.test.js`: validates the module-level read-only/redacted contract.
- `mac-helper/bin/swift-sim.js` — normal `doctor`/`status` composition imports/displays the artifact doctor projection but does not import or invoke `collectPhase4SupportDiagnostics`.
- `mac-helper/bin/swift-sim-helper.js`: does not expose the collector as an alternate operator-facing support endpoint.
- Architecture master plan, Phase 4: requires doctor schema/migration/permissions/orphan checks, corruption failure with actionable recovery guidance, and redacted diagnostic/export support.

### Why it matters

A diagnostic module that cannot be reached by a normal operator does not satisfy a cutover gate. On a persistent Mac, the operator currently cannot use the shipped Phase-4 surface to prove schema/migration health, distinguish corruption/busy/incompatibility/permission states, obtain the prescribed recovery guidance, or capture the complete redacted support report. This also prevents real-machine evidence from exercising the intended recovery UX end-to-end.

### Affected invariant / gate

- Phase-4 master-plan doctor/support requirements.
- Phase-4 corruption gate: database corruption must fail closed with actionable recovery guidance.
- Checkpoint/verification principle: a migration/cutover checkpoint must have independent, operator-observable verification.
- Parallel execution contract: integration owns central composition; worker module existence is not completion.

### Exact orchestrator action

Create a **product correction workstream/PR on the serialized Phase-4 integration line, without changing authority or cleanup policy**, that:

1. composes the existing read-only `collectPhase4SupportDiagnostics` into normal `swift-sim doctor` and/or an explicitly documented operator support/export command;
2. exposes schema/migration/shadow/compatibility/artifact health and the redacted actionable recovery guidance;
3. ensures the original explicit private-state permissions check is directly represented in the operator-facing result (reuse existing primitives if sufficient; add the smallest read-only probe if not);
4. adds behavior-level CLI tests for healthy, corrupt/incompatible, permission-denied, and artifact/orphan-support cases;
5. proves the diagnostic path is non-mutating and cannot change authority or perform cleanup.

Do not combine this correction with an authority switch.

## P2 — `swift-sim pair` has no behavior-level regression test after a demonstrated full-gate miss

**Severity:** P2 — current product source is corrected, but the regression gate is demonstrably incomplete; repository correction required before cutover.

### Exact file / symbol / evidence

- `mac-helper/bin/swift-sim.js` — `pair(args)`: exact `eaa44b0f...` no longer contains the stray doctor-only `includeStorage` reference; source correction is sound.
- `test/cli.test.js`: current CLI tests cover doctor/status/setup behavior but do not execute the actual `pair` command path.
- Pre-audit integration history: `pair` previously contained an out-of-scope `includeStorage` reference that produced a runtime failure.
- Verify #1084's predecessor/full hosted gate did not detect that class of defect, demonstrating that source/adjacent tests are insufficient for this path.

### Why it matters

The defect itself is fixed, but an integration gate that cannot detect a one-line runtime `ReferenceError` in a legacy command is not strong enough to protect the authority-switch boundary. The whole-tree audit requirement exists precisely because serialized integration can perturb command-local assumptions outside an agent's changed-file set.

### Affected invariant / gate

- Whole-tree regression requirement for `setup/status/doctor/pair`.
- Checkpoint requirement that verification be capable of detecting the class of failure being accepted.
- Pre-cutover confidence in legacy CLI behavior while authority is still legacy.

### Exact orchestrator action

Add a focused **behavior-level CLI regression test** that invokes the real `pair` entrypoint/command with controlled helper/network dependencies and proves the command completes its setup-status/pair request path without an undeclared-variable/runtime-scope failure. Prefer testing the same executable/compiled entrypoint that packaging exposes where practical. Keep this as test/product-gate correction only; do not alter pairing authority.

## P3 — Persistent-Mac migration/recovery/rollback/service evidence is not yet collected for cutover

**Severity:** P3 — evidence/readiness gap rather than a repository correctness defect, but hard evidence blocker before authority switch.

### Exact file / symbol / evidence

- GitHub Actions Verify #1084 / run `31799660233`: PASS, exact head SHA `eaa44b0f74e3bbea2dadbfe0b03db44cdd8fba66`; hosted CI/macOS only.
- `test/phase4Integration.test.js`: repository-level v1-v8/close-reopen/openers/session characterization.
- `test/sessionDurablePersistence.test.js`: repository-level durable-session import/restart/idempotency characterization.
- `test/previousReleaseUpgradeEvidence.test.js`: pins previous-release archive/tag provenance but does not perform a persistent installed-Mac/Homebrew upgrade.
- Architecture master-plan Phase-4 gate and checkpoint protocol require real migration/rollback/recovery confidence before cutover.

### Why it matters

Fixtures cannot establish permissions, launchd/service lifecycle, real legacy state-root migration, actual previous-release packaging behavior, filesystem durability, busy/corruption recovery UX, or rollback readability on the target environment. Those are exactly the failure modes that become consequential when authority changes.

### Affected invariant / gate

- Phase-4 migration idempotency/interruption-safety gate.
- Old-data rollback readability gate.
- Database corruption fail-closed/recovery gate.
- Previous tagged/Homebrew release upgrade gate.
- Checkpoint protocol's environment-qualified evidence requirement.

### Exact orchestrator action

Begin persistent-Mac evidence collection now for non-diagnostic-sensitive scenarios, but bind final acceptance to the corrected frozen candidate after P1/P2. Record commands, before/after state metadata, schema/migration state, backups, helper/service lifecycle, failure injection outcomes, operator diagnostics, rollback results, and exact tested SHA. Do not allow fixture output to stand in for this evidence.

---

# Required final answers

## 1. Is exact head `eaa44b0f...` safe to proceed to persistent-Mac evidence collection?

**Yes.** It is safe to begin persistent-Mac evidence collection because legacy authority remains intact, the unified v1-v8 history is coherent, session runtime/process authority remains outside SQLite, and no automatic destructive cleanup/cutover was found. Preliminary migration/restart/rollback/busy evidence is useful now.

However, final cutover acceptance evidence must be collected or repeated against the final corrected/frozen candidate after P1/P2, especially diagnostics/recovery and CLI regression evidence.

## 2. Is it safe to proceed to an authority/cutover decision now, or are repository corrections required first?

**No authority/cutover decision yet. Repository corrections are required first.** P1 must make the original Phase-4 doctor/support/recovery contract operator-reachable, and P2 must close the demonstrated `pair` behavior-test blind spot. Persistent-Mac evidence must then qualify the corrected exact candidate.

## 3. Which findings are hard blockers before cutover?

- **P1** — hard repository blocker: operator-facing Phase-4 diagnostics/recovery composition is incomplete.
- **P2** — hard regression-gate correction before cutover: `pair` behavior is not exercised despite a demonstrated missed runtime defect.
- **P3** — hard evidence blocker: persistent-Mac migration/upgrade/recovery/rollback/service evidence is outstanding.

There are no P0 blockers in this audit.

## 4. What is the minimal ordered correction/evidence sequence?

1. **Repository correction, no authority change:** wire the existing read-only/redacted Phase-4 support diagnostics/recovery into an operator-facing CLI surface and ensure the explicit permissions requirement is represented; add end-to-end CLI behavior tests.
2. **Repository correction, no authority change:** add direct behavior-level coverage for the real `swift-sim pair` command path that would have failed on the prior stray `includeStorage` reference.
3. **Freeze the corrected candidate and rerun repository gates:** docs/architecture/diff checks plus full hosted Verify on that exact SHA.
4. **Collect/complete persistent-Mac evidence on the exact frozen candidate:** real legacy -> v8 migration; previous-release/Homebrew upgrade; restart/idempotency/checkpoint resume; busy/locked; corruption; permissions; redacted diagnostics/recovery; rollback/readability; installed helper/service persistence; Simulator/device evidence only where it proves a Phase-4 claim.
5. **Independent pre-cutover gate:** re-audit the frozen exact SHA and linked evidence, then make the authority switch a separate explicit serialized decision/workstream.

Preliminary persistent-Mac evidence that is not sensitive to P1/P2 may start before steps 1-2 finish, but it does not qualify a different final SHA automatically.

## 5. What independent gate should happen immediately before an authority switch?

Run an **independent frozen-head Phase-4 cutover preflight** immediately before any authority switch. The auditor must verify on one exact immutable candidate SHA that:

- every shared production SQLite opener uses the complete migration history;
- v1-v8 migration/checksum identity and real upgrade evidence are intact;
- pairing/device-build/session reads are still legacy-authoritative until the explicit switch;
- legacy rollback/readability remains proven and no deletion/window-expiry has occurred;
- SQLite cannot establish PID/process/termination authority;
- durable-session scope is still exactly the six frozen fields;
- artifact freshness/containment and no-automatic-cleanup constraints still hold;
- normal operator diagnostics/recovery are actually reachable and redacted;
- the real `pair` command behavior gate is green;
- the complete persistent-Mac evidence bundle is tied to that exact SHA;
- full hosted Verify and architecture/diff gates pass on the same candidate.

Only after that independent gate passes should the orchestrator authorize a separate serialized authority-switch change.
