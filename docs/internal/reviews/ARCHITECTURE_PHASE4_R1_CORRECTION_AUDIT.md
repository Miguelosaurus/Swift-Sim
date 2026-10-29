# Architecture Phase 4 R1 Correction Audit

**Audit workstream:** `P4-R1-INDEPENDENT-REVIEW`  
**Auditor role:** independent correction auditor; no product fixes  
**Assigned branch:** `agent/arch-ws-P4-R1-INDEPENDENT-REVIEW`  
**Assignment head:** `f8dcb6dc09104c1b673bb9afaeb742046a132dd5`  
**Exact corrected product head audited:** `bde5c1993112678430423ba32e7fb02b9bb5c9a1`  
**Correction PR:** #149  
**Parent integration audit:** PR #148 at `27902f55910ba06bb65bb7074c62553379f8f1d5`  
**Pinned product Verify:** #1106 / run `31820807687` — PASS on exact `bde5c1993112678430423ba32e7fb02b9bb5c9a1`

## Executive verdict

PR #149 closes both repository findings from PR #148.

- **PR #148 P1 is CLOSED.** The normal `swift-sim doctor --json` / `status --json` path now exposes the accepted P4-DIAGNOSTICS report at `storage.phase4Support`, and human doctor/status output carries useful Phase-4 health and recovery guidance. The product reuses `collectPhase4SupportDiagnostics`; it does not define a second product support schema.
- **PR #148 P2 is CLOSED.** `test/pairCliRegression.test.js` launches the real `mac-helper/bin/swift-sim.js pair` CLI as a child process. Its preload controls only helper/network dependencies, and unchanged production `pair()` must traverse setup-status and then actual pair dispatch. Reintroducing the prior undeclared `includeStorage` expression would make the child fail before dispatch and fail the test.
- I found **no repository correction still required before the final persistent-Mac acceptance evidence / pre-cutover review**.
- The exact product head `bde5c1993112678430423ba32e7fb02b9bb5c9a1` is **suitable as the repository candidate for the final Phase-4 pre-cutover evidence gate**. This is not an authority-switch approval.
- Persistent real-Mac/installed-service migration, upgrade, rollback, corruption/busy/permission, restart, and compatibility evidence remains environment-only and must be bound to this exact candidate before a cutover decision.

| Severity | Count | Disposition |
| --- | ---: | --- |
| P0 | 0 | No catastrophic safety or integrity defect found. |
| P1 | 0 | PR #148 P1 is closed. |
| P2 | 0 | PR #148 P2 is closed; no new bounded correctness blocker found. |
| P3 | 1 | Final persistent-Mac / installed-environment evidence remains outstanding before cutover. |

## Audit basis, provenance, and execution limitation

The assignment provenance is exact. The assigned branch resolves to `f8dcb6dc09104c1b673bb9afaeb742046a132dd5`; that commit has exactly one parent, `bde5c1993112678430423ba32e7fb02b9bb5c9a1`, and its only change is the docs-only assignment file `docs/internal/plans/workstreams/P4-R1-INDEPENDENT-REVIEW.md`. The product audited here is therefore the requested frozen corrected SHA, not a moving PR tip or the audit branch tree.

I read the architecture control plane required by the assignment, including:

- `AGENTS.md`;
- `ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md`, especially Phase 4;
- `ARCHITECTURE_CONSOLIDATION_INVARIANTS.md`;
- `ARCHITECTURE_CONSOLIDATION_EXECUTION_GUIDE.md`;
- `ARCHITECTURE_CONSOLIDATION_CHECKPOINT_PROTOCOL.md`;
- batched- and parallel-execution amendments;
- parallel roadmap, workstream registry, and agent protocol;
- ADR-0003;
- Wave 1 orchestrator review and Wave 2 independent/orchestrator review material;
- PR #147 integration handoff;
- full PR #148 independent integration audit;
- PR #149 diff, history, tests, and handoff;
- `P4-INTEGRATION-CORRECTIONS-R1.md` and `P4-R1-INDEPENDENT-REVIEW.md`.

The execution container does not have working outbound DNS for GitHub. A fresh local `git clone` retry failed with `Could not resolve host: github.com`, so I could not truthfully materialize the requested local worktree or claim local test commands. I preserved audit isolation by using the dedicated assigned branch for the review artifact and immutable exact-SHA GitHub reads/comparisons for all product evidence. Hosted verification is recorded separately below. This tooling limitation is not a repository finding and does not convert any unrun local command into a pass.

## Exact PR #149 boundary

Compared with the audited product parent `eaa44b0f74e3bbea2dadbfe0b03db44cdd8fba66`, PR #149 changes exactly eight paths:

1. `docs/internal/plans/workstreams/P4-INTEGRATION-CORRECTIONS-R1.md`
2. `mac-helper/src/commands/deviceBuildArtifactDoctorProjection.js`
3. `mac-helper/src/commands/phase4DatabaseDiagnosticProjection.js`
4. `mac-helper/src/commands/phase4OperatorDiagnostics.js`
5. `test/fixtures/pair-cli-preload.mjs`
6. `test/pairCliRegression.test.js`
7. `test/phase4OperatorDiagnosticsAuthority.test.js`
8. `test/phase4OperatorDiagnosticsCli.test.js`

There is no correction diff in global SQLite schema/history, the durable-session schema, normal shared database owners, pairing/device/session authority implementations, rollback readers/windows, process ownership/termination, artifact cleanup execution, root package policy, CI workflows, or Phase-5 product code.

---

# PR #148 P1 — CLOSED

## 1. Normal operator reachability is real

The normal CLI maps both `doctor` and `status` to `doctor(args)`. `doctor()` calls `buildDoctorReport({ includeStorage: true })`. When storage is included, `buildDoctorReport` includes `storage: deviceBuildArtifactDoctorSection(artifactAudit)`.

PR #149 changes that existing projection so `deviceBuildArtifactDoctorSection()` calls `collectPhase4OperatorDiagnostics({ artifactAudit: value })` and returns the result as `storage.phase4Support`. JSON doctor/status therefore exposes the accepted report on a normal product path; it is not a test-only helper or a separate hidden command.

Human doctor/status output still renders the existing read-only artifact section, whose detail now appends a bounded Phase-4 summary with overall/database/migration/shadow/compatibility status, recovery action codes, and the explicit statement that evidence is read-only, redacted, and mutation-disabled.

`setup` calls `buildDoctorReport()` without storage, so this correction does not make setup construct the Phase-4 operator probe merely as a startup side effect.

## 2. The accepted P4-DIAGNOSTICS model is reused

`phase4OperatorDiagnostics.js` imports and delegates to the existing `collectPhase4SupportDiagnostics`; `phase4SupportDiagnostics.js` remains the product support-field owner. The resulting report retains the accepted shape and flags:

- `version: 1`;
- `readOnly: true`;
- `redacted: true`;
- `mutationAllowed: false`;
- recovery also has `mutationAllowed: false`.

No competing diagnostic schema, alternative recovery vocabulary, or second redaction model was introduced.

## 3. Required Phase-4 evidence is represented

The operator probe supplies accepted observations for:

- **database/schema:** integrity, WAL journal mode, foreign keys and violations, required-table presence, current/latest schema version, migration count;
- **migration/checkpoint:** current vs checkpointed migration posture and legacy-import checkpoint count;
- **shadow:** observed shadow-mismatch tables and mismatch count;
- **compatibility/authority:** legacy readability, SQLite readability, rollback readability, compatible/transitioning/incompatible state;
- **private permissions:** state-root/database access and mode failures are classified as permission-denied and mapped to private-permission recovery guidance;
- **artifact/orphan:** the already accepted read-only artifact audit projection, including orphan/manual-review evidence and `cleanupEnabled: false`;
- **failure vocabulary:** corruption, busy/locked, incompatible/newer schema, permission-denied, unavailable;
- **recovery:** accepted authority-preserving recovery action codes rather than mutation commands.

This closes the original master-plan gap identified by PR #148: schema/migration/permissions/orphan and corruption-recovery evidence is now reachable from normal doctor/support output.

## 4. The probe is bounded away from mutating owners

`phase4OperatorDiagnostics.js` deliberately imports only read/stat/access filesystem primitives, `node:sqlite` `DatabaseSync`, the migration metadata list, and the accepted support collector. It does **not** import or instantiate:

- `SwiftSimSqliteDatabase`;
- a normal migration/import coordinator;
- device/session/pairing stores;
- compatibility runtimes/read-authority routers;
- cleanup queues/executors;
- artifact reclamation services;
- process supervisors/termination owners.

Therefore invoking doctor/status cannot through this probe:

- run a schema migration or legacy import;
- cut over a reader or writer;
- drain or execute cleanup jobs;
- delete legacy state;
- switch pairing/device/session authority;
- terminate a process;
- create a permanent dual write.

The artifact input is a read-only audit result from the already existing `device-build-artifact-audit` support command; the correction does not activate maintenance apply.

## 5. SQLite is read-only/query-only and closed deterministically

The operator database handle is opened as:

`new DatabaseSync(databasePath, { readOnly: true })`

and immediately executes:

- `PRAGMA query_only = ON`;
- `PRAGMA foreign_keys = ON`.

The probe performs only schema/health/count queries and PRAGMA health checks. The handle is closed in `finally`.

The code temporarily applies `umask 077` before the bounded SQLite reader window and restores the prior process umask in a nested `finally`, including when probing fails. State-root/database private-mode checks happen before SQLite is opened.

## 6. Domain mutation is correctly distinguished from SQLite reader coordination

The real-v8 regression creates a disposable production-format v8 database, closes its normal owner, then invokes the real operator collector. It verifies:

- the main SQLite database bytes are unchanged;
- any WAL created by the read path contains no appended diagnostic records in the no-writer characterization;
- any diagnostic-created WAL/SHM coordination files are owner-private;
- the result remains read-only/redacted/mutation-disabled.

This is the correct boundary. SQLite WAL-mode readers may require coordination sidecars; those files are not treated as a domain/authority mutation, while main database bytes and domain/legacy authority remain invariant.

## 7. Legacy authority is observed without disclosure or mutation

Compatibility probing examines `pairing.json`, `device-builds.json`, and `sessions.json` only for readability and JSON validity. It returns booleans/state, not file contents or paths.

The malformed-legacy real regression uses a real v8 database plus malformed existing legacy bytes and verifies:

- compatibility becomes blocked/incompatible;
- `legacyReadable` and `rollbackReadable` become false;
- authority-preserving compatibility recovery guidance is emitted;
- the main SQLite bytes are unchanged;
- the malformed legacy bytes are unchanged;
- the previous umask is restored.

Failure classification itself discards raw error strings after mapping them into stable coarse categories, and CLI tests assert that a private absolute path is absent from emitted JSON. I found no path/token/legacy-content field in `phase4Support`.

## 8. Valid staged v7 is not falsely corruption-blocked

PR #149 makes one necessary correction in `projectPhase4DatabaseHealth`: a missing required table is severe only when the observed schema version is at or beyond the runtime's latest schema. This distinguishes a legitimate earlier schema awaiting a supported migration from a structurally broken current schema.

The real-v7 regression constructs a real database from the accepted v1-v7 history and invokes the real operator collector. It requires:

- database status `attention`;
- schema version 7 / latest 8;
- one expected missing v8 table;
- migration outcome `checkpointed` / migration health retained;
- compatibility `transitioning` while legacy remains readable;
- recovery includes the supported-migration/authority-preserving action;
- recovery does **not** falsely classify the state as current-schema corruption;
- database bytes remain unchanged.

The fail-safe side remains intact:

- current/latest schema missing required tables => blocked;
- newer schema/history => incompatible/blocked;
- integrity/corruption => corrupt/blocked with preserve/restore guidance;
- permission failure => unavailable/permission-denied with private-state-permission guidance;
- busy/locked => unavailable/busy with retry-after-writer guidance;
- otherwise unavailable => unavailable with state-availability guidance.

## 9. Real regression coverage, not fixture-only projection coverage

The correction includes fixture-level CLI failure/output cases, but the audit did not rely only on them. The real-state regressions independently cover:

- real v8 database read-only/WAL-SHM characterization;
- real private database mode rejection before open;
- real v7 staged schema posture;
- malformed existing legacy authority with real v8 database;
- byte stability and umask restoration.

`test/phase4OperatorDiagnosticsCli.test.js` also launches the real `mac-helper/bin/swift-sim.js doctor --json` child path and verifies healthy, corrupt, newer/incompatible, permission, busy/unavailable, artifact/orphan, redaction and human-output behavior.

**P1 disposition: CLOSED.**

---

# PR #148 P2 — CLOSED

## 1. The test executes the real CLI process

`test/pairCliRegression.test.js` resolves `../mac-helper/bin/swift-sim.js` and launches a new Node child process with that actual CLI file and command `pair`. It does not duplicate or reimplement `pair()` in test code.

## 2. Only external/helper dependencies are controlled

`test/fixtures/pair-cli-preload.mjs` intercepts child `spawnSync` only when the executable/arguments identify the real Swift Sim helper entrypoint. It supplies controlled successful helper health/setup-status/pair responses and records pair dispatch. It also supplies the network health response required by helper readiness. Other child-process behavior delegates to the original implementation.

The preload does not replace production `pair()`, pairing validation, authority selection, request construction, or dispatch sequencing.

## 3. Production `pair()` must traverse the meaningful behavior

The exact production `pair()` remains unchanged by PR #149. The child must:

1. ensure the helper is ready;
2. call helper `setup-status`;
3. validate/normalize the suggested remote URL;
4. derive the Mac name from setup status;
5. dispatch the actual helper `pair` command.

The regression asserts successful child exit and the exact observed pair helper request, proving execution reaches dispatch rather than merely parsing source.

## 4. It catches the prior `includeStorage` failure class

The previous integrated defect inserted an undeclared doctor-only `includeStorage` expression immediately after `setup-status` inside `pair()`. Restoring that expression would throw a `ReferenceError` in the real child before pair dispatch. The child would exit nonzero and the expected recorded pair request would be absent, so the regression would fail.

## 5. No pairing simplification was made to satisfy the test

PR #149 changes no production CLI/pairing implementation file. Pairing/device/session legacy authority, protocol semantics, authorization routing and rollback behavior therefore were not modified merely to make the regression green.

**P2 disposition: CLOSED.**

---

# Frozen Phase-4 surfaces

The correction diff plus exact-tree inspection preserves the following audited posture:

| Surface | Audit result |
| --- | --- |
| Shared SQLite schema | PASS — `PHASE4_SQLITE_MIGRATIONS` remains v1-v8; no v9. |
| v1-v7 migration identity/order/checksum inputs | PASS — no schema/history provider file changed from the PR #148 audited parent. |
| Durable session table | PASS — `session_records` still has exactly `id`, `token`, `project`, `scheme`, `simulator_udid`, `created_at`. |
| Shared production SQLite openers | PASS — staged device/session shadow runtimes continue to use complete `PHASE4_SQLITE_MIGRATIONS` v1-v8. |
| Pairing authority | PASS — legacy production authority unchanged. |
| Device-build authority | PASS — legacy compatibility authority unchanged. |
| Session runtime/process authority | PASS — remains legacy/filesystem/runtime-owned; durable SQLite rows do not own PID/process claims. |
| Rollback readers/windows | PASS — no correction path removes or expires them. |
| PID/process termination | PASS — no relevant production ownership/termination file changed; SQLite remains non-authoritative for termination under ADR-0003. |
| Artifact cleanup activation | PASS — audit remains read-only; `cleanupEnabled: false`; no startup/background/orphan/manual-review cleanup activation. |
| Root package / CI policy | PASS — no root package or workflow file changed in PR #149. |
| Phase 5 production behavior | PASS — no Phase-5 product change or authority transition. |

# Whole-tree regression pass

I reviewed the correction in the context of the surrounding executable boundaries rather than only its eight-file diff:

- **setup:** still calls doctor-report construction without storage/Phase-4 operator probing, so setup does not gain an accidental migration/maintenance owner;
- **doctor/status:** both route through the same real doctor path; storage-enabled doctor/status now exposes the accepted Phase-4 report while retaining read-only artifact audit behavior;
- **pair:** unchanged production path is now covered by a real child-process regression through setup-status to pair dispatch;
- **helper startup:** no helper-startup/composition file changed; the diagnostic probe does not instantiate the helper's normal migration/shadow owners;
- **database open/close:** new probe is direct read-only/query-only and finally-closed; normal production shared-state openers are unchanged and retain complete v1-v8 history;
- **authority routing:** no pairing/device/session selector or compatibility reader changed; legacy authority remains active;
- **failure boundaries:** diagnostic database failures degrade into redacted support classifications and recovery guidance without mutating authority. Corrupt/current-incomplete/newer states fail closed; expected v7 migration state is attention/transitioning rather than false corruption.

Exact product Verify #1106 / run `31820807687` independently confirms the frozen candidate completed successfully on macOS 26. The run executed:

- `npm ci`;
- `npm run check`;
- isolated clean Homebrew installation gate;
- workflow YAML parsing;
- shell syntax checks;
- iOS app tests.

At this exact tree, `npm run check` includes architecture and docs checks, strict type checking, format/lint, the wildcard `node --test --test-concurrency=1 test/*.test.js ...`, compiled-tree validation, and package/Homebrew validation. Because the correction's three new `.test.js` files are under `test/`, the real pair CLI regression and the operator-diagnostics CLI/authority regressions are part of that exact-head hosted gate.

I could not rerun local `git diff --check`, architecture/docs commands, or tests in this audit container because no local checkout could be materialized. The product exact-head hosted gate above is the executable repository evidence; the audit branch itself is docs-only and is verified by GitHub diff inspection below.

---

# Finding P3 — final persistent-Mac acceptance evidence remains environment-only

**Severity:** P3 in this correction audit because it is not a repository defect and does not reopen P1/P2. It remains a hard evidence prerequisite before an authority switch.

Repository fixtures and hosted macOS CI cannot substitute for the final persistent installed environment required by the batched-execution/evidence rules. Bind final evidence to exact `bde5c1993112678430423ba32e7fb02b9bb5c9a1` (or a later explicitly re-audited correction candidate) for at least:

1. normal installed `swift-sim doctor`/`status` JSON and human recovery output against private real state;
2. representative legitimate staged v7 state and disposable v7 -> v8 migration with backup, idempotency and interruption/restart behavior;
3. corruption/unreadable database handling;
4. private state-root/database permission failures;
5. real busy/writer contention behavior;
6. malformed/unreadable preserved legacy authority and rollback/readability behavior;
7. previous-tagged-release Homebrew upgrade against representative preserved state;
8. installed helper/service start, restart and persistence behavior on the target Mac;
9. final verification that main DB/domain/legacy authority bytes and owner-only permissions behave as expected across those scenarios;
10. any physical-device/network evidence required by the final Phase-4/pre-cutover gate that hosted CI cannot manufacture.

Preliminary evidence gathered on `eaa44b0f...` remains useful background but is not a substitute for binding final acceptance to the corrected candidate.

# Explicit answers

1. **Is PR #148 P1 closed?** Yes.
2. **Is PR #148 P2 closed?** Yes.
3. **Are any repository corrections still required before final persistent-Mac acceptance evidence / pre-cutover review?** No.
4. **What evidence remains environment-only?** Persistent installed-Mac migration/upgrade/restart/idempotency/corruption/busy/permission/rollback/readability/service evidence, plus any required physical-device/network proof unavailable to hosted CI.
5. **Is exact `bde5c1993112678430423ba32e7fb02b9bb5c9a1` suitable as the repository candidate for the final Phase-4 pre-cutover evidence gate?** Yes. It is suitable for evidence collection and final pre-cutover review; this audit does **not** authorize SQLite authority activation, rollback-window expiry, legacy deletion, automatic cleanup, or Phase-5 production work.

## Recommendation

Proceed with the final persistent-Mac acceptance evidence program against exact `bde5c1993112678430423ba32e7fb02b9bb5c9a1`, then perform the frozen-head Phase-4 pre-cutover review. Keep PR #149 and this audit PR draft and unmerged until the orchestration plan explicitly advances them.