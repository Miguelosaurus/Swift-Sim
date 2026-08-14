# Architecture Parallel Wave 2 Audit

Status: **independent pre-integration audit**  
Auditor role: **WAVE2 architecture auditor; not an implementation worker**  
Assigned branch: `agent/arch-ws-WAVE2-AUDIT-independent-review`  
Assignment head: `b645b4ebc6ab4e61555bb108733e1eeecaa1285f`  
Underlying Wave 2 control base / target control head: `4e670281bcda9e443b4fb5b7e3a2f42e379cfa35`  
Target PR branch: `agent/architecture-consolidation-wave1-control`

## Executive result

The completed Wave 2 feeders reviewed here have **no remaining P0 or P1 architecture defect**. All six Wave 1 audit findings are closed at the feeder/control-plane level. The Wave 2 correction work materially closes the three prior P1 hazards:

- historical artifact apply now binds actions to authoritative revision/root state, re-measures and re-plans current policy, and re-reads authority after measurement before reclamation;
- the session boundary now freezes exactly six durable fields and excludes mixed runtime/process state, `revision`, and `updatedAt`;
- session legacy locking reuses the exact Darwin `ps -o lstart=` process-start token and rejects reused-PID identity mismatches.

Device cutover is now a verified, explicitly legacy-authoritative provider vocabulary; upgrade evidence is a verified consumer that does not introduce a competing migration state model. Diagnostics remains read-only/redacted and remains the sole owner of product Phase 4 support-field semantics.

One new **P2 integration-ownership finding** remains: PR #143 correctly makes the artifact freshness regressions durable in the compiled gate, but it directly edits root `package.json`, a red-zone surface reserved to the orchestrator unless explicitly delegated. The regression test should be accepted; the package registration must be re-homed into an orchestrator-owned integration commit (or an explicit delegation must be recorded) rather than integrating PR #143 verbatim.

| Severity | Count |
| --- | ---: |
| P0 | 0 |
| P1 | 0 |
| P2 | 1 |
| P3 | 0 |

**Integration verdict:** completed Wave 2 feeders may enter the **serialized Phase 4 integration lane**, subject to W2-P2-01 and the dependency/order conditions below. This does **not** make Phase 4 complete. `P4-SESSIONS-DOMAINS-R2` is still active and must satisfy the exact acceptance conditions in this report before it becomes an integration feeder. Final shared schema/composition, authority selection, real-user historical cleanup exposure, rollback-window expiry, and Phase 4 gate evidence remain integration-owned.

## Audit basis and ancestry

The assigned audit branch was independently resolved to `b645b4ebc6ab4e61555bb108733e1eeecaa1285f`. Comparing it with `4e670281bcda9e443b4fb5b7e3a2f42e379cfa35` showed:

- merge base exactly `4e670281bcda9e443b4fb5b7e3a2f42e379cfa35`;
- `ahead_by: 1`, `behind_by: 0`;
- the only assignment delta was `docs/internal/plans/workstreams/WAVE2-INDEPENDENT-AUDIT.md`.

The target `agent/architecture-consolidation-wave1-control` also resolves to `4e670281bcda9e443b4fb5b7e3a2f42e379cfa35`.

Environment limitation: this auditor runtime did not expose a local Swift-Sim checkout, and direct container GitHub network resolution was unavailable. Therefore no local filesystem `git worktree` command or local test command is claimed. The pre-created assigned branch was used as the isolated audit/write lane through the GitHub connector, and ancestry was verified from repository commit/ref data. Hosted exact-head verification is recorded separately from local execution.

### Control plane read

The audit read the active architecture controls relevant to this decision, including:

- `AGENTS.md`;
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md`;
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_INVARIANTS.md`;
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_EXECUTION_GUIDE.md`;
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_CHECKPOINT_PROTOCOL.md`;
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_BATCHED_EXECUTION_AMENDMENT.md`;
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PARALLEL_EXECUTION_AMENDMENT.md`;
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PARALLEL_ROADMAP.md`;
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_WORKSTREAM_REGISTRY.md`;
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_AGENT_PROTOCOL.md`;
- ADRs 0001 through 0005;
- Wave 1 independent audit PR #132;
- Wave 1 orchestrator review and Wave 2 registry from PR #138;
- `docs/internal/plans/workstreams/WAVE2-INDEPENDENT-AUDIT.md`;
- correction workstream contracts for artifact execution R2, device-cutover fix, session boundary, and upgrade-evidence fix;
- the active `P4-SESSIONS-DOMAINS-R2` contract only to define its future acceptance conditions, not to review the running implementation as complete.

## Reviewed feeder heads and hosted status

| Feeder | Exact reviewed head | Hosted Verify | Audit disposition |
| --- | --- | --- | --- |
| PR #130 `P4-DIAGNOSTICS` | `5313b17d1949ceced7830034c5f46e3ac0581baa` | Verify #1007 / run `31750485903` passed | accepted feeder; read-only/redacted support-field owner |
| PR #139 `P4-DEVICE-CUTOVER-FIX` | `d0b88d5b4f9bf616ee0edfca26d5f7a75290412c` | Verify #1051 / run `31789021720` passed | accepted provider feeder |
| PR #140 `P4-ARTIFACT-EXECUTION-R2` source | `c8edbb57b94dfb291a7cada84ae6a097408352cc` | Verify #1059 / run `31789349142` passed | accepted source feeder |
| PR #143 artifact freshness regression | `32884c768ecd1e048170d4672d4bf407e2d95303` | Verify #1065 / run `31789672092` passed | semantic test accepted; package red-zone edit requires orchestrator handling |
| PR #141 `P4-SESSION-BOUNDARY` | `41269235243f836a2575de3f306ebb4ca342cad8` | Verify #1061 / run `31789461892` passed | accepted boundary feeder / mandatory parent for sessions R2 |
| PR #142 `P4-UPGRADE-EVIDENCE-FIX` | `ec7b909199eea5adc62f4114b74463ad7f1d4c05` | Verify #1041 / run `31755224171` passed | accepted consumer feeder after device provider |

PR #143's trusted Verify was allowed to remain semantically independent while pending by the assignment. At audit completion it is no longer pending: exact-head Verify #1065 passed.

## Wave 1 finding closure

### W1-P1-01 — historical artifact stale-plan hazard: CLOSED

**Prior hazard:** a historical audit plan could become stale before deletion and lacked an authoritative revision/epoch plus current state/root/policy revalidation.

**Wave 2 evidence:** PR #140, `mac-helper/src/deviceBuildArtifactMaintenancePlan.ts` and `mac-helper/src/deviceBuildArtifactMaintenanceService.ts`.

Key symbols and behavior:

- `MaintenanceAction.expectedRevision` binds every executable action to a specific authoritative revision.
- `planDeviceBuildArtifactMaintenance()` requires a current canonical artifact root and stores that canonical root/path on the action.
- `createDeviceBuildArtifactMaintenanceService().apply()` refuses a changed artifact directory before iterating actions.
- `validateFreshAction()` calls `getBuild(entry.buildID)`, rejects identity/revision/root drift through `basicFreshnessRefusal()`, derives the current candidate path, performs a fresh `usage.measure()`, rejects any measurement issue, reruns `planDeviceBuildArtifactAudit()` and `planDeviceBuildArtifactMaintenance()`, and requires the exact action to remain currently authorized.
- After measurement and policy re-plan, `validateFreshAction()` calls `getBuild()` **again** and rechecks identity/revision/root before returning the latest record for reclamation.
- `applyOne()` re-derives the candidate from that latest record, requires the exact planned path, calls the contained executor approval boundary, and only then calls `reclaimApproved()`.
- The maintenance planner iterates only bound `audit.builds`; orphan/manual-review roots are never converted into executable actions.
- Ready-live policy excludes DerivedData; export/install payloads are not a maintenance action kind.
- There is no startup scheduling, helper/CLI wiring, or automatic real-user cleanup in PR #140.

PR #143 adds durable regressions in `test/deviceBuildArtifactMaintenanceService.test.ts` for stale revision, live-ready policy drift, authoritative root drift, ambiguous fresh measurement, idempotently absent data, post-measurement revision drift, and stable contained reclamation. The test is registered in the compiled gate and exact-head Verify #1065 passed.

The current legacy `DeviceBuildStore` also advances `revision` on `save()` and through `touchBuild()`, so normal persisted lifecycle/state changes participate in the revision freshness fence rather than silently changing beneath a stable epoch.

**Closure condition at integration:** bind the R2 `executor` seam to the existing `NodeArtifactStore` containment behavior (or an equally proven adapter), so actual deletion retains root identity/symlink component revalidation. Do not replace it with a raw filesystem deletion call. This is a normal integration requirement, not a reopened P1 in the feeder.

### W1-P1-02 — mixed durable/runtime session aggregate: CLOSED at boundary; repository implementation still pending

**Wave 2 evidence:** PR #141.

- `mac-helper/src/contracts/durableSession.ts::DurableSessionRecord` contains exactly `id`, `token`, `project`, `scheme`, `simulatorUDID`, and `createdAt`.
- Its comment explicitly excludes the mixed legacy `updatedAt` and `revision` epochs because runtime/stream writes advance them.
- `mac-helper/src/persistence/sessionBoundaryProjection.js::projectDurableSession()` returns exactly those six fields.
- `parseDurableSession()` rejects any extra field.
- `joinSessionForPresentation()` gives durable identity fields to the durable record and obtains `updatedAt`, `revision`, `remoteBaseUrl`, `build`, `stream`, `logs`, and `orientation` from the runtime/presentation input; the result is deeply frozen and is not a writable merge store.
- `test/sessionBoundaryProjection.test.js` explicitly rejects `stream`, `logs`, `remoteBaseUrl`, `orientation`, `build`, `updatedAt`, and `revision` from durable parsing, and verifies stale runtime copies cannot override durable identity.

This supersedes PR #137's rejected whole-record design. No SQLite repository/schema is introduced by PR #141.

### W1-P1-03 — session lock identity / PID reuse: CLOSED at boundary; R2 must consume it exactly

**Wave 2 evidence:** PR #141.

- `mac-helper/src/infrastructure/sessionLegacyProcessIdentity.js` is a direct re-export: `createDarwinLegacyProcessIdentity as createSessionLegacyProcessIdentity`. It does not invent a second process identity representation.
- The reused adapter executes exactly `/bin/ps`, arguments `-p`, `<pid>`, `-o`, `lstart=`, with UTF-8 output, and trims stdout into `{ startToken }`.
- `test/sessionLegacyProcessIdentity.test.js` asserts the exact executable/argument vector and trimmed Darwin token.
- The same test calls `NodeLockManager`'s `lockOwnerIsAlive()` and proves the same PID is live only with the same start token; a different start token is rejected as PID reuse.
- `NodeLockManager::lockOwnerIsAlive()` requires both a valid PID and a non-empty owner start token, checks process existence, and then requires the supplied current identity token to match. PID existence alone cannot prove ownership.

The legacy `SessionStore` still writes `startedAt: processStartIdentity()` and derives it with the same `/bin/ps -p <pid> -o lstart=` semantics. Its older identity-less-owner compatibility fallback is not permission for R2 to downgrade new migration locking to PID-only semantics.

### W1-P2-01 — device cutover vs upgrade-evidence ownership overlap: CLOSED

**Provider evidence:** PR #139.

- `deviceBuildMigrationState.js` hard-codes `DEVICE_BUILD_MIGRATION_AUTHORITY = "legacy"` and rejects any parsed state that selects non-legacy authority.
- Migration state is seeded from locked-snapshot evidence and binds `sourceRevision`, `projectionHash`, `sourceVersion`, `recordCount`, and `cursor`.
- `deviceBuildMigrationExport.js` exports normalized domain records only, binds batches to the provider epoch, uses deterministic record idempotency keys, requires contiguous acknowledgement, and regenerates the same batch after interruption until the whole batch is acknowledged.
- `DeviceBuildCompatibilityReader.read()` always returns legacy. `inspect()` may compare SQLite evidence but never falls back to it.
- `test/deviceBuildCutoverFallback.test.js` proves an invalid legacy read fails without even reading SQLite.
- `verifyDeviceBuildLegacyRollbackReadability()` reparses preserved legacy bytes through the existing legacy parser and can fence expected projection hash/source version.
- `test/deviceBuildRollbackReadability.test.js` proves both current v6 and older v5 preserved legacy bytes remain readable, while malformed bytes fail.

**Consumer evidence:** PR #142.

- No root package/workflow file is changed.
- The pinned v0.6.1 fixture is exercised through the existing device-build and pairing legacy import suites and the normal top-level test glob.
- The device import assertion consumes the existing provider-compatible epoch vocabulary (`sourceRevision`, `projectionHash`, `recordCount`) through the accepted legacy importer/checkpoint path and verifies retry returns `already-current` with one backup.
- It does not add a migration state/cursor/export/rollback implementation competing with PR #139.

**Ordering remains mandatory:** integrate/accept PR #139 provider semantics before PR #142 consumer evidence and rerun the combined exact-head gate.

### W1-P2-02 — Phase 6 classifier seam vs Phase 7 analyzer preparation: CLOSED by control-plane ownership

PR #138's Wave 1 review and Wave 2 registry explicitly preserve Phase 6 as owner of the future canonical analyzer seam and keep Phase 7 preparation experimental/noncanonical until that seam is integrated. None of the reviewed Wave 2 feeder PRs modifies that protocol or production analyzer routing.

### W1-P2-03 — Phase 4 diagnostics vs Phase 10 support schema: CLOSED

PR #130 remains the sole reviewed product support-field/redaction owner:

- `phase4SupportDiagnostics.js::collectPhase4SupportDiagnostics()` consumes caller-owned probes and states that it owns no database, migration, authority, or cleanup resource.
- Its output is fixed as `readOnly: true`, `redacted: true`, `mutationAllowed: false`; recovery also sets `mutationAllowed: false`.
- `phase4SupportRecoveryActions()` emits non-mutating operator guidance only.
- `phase4ArtifactDiagnosticProjection.js` rejects artifact observations unless `readOnly === true` and `cleanupEnabled === false`, and its projection keeps `cleanupEnabled: false`.

PR #138 makes Phase 10 reliability tooling a consumer of accepted diagnostic output rather than a competing product field model. No reviewed Wave 2 correction PR defines another product diagnostic schema.

## Findings

### W2-P2-01 — PR #143 directly edits an orchestrator-owned root package manifest

**Severity:** P2  
**Category:** red-zone ownership / integration conflict  
**Affected feeder:** PR #143, stacked on PR #140

#### Exact evidence

- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PARALLEL_EXECUTION_AMENDMENT.md` reserves root package manifests/lockfiles and TypeScript compiler configuration to the orchestrator by default, unless a workstream contract explicitly grants ownership.
- `docs/internal/plans/workstreams/P4-ARTIFACT-EXECUTION-R2.md` grants artifact-maintenance application/domain modules and focused fixtures/tests. It does not grant root package ownership.
- PR #143 changes `package.json` by adding `dist/test/deviceBuildArtifactMaintenanceService.test.js` to `check:compiled`.
- PR #143 also adds the semantically valuable `test/deviceBuildArtifactMaintenanceService.test.ts` and is exact-head hosted green.
- PR #143's own body describes the root package edit as test registration, but there is no registered Wave 2 contract delegating that red-zone surface.

#### Why it matters

The package edit is not a product correctness defect, but accepting sibling/worker changes directly on shared root command graphs defeats the parallel program's conflict-control model. Root test/package registration has to be composed with every other feeder's package requirements on the serialized integration spine. The fact that this particular edit is small and correct does not create a reusable exception.

This does **not** invalidate W1-P1-01 closure: the test source and the source implementation are correct and exact-head green. It is an ownership/integration disposition issue.

#### Required orchestrator action

1. Accept the PR #143 regression test semantics and preserve its exact cases.
2. Do not merge/cherry-pick PR #143 verbatim into the canonical integration stack while leaving the worker-owned `package.json` commit as the source of shared package policy.
3. Integrate PR #140 source first, then bring in `test/deviceBuildArtifactMaintenanceService.test.ts`.
4. In an orchestrator-owned Phase 4 integration commit, register the compiled regression in `check:compiled` (or explicitly record a bounded delegation before accepting the existing package edit).
5. Rerun the full exact-head Verify on the combined integration head so compiled-test registration is proven together with every other shared package/composition change.

## Hidden schema/composition and two-truth review

No reviewed completed feeder changes the global SQLite migration list/version/order or central helper/CLI composition:

- PR #139 adds cutover vocabulary/compatibility/export modules and tests but no global schema or authority selector.
- PR #141 adds only the session boundary/projection/identity adapter and tests; no session SQLite repository or global schema.
- PR #142 is test/fixture-only and no longer edits root package policy.
- PR #130 remains caller-composed read-only diagnostics.
- PR #140 adds an unwired maintenance service/plan only.

No completed feeder activates SQLite authority. Device compatibility is explicitly legacy-authoritative. No permanent JSON/SQLite dual write is introduced. No reviewed feeder removes legacy state or expires rollback readability.

The running Sessions R2 is the next place a two-writable-truth hazard could reappear; the conditions below are therefore release/integration prerequisites, not optional follow-up polish.

## P4-SESSIONS-DOMAINS-R2 — exact conditions before it may become an integration feeder

`P4-SESSIONS-DOMAINS-R2` is **not reviewed as complete here**. Its active contract is based on verified P4-SESSION-BOUNDARY head `41269235243f836a2575de3f306ebb4ca342cad8`. Before the orchestrator promotes it to an integration feeder, require all of the following:

1. **Exact ancestry:** the implementation must descend from `41269235243f836a2575de3f306ebb4ca342cad8` and preserve the PR #141 boundary unchanged unless a separately reviewed correction is required.
2. **Exactly six durable fields:** durable session persistence may contain only `id`, `token`, `project`, `scheme`, `simulatorUDID`, and `createdAt`.
3. **No rejected aggregate recreation:** no `record_json`, `stream_state`, whole legacy session blob, `revision`, `updatedAt`, `stream`, `build`, logs, orientation, `remoteBaseUrl`, local/preview/websocket URL, PID, port, process identity, runtime claim, worker/engine state, or other transient/presentation field may become durable SQLite ownership.
4. **Projection-before-persistence:** legacy mixed records must pass through `projectDurableSession()` before import, repository replacement, or durable comparison. `parseDurableSession()`/the frozen boundary must be the field fence rather than a parallel ad-hoc allowlist that can drift into wider ownership.
5. **Bounded schema fragment only:** the worker may expose the required session table/index/schema statements or fragment, but it must not edit the global SQLite schema version, migration order, or shared migration list. The orchestrator composes that fragment serially.
6. **Repository boundary:** the repository abstraction/implementation operates on the six-field durable type only. It must not accept/publish the presentation join or legacy aggregate as a writable repository record.
7. **One writable truth:** current JSON/session compatibility state remains production-authoritative throughout the feeder. No SQLite authority switch, permanent dual-write, legacy deletion, or rollback-window expiry is allowed.
8. **Exact legacy lock identity:** locked snapshot/import must reuse `createSessionLegacyProcessIdentity`, which is the exact `createDarwinLegacyProcessIdentity` semantics: `/bin/ps -p <pid> -o lstart=` with trimmed Darwin start token. PID existence alone is forbidden.
9. **PID-reuse characterization:** tests must prove matching PID+start token remains live and same-PID/different-start-token is not the owner. Malformed/unverifiable ownership must fail closed; do not invent a weaker fallback in migration code.
10. **Lock lifetime:** source snapshot/fingerprint and any backup/import/checkpoint mutation derived from that snapshot must remain ordered under the compatible legacy lock protocol so a live legacy writer cannot race the migration evidence.
11. **Runtime-only mismatch immunity:** strong characterization must mutate only runtime/presentation fields (including nested stream PID/port/URLs/raw claims/state, build/log/orientation/remote URL, and mixed revision/updatedAt churn) and prove the durable projection/shadow comparison still matches.
12. **Durable mismatch sensitivity:** each durable-field change that affects the six-field record must be detectable by the durable shadow comparison without comparing runtime-only data.
13. **Restart/idempotency:** interrupted/repeated import cannot duplicate sessions, and a repeated already-current import is a no-op against durable rows/checkpoint state. Malformed durable input fails safely and does not partially publish.
14. **Persisted-row proof:** tests must inspect persisted rows/projections and prove runtime/process fields are absent, not merely ignored by a public read projection.
15. **Rollback/readability preserved:** legacy session state/readers needed for the rollback window remain intact and readable; the feeder does not delete or rewrite legacy state merely because SQLite shadow data exists.
16. **No red-zone expansion:** no central helper/CLI authority routing, root package/compiler policy, global schema/version/order, canonical roadmap/registry/progress/current handoff, or runtime/process persistence change is taken by the worker.
17. **Verification:** focused durable projection/repository/import/shadow/lock/restart tests, architecture/types/lint/format, full unchanged `npm run check`, and exact-head hosted Verify must pass. Genuine persistent-Mac migration/rollback evidence remains separately classified if not available in hosted CI.
18. **Integration handoff:** return exact schema fragment/statements, repository/import/shadow seams, verification SHA, and shared composition requests to the orchestrator; do not self-integrate or self-select SQLite authority.

A Sessions R2 result that persists even one rejected runtime/mixed field, uses PID-only locking, edits global schema order, or introduces a second writable session truth is a stop condition rather than a minor correction.

## Recommended serialized Phase 4 integration order

The feeder implementations were developed in parallel, but their canonical composition should be deliberately serial:

1. **P4-SESSION-BOUNDARY — PR #141** at `41269235243f836a2575de3f306ebb4ca342cad8`. Preserve this boundary before any session repository work.
2. **P4-DEVICE-CUTOVER-FIX provider — PR #139** at `d0b88d5b4f9bf616ee0edfca26d5f7a75290412c`. Establish the accepted device migration/export/rollback vocabulary while keeping authority legacy.
3. **P4-UPGRADE-EVIDENCE-FIX consumer — PR #142** at `ec7b909199eea5adc62f4114b74463ad7f1d4c05`. Apply after the provider and rerun its previous-release assertions against the combined provider ancestry.
4. **P4-DIAGNOSTICS — PR #130** at `5313b17d1949ceced7830034c5f46e3ac0581baa`. Preserve its support/redaction fields as the only product diagnostic schema; central probe/doctor composition remains integration-owned.
5. **P4-ARTIFACT-EXECUTION-R2 — PR #140 source** at `c8edbb57b94dfb291a7cada84ae6a097408352cc`, followed by the **PR #143 regression test semantics**. Re-home the `package.json` registration into the orchestrator-owned integration commit per W2-P2-01. Keep historical apply unwired/explicit until the dedicated integration decision and real-user destructive evidence gate.
6. **P4-SESSIONS-DOMAINS-R2**, only after it satisfies every condition above and becomes exact-head hosted green. Preserve the PR #141 boundary and compose its schema fragment in the integration lane rather than importing a worker-owned global schema edit.
7. **P4-INTEGRATION shared schema/composition pass.** Serially compose global SQLite migration order, repository construction, diagnostic probes, compatibility readers, helper/CLI surfaces, and authority routing. Run the combined full Verify after each red-zone composition cluster where practical.
8. **Authority/cutover and rollback evidence last.** Only after combined shadow parity, previous-release upgrade/restart/rollback evidence, corruption/busy handling, and required persistent-Mac proof may the orchestrator consider changing the current recorded authority. Legacy readers/state remain available through the defined rollback window. Historical artifact maintenance remains explicit operator action only; no startup/background orphan/manual-review cleanup is authorized.

This order intentionally separates feeder acceptance from authority transition. Individually green branches are inputs; only the combined canonical Phase 4 head can satisfy the Phase 4 gate.

## Final verdict

- **All Wave 1 findings closed:** yes, at the feeder/control-plane level reviewed here.
- **Completed Wave 2 feeders may enter integration:** yes, serially; there is no remaining P0/P1 blocker. W2-P2-01 must be resolved by orchestrator-owned package composition rather than accepting the root package edit as worker policy.
- **P4-SESSIONS-DOMAINS-R2:** still active and not accepted by this audit. It becomes eligible only after the exact durable-only, lock-identity, idempotency/shadow, no-two-truth, no-red-zone, and exact-head verification conditions above are proven.
- **Phase 4 complete:** no. Shared schema/composition, authority routing, integrated rollback/readability, persistent environment evidence, and the Phase 4 gate remain.
