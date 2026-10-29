# Independent Phase-4 cutover code audit

Status: independent audit documentation only. This report does **not** authorize or perform a Phase-4 authority switch, merge PR #152, expire rollback, delete legacy state, execute cleanup, or start Phase 5.

## Exact audit target

- Repository: `Miguelosaurus/Swift-Sim`
- Implementation PR: #152 — `P4-CUTOVER-IMPLEMENTATION: serialized authority transition`
- Exact product SHA audited: `3a1fb02c9ace97dfdd0637fc5ecb391e3570a77e`
- Frozen product parent: `bde5c1993112678430423ba32e7fb02b9bb5c9a1`
- Exact hosted product Verify: #1135 / run `31939393430` — PASS
- Independent pre-cutover audit: PR #151 / `f39da9c6bd5c1bfca9b9e4147d2bbc2c1439d4d3` / Verify #1108 / run `31848127993` — PASS
- Audit branch base: exact `3a1fb02c9ace97dfdd0637fc5ecb391e3570a77e`; no pre-existing audit assignment commit was present, so this audit is one ordinary docs-only commit directly above the product SHA.

Prior Phase-4 control-plane chain reviewed includes PR #147 product integration at `eaa44b0f74e3bbea2dadbfe0b03db44cdd8fba66`, PR #148 audit at `27902f55910ba06bb65bb7074c62553379f8f1d5`, PR #149 corrected product at `bde5c1993112678430423ba32e7fb02b9bb5c9a1`, PR #150 correction audit at `33919377db8809739baa3860c6145d0e8f831407`, PR #151 pre-cutover audit at `f39da9c6bd5c1bfca9b9e4147d2bbc2c1439d4d3`, and PR #152 at the exact audited product SHA above.

## Method and evidence boundary

I independently read the active architecture master plan, invariants, execution/checkpoint protocols, batched/parallel execution amendments, Wave-2 registry/control-plane material, ADR-0003, the PR #147-#152 chain, `P4-CUTOVER-IMPLEMENTATION.md`, `PHASE4_CUTOVER_MAINTENANCE_RUNBOOK.md`, the complete PR #152 changed-file set, and the exact-head production sources/tests relevant to migration, authority, helper/service routing, sessions, rollback, diagnostics, packaging, and cleanup.

Repository reads were pinned to immutable Git SHAs through the connected GitHub repository interface. The sandbox could not materialize the private repository through local Git authentication, so I do **not** claim an isolated local worktree test rerun. The exact product head does have the independent hosted Verify #1135 gate noted above. This report does not treat that green gate or PR prose as proof; findings below come from tracing exact production source paths.

## Finding summary

| Severity | Count |
| --- | ---: |
| P0 | 0 |
| P1 | 4 |
| P2 | 2 |
| P3 | 2 |

The product is not safe to advance to maintenance-window v9 requalification until the P1 corrections below are made and independently re-audited. The two pre-existing environment-only P3 gates remain environment-only; repository defects found here are not reclassified as P3.

## P1 findings

### P1-1 — reachable production HTTP boundaries bypass the v9 global selector and keep direct legacy stores

**Evidence:**

- `mac-helper/bin/swift-sim-helper-entry.js` imports `deviceBuildCapabilityBoundaryPreload.js` and installs `helperHttpBoundaryPreload.js` before loading the extracted/compatibility helper runtime.
- `mac-helper/src/deviceBuildCapabilityBoundaryPreload.js` imports `PairingStore` and `DeviceBuildStore` directly. Its default `pairingStore()` constructs `new PairingStore()` and its default `buildStore()` constructs `new DeviceBuildStore({ maintenance: false })`. Those defaults serve real public device-build capability/status/log/install-request/verification paths and can mutate device-build state.
- `mac-helper/src/helperHttpBoundaryPreload.js` likewise imports and lazily constructs direct `PairingStore`, `PairingInviteStore`, and `DeviceBuildStore` instances for pairing fallback and public build boundary behavior.
- These paths do not consult `Phase4AuthorityRouter` or `phase4_authority_state`.

**Impact:** after a valid global `sqlite-rollback` activation, these production HTTP surfaces can still read and write the inactive legacy pairing/device state. Therefore the v9 selector is not the only reachable product authority decision, selected/inactive backend exclusivity is false, and pairing/device behavior can disagree with the SQLite-authoritative product state even though the newer facades themselves are no-fallback.

**Required repository correction:** route every reachable helper HTTP pairing/invitation/device-build boundary through the v9 authority-aware production stores, or remove the direct legacy constructors from reachable production composition. Add behavior-level post-switch tests through the actual helper HTTP entry/boundaries proving SQLite selection, no inactive legacy read/write, and selected-backend failure propagation without fallback.

### P1-2 — the maintenance cutover entrypoint is not installed at the path documented by the runbook

**Evidence:**

- PR #152 adds source `mac-helper/bin/swift-sim-phase4-cutover.js`.
- `PHASE4_CUTOVER_MAINTENANCE_RUNBOOK.md` instructs the later executor to run `node <installed-libexec>/mac-helper/bin/swift-sim-phase4-cutover.js ...`.
- Root `package.json` publishes `dist/mac-helper`, not source `mac-helper`, in its `files` list and does not register a cutover binary in `bin`.
- The release archive is produced from the built/npm-packed package and Homebrew installs that package into `libexec`; ordinary launchers use `dist/mac-helper/bin/...`.
- Existing package/Homebrew verification does not assert or invoke the Phase-4 maintenance script at the documented source-tree path.

**Impact:** source presence is not installed operator reachability. A clean package/Homebrew candidate does not contain the documented `<installed-libexec>/mac-helper/bin/swift-sim-phase4-cutover.js` path. The maintenance executor therefore cannot invoke the reviewed entrypoint in the form the runbook requires, and the exact installed bytes are not currently covered by package verification.

**Required repository correction:** define one supported installed maintenance entrypoint (for example the built `dist/mac-helper/bin/...` artifact or an explicitly registered maintenance binary), update the runbook to that exact installed path, and extend package/Homebrew verification to prove the candidate archive contains and can invoke exactly the reviewed compiled maintenance entrypoint without mutating authority.

### P1-3 — the 25 maintenance stop conditions are largely forgeable assertions, and the mutating database opener runs before evidence validation

**Evidence:**

`mac-helper/src/persistence/phase4CutoverPreflight.js` accepts a caller-supplied JSON object and treats a long set of machine-observable safety claims as satisfied when named boolean fields are `true`. It syntactically validates candidate SHA, Verify run ID, PID/start string and mismatch count, but it does not bind those values to the actually installed candidate, hosted run, running helper, filesystem permissions, current DB/migration contents, snapshot/backup identity, live shadow evidence, or rollback readers/material.

Examples accepted by assertion include `installedProvenanceVerified`, `exactProcessIdentityVerified`, `writersQuiesced`, `exactDomainLocksAvailable`, `privatePermissionsVerified`, `schemaMigrationsCoherent`, `databaseIntegrityWalForeignKeysVerified`, `preMigrationDatabaseSnapshotVerified`, `legacyBackupsVerified`, `migrationReopenIdempotencyVerified`, `installedCandidateHelperHealthy`, `zeroUnresolvedShadowMismatches`, and `rollbackReadable`. Existing tests construct synthetic all-true evidence objects; their acceptance proves shape enforcement, not truth enforcement.

The coordinator does independently and correctly revalidate important activation facts under exact locks: prepared revision/evidence, source revisions/projections, final re-import, exact SQLite projection equality, a second freshness reread, and the selector transaction. `SwiftSimSqliteDatabase` also verifies migration identity/integrity when it is opened. Those protections do not make the remaining assertions trustworthy.

More importantly, `mac-helper/bin/swift-sim-phase4-cutover.js` opens the shared `SwiftSimSqliteDatabase` before the coordinator's `prepare`/`activate` evidence validation. Construction can apply the v8->v9 migration. Thus a false or malformed evidence file can be rejected only **after** database mutation has already occurred. v9 defaults to legacy, so this does not itself activate SQLite, but it violates PR #151's requirement that maintenance stop conditions be enforceable before the corresponding live mutation.

**Required repository correction:** separate genuinely human authorization statements from measurable conditions. Before any opener capable of migration/write, bind and verify the exact candidate/installed provenance and required maintenance authorization. Independently measure/revalidate machine-observable conditions at the latest safe point, including applicable process identity/quiescence, private permissions, exact migration identity, integrity/WAL/FK, verified pre-migration snapshot/backup identity, current shadow mismatch state, and rollback readability/material. Preserve the coordinator's existing under-lock final equality/freshness checks. Add falsification tests showing hand-authored `true` values cannot bypass facts the implementation can measure.

### P1-4 — ordinary authority-aware helper startup drains destructive artifact cleanup

**Evidence:**

- `mac-helper/src/persistence/phase4ProductionStores.js` makes `createDeviceBuildStore()` call `ensureDeviceMaintenance()`.
- `ensureDeviceMaintenance()` immediately runs the selected backend maintenance and installs a repeating timer.
- `runDeviceMaintenance(store)` calls both `store.runMaintenance()` **and** `store.drainArtifactCleanupJobs()`.
- The legacy `DeviceBuildStore.drainArtifactCleanupJobs()` is a destructive executor: queued artifact roots can be recursively removed and cleanup queue state consumed.
- The production compatibility helper composition creates the authority-aware device-build store during normal helper startup.

**Impact:** merely starting/reopening the helper can drain artifact cleanup and delete queued artifact material. That contradicts the frozen Phase-4 cutover boundary and this audit's explicit requirement that startup/cutover/doctor/rollback not drain artifact cleanup, delete orphan/manual-review/historical material, or couple cleanup execution to authority cutover. This is also inconsistent with the pre-cutover accepted state in which historical cleanup remained separately authorized/nonautomatic.

**Required repository correction:** remove destructive artifact cleanup draining from Phase-4 authority-store construction/startup/requalification. Keep cleanup execution behind its existing separately authorized maintenance owner/gate. Add regression tests proving helper startup/reopen, cutover prepare/activate/status, doctor, and rollback do not drain artifact cleanup or delete artifact roots.

## P2 findings

### P2-1 — the v9 table can represent SQLite-authoritative modes with `cutover_epoch = 0`

`mac-helper/src/persistence/phase4AuthoritySchema.js` constrains `cutover_epoch >= 0` but the mode-layout CHECK for `sqlite-rollback`, `rollback-preparing`, and `sqlite-final` does not require a positive epoch. `SqlitePhase4AuthorityRepository.parseAuthorityRow()` also accepts any non-negative safe integer. Normal repository activation increments epoch and therefore does not generate zero through the intended transition API, but the schema itself can represent a semantically invalid SQLite-authoritative row that the router will accept.

The assignment explicitly requires `phase4_authority_state` not to represent contradictory/invalid live transition states. This should be enforced by the durable schema/read validator, not only by the happy-path writer.

**Required correction:** require a positive cutover epoch for SQLite-authoritative/final modes (and the intended legacy/preparing epoch semantics if they are meant to be fixed), with adversarial row-validation/migration tests.

### P2-2 — hybrid session creation has an unprotected SQLite-then-runtime crash boundary

`mac-helper/src/persistence/phase4SessionStore.js` constructs the hybrid store with `Object.create(SessionStore.prototype)` and overrides `writeStateUnlocked()`. During `create()`, `_phase4AllowDurableInsert` permits any new session's six-field durable projection to be upserted into SQLite first; only afterward does the method publish the reconstructed runtime/session JSON through `BaseSessionStore.prototype.writeStateUnlocked`.

If runtime-file publication throws or the process crashes after the SQLite upsert commits, the API call can fail while a durable SQLite row remains. On reopen the hybrid reconstruction iterates durable rows, so that abandoned durable row can reappear with absent/default runtime state; a retry can create a different session ID. The six-field ownership boundary itself remains respected, and SQLite gains no PID/process-termination authority, but creation is not crash-atomic or explicitly recoverable across the two media.

**Required correction:** make durable-session creation publication explicitly idempotent/recoverable across SQLite and runtime state, or introduce a bounded publication protocol/compensation that cannot leave an abandoned authoritative durable row after failed runtime publication. Add injected-failure coverage between durable commit and runtime file publication plus reopen/retry characterization.

## Audit of the required areas

### 1. v9 schema and migration composition

**Accepted in purpose/minimality, not fully accepted as encoded until P2-1 is corrected.** PR #152 appends one product-global v9 selector migration; the PR diff does not rewrite v1-v8 migration definitions. Existing v1-v8 state had domain data and pairing-local cutover vocabulary but no semantically valid product-global selector coordinating pairing, device builds, and durable sessions, so a new global migration is justified. v9 initializes exactly one row in `legacy`; migration/startup does not activate SQLite. `session_records` remains the accepted six durable columns (`id`, `token`, `project`, `scheme`, `simulator_udid`, `created_at`). Reviewed `SwiftSimSqliteDatabase` openers use the complete Phase-4 migration list and fail closed on migration identity/schema-ahead/integrity failures. P2-1 prevents full acceptance of the v9 row invariant as currently encoded.

### 2. One global authority decision

**Not accepted product-wide because of P1-1.** `Phase4AuthorityRouter` itself has the correct map: `legacy`/`preparing` -> legacy; `sqlite-rollback`/`rollback-preparing`/reserved `sqlite-final` -> SQLite. Its facade chooses one backend per method and propagates selected-backend failure. Pairing's older authority row is used as a local synchronization fence rather than by this router. However, the helper HTTP preloads bypass the router and directly instantiate legacy pairing/device stores, so the system does not yet have one reachable authority decision.

### 3. Preparation and crash boundaries

**Accepted structurally.** Pairing's local preparation fence may be written before global `preparing`, but product authority remains globally `legacy`. A crash after only the pairing fence, during an import, or after imports/checkpoints but before global preparation cannot select incomplete SQLite data. Re-running preparation reconciles the same preparation ID; disagreeing IDs/evidence/revisions fail closed. Cancellation can be interrupted after local cancellation while global remains `preparing`; restart still routes legacy and can complete cancellation or re-establish the matching local preparation fence. No reviewed pre-activation crash point makes SQLite authoritative.

### 4. Activation transaction

**Accepted.** The coordinator acquires the four exact legacy domain locks in deterministic path order. It uses `NodeLockManager` with `createSessionLegacyProcessIdentity`, which delegates to the exact Darwin `/bin/ps -p <pid> -o lstart=` start-token identity; stale ownership is therefore PID+start-identity rather than PID-only. Under all locks, activation verifies prepared source revision/projection, reapplies the final import, verifies exact SQLite projections, performs a second freshness reread, then calls the global authority repository. Pairing-local activation executes in `beforeSelectorCommit` inside the exact same SQLite `BEGIN IMMEDIATE` transaction as the global selector update. An exception before commit rolls both back. No reviewed persistent exception point exists after one authority field commits but before the other.

### 5. Production routing parity

**Rejected because of P1-1 and P1-4.** The new production store facades and extracted/compatibility paths use the global router, but real helper HTTP boundaries still bypass it, and normal authority-aware device-store startup now owns destructive cleanup execution. Post-switch service reopen therefore is not proven safe through all real product surfaces.

### 6. Frozen hybrid session boundary

**Ownership model accepted; crash publication requires P2-2 correction.** SQLite contains and overlays exactly the six accepted durable values. Runtime-only save/reconcile/flush cannot redefine those durable fields because presentation/writes reconstruct from current SQLite durable rows. Runtime/process/stream/build/log/orientation/URL/port/PID state stays in runtime/filesystem state, and no SQLite field authorizes process termination. Current-state rollback overlays current SQLite durable values over current runtime state. The prototype-based construction preserves inherited lifecycle methods through the overridden read/write boundary, but the create-path cross-medium crash window is not yet safely characterized.

### 7. Current-state rollback

**Accepted structurally, subject to the repository blockers above.** The flow is `sqlite-rollback -> rollback-preparing -> legacy`; `rollback-preparing` stays SQLite-authoritative. The rollback coordinator exports current SQLite pairing/device/session state, not stale pre-cutover backups, verifies publications, and leaves partially exported legacy files inactive if interrupted. Retry from rollback-preparing is fenced by current revision/epoch. The code rejects rollback when `now >= rollbackExpiresAt`, implementing the half-open `[cutoverAt, rollbackExpiresAt)` window. If expiry occurs after one/two legacy exports, the selector remains SQLite and final restoration fails closed. Final global legacy restoration and pairing-local fence restoration share one SQLite transaction. P1-3 still requires real quiescence/rollback-material facts to be enforced rather than asserted before executing this on a live root.

### 8. Maintenance evidence enforcement

**Rejected — P1-3.** Human-only facts such as explicit maintenance authorization inherently require operator assertion/recording. Other conditions can be measured in preceding runbook commands, but the mutating implementation must bind their evidence to concrete candidate/process/files/database state where feasible. Conditions such as exact candidate/Verify identity, installed provenance, helper PID+start identity, writer quiescence/locks, private permissions, migration identity/DB health, snapshot/backup identity, shadow mismatch state, migration reopen/idempotency, and rollback readability must not be bypassable by arbitrary hand-authored `true` fields. Final locked source/projection equality and freshness are correctly measured by the coordinator itself.

### 9. Maintenance operator reachability and packaging

**Rejected — P1-2.** The source entrypoint is reviewed, but the runbook path does not match the clean npm/Homebrew artifact layout and package verification does not prove that maintenance surface. Installed-source reachability cannot be inferred from repository presence.

### 10. Diagnostics

**Accepted.** PR #152 extends the accepted P4-DIAGNOSTICS vocabulary rather than inventing a competing support schema. Normal support remains at `storage.phase4Support` with `readOnly=true`, `redacted=true`, `mutationAllowed=false`. The operator diagnostic path uses a read-only/query-only SQLite observation, reports global modes/rollback availability and distinguishes preparation from final freshness, and does not invoke prepare/import/activate/rollback/cleanup/delete/process termination. Existing busy/corrupt/incompatible/permission recovery semantics remain authority-preserving. The explicit maintenance status surface is separate from normal support diagnostics.

### 11. Cleanup/process boundaries

**Rejected for cleanup because of P1-4; process boundary accepted.** No reviewed SQLite schema gains PID/port/runtime URL/process ownership or termination authority, and no finalization/legacy-deletion/rollback-expiry surface is exposed. `sqlite-final` is representable for forward compatibility but there is no callable transition/finalize operation in this workstream. However, authority-aware helper startup does drain artifact cleanup through device maintenance, which violates the frozen cleanup boundary.

### 12. Tests and gate adequacy

Exact hosted product Verify #1135 / run `31939393430` passed on `3a1fb02c...`; that is useful but insufficient. PR #152 adds strong repository/facade tests for authority transitions, stale evidence, pairing synchronization, rollback, diagnostics, and selected router semantics. The suite does not catch the production HTTP preload bypasses, installed maintenance path mismatch, arbitrary truthy maintenance evidence, startup cleanup drain, hybrid session durable-commit/runtime-publish crash, or the v9 zero-epoch representable state. Those omissions correspond directly to the findings above and require targeted regressions.

## Major acceptance decisions

- **v9 necessity/minimality:** accepted; **v9 row invariants as currently encoded:** not fully accepted until P2-1.
- **global selector + pairing-local transaction atomicity:** accepted.
- **product-wide one-global-authority routing:** not accepted because of P1-1.
- **preparation crash safety:** accepted.
- **current-state rollback algorithm:** accepted, but live execution remains blocked by P1-3 and other P1s.
- **frozen six-field session ownership:** accepted; hybrid create crash publication needs P2-2.
- **maintenance evidence enforcement:** not accepted.
- **installed maintenance operator reachability:** not accepted.
- **normal Phase-4 diagnostics:** accepted.
- **cleanup/process boundary:** process authority accepted; cleanup boundary not accepted.

## Remaining environment-only gates

After repository corrections and an independent exact-head re-audit, the two known PR #151 P3 gates still remain and must be performed only in the separately authorized maintenance window:

1. live-root migration/helper staging, including v9 migration-target requalification against the real private root;
2. real installed Homebrew v0.6.1 -> corrected candidate upgrade/provenance/service proof.

The clean-package maintenance-entrypoint defect in P1-2 is a repository problem and is **not** satisfied by deferring it to that Homebrew ceremony. Physical-device/Simulator/network ceremony is not newly required by this implementation because this cutover makes no new hardware/network claim.

## Exact repository corrections required before maintenance-window requalification

1. Route every reachable pairing/invitation/device-build helper HTTP boundary through the v9 authority-aware store selection and add post-switch production-boundary/no-fallback tests.
2. Package and verify one supported maintenance entrypoint at the exact installed path documented for the executor.
3. Replace forgeable machine-condition booleans with bound measurements/revalidation where code can observe the fact, and enforce pre-migration gating before opening a database capable of applying v9.
4. Remove destructive artifact-cleanup draining from ordinary Phase-4 helper/store startup and prove cutover/startup/doctor/rollback are cleanup-inert.
5. Harden v9 mode/epoch constraints so SQLite-authoritative rows cannot carry epoch zero.
6. Make hybrid session creation recoverable/idempotent across the durable SQLite commit and runtime-file publication crash boundary and add fault-injection/reopen/retry coverage.

## Verdict

**NOT READY, with exact repository corrections required.**

This verdict blocks maintenance-window v9 requalification of exact `3a1fb02c9ace97dfdd0637fc5ecb391e3570a77e`. It does **not** authorize or perform the actual authority switch.