# Architecture Parallel Wave 1 Audit

Status: **independent pre-integration audit**
Auditor role: **WAVE1 architecture auditor; not an implementation worker**
Frozen dispatch base: `38eee4bfb1eabc2184d92aa3e52fee28b139cbf5`
Assigned branch: `agent/arch-ws-WAVE1-AUDIT-independent-review`
Target integration branch: `agent/architecture-consolidation-program-orchestration`

## Executive result

The first parallel wave **must not continue unchanged**.

No P0 issue was found in the frozen baseline. The baseline still preserves JSON device-build authority and the read-only character of the Phase 4Z3–4Z5 historical artifact audit. However, the current parallel graph has three P1 stop-condition hazards that require orchestrator dependency/scope correction before the affected worker results can be accepted:

1. `P4-ARTIFACT-EXECUTION` can build mutating historical `plan/apply` behavior on top of an audit result that has no authoritative build revision, source epoch, or equivalent freshness proof. A stale plan can delete artifacts that became protected after inspection.
2. `P4-SESSIONS-DOMAINS` is implementation-ready even though `SessionStore` persists durable session identity and process/runtime ownership in the same JSON record. A whole-record SQLite migration would violate ADR-0003 and can create two writable truths.
3. The session store uses the exact Darwin `/bin/ps ... lstart` process-start token in its legacy lock protocol, but the session workstream does not declare the already-proven compatible identity adapter as a migration prerequisite. A generic or PID-only lock identity can misclassify a live owner during PID reuse.

Three P2 findings require explicit ownership/dependency reconciliation: device-cutover versus upgrade migration fixtures, Phase 6 classifier-boundary work versus Phase 7 analyzer-protocol preparation, and Phase 4 diagnostic semantics versus Phase 10 diagnostic-bundle/report structure.

| Severity | Count |
| --- | ---: |
| P0 | 0 |
| P1 | 3 |
| P2 | 3 |
| P3 | 0 |

## Audit basis

The audit read the active control plane at the frozen dispatch SHA:

- `AGENTS.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_INVARIANTS.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_EXECUTION_GUIDE.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_CHECKPOINT_PROTOCOL.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_BATCHED_EXECUTION_AMENDMENT.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PARALLEL_EXECUTION_AMENDMENT.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PARALLEL_ROADMAP.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_WORKSTREAM_REGISTRY.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_AGENT_PROTOCOL.md`
- ADRs `0001` through `0005`
- all current contracts under `docs/internal/plans/workstreams/`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PROGRESS.md`
- `docs/internal/plans/NEXT_AGENT_HANDOFF_ARCHITECTURE_CONSOLIDATION_CURRENT.md`

The audit also inspected the frozen repository implementation and Phase 2–4 history/surfaces relevant to this wave: current session persistence and locking, live-reload classification, device-build migration/shadow composition, pairing cutover/rollback precedent, Phase 4Z3–4Z5 artifact audit code, package verification registration, and the worker contracts that touch those seams.

Environment note: this auditor runtime did not expose the user's local checkout and its local container could not resolve GitHub. The assigned remote branch was independently verified identical to the frozen dispatch SHA and used as the isolated audit workspace through the GitHub connector. No local-worktree command result is claimed here.

## Findings

### W1-P1-01 — Historical artifact apply lacks a required freshness/epoch contract

**Severity:** P1

**Category:** data loss / stale decision / destructive operation

**Affected workstreams:** `P4-ARTIFACT-EXECUTION`, `P4-INTEGRATION`; later `P10-RELIABILITY-HARNESS` should cover the corrected behavior in its evidence matrix.

#### Exact evidence

- `mac-helper/src/deviceBuildArtifactAuditService.js`
  - `createDeviceBuildArtifactAuditService()` exposes only `inspect()`.
  - `inspect()` reads current builds, invokes usage measurement, calls `planDeviceBuildArtifactAudit()`, and returns the read-only plan plus measurement metadata.
  - Its `BuildRecord` shape contains `id`, `state`, `liveReload.compilerReady`, and `artifacts.root`, but not authoritative `revision`, legacy source revision/hash, or another apply-time epoch.
- `mac-helper/src/deviceBuildArtifactAuditPlan.js`
  - `planDeviceBuildArtifactAudit()` and `planBuild()` classify a failed build's whole measured root as reclaimable.
  - Ready non-live builds can reclaim DerivedData/archive/result/scratch; ready live compiler builds protect DerivedData; ready install/export payloads stay protected.
  - The returned build plan records build ID, root, state, compiler-ready flag, policy, and sizes, but no authoritative build revision/source epoch or measurement identity suitable for a later destructive compare-and-delete.
- `docs/internal/plans/workstreams/P4-ARTIFACT-EXECUTION.md`
  - Assigns a new mutating historical maintenance core with bounded `plan/apply` interfaces consuming the canonical planner output.
  - Requires idempotency, containment, live-ready DerivedData/install-payload protection, and manual-review exclusion, but does not explicitly require authoritative state/root revalidation at apply time.
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PARALLEL_EXECUTION_AMENDMENT.md`
  - Requires historical deletion to be a separately reviewed explicit operator action and forbids invented startup/background historical cleanup.

#### Hazard

Inspection and application are separated in time. Between them, a build can advance revision, change state, become live-reload compiler-ready, gain a protected install payload, be retried/rebound, or have its artifact root replaced. A decision that was safe when inspected can become unsafe before deletion.

Path containment proves only that a target is inside the canonical artifact tree. It does not prove the target is still eligible under the current authoritative build state. If `apply()` treats an old audit object as deletion authority, a normal stale-plan race can delete currently protected artifacts.

#### Recommended orchestrator action

Do not accept a mutating historical `apply()` unless the destructive boundary proves freshness. Require the accepted implementation/integration to:

- re-read the authoritative JSON build record immediately before mutation;
- bind executable work to build ID plus authoritative build revision/source epoch;
- re-derive or verify the canonical artifact root and symlink/containment identity;
- re-run or revalidate the current retention decision from fresh state;
- refuse that build operation if state, revision, live-reload readiness, or root identity drifted;
- keep orphan/unbound/manual-review roots non-executable;
- make retries idempotent without treating a missing path as proof that the original plan was current;
- preserve explicit-operator-only historical cleanup; never schedule it at startup/background;
- require real-Mac dry-run plus disposable/canary destructive proof before product enablement, in addition to hosted repository tests.

If freshness requires a shared epoch/protocol or central composition change, that part is `P4-INTEGRATION` ownership, not feeder-worker ownership.

### W1-P1-02 — `sessions.json` mixes durable domain state with runtime/process ownership

**Severity:** P1

**Category:** two writable truths / wrong storage authority / process ownership

**Affected workstreams:** `P4-SESSIONS-DOMAINS`, `P4-INTEGRATION`; Phase 6 must continue treating live runtime ownership independently.

#### Exact evidence

- `mac-helper/src/sessionStoreBase.js`
  - `SessionStore.create()` persists durable/domain-like identity such as `id`, `token`, `project`, `scheme`, `simulatorUDID`, timestamps, and `revision` in the same record as runtime stream state.
  - The same persisted record includes `stream.state`, `stream.transport`, `stream.quality`, `stream.localUrl`, `stream.previewUrl`, `stream.wsUrl`, `stream.port`, `stream.pid`, `stream.raw`, and `stream.limitations`.
  - `SessionStore.save()` merges and republishes that combined record.
  - `validateStoredSession()` explicitly accepts `stream.port` and `stream.pid`, proving process/runtime ownership values are persisted, not merely transient in-memory fields.
- `docs/internal/adr/ADR-0003-sqlite-domain-state-filesystem-runtime.md` and the Phase 4 master-plan requirements
  - Durable transactional domain state belongs in SQLite.
  - Process ownership, runtime journals/leases/handoff, artifacts, sockets, cancellation markers, and analogous runtime authority remain filesystem concerns.
- `docs/internal/plans/workstreams/P4-SESSIONS-DOMAINS.md`
  - Is marked `READY` and owns session/remaining-domain repositories, compatibility/import fixtures, and shadow fixtures where prerequisites are stable.
  - Explicitly does not own process/runtime ownership state that ADR-0003 leaves on the filesystem.
  - Does not identify a frozen durable-only session projection that is already safe to migrate.

#### Hazard

A straightforward repository/importer that copies the current `SessionStore` record to SQLite would move PID/port/runtime endpoints/handoff/state into the durable database, violating ADR-0003. Keeping JSON runtime mutation alive while SQLite contains and mutates the same full record creates two writable truths. Making SQLite authoritative for the whole record makes the database an owner of wrong-process/runtime state.

The current JSON object therefore is not one storage-authority boundary. It must be decomposed semantically before transactional migration.

#### Recommended orchestrator action

- Treat the current-reader/writer and durable-vs-runtime projection inventory as a prerequisite deliverable.
- Do not accept a whole-`sessions.json` SQLite snapshot/repository.
- Freeze an explicit durable-session projection that excludes process ownership, runtime endpoints/handoff, active transport state, runtime raw metadata, and any other ADR-0003 filesystem authority.
- Keep the runtime projection on the filesystem with one writer/ownership model and define how durable/runtime identities join without dual-writing the same fields.
- Treat the shared projection/type/schema definition as orchestrator-owned integration work.
- Only after that boundary is frozen should session repository/import/shadow implementation be integration-ready.

The worker may continue characterization and may implement demonstrably durable subdomains whose boundaries are already stable. The whole-session migration lane is blocked until the split is explicit.

### W1-P1-03 — Session migration has an undeclared legacy lock-identity prerequisite

**Severity:** P1

**Category:** missing prerequisite / PID reuse / concurrent mutation

**Affected workstreams:** `P4-SESSIONS-DOMAINS`, `P4-INTEGRATION`; the reusable primitive already exists from Phase 4K device-build migration work.

#### Exact evidence

- `mac-helper/src/sessionStoreBase.js`
  - `SessionStore.withLock()` writes owner records containing `pid`, `startedAt: processStartIdentity()`, a nonce, and creation time.
  - `lockOwnerIsAlive()` requires `processStartedAt(owner.pid) === owner.startedAt` when the token exists.
  - `processStartedAt(pid)` executes exactly `/bin/ps -p <pid> -o lstart=` and compares the trimmed Darwin string.
- `mac-helper/src/infrastructure/darwinLegacyProcessIdentity.js`
  - `createDarwinLegacyProcessIdentity({ spawnSync })` adapts that exact legacy Darwin `lstart` representation into the generic `NodeLockManager` `{ startToken }` identity shape.
  - The comment names the device-build legacy lock because that was the workstream that introduced it, but the token representation is the same one required by the session lock above.
- `docs/internal/plans/workstreams/P4-SESSIONS-DOMAINS.md`
  - Owns legacy compatibility/import fixtures but does not declare the exact legacy process-start representation as a prerequisite.

#### Hazard

A migration reader that acquires the legacy session lock through a generic identity provider using a different token can conclude that a live owner is stale. PID-only fallback is worse because it cannot distinguish PID reuse. Either failure can let migration/import race a live session writer, causing inconsistent snapshots, lost updates, or wrong-process lock reclamation.

The parallel amendment treats wrong-process/process-ownership faults and P1 findings as stop conditions.

#### Recommended orchestrator action

- Add an explicit dependency from session migration to the exact legacy Darwin identity semantics already proven in Phase 4K.
- Reuse or safely generalize `createDarwinLegacyProcessIdentity()` instead of creating a second representation.
- Require session migration tests for a matching live `startedAt` token and a reused PID with a different token.
- Require source read, backup, import evidence, and any mutation that depends on the snapshot to remain inside the exact compatible lock lifetime.
- Reject PID-only migration locking.
- Keep final live composition orchestrator-owned.

If the adapter is renamed/generalized, do that as a bounded shared-infrastructure integration step; feeder workers should not fork competing identity adapters.

### W1-P2-01 — Device cutover and upgrade evidence overlap on migration/restart/rollback fixtures

**Severity:** P2

**Category:** overlapping workstream ownership / duplicated semantic harness

**Affected workstreams:** `P4-DEVICE-CUTOVER`, `P4-UPGRADE-EVIDENCE`, `P4-INTEGRATION`.

#### Exact evidence

- `docs/internal/plans/workstreams/P4-DEVICE-CUTOVER.md` owns deterministic migration fixtures, interruption/restart/idempotency tests, and focused migration/export/rollback fixtures.
- `docs/internal/plans/workstreams/P4-UPGRADE-EVIDENCE.md` assigns test fixtures and previous-release/package/service compatibility verification.
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_WORKSTREAM_REGISTRY.md` describes `P4-UPGRADE-EVIDENCE` as previous-release migration/rollback/crash-restart/package verification harnesses.

Both lanes can therefore independently define old-state fixtures, interruption points, rollback expectations, and restart success criteria even though the registry treats them as parallel READY work.

#### Hazard

Two fixture dialects can encode different migration epochs, schema assumptions, rollback windows, corruption behavior, or restart semantics. Two individually green PRs would then not prove one state machine, and the upgrade harness could accidentally validate behavior that the device cutover implementation does not own.

#### Recommended orchestrator action

- Make `P4-DEVICE-CUTOVER` the provider of device-domain migration/cutover fixture vocabulary and fault-injection semantics.
- Make `P4-UPGRADE-EVIDENCE` the black-box previous-release/archive/package/service harness that consumes those accepted semantics.
- Do not accept a competing device migration-state or rollback-state model from the upgrade lane.
- Keep purely packaging-oriented previous-release inputs upgrade-owned.
- Assert shared schema/composition/authority behavior against the integrated Phase 4 head rather than reimplementing it in either feeder.

`P4-UPGRADE-EVIDENCE` can continue package/history discovery independently. Its device-migration fixture contract should follow the accepted device-cutover semantics.

### W1-P2-02 — Phase 7 analyzer-protocol preparation depends on a Phase 6 classification seam that does not exist yet

**Severity:** P2

**Category:** missing dependency / cross-workstream protocol red zone

**Affected workstreams:** `P6-LIVE-DECOMP-PREP`, `P7-ANALYZER-PREP`; later Phase 6/7 integration.

#### Exact evidence

- `mac-helper/src/liveReload.js`
  - Current production classification still lives in the live-reload module.
  - `CLASSIFIER_VERSION = 1` and `LIVE_REASON_CODES` are defined there.
  - `classifyEditSet()` is the canonical edit-operation classifier.
  - `classifyEditFile()` and `classifySwiftSource()` own the current file/source decision logic.
  - There is no production `SwiftEditAnalyzer` implementation at the frozen base; that named boundary is still an ADR/master-plan target.
- `docs/internal/plans/workstreams/P6-LIVE-DECOMP-PREP.md`
  - Owns the Phase 6 responsibility graph for classification and related behavioral fixtures/proposed extraction packages.
- `docs/internal/plans/workstreams/P7-ANALYZER-PREP.md`
  - Owns analyzer protocol fixtures, differential corpus/tooling, degraded-mode cases, and a SwiftSyntax experiment.
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PARALLEL_EXECUTION_AMENDMENT.md`
  - Reserves cross-workstream protocol/schema definitions for the orchestrator by default.
  - Requires production analyzer replacement to follow the Phase 6 integration gate.

#### Hazard

If P7 freezes request/response fixture fields or shared analyzer types while P6 independently defines the classification extraction seam, both feeders can be correct in isolation but disagree on edit-set versus file granularity, normalization, reason-code ownership, unsupported/degraded behavior, or versioning. Choosing one at integration time would make a preparatory worker the de facto shared-protocol owner.

#### Recommended orchestrator action

- Let P6 characterize current classification and propose a boundary, but establish the canonical shared analyzer protocol only during Phase 6 integration/orchestrator work.
- Let P7 build the differential corpus, SwiftSyntax experiment, packaging feasibility work, degraded-mode cases, and adapter-local experimental fixtures now.
- Do not accept a P7 feeder definition as the authoritative cross-workstream production protocol.
- After Phase 6 freezes the analyzer seam, adapt P7 tooling/fixtures to that exact interface before Phase 7 implementation is accepted.
- Keep every potentially more-permissive SwiftSyntax result disabled until the required physical-device proof.

### W1-P2-03 — Phase 4 diagnostics and Phase 10 reliability preparation both claim report/bundle structure

**Severity:** P2

**Category:** overlapping reporting protocol / privacy-redaction ownership

**Affected workstreams:** `P4-DIAGNOSTICS`, `P10-RELIABILITY-HARNESS`; `P4-INTEGRATION` for product composition.

#### Exact evidence

- `docs/internal/plans/workstreams/P4-DIAGNOSTICS.md` assigns new support/reporting modules on top of the existing Phase 4Z4/4Z5 read-only observational architecture.
- `docs/internal/plans/workstreams/P10-RELIABILITY-HARNESS.md` assigns a diagnostic-bundle/report structure plus evidence taxonomy and reliability matrices.
- Existing Phase 4Z5 behavior deliberately emits a redacted/path-free, read-only artifact-audit doctor projection. Diagnostic field selection and redaction are therefore product privacy/support semantics, not just documentation formatting.
- The parallel amendment reserves cross-workstream protocol/schema definitions for the orchestrator by default.

#### Hazard

If P10 independently defines a diagnostic bundle payload while P4 is still creating product support/health projections, the project can end with two support schemas, inconsistent redaction, or a reliability harness that expects raw/private fields the product diagnostics intentionally refuse to expose. That either duplicates the support protocol or creates pressure to weaken the Phase 4 privacy boundary.

#### Recommended orchestrator action

- Make `P4-DIAGNOSTICS` the owner of product diagnostic/support fields, health semantics, redaction, and fail-safe behavior for Phase 4 state.
- Let `P10-RELIABILITY-HARNESS` define an evidence envelope/template that embeds or references accepted redacted diagnostic output as an opaque/versioned input.
- Do not let P10 define a competing product diagnostic schema.
- Return missing information discovered by P10 as an integration requirement rather than bypassing/redesigning P4 redaction on a prep branch.
- Reconcile the final P10 bundle/report after accepted P4 diagnostics are integrated.
- Apply the same provider/consumer rule to upgrade/package evidence: P10 aggregates final evidence; it does not recreate the Phase 4 upgrade harness as a second source of truth.

## Explicit no-finding areas

The audit records clean areas rather than manufacturing severity.

### Frozen production authority — no finding

No finding at the dispatch baseline. The device-build SQLite path remains diagnostic/shadow-only and the program records JSON as the production read/write authority. The Phase 4 contracts forbid independent authority activation, while final selectors/cutover/rollback expiry remain orchestrator-owned.

Acceptance condition: any worker PR that changes an authority selector, helper composition root, legacy deletion, or shared schema outside its contract becomes a new finding and should be returned even if focused tests pass.

### Existing pairing cutover/rollback precedent — no new finding

No new finding in the pairing precedent inspected here. `mac-helper/src/persistence/pairingCutoverCoordinator.js` performs preparation/import/activation as a synchronous locked operation and validates source/projection evidence before authority activation. Device/session workers should reuse matching semantics rather than invent policy. The precedent itself does not authorize a feeder branch to activate production authority.

### Existing Phase 4Z3–4Z5 artifact audit privacy/read-only boundary — no baseline finding

No finding in the existing read-only audit. `createDeviceBuildArtifactAuditService()` exposes only `inspect()`, and Phase 4Z5 intentionally projects redacted/path-free operator information. W1-P1-01 applies to the new mutating execution lane, not to the current observational audit.

### Phase 3 public/private route authorization — no Wave 1 finding

No new authorization finding was identified. The current control plane records completed Phase 3 route-authorization/public-gateway matrix proof, and no Wave 1 feeder contract grants authority to broaden public HTTP exposure. A worker touching public/private route composition without explicit ownership is red-zone/scope drift.

### P5 preload inventory preparation — no finding

No finding in `P5-PRELOAD-INVENTORY`. It is correctly preparatory: current preload/runtime-patch/call-site inventory and characterization can run early, while production removal remains Phase 5/checkpoint-2 gated.

### P8 companion preparation — no finding

No finding in `P8-COMPANION-PREP`. It is a behavior-preserving characterization/ownership exercise under ADR-0005 and does not own production feature cutover, helper protocol redesign, or UI redesign in this wave.

### P9 consolidation inventory — no finding

No finding in `P9-CONSOLIDATION-INVENTORY`. Its explicit current/canonical versus historical-retain versus consolidate/delete-later classification is appropriate protection against erasing evidence. Phase 9 deletion is not authorized from this prep branch.

### P10 irreducible evidence honesty — no finding

No finding in the P10 contract's evidence-honesty rule. It explicitly says repository automation cannot substitute for persistent-Mac, physical-device, external-beta, or long-lived reliability evidence. W1-P2-03 concerns report-schema ownership, not evidence honesty.

### Hosted versus local/device gates — no control-plane waiver found

No finding that current amendments waive irreducible evidence. Exact-head hosted Verify remains necessary for product feeder work but is insufficient for authority activation, destructive historical cleanup, or final phase completion. The integrated Phase 4 head still requires persistent-machine/upgrade/rollback evidence; later analyzer permissiveness still requires physical-device proof; Phase 10 still requires real external/long-lived evidence.

## Required integration ordering and PR acceptance constraints

1. Review every worker PR against its exact frozen base and red-zone changed paths. Return feeders that edit canonical control-plane files, global schema ordering, helper/CLI composition roots, root package/compiler policy without authorization, authority selectors, rollback expiry, or legacy deletion.
2. Resolve W1-P1-01 before accepting a mutating artifact apply core. A plan-only/freshness-design slice can precede it; mutating execution must prove apply-time revalidation and remain operator-unwired.
3. For sessions, accept the durable-vs-runtime inventory first. Reject a whole-session SQLite repository. Freeze the durable projection under W1-P1-02, then require exact legacy lock compatibility under W1-P1-03, then accept bounded repositories/importers for the demonstrably durable projection.
4. Integrate proposed device/session/diagnostic schema changes serially in `P4-INTEGRATION`; feeder branches do not choose global SQLite migration version/order.
5. Accept bounded device migration/export/rollback abstractions only while non-authoritative. Freeze their fixture/state-machine semantics before treating the migration portion of `P4-UPGRADE-EVIDENCE` as authoritative evidence.
6. Accept upgrade package/release-history discovery independently. Migration/crash/restart/rollback checks must consume accepted/integrated Phase 4 behavior. Persistent-Mac previous-release package/service evidence remains a final gate, not a hosted-test substitute.
7. Integrate product diagnostic/redaction semantics before Phase 10 finalizes its diagnostic evidence envelope. Diagnostics remain observational and cannot become a second writer or repair path.
8. Only the orchestrator integrates Phase 4 schema, central composition, authority sequencing, rollback window, and eventual finalization. Re-run the complete exact-head hosted gate on that integrated head and collect required persistent-machine/upgrade evidence before recording Phase 4 completion.
9. P5 preparation can continue; production preload removal remains Phase 5/checkpoint-2 gated.
10. P6/P7 corpus and characterization can continue concurrently, but Phase 6 integration must freeze the canonical classifier/analyzer seam before P7 protocol fixtures become canonical.
11. P8/P9/P10 preparation can continue within non-production contracts. P10 consumes accepted diagnostic/upgrade evidence rather than becoming a second protocol owner.
12. Evaluate checkpoints only on integrated canonical phase heads, never on a collection of individually green worker PRs.

## Worker-PR review checklist derived from this audit

For each incoming Wave 1 PR, the orchestrator should explicitly answer:

- Is the exact parent still `38eee4bfb1eabc2184d92aa3e52fee28b139cbf5` or an explicitly authorized dependency head?
- Did the worker touch a red-zone file or define a cross-workstream schema/protocol?
- Does any repository make JSON and SQLite writable for the same field/domain at once?
- Does a session repository include `stream.pid`, runtime transport endpoints/state, runtime raw metadata, or another filesystem/process-ownership field?
- Does session migration use the exact Darwin `ps -o lstart=` identity semantics and refuse PID-only liveness?
- Does artifact deletion revalidate current authoritative revision/state/root policy at apply time rather than trust an old inspection object?
- Are manual-review/orphan/unbound artifact roots still impossible to execute automatically?
- Does `P4-UPGRADE-EVIDENCE` consume device migration fixture/state semantics rather than redeclare them?
- Does `P4-DIAGNOSTICS` remain read-only, redacted, and fail-safe?
- Does `P10-RELIABILITY-HARNESS` treat product diagnostics as an input rather than define a second product report schema?
- Does P7 tooling avoid claiming production analyzer-protocol ownership before Phase 6 integration?
- Are exact-head hosted checks recorded for product work, with local/device/external evidence separately identified rather than implied?

## Wave decision

**The wave cannot continue unchanged.**

Unaffected preparatory lanes can continue under their non-production constraints, and independent package/history/inventory/corpus work can proceed. Before affected worker PRs are accepted, the orchestrator should amend the dependency/acceptance graph to:

- block mutating historical artifact execution until freshness/revalidation is explicit;
- make session durable/runtime projection separation and exact legacy lock identity prerequisites to session migration;
- make device migration fixtures the provider for upgrade migration evidence;
- make Phase 6 integration the provider of the canonical analyzer protocol for Phase 7;
- make Phase 4 diagnostics the provider of product diagnostic/redaction semantics for Phase 10.

No worker scope is fixed by this audit branch; these are orchestrator reconciliation requirements.
