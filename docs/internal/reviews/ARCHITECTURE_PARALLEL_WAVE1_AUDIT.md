# Architecture Parallel Wave 1 Audit

Status: **independent pre-integration audit**  
Auditor role: **WAVE1 architecture auditor; not an implementation worker**  
Frozen dispatch base: `38eee4bfb1eabc2184d92aa3e52fee28b139cbf5`  
Assigned branch: `agent/arch-ws-WAVE1-AUDIT-independent-review`  
Target integration branch: `agent/architecture-consolidation-program-orchestration`

## Executive result

The first parallel wave **must not continue unchanged**.

No P0 issue was found in the frozen baseline, and the current baseline itself still preserves JSON device-build authority and the read-only character of the 4Z3–4Z5 historical artifact audit. However, the parallel graph contains three P1 stop-condition hazards that require orchestrator scope/dependency corrections before the affected worker outputs can be accepted:

1. `P4-ARTIFACT-EXECUTION` is allowed to build mutating `plan/apply` behavior on top of an audit result that currently has no authoritative build revision, source epoch, or freshness proof. Executing a stale historical plan can delete artifacts that became protected after inspection.
2. `P4-SESSIONS-DOMAINS` is marked implementation-ready even though the current `SessionStore` persists durable session identity and process/runtime ownership fields in the same JSON record. A whole-record SQLite migration would violate ADR-0003 and can create two writable truths for runtime state.
3. The same session-state store uses an exact Darwin `/bin/ps ... lstart` process-start token in its lock owner protocol. The session workstream does not declare the already-proven legacy process-identity adapter as a prerequisite. Generic or PID-only migration locking can misclassify a live lock during PID reuse.

Three additional P2 findings require explicit ownership/dependency reconciliation: device-cutover versus upgrade fixtures, Phase 6 classification versus Phase 7 analyzer protocol ownership, and Phase 4 diagnostics versus Phase 10 diagnostic/report structure ownership.

Severity totals:

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
- every contract currently under `docs/internal/plans/workstreams/`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PROGRESS.md`
- `docs/internal/plans/NEXT_AGENT_HANDOFF_ARCHITECTURE_CONSOLIDATION_CURRENT.md`

The audit then inspected the frozen repository implementation and the Phase 2–4 history/surfaces relevant to the wave, including current session persistence, live-reload classification, device-build migration/shadow composition, pairing cutover/rollback precedent, 4Z3–4Z5 artifact audit code, package verification registration, and the relevant worker contracts.

Environment note: this auditor runtime did not expose the user's local checkout and its local container could not reach GitHub. The assigned remote branch was independently verified to be exactly identical to the frozen dispatch SHA and was used as the isolated audit workspace through the GitHub connector. No local-worktree command result is claimed in this report.

## Findings

### W1-P1-01 — Historical artifact `apply` lacks a required freshness/epoch contract

**Severity:** P1  
**Category:** data loss / stale decision / destructive operation  
**Affected workstreams:** `P4-ARTIFACT-EXECUTION`, `P4-INTEGRATION`; later `P10-RELIABILITY-HARNESS` evidence should cover the corrected behavior.

#### Evidence

`mac-helper/src/deviceBuildArtifactAuditService.js` defines `createDeviceBuildArtifactAuditService()` with an `inspect()`-only surface. `inspect()`:

1. calls `listBuilds()`;
2. measures filesystem usage;
3. calls `planDeviceBuildArtifactAudit()`; and
4. returns the read-only plan plus measurement metadata.

The build shape used by that service includes `id`, `state`, `liveReload.compilerReady`, and `artifacts.root`, but **does not carry the authoritative device-build `revision`** or another source epoch into the plan.

`mac-helper/src/deviceBuildArtifactAuditPlan.js` / `planDeviceBuildArtifactAudit()` and `planBuild()` classify a failed build's **whole measured root** as reclaimable and classify ready non-live/live components according to the 4Z2 policy. The returned plan records state/policy/size/root information, but has no build revision, source revision/hash, measurement digest, or apply-time freshness token.

`docs/internal/plans/workstreams/P4-ARTIFACT-EXECUTION.md` explicitly assigns a new mutating maintenance core with `plan/apply` interfaces consuming the canonical planner output. It requires idempotency, containment, protected live-ready DerivedData/install payloads, and manual-review exclusion, but does not explicitly require re-reading authoritative build state or invalidating a plan when the build/root changed after inspection.

The parallel amendment separately requires historical deletion to be an explicit reviewed operator action, but operator intent alone does not make a stale plan safe.

#### Hazard

Inspection and application are necessarily separated in time. Between them, a build can change revision/state, become live-reload compiler-ready, gain a protected install payload, be retried/rebound, or have its artifact tree replaced. A previously safe `failedWholeRoots` or non-live-intermediate decision can therefore become unsafe.

If `apply()` treats the prior audit object as deletion authority, a normal stale-plan race can delete data the current policy would protect. Path containment prevents deletion outside the canonical root, but does not prove the target is still eligible **inside** that root.

#### Required orchestrator action

Do not accept a mutating historical `apply()` unless it proves freshness at the destructive boundary. Require the implementation/integration contract to do all of the following before the first delete:

- re-read the authoritative JSON build record;
- bind the plan to build ID **and authoritative build revision/source epoch**;
- re-derive or verify the canonical artifact root and symlink/containment identity;
- re-run/revalidate the relevant current retention decision against fresh state;
- refuse the complete build operation if state/revision/live-reload readiness/root identity drifted;
- keep orphan/unbound/manual-review roots non-executable;
- make retries idempotent without treating a missing path as proof that the original plan was current;
- preserve the parallel amendment's explicit-operator-only rule; no startup/background historical cleanup;
- require a real-Mac dry-run and disposable/canary destructive proof before product enablement, in addition to hosted tests.

If those guarantees require a shared epoch/protocol or central composition change, that part belongs to `P4-INTEGRATION`, not the feeder worker.

---

### W1-P1-02 — `sessions.json` mixes durable domain state with runtime/process ownership, so the session repository is not yet a single migratable projection

**Severity:** P1  
**Category:** two writable truths / wrong storage authority / process ownership  
**Affected workstreams:** `P4-SESSIONS-DOMAINS`, `P4-INTEGRATION`; Phase 6 must continue to treat live runtime ownership independently.

#### Evidence

`mac-helper/src/sessionStoreBase.js` / `SessionStore.create()` persists, in the same session record, durable-looking session identity and runtime state. The persisted record includes:

- durable/domain-like fields such as `id`, `token`, `project`, `scheme`, `simulatorUDID`, `createdAt`, `updatedAt`, and `revision`;
- `stream.state`, `stream.transport`, `stream.quality`;
- runtime endpoints `stream.localUrl`, `stream.previewUrl`, `stream.wsUrl`;
- runtime ownership values `stream.port` and `stream.pid`;
- `stream.raw` transport/runtime metadata and `stream.limitations`;
- mutable build/stream state subsequently merged by `SessionStore.save()`.

`validateStoredSession()` explicitly accepts `stream.port` and `stream.pid`, proving these are part of the persisted JSON record rather than transient in-memory fields.

ADR-0003 and the master plan require SQLite for durable transactional domain state while process ownership, runtime journals/leases/handoff, and similar runtime authority remain filesystem concerns.

`docs/internal/plans/workstreams/P4-SESSIONS-DOMAINS.md` is `READY` and assigns session repositories/importers/shadow work, while also saying the worker does **not** own process/runtime ownership state that ADR-0003 intentionally keeps on the filesystem. It asks the worker to classify every domain, but it does not identify an already-stable canonical durable-session projection that can safely be implemented now.

#### Hazard

A straightforward repository/importer that serializes the existing `SessionStore` record into SQLite would move `pid`/port/transport handoff/runtime state into the durable database, violating ADR-0003. Keeping JSON runtime mutation alive while SQLite also contains/updates the same full session record would create two writable truths. Conversely, making SQLite authoritative for the whole record would make the database an owner of wrong-process/runtime state.

The current JSON shape therefore has to be **decomposed semantically before it can be migrated transactionally**; “session” is not presently one storage authority boundary.

#### Required orchestrator action

Narrow `P4-SESSIONS-DOMAINS` acceptance as follows:

1. Treat the exact current-reader/writer and durable-vs-runtime projection inventory as a prerequisite deliverable.
2. Do not accept a whole-`sessions.json` SQLite snapshot/repository.
3. Require an explicit durable-session projection that excludes process ownership, runtime endpoints/handoff, active transport state, runtime raw metadata, and any other ADR-0003 filesystem authority.
4. Keep the runtime projection on the filesystem with one writer/ownership model; define how durable and runtime identities join without dual-writing the same fields.
5. Make any cross-domain projection/type/schema definition an orchestrator-owned integration decision because it becomes a shared protocol/schema.
6. Only after that boundary is frozen should repository/import/shadow implementation be considered integration-ready.

The worker may continue characterization and implement demonstrably durable subdomains whose boundaries are already stable, but the session whole-record migration lane is blocked until this split is explicit.

---

### W1-P1-03 — Session migration has an undeclared legacy lock-identity prerequisite

**Severity:** P1  
**Category:** missing prerequisite / PID reuse / concurrent mutation  
**Affected workstreams:** `P4-SESSIONS-DOMAINS`, `P4-INTEGRATION`; reusable primitive comes from the already-proven Phase 4K device-build work.

#### Evidence

`mac-helper/src/sessionStoreBase.js` / `SessionStore.withLock()` writes an owner record containing:

- `pid`;
- `startedAt: processStartIdentity()`;
- a nonce and creation time.

`lockOwnerIsAlive()` requires `processStartedAt(owner.pid) === owner.startedAt` when the token exists. `processStartedAt()` executes exactly:

`/bin/ps -p <pid> -o lstart=`

and compares the trimmed Darwin string. This is the same PID-reuse-safe representation that previously blocked device-build migration composition.

`mac-helper/src/infrastructure/darwinLegacyProcessIdentity.js` / `createDarwinLegacyProcessIdentity()` was added specifically to adapt that exact legacy `lstart` representation into the generic `NodeLockManager` `startToken` shape. Its comment currently names the device-build lock, but the underlying representation is equally required by the session legacy lock shown above.

`docs/internal/plans/workstreams/P4-SESSIONS-DOMAINS.md` does not declare this adapter/identity representation as a prerequisite even though it owns legacy compatibility/import fixtures and transaction/idempotency work.

#### Hazard

A migration reader that acquires the legacy session lock through a generic process-identity provider with a different token representation can conclude that a live owner is stale. A PID-only fallback is worse: it cannot distinguish PID reuse. Either failure can permit migration/import to race a live session writer, producing inconsistent snapshots, lost updates, or wrong-process lock reclamation.

The parallel amendment names wrong-process/process-ownership faults and P1 issues as stop conditions.

#### Required orchestrator action

Add an explicit dependency from the session migration lane to the exact legacy Darwin identity semantics already proven in Phase 4K:

- reuse or safely generalize `createDarwinLegacyProcessIdentity()` rather than inventing a second representation;
- require session migration lock tests for a matching live `startedAt` token and a reused PID with a different token;
- require the entire legacy source read/backup/import evidence operation to remain inside the exact compatible lock lifetime;
- reject PID-only migration locking;
- keep final live composition orchestrator-owned.

If the adapter is renamed/generalized, do that only in a bounded shared-infrastructure integration step; workers should not fork competing identity adapters.

---

### W1-P2-01 — `P4-DEVICE-CUTOVER` and `P4-UPGRADE-EVIDENCE` overlap on migration/restart/rollback fixtures despite being dispatched as independent READY lanes

**Severity:** P2  
**Category:** overlapping workstream ownership / duplicated semantic harness  
**Affected workstreams:** `P4-DEVICE-CUTOVER`, `P4-UPGRADE-EVIDENCE`, `P4-INTEGRATION`.

#### Evidence

The canonical registry describes:

- `P4-DEVICE-CUTOVER`: “device-build cutover/rollback/export machinery, initially non-authoritative”;
- `P4-UPGRADE-EVIDENCE`: “previous-release migration/rollback/crash-restart/package verification harnesses”.

`docs/internal/plans/workstreams/P4-DEVICE-CUTOVER.md` explicitly owns:

- deterministic migration fixtures;
- interruption/restart/idempotency tests;
- focused migration/export/rollback fixtures.

`docs/internal/plans/workstreams/P4-UPGRADE-EVIDENCE.md` assigns test fixtures and verification harnesses for previous-release/package/service compatibility. The registry further makes migration/rollback/crash-restart part of its primary responsibility.

Those are not fully disjoint test semantics. Both lanes can independently define old-state fixtures, interruption points, rollback expectations, and restart success criteria.

#### Hazard

Two fixture dialects can encode subtly different migration epochs, schema expectations, rollback windows, corruption handling, or restart semantics. Individually green PRs would then not compose into one trustworthy Phase 4 gate; the upgrade harness could prove a different state machine than the device cutover modules actually implement.

#### Required orchestrator action

Make the provider/consumer edge explicit before accepting both PRs:

- `P4-DEVICE-CUTOVER` owns the **device-domain migration/cutover fixture vocabulary and fault-injection semantics** used to validate its modules.
- `P4-UPGRADE-EVIDENCE` owns the **black-box release/package/service upgrade harness** and may consume those canonical device-domain fixtures/expected states.
- `P4-UPGRADE-EVIDENCE` must not create a competing device migration-state model or second rollback-state fixture definition.
- Previous-release archive/package fixtures that are purely packaging inputs remain upgrade-owned.
- Shared composition/schema/authority expectations are asserted against the integrated Phase 4 head, not reimplemented in either feeder.

`P4-UPGRADE-EVIDENCE` can continue independent package/history discovery immediately, but its device-migration fixture contract should follow the accepted device-cutover semantics.

---

### W1-P2-02 — Phase 7 analyzer protocol preparation depends on a Phase 6 classification seam that does not exist yet

**Severity:** P2  
**Category:** missing dependency / cross-workstream protocol red zone  
**Affected workstreams:** `P6-LIVE-DECOMP-PREP`, `P7-ANALYZER-PREP`; later Phase 6/7 integration.

#### Evidence

The current production classifier still lives directly inside `mac-helper/src/liveReload.js`:

- `CLASSIFIER_VERSION = 1`;
- `classifyEditSet()` is the canonical internal edit-operation classifier;
- `classifyEditFile()` reads source and delegates;
- `classifySwiftSource()` computes the current declaration-surface decision and emits `LIVE_REASON_CODES`.

There is no production `SwiftEditAnalyzer` implementation at the frozen base; the named analyzer boundary is still an ADR/master-plan target rather than a current code seam.

`docs/internal/plans/workstreams/P6-LIVE-DECOMP-PREP.md` assigns the Phase 6 worker responsibility mapping for **classification** plus behavioral fixtures and proposed extraction ownership.

`docs/internal/plans/workstreams/P7-ANALYZER-PREP.md` simultaneously assigns the Phase 7 worker **analyzer protocol fixtures**, differential corpus/tooling, degraded-mode cases, and a SwiftSyntax experiment.

The parallel amendment declares cross-workstream protocol/schema definitions orchestrator-owned red zones and states that production analyzer replacement follows Phase 6 integration.

#### Hazard

If P7 freezes request/response fixture fields or shared protocol types while P6 is independently defining the classification extraction seam, the two PRs can each be internally correct but disagree on normalization, reason-code ownership, edit-set versus file granularity, unsupported cases, versioning, or degraded behavior. Resolving that by picking one worker's protocol at integration time would turn a supposedly preparatory branch into de facto shared-protocol authority.

#### Required orchestrator action

Add the dependency explicitly:

- P6 may characterize the current classifier and propose the boundary, but the **canonical shared analyzer protocol is established only by the Phase 6 integration/orchestrator step**.
- P7 may build the differential corpus, SwiftSyntax experiment, packaging feasibility work, and adapter-local experimental fixtures now.
- P7 must not publish a cross-workstream production protocol/type/schema as authoritative from its feeder branch.
- After Phase 6 freezes the canonical analyzer seam, P7 fixtures/tooling must adapt to that exact interface before Phase 7 implementation is accepted.
- Keep every potentially more-permissive SwiftSyntax result disabled until the already-required physical-device proof.

This preserves useful parallel preparation without pretending the protocol dependency is disjoint.

---

### W1-P2-03 — Phase 4 diagnostics and Phase 10 reliability preparation both claim report/bundle structure

**Severity:** P2  
**Category:** overlapping reporting protocol / privacy-redaction ownership  
**Affected workstreams:** `P4-DIAGNOSTICS`, `P10-RELIABILITY-HARNESS`; `P4-INTEGRATION` for product composition.

#### Evidence

`docs/internal/plans/workstreams/P4-DIAGNOSTICS.md` assigns **new support/reporting modules** on top of the existing 4Z4/4Z5 read-only observational architecture.

`docs/internal/plans/workstreams/P10-RELIABILITY-HARNESS.md` assigns a **diagnostic-bundle/report structure** plus evidence taxonomy and reliability matrices.

The existing Phase 4Z5 product already exposes a deliberately redacted/path-free, read-only artifact-audit doctor projection, so diagnostic field selection and redaction are not merely documentation formatting; they are part of product support/privacy semantics.

The parallel amendment reserves cross-workstream protocol/schema definitions for the orchestrator by default.

#### Hazard

If P10 independently defines the diagnostic bundle payload while P4 is still creating the product support/health projections, the project can end with two support schemas, different redaction rules, or a reliability harness that expects private/raw fields the product diagnostics intentionally refuse to expose. That creates either duplication or pressure to weaken the Phase 4 privacy boundary later.

#### Required orchestrator action

Make ownership one-directional:

- `P4-DIAGNOSTICS` owns product diagnostic/support fields, health semantics, redaction, and fail-safe behavior for Phase 4 state.
- `P10-RELIABILITY-HARNESS` may define an **evidence envelope/template** that embeds or references the public/redacted Phase 4 diagnostic output as an opaque/versioned input; it must not define a competing product diagnostic schema.
- Missing information discovered by P10 is returned as an integration requirement, not obtained by bypassing/redesigning P4 redaction on the prep branch.
- Final P10 bundle/report structure should be reconciled after accepted P4 diagnostics are integrated.

The same rule should be used for upgrade/package evidence: P10 catalogs and aggregates final evidence; it does not recreate the Phase 4 upgrade harness as a second source of truth.

## Explicit no-finding areas

The audit intentionally records clean areas rather than manufacturing severity.

### Frozen production authority — no finding

No finding at the dispatch baseline. The current device-build SQLite path remains diagnostic/shadow-only and the current program documentation consistently records JSON as the production read/write authority. The Phase 4 worker contracts also forbid independent authority activation, and the parallel amendment reserves final selectors/cutover/rollback expiry for the orchestrator.

Acceptance caveat: a worker PR that changes an authority selector, helper composition root, legacy deletion, or shared schema despite its contract becomes a new finding and must be rejected even if its focused tests pass.

### Existing pairing cutover/rollback precedent — no new finding

No new finding in the existing pairing precedent inspected here. `mac-helper/src/persistence/pairingCutoverCoordinator.js` performs preparation/import/activation as a synchronous locked operation and validates source/projection evidence before authority activation. The device/session workers should reuse its semantics where they match rather than create new policy. Its existence does not authorize production cutover from a feeder branch.

### Existing 4Z3–4Z5 artifact audit privacy/read-only boundary — no baseline finding

No finding in the existing read-only audit itself. `deviceBuildArtifactAuditService` exposes only `inspect()` and 4Z5 intentionally projects redacted/path-free operator information. W1-P1-01 applies to the **new mutating execution lane**, not to the existing read-only audit.

### Phase 3 public/private route authorization — no Wave 1 finding

No new Wave 1 authorization finding was identified. The current control plane records the completed Phase 3 route authorization/public-gateway matrix proof, and none of the registered feeder contracts grants workers authority to broaden public HTTP exposure. Any worker touching public/private route composition without an explicit contract should be rejected as red-zone/scope drift.

### P5 preload inventory preparation — no finding

No finding in the contract. `P5-PRELOAD-INVENTORY` is correctly preparatory: it can inventory current preloads/call sites and add characterization/non-product fixtures, but cannot remove production compatibility behavior or claim checkpoint 2. Reject any production preload removal from this wave.

### P8 companion preparation — no finding

No finding in the contract. `P8-COMPANION-PREP` is a behavior-preserving characterization/ownership exercise under ADR-0005. It does not own production feature cutover, helper protocol redesign, or UI redesign in this wave.

### P9 consolidation inventory — no finding

No finding in the contract. It explicitly classifies current/canonical versus historical-retain versus consolidate/delete-later material and is therefore the correct phase to prevent cleanup from erasing evidence. No Phase 9 deletion should occur from the prep branch.

### P10 irreducible evidence claims — no finding

No finding in the contract's evidence honesty rule. It explicitly says repository automation cannot substitute for persistent-Mac, physical-device, external-beta, or long-lived reliability evidence. W1-P2-03 concerns report-schema ownership only.

### Hosted versus local/device gates — no control-plane waiver found

No finding that the current amendments waive irreducible evidence. Exact-head hosted Verify remains necessary for product feeder work, but it is not sufficient for authority activation/destructive historical cleanup/final phase completion. The integrated Phase 4 head still needs the persistent-machine/upgrade/rollback evidence required by the master plan and amendments; later analyzer permissiveness still needs physical-device proof; Phase 10 still needs real external/long-lived evidence.

## Required integration ordering and PR acceptance constraints

The orchestrator should use the following ordering when worker PRs arrive.

1. **Review every PR against its exact frozen base and red-zone changed paths first.** Reject/return any feeder that edits canonical control-plane files, global schema ordering, helper/CLI composition roots, root package/compiler policy without authorization, authority selectors, rollback expiry, or legacy deletion.
2. **Artifact execution:** resolve W1-P1-01 before accepting any mutating apply core. A plan-only/freshness-design slice may be accepted first; mutating execution must prove apply-time revalidation and remain operator-unwired.
3. **Sessions:** accept the inventory/durable-vs-runtime map first. Do not accept a whole-session SQLite repository. Resolve the durable projection boundary (W1-P1-02), then require exact legacy lock-identity compatibility (W1-P1-03), then accept bounded repositories/importers for the demonstrably durable projection.
4. **Shared Phase 4 schema:** integrate proposed device/session/diagnostic schema changes serially in `P4-INTEGRATION`; feeder branches must not choose global migration version/order independently.
5. **Device cutover:** accept bounded migration/export/rollback abstractions only while non-authoritative. Freeze their fixture/state-machine semantics before treating the migration portion of `P4-UPGRADE-EVIDENCE` as authoritative evidence (W1-P2-01).
6. **Upgrade evidence:** package/release-history discovery can be accepted independently; migration/crash/restart/rollback checks must consume the accepted/integrated Phase 4 behavior rather than duplicate it. Persistent-Mac and previous-release package/service evidence remains a final gate, not a hosted-test substitute.
7. **Diagnostics:** integrate product support/redaction semantics before Phase 10 finalizes any diagnostic bundle schema (W1-P2-03). Diagnostics remain observational and must not become a second state writer or repair path.
8. **Phase 4 composition/authority:** only the orchestrator integrates schema, central composition, authority sequencing, rollback window, and eventual finalization. Re-run the complete exact-head hosted gate on that integrated head and collect the required persistent-machine/upgrade evidence before Phase 4 completion is recorded.
9. **P5 preparation:** may continue in parallel, but production preload removal remains Phase 5 and checkpoint-2 gated.
10. **P6/P7 preparation:** corpus and characterization can continue concurrently, but the Phase 6 integration step must freeze the canonical classifier/analyzer seam before P7's protocol fixtures become canonical (W1-P2-02).
11. **P8/P9/P10 preparation:** may continue within their non-production contracts. P10 report/bundle work must consume accepted diagnostic/upgrade evidence rather than become a second protocol owner.
12. **Checkpoints:** evaluate only the integrated canonical phase heads, never the set of individually green worker PRs.

## Worker-PR review checklist derived from this audit

For each incoming Wave 1 PR, the orchestrator should explicitly answer:

- Is the exact parent still `38eee4bfb1eabc2184d92aa3e52fee28b139cbf5` or an explicitly authorized dependency head?
- Did the worker touch a red-zone file or define a cross-workstream schema/protocol?
- Does any new repository make JSON and SQLite writable for the same field/domain at once?
- Does a session repository include `stream.pid`, runtime transport endpoints/state, runtime raw metadata, or another filesystem/process-ownership field?
- Does any legacy session migration use an identity token other than the exact Darwin `ps -o lstart=` representation or fall back to PID-only liveness?
- Does artifact deletion revalidate current authoritative revision/state/root policy at apply time rather than trusting an old inspection object?
- Are manual-review/orphan/unbound artifact roots still impossible to execute automatically?
- Does `P4-UPGRADE-EVIDENCE` consume the device migration fixture/state semantics rather than re-declare them?
- Does `P4-DIAGNOSTICS` remain read-only, redacted, and fail-safe?
- Does `P10-RELIABILITY-HARNESS` treat product diagnostics as an input rather than define a second product report schema?
- Does P7 tooling avoid claiming ownership of the production analyzer protocol before Phase 6 integration?
- Are exact-head hosted checks recorded for product work, with local/device/external evidence clearly separated rather than implied?

## Wave decision

**The wave cannot continue unchanged.**

The unaffected preparatory lanes may continue under their existing non-production constraints, and independent package/history/inventory/corpus work can proceed. But the orchestrator should amend the dependency/acceptance graph before integrating worker PRs:

- block mutating historical artifact execution until freshness/revalidation is explicit;
- treat session durable/runtime projection separation and exact legacy lock identity as prerequisites to session migration implementation;
- make device migration fixtures the provider for upgrade migration evidence;
- make Phase 6 integration the provider of the canonical analyzer protocol for Phase 7;
- make Phase 4 diagnostics the provider of product diagnostic/redaction semantics for Phase 10.

No worker scope should be fixed by this audit branch; these are orchestrator reconciliation requirements.