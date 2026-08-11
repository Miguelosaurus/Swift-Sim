# Architecture Consolidation Progress

This is the compact execution ledger for the architecture consolidation program. Pull-request bodies, checkpoint reports, ADRs, and Git history retain the detailed implementation record. Phase rows record validated implementation commits; documentation-only final heads are recorded in the owning PR body after the final metadata commit.

The active execution control is [the batched-execution amendment](ARCHITECTURE_CONSOLIDATION_BATCHED_EXECUTION_AMENDMENT.md), authorized by Miguel on 2026-08-04. It preserves phase boundaries, rollback points, fail-closed behavior, mandatory checkpoint records, final Luna local verification, and final Miguel merge authorization while allowing provisional stacked work between checkpoints.

## Program status

| Phase | Scope | Status | PR or stack | Base | Validated implementation | Key residual |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Baseline and guardrails | Merged | [#23](https://github.com/Miguelosaurus/Swift-Sim/pull/23) | `4dfa15f` | `2a2239c`; merge `6f356df` | Existing debt is baselined and decrease-only |
| 1 | TypeScript and package foundation | Merged | [#24](https://github.com/Miguelosaurus/Swift-Sim/pull/24) | `6f356df` | `2151d35`; merge `820ff2e` | Mixed JS/TS transition remains; compiled `dist` is runtime output |
| 2 | Explicit infrastructure primitives | Checkpoint 1 hosted-green; draft stack unmerged | [#26–#33](https://github.com/Miguelosaurus/Swift-Sim/pull/33) | `820ff2e` | `d441798` | Weak delivery identity and unmigrated command/process call sites |
| 3 | Helper and HTTP decomposition | Partial implementation through corrective 3M; draft stack unmerged | [#34–#40, #56–#60, #63](https://github.com/Miguelosaurus/Swift-Sim/pull/63) | Phase 2 final metadata / `f21e344` | Corrective implementation `ba97946` | HTTP route families are extracted; lifecycle/reconciliation/process behavior, module-global runtime construction, and remaining CLI composition still prevent the Phase 3 gate |
| 4 | Repository interfaces and SQLite migration | Pairing rollback primitives plus device-build live optional SQLite shadow through 4U hosted-green; full phase incomplete and draft | [#41, #44–#50, #52–#54, #95–#99, #101–#112](https://github.com/Miguelosaurus/Swift-Sim/pull/112) | Phase 3G / `7367fa2` | Device-build shadow/security head `588aacc`; pairing E4 remains direct ancestor | Persistent local shadow evidence, device-build cutover/rollback, sessions/remaining domains, doctor/export/corruption, previous-release upgrade, and final Phase 4 gate remain required |
| 5 | Preload removal | Not started | — | — | — | Checkpoint 2 required before Phase 6 |
| 6 | Live reload module split | Not started | — | — | — | — |
| 7 | SwiftSyntax analyzer | Not started | — | — | — | Newly permissive cases remain disabled without physical proof |
| 8 | iOS companion feature architecture | Not started | — | — | — | Checkpoint 3 required before Phase 9 |
| 9 | Test, docs, and release consolidation | Not started | — | — | — | — |
| 10 | Product reliability proof | Not started | — | — | — | External-beta evidence cannot be manufactured by repository automation |

## Mandatory architecture checkpoints

| Checkpoint | Trigger | PR / implementation head | Repository review complete | Repository corrections complete | Deferred local gates captured | Provisional next phase authorized by amendment | Final Luna verification | Final Miguel merge authorization | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Phase 2 complete; before Phase 2 merge | PR #33 / `d441798` | Yes | Yes | Yes | Yes, Phase 3 after final metadata Verify | No | No | Hosted-green; stack remains draft and unmerged |
| 2 | Phase 5 complete; before Phase 6 | — | No | No | No | No | No | No | Pending |
| 3 | Phase 8 complete; before Phase 9 | — | No | No | No | No | No | No | Pending |

Checkpoint 1 records:

- [Canonical state report](checkpoints/CHECKPOINT_1_STATE.md)
- [Canonical independent-review prompt](checkpoints/NEXT_AGENT_PROMPT_CHECKPOINT_1_CURRENT_STATE.md)
- Dated audit snapshots remain beside the canonical files.
- Repository verdict: proceed provisionally under the batched-execution amendment.
- Remaining severity: P0 0, P1 0, P2 2, P3 1.
- Merge authorization: not granted; persistent-local/device evidence remains delegated to Luna.

The live Checkpoint 1 PR head is `f21e344ea18eb0a976630a4ce38cf52bf30a3f47`; `d441798` is the code implementation head. PR #33 metadata must keep those roles distinct.

## Current architecture metrics

| Metric | Phase 0 baseline | Current at Checkpoint 1 | Target |
| --- | ---: | ---: | ---: |
| Production source files | 74 | 95 | Responsibility-oriented modules without framework-shaped sprawl |
| Production JavaScript files | 67 | 79 | 0 canonical JS implementation files after migration, excluding intentional wrappers |
| Production TypeScript files | 0 | 9 | Canonical Node implementation |
| Production Swift files | 7 | 7 | Feature-organized |
| Named infrastructure ports | 0 | 10 | Stable narrow boundary |
| Preload/runtime-patch modules | 30 | 30 | 0 |
| Built-in monkey-patch evidence modules | 10 | 10 | 0 |
| Source-text implementation tests | 28 | 28 | 0 |
| Direct `child_process` production importer files | 28 | 28 | Approved composition/infrastructure owners only |
| Legacy destructive-filesystem importer files | 26 | 25 | 0 legacy owners |
| Dedicated destructive-filesystem infrastructure owners | 0 | 3 | Explicit stores only |
| Largest Node production file | 2,821 (`mac-helper/src/liveReload.js`) | 2,821 | <= 800 lines or ADR |
| Largest Swift production file | 2,562 (`Companion/SwiftSimCompanion/SessionStore.swift`) | 2,562 | <= 800 lines or ADR |
| Writable JSON domain-state candidates | 29 | 29 | 0 writable domain stores after migration window |
| Supported Node line | >=20 | 24.x | Supported pinned LTS |

Current audit at the PR #55 parent records 122 production files (104 JavaScript, 11 TypeScript, 7 Swift), 30 preload/runtime-patch entries, 28 source-text implementation tests, 28 direct child-process importers, and 27 writable JSON-state candidates. The table above remains the Checkpoint 1 snapshot rather than a claim that those counts describe the current tip.

## Phase 0 — Baseline and architectural guardrails

- Status: Merged
- Branch: `agent/architecture-consolidation-phase-0-guardrails`
- PR: [#23](https://github.com/Miguelosaurus/Swift-Sim/pull/23)
- Base SHA: `4dfa15ff76b5bd046f7ad02ee9f8d963d02d62cb`
- Validated implementation: `2a2239c1e49df83b8b75ddc42a363e73a11f0655`
- Merge commit: `6f356df3c1e1e91499b3d05efe4308337cc7ff6b`
- Date: 2026-08-04

### Outcome

- Added generated architecture inventory and immutable Git-history-backed baseline policy.
- Added decrease-only caps and exact ADR-backed/time-bounded exceptions for preload/runtime patches, process/filesystem authority, source-text tests, and oversized production files.
- Added event-safe pull-request/push history selection and extensive scanner bypass regressions.
- Added ADR-0001 through ADR-0005 and architecture navigation.
- Added the architecture gate to the authoritative verification workflow.
- Changed no product runtime behavior.

### Validation

- Architecture inventory was deterministic and passed its focused 28-test suite.
- Final source/release gate passed 456 tests.
- iOS companion tests passed 30/30.
- Post-merge Verify run `30920938939` passed on merge commit `6f356df3c1e1e91499b3d05efe4308337cc7ff6b`.

### Self-review

| Severity | Found | Fixed | Remaining |
| --- | ---: | ---: | ---: |
| P0 | 0 | 0 | 0 |
| P1 | 7 | 7 | 0 |
| P2 | 6 | 6 | 0 |
| P3 | 1 | 1 | 0 |

### Rollback and residuals

- Rollback: revert PR #23; no user state was touched.
- Existing preloads, direct infrastructure access, JSON stores, source-text tests, and oversized files remained deliberately baselined for later phases.
- The lexical inventory scanner remains documented and fail-closed for supported static forms; dynamic/computed forms require later AST-aware enforcement if introduced.

## Phase 1 — TypeScript and package foundation

- Status: Merged
- Branch: `agent/architecture-consolidation-phase-1-typescript-foundation`
- PR: [#24](https://github.com/Miguelosaurus/Swift-Sim/pull/24)
- Base SHA: `6f356df3c1e1e91499b3d05efe4308337cc7ff6b`
- Exact final PR head: `2151d35511dcefec2bef8bd4501560598581d629`
- Merge commit: `820ff2e2863e06eab908da70229c7991fd85c65c`
- Date: 2026-08-04

### Outcome

- Pinned Node 24, TypeScript 5.9.3, Node types, ESLint, and Prettier.
- Established strict NodeNext compilation with `allowJs`, emitted ignored `dist/`, no production runtime transpiler, and compiled package/Homebrew entrypoints.
- Added characterization-backed validators for actual session, build, pairing, invite, delivery, command, process, and runtime-journal records.
- Made source/compiled behavior, hermetic compiled execution, clean npm package installation, package-root resolution, and isolated Homebrew service lifecycle authoritative gates.
- Removed `skipLibCheck` and avoided broad lint/format rewrites.
- Merged the batched-execution amendment into Phase 1 before merge.

### Validation

- Local Node 24 gate passed strict types, formatting, lint, 457 source tests, compiled characterization, hermetic execution, package inspection/install, and safe Homebrew preflight.
- Isolated clean Homebrew install/service/restart proof passed.
- iOS companion tests passed 30/30.
- Exact-final-head Verify run `30943330191` passed at `2151d35511dcefec2bef8bd4501560598581d629`.

### Self-review

| Severity | Found | Fixed | Remaining |
| --- | ---: | ---: | ---: |
| P0 | 0 | 0 | 0 |
| P1 | 5 | 5 | 0 |
| P2 | 3 | 3 | 0 |
| P3 | 0 | 0 | 0 |

### Rollback and residuals

- Rollback: revert PR #24; no data migration occurred.
- Existing JavaScript remained canonical during the mixed-source transition.
- Source checkout wrappers require a build; shipped npm/Homebrew bins execute emitted JavaScript.
- A public tagged-release upgrade remained outside this phase.

## Phase 2 — Explicit infrastructure primitives

- Status: Implementation complete, Checkpoint 1 hosted-green, draft stack unmerged
- Base commit: `820ff2e2863e06eab908da70229c7991fd85c65c`
- Code implementation head: `d44179868fee4b62af5376b3344a40aca0b917d2`
- Dates: 2026-08-04 to 2026-08-05
- Checkpoint relationship: Checkpoint 1 complete for repository-hosted evidence; final Luna verification and final Miguel merge authorization remain pending

### Stack order

| Unit | PR | Base branch / SHA | Exact validated head | Verify run | State |
| --- | ---: | --- | --- | ---: | --- |
| 2A — port contracts | [#26](https://github.com/Miguelosaurus/Swift-Sim/pull/26) | `main` / `820ff2e2863e06eab908da70229c7991fd85c65c` | `f6d5338df4bb392543bb1db7ac9a597e58d040b0` | `30946128136` | Open, draft, unmerged |
| 2B — foundation adapters | [#27](https://github.com/Miguelosaurus/Swift-Sim/pull/27) | Phase 2A / `f6d5338df4bb392543bb1db7ac9a597e58d040b0` | `932241d0b60cbe27aec31db125635bbdec24dc8a` | `30948591408` | Open, draft, unmerged |
| 2C — origin delegation | [#28](https://github.com/Miguelosaurus/Swift-Sim/pull/28) | Phase 2B / `932241d0b60cbe27aec31db125635bbdec24dc8a` | `110b2422ecc5b57fd28bbffaa45762eb518f315b` | `30950707093` | Open, draft, unmerged |
| 2D — persistence adapters | [#29](https://github.com/Miguelosaurus/Swift-Sim/pull/29) | Phase 2C / `110b2422ecc5b57fd28bbffaa45762eb518f315b` | `4b175a472ca009498e27e43950dfb09bd26c9408` | `30952061308` | Open, draft, unmerged |
| 2E — lock manager | [#30](https://github.com/Miguelosaurus/Swift-Sim/pull/30) | Phase 2D / `4b175a472ca009498e27e43950dfb09bd26c9408` | `092ec816b8684f36e3900ed6826eead8d12b29a3` | `30953444594` | Open, draft, unmerged |
| 2F — artifacts/logger | [#31](https://github.com/Miguelosaurus/Swift-Sim/pull/31) | Phase 2E / `092ec816b8684f36e3900ed6826eead8d12b29a3` | `ecb2e7f926787e24bb73e432c436c6b4b11c4574` | `30954907621` | Open, draft, unmerged |
| 2G — command runner | [#32](https://github.com/Miguelosaurus/Swift-Sim/pull/32) | Phase 2F / `ecb2e7f926787e24bb73e432c436c6b4b11c4574` | `4260dbf58cb04a97b991bdd17ae7152f76dcd442` | `30989529025` | Open, draft, unmerged |
| 2H — process supervisor | [#33](https://github.com/Miguelosaurus/Swift-Sim/pull/33) | Phase 2G / `4260dbf58cb04a97b991bdd17ae7152f76dcd442` | `d44179868fee4b62af5376b3344a40aca0b917d2` | `30993626853` | Open, draft, unmerged |

### Outcome

- Added ten narrow typed ports: `CommandRunner`, `ProcessSupervisor`, `AtomicFileStore`, `LockManager`, `RuntimeJournalStore`, `ArtifactStore`, `RequestOriginPolicy`, `Clock`, `IdGenerator`, and `Logger`.
- Added a validated immutable runtime container while prohibiting application services from receiving the complete aggregate.
- Added source-loadable, TypeScript-checked Node adapters without a runtime TypeScript loader.
- Moved request-origin decisions behind `RequestOriginPolicy`; the existing HTTP compatibility preload delegates to it.
- Moved the hardened live-engine lifecycle lock algorithm behind `NodeLockManager`; the compatibility module delegates and retains legacy error mapping.
- Added atomic publication/runtime-journal stores, inode-fenced artifact containment, deterministic redacting structured logging, bounded command execution, and identity-authorized process supervision.
- Preserved all current public routes, package layouts, persisted record shapes, process-role authority distinctions, and compatibility preloads.
- Did not begin helper decomposition, SQLite migration, preload removal, live-reload restructuring, analyzer replacement, or iOS redesign.

### Behavioral and safety guarantees

- Command execution requires explicit environment inheritance, deadlines, output limits, accepted exits, and process-group policy.
- Async cancellation/timeout and accepted-parent lingering descendants trigger bounded cleanup; synchronous new-group execution fails closed because Node cannot establish the required detached ownership through `spawnSync`.
- Strong worker/live-engine records may authorize group operations; weak manager/gateway/tunnel records remain exact-PID only.
- Process identities are captured and atomically journaled before return; identity/publication failure rolls back the process.
- Identity is revalidated before signaling and before KILL escalation. Transient post-kill unverifiability is bounded and never grants authority.
- Atomic publication uses exclusive same-directory temporaries, fsync, exact replace/no-replace semantics, owner modes, and cleanup.
- Lock reclamation retains PID/start-token/nonce ownership, quarantine, claim fencing, and replacement-lock protection.
- Artifact operations require prior containment approval and reject traversal, symlink components, and root replacement.
- Logger redaction/bounds are recursive and logging construction/sink failures cannot alter application outcomes.
- Forwarded origin headers are trusted only for loopback proxy sockets; direct remote origin behavior is preserved.

### Validation

Verify run `30993626853` passed at implementation head `d44179868fee4b62af5376b3344a40aca0b917d2` on macOS 26 ARM64 with Node 24:

- architecture inventory and documentation;
- strict TypeScript, formatting, and lint;
- all 457 source tests;
- compiled contracts and every Phase 2 adapter suite;
- real command/process-group, identity, journal, lock, containment, and fault-injection tests;
- hermetic compiled execution;
- clean npm package/archive installation and entrypoints;
- isolated clean Homebrew install, launcher, setup/doctor, service identity, and restart;
- workflow YAML and release-shell syntax;
- iOS companion tests.

Temporary diagnostic commands were removed before the accepted run. The final documentation-only checkpoint head must pass the same Verify workflow before Phase 3 begins.

### Checkpoint review and residuals

| Severity | Remaining | Residual |
| --- | ---: | --- |
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 2 | Weak delivery identity remains exact-PID only; CommandRunner/ProcessSupervisor are not yet production owners |
| P3 | 1 | Preload count remains at the Phase 0 cap until the planned removal phase |

No emergency-stop condition was found. The repository checkpoint verdict is provisional continuation under the batched-execution amendment.

### Deferred evidence

Before final merge, Luna must execute and record:

- persistent installed npm CLI `version`, `setup`, and `doctor --json`;
- persistent helper start/health/restart/stop and orphan/journal inspection;
- clean local Homebrew install/upgrade/uninstall and service lifecycle on the target Mac;
- representative sleep/wake, stale/reused PID, process-group, filesystem-permission, and local-state behavior;
- physical iPhone build/install/renew and available network/signing scenarios;
- final release-candidate smoke checks.

Hosted isolated Homebrew and Simulator evidence is real but does not replace those persistent-local/device gates.

### Migration and rollback

- Data migration: none.
- Irreversible changes: none.
- Rollback: discard or revert the Phase 2 stack in reverse order; persisted external formats and public contracts are unchanged.
- No Phase 2 PR may merge before the complete stacked state receives final Luna evidence and Miguel authorization.

### Next phase

After the final checkpoint-documentation head passes Verify, create Phase 3 from that exact PR #33 head and target the Phase 2H branch. Phase 3 must decompose helper/HTTP responsibilities through explicit application services and route modules, inject only required Phase 2 ports, preserve route/projection contracts, and keep lifecycle/process authority visible. It must not remove preloads, migrate SQLite, or redesign the companion outside its assigned phase.

## Phase 3 — Helper and HTTP decomposition

- Status: **Phase 3 implementation gate complete** on the draft corrective stack through PR #93; all Phase 3 PRs remain open/draft/unmerged and merge still requires Miguel authorization.
- Stack base: Checkpoint 1 final metadata head `f21e344ea18eb0a976630a4ce38cf52bf30a3f47`.
- Final Phase 3 exact verification head: PR #93 / `07a8295f0221f1f2007cb1f01c99a5998f371f8a` (product tree `c025296d0a458809809b948e16d47ffa6f8c82fd`).
- Corrective active ancestry now runs through PRs #77, #80, #85/#87, #89, #91, #92, and #93. Earlier validated sibling/corrective history remains preserved; temporary oracle/publisher branches are not product ancestry.

### Implemented slices

- #34–#35 extract seven bounded one-shot CLI commands and command-specific composition.
- #36–#37 add typed request context plus pairing-fallback and public-build capability handlers.
- #38–#40 extract delivery maintenance and HTTP server/timer behavior and make the compatibility boundary installation explicit.
- #56 extracts all 14 Simulator-session HTTP contracts behind one typed application service. Each route owns only matching and HTTP projection; authorization, input decoding, store access, operation orchestration, and persisted-session projection are behind one `execute` call. The compiled public gateway returns 404 for every private session route, including GET and POST for the legacy any-method session page.
- #57 extracts seven helper-control routes: health, association, serve-sim inspection, transport inspection, pairing status, pairing claim, and pairing rotation. Route modules own matching and HTTP projection; the application service owns authorization, input, store access, and result projection through one `execute` call. The compiled public gateway exposes health but returns 404 for every other extracted route.
- #58 extracts six paired-Mac device-build/app catalogue and mutation routes. The application service owns authorization, persistence access, rebuild deduplication, recipe validation, build start, archive/delete mutation, and delivery-reference cleanup; the route owns matching and HTTP projection through one `execute` call.
- #59 extracts paired-Mac device-build start and renewal commands. The application service owns authorization, input projection, persistence orchestration, renewal rollback, and public projection; lazy keyed tracking coalesces a shared renewal lease and prevents a stale completion from deleting a replacement task. The private `start` command is excluded from public capability dispatch so the isolated gateway returns 404 rather than an authentication response.
- #60 extracts public device-build capability, artifact, manifest, install-request, verification, links, logs, and install-page routing behind an explicit application-service/route boundary while preserving paired-Mac versus capability authorization and response projection.
- #63 extracts the final embedded `GET /pair` HTML route behind a pairing-page application service, renderer, and route boundary, preserving invite precedence, token authorization, request-origin handling, HTML escaping, exact security headers, and public-gateway 404 isolation.

### Corrective Phase 3H evidence

- Independent review initially found four P2 boundary/evidence gaps: an inaccurate session-page method matrix, an unenforced service façade, shallow authorization/completion coverage, and incomplete real-gateway proof. Corrections added the accurate `ANY /s/:id` contract, a `@ts-check` and runtime-validated application-service surface, every-route authorization/signature/outcome/malformed/unsupported-method tests, headers-sent-safe stream failure handling, and compiled all-route gateway isolation. Final re-review reported P0 0, P1 0, P2 0.
- Node 24 `npm run check` at `1956dac` passed syntax for 460 JavaScript files, architecture inventory for 124 production sources, 55 Markdown links, strict types, formatting, lint, 506/506 source tests, 139/139 compiled contract tests, 2/2 hermetic process tests, compiled entrypoint equivalence, 265 package paths, isolated package installation, and formula validation.
- This is a bounded corrective slice, not a Phase 3 completion claim. The compatibility helper still owns the remaining build, pairing, transport, and lifecycle route families plus module-global construction and direct process/persistence work.

### Corrective Phase 3I evidence

- The first independent review reported P0 0, P1 0, P2 1, P3 0. The P2 identified that descriptive authorization metadata was only name-tested and query-token denial lacked explicit no-side-effect proof. The correction asserts every route, exposure, and authorization tuple and proves denied pairing status/rotation cannot read or rotate pairing state. Final re-review reported P0 0, P1 0, P2 0, P3 0.
- Node 24 `npm run check` at `38aaaed` passed syntax for 468 JavaScript files, architecture inventory for 126 production sources, 55 Markdown links, strict types, formatting, lint, 524/524 source tests, 139/139 compiled contract tests, 2/2 hermetic runtime tests, compiled entrypoint equivalence, 269 package paths, isolated package installation, and Homebrew formula/Node 24 entrypoint validation. The destructive clean-Homebrew installation gate was intentionally not run.
- PR #56 final metadata head `e680b6f` passed Verify run `31320850843`. PR #57 remains open, draft, and unmerged; its natural Verify run was in progress when this ledger entry was written.
- This is another bounded corrective slice, not a Phase 3 completion claim. The compatibility helper remains 1,956 lines and still owns build routes, the pairing HTML route, lifecycle/process work, persistence construction, and module-global composition.

### Corrective Phase 3J evidence

- The first independent review reported P0 0, P1 0, P2 2, P3 2. Corrections added compiled public-gateway 404 proof for all six routes, active-rebuild reuse and missing-recipe evidence, response-completion assertions, and exact archive/query/delete default and cleanup-suppression coverage. Final re-review reported P0 0, P1 0, P2 0, P3 0.
- Node 24 `npm run check` at `b5dbb73` passed syntax for 476 JavaScript files, architecture inventory for 128 production sources, 55 Markdown links, strict types, formatting, lint, 543/543 source tests, 139/139 compiled contract tests, 2/2 hermetic runtime tests, compiled entrypoint equivalence, 273 package paths, isolated package installation, and Homebrew formula/Node 24 entrypoint validation. The destructive clean-Homebrew installation gate was intentionally not run.
- PR #57 final metadata head `f7b6add` passed Verify run `31321514451`. PR #58 final metadata head `98081e4` passed Verify run `31322007847`.
- This remains a bounded corrective slice. The 1,894-line compatibility helper still owns device-build start, renewal, capability/artifact/install-page routes, the pairing HTML route, lifecycle/process work, persistence construction, and module-global composition.

### Corrective Phase 3K evidence

- The first independent review reported P0 0, P1 0, P2 2, P3 2. Corrections replaced already-started renewal promises with lazy keyed registration, joined shared leases onto the owning delivery result, fenced task-map deletion by promise identity, removed the new broad `any`, proved detached start, and covered every renewal precondition. The hermetic gate also exposed the private `start` command being parsed as a public build ID; both capability preload and gateway dispatch now reserve that path. Final re-review reported P0 0, P1 0, P2 0, P3 0.
- Node 24 `npm run check` at `9a17315` passed syntax for 486 JavaScript files, architecture inventory for 131 production sources, 55 Markdown links, strict types, formatting, lint, 559/559 source tests, 139/139 compiled contract tests, 2/2 hermetic runtime tests, compiled entrypoint equivalence, 279 package paths, isolated package installation, and Homebrew formula/Node 24 entrypoint validation. The destructive clean-Homebrew installation gate was intentionally not run.
- PR #59 is open, draft, mergeable, and unmerged on PR #58 final head `98081e4`. Its natural Verify run `31322722122` was in progress when this ledger entry was written.
- This remains a bounded corrective slice. The 1,852-line compatibility helper still owns public build capability/artifact/install-page routes, the pairing HTML route, lifecycle/process work, persistence construction, and module-global composition.

### Corrective Phase 3L evidence

- PR #60 implementation `61dbb05` extracted the public device-build capability/artifact/install-page family. Its first hosted run exposed only repository Prettier formatting in the two new production modules; the normal follow-up `9a3be575` applied the exact Prettier 3.7.0 output without rewriting history.
- Authoritative Verify run `31417609440` (#760) passed at exact head `9a3be575`: Node 24 `npm run check`, isolated clean Homebrew installation/service, workflow YAML, release-shell syntax, and iOS Simulator tests all passed.
- This remained a bounded corrective slice. The compatibility helper was reduced to 1,761 lines but still owned the pairing HTML route plus lifecycle/reconciliation/process behavior, persistence construction, module-global composition, and remaining CLI composition.

### Corrective Phase 3M evidence

- PR #63 implementation `ba97946` extracted the final embedded `GET /pair` route into an explicit application service, renderer, and route boundary. Invitation precedence, expired/claimed behavior, pairing-token authorization, request-origin-derived links, HTML escaping, content type, cache/CSP/referrer/nosniff headers, and device-build-only public-gateway 404 behavior are covered through stable seams.
- Focused adversarial review found no remaining correctness, authorization, projection, escaping, side-effect-ordering, or public-gateway-isolation finding. Authoritative Verify run `31420399403` (#763) passed at exact implementation head `ba97946`: full Node 24 checks, isolated clean Homebrew installation/service, workflow YAML, release-shell syntax, and iOS Simulator tests all passed.
- The current HTTP surface is now routed through explicit route/application-service boundaries with authorization metadata and compiled public-gateway isolation evidence. Phase 3 is still incomplete because the helper entrypoint owns service lifecycle/reconciliation, module-global runtime construction, direct orchestration/process functions outside route modules, and remaining CLI composition.

### Corrective Phase 3O evidence

- PR #77 / `bbd773972e33dcc5d7e2e7758482aafabb8f318d` centralizes interrupted-build recovery, initial cleanup, HTTP listen/socket ownership, reconciliation/cleanup timers, keepalive, signals, graceful drain, forced socket closure, and the bounded fail-safe exit in `HelperServiceLifecycle`, while retaining the corrected device-installation reconciliation coordinator.
- Authoritative Verify #807 / run `31425602501` passed full Node/package checks, isolated clean Homebrew installation/service, YAML/shell gates, and iOS Simulator tests.

### Corrective Phase 3P evidence

- PR #80 / `c92668eee8f17c96346279cc75fc0dd9d5492415` makes compatibility-helper import inert and moves all concrete store/adapter/transport construction behind explicit `createCompatibilityHelperRuntime()` composition with fail-before-construction factory validation.
- Authoritative Verify #815 / run `31427558750` passed end to end.

### Corrective Phase 3Q–R evidence

- PR #85 / `ad9dd22721b0f5f99143d1f47fc8d02ff42cd7ce` extracts `delete-app` into selective command composition and reuses the delivery-maintenance coordinator. Verify #819 / run `31428505506` passed end to end.
- PR #87 / `b994cfa3d5a4f4a8aa5fe0aa8760a943745b2cb1` reconciles the hosted-green CLI siblings and moves all remaining compatibility option parsing/output formatting out of the helper. Verify #827 / run `31430219744` passed end to end.

### Corrective Phase 3S evidence

- PR #89 / `387e69f35dc3e5adec71d30f03fc1983abdf3292` extracts session start/reuse/stop, stream recovery, input/control channels, CA-debug state, and restart coalescing into a strict-typed `SessionRuntimeController`. Adversarial corrections route token generation through `IdGenerator` and timestamps/deliberate input delays through `Clock`.
- Authoritative Verify #859 / run `31440168113` passed full Node/package, isolated clean Homebrew, YAML/shell, and iOS gates.

### Corrective Phase 3T evidence

- PR #91 / `2b870d1cd6f76f1b822802219d52b7780bd77e3d` extracts setup-status, Tailscale backend/Serve probing, and helper-health probing into a typed service. Tailscale commands use the established `CommandRunner`, bounded output, deadlines, and owned process groups; the stale helper oversized-file cap is removed while the immutable baseline snapshot stays unchanged.
- Authoritative Verify #861 / run `31441333912` passed end to end.

### Corrective Phase 3U evidence

- PR #92 / `db5d66b84aff7efbda69ee7383abe07424b296bd` extracts device-build/delivery orchestration into a typed controller owning active task coordination, delivery cleanup, interruption recovery, CLI signal ownership, and build/delivery lifecycle. The compatibility runtime no longer exports mutable active-task coordination state.
- Natural Verify run `31442751740` passed full Node/package, isolated clean Homebrew, YAML/shell, and iOS gates.

### Corrective Phase 3V and closure evidence

- PR #93 final exact head `07a8295f0221f1f2007cb1f01c99a5998f371f8a` (tree `c025296d0a458809809b948e16d47ffa6f8c82fd`) extracts the fallback session/install HTML, AASA document, and escaping from the composition entrypoint; the remaining install/capability current-time callbacks use `Clock`; and public-delivery isolation is derived from every declared Phase 3 authorization matrix.
- The initial semantic commit `ed89b80647a198c08aed2d600ba932af70a517c4` is preserved in history. Clean-tree correction `71177a0c30533f5fac3f06ed4db6a9989f01915b` removes incidental legacy formatting churn without rewriting history; `07a8295f…` is a same-tree natural-Verify trigger.
- Authoritative Verify #865 / run `31444358586` passed full Node/package, architecture/types/format/lint, isolated clean Homebrew installation/service, YAML/shell, and iOS Simulator gates.
- Exact-head closure audit run `31444581201` passed 88/88 focused Phase 3 contracts, import-inert composition, atomic lifecycle authorization/recovery, every route authorization matrix, matrix-complete public-gateway allow/404 proof, raw route-authority scanning, the architecture debt gate, strict types, and diff hygiene. The exact clean entrypoint is 354 lines and contains no extracted setup/build/session/presentation implementation.

### Phase 3 gate completion

The 2026-08-11 exact-head closure audit supersedes the earlier corrective gate note. The master-plan Phase 3 implementation gate is now met at `07a8295f0221f1f2007cb1f01c99a5998f371f8a`:

- `swift-sim-helper.js` is primarily composition/wiring; its exact clean-tree size is 354 lines.
- route paths, projections, exposure classes, and authorization modes are explicit and contract-tested; the public delivery gateway is proved against the complete declared authorization matrix and rejects every private route.
- route modules contain no direct child-process or raw filesystem mutation authority; persistence/process behavior is behind application/runtime services.
- importing the compatibility helper is inert; concrete infrastructure construction occurs only through explicit compatibility composition.
- service startup, interrupted-build recovery, reconciliation/cleanup timers, socket ownership, signals, graceful drain, and forced shutdown are centralized in `HelperServiceLifecycle`.
- CLI parsing, session runtime, setup-status probing, device-build/delivery orchestration, installation reconciliation, and fallback presentation are behind bounded typed seams.
- architecture debt, strict type, full package/install, clean Homebrew, and iOS gates pass on the exact final product tree.

Phase 3 remains draft/unmerged and does not authorize a storage cutover. Compatibility preloads still exist only as a time-bounded Phase 5 migration concern; they are not being removed here. The validated Phase 4 SQLite/pairing tranche through `b1fac0df3360fdc68ca76d910e467b8a1f4944d7` is already a direct ancestor of this final Phase 3 head, so no replay/rebase is required. Phase 4 can continue forward from the finalized ancestry with the missing broader domain repositories, shadow composition, authority cutover, rollback, diagnostics, and upgrade proof.

## Phase 4 — Repository interfaces and SQLite migration

- Status: The pairing migration/rollback primitives plus device-build repository/import/shadow work through live optional Phase 4U are hosted-green in the draft stack. JSON remains the sole production read/write authority; device-build cutover and rollback activation remain disabled pending persistent local shadow evidence.
- Full Phase 4 stack base: Phase 3G head `7367fa2574ff8fa88499be7c8b02ece72ff11ffa`.
- Pairing E stack base: Phase 4D2 head `1364fa1ea570840e779b4f6b65195b3bb4433ac6`.
- Validated pairing E4 implementation: `7ce31e6f859180af213d7d3d52e2dd564bcbd63d`.
- Active device-build continuation head: PR #112 / `588aacc46cd9482fc963c3ada3da709b6bfa0d81`, retaining the pairing tranche and all prior Phase 4 device-build work as direct ancestors.
- Local persistent-machine device-build shadow verification is now the evidence boundary before authority activation. Full Phase 4 still requires device-build cutover/rollback/export, session/remaining transactional domains, doctor/export/corruption support, previous-release upgrade proof, and the final phase gate.

### Stack order and live state

| Unit | PR | Base | Validated implementation head | Verify evidence | State |
| --- | ---: | --- | --- | --- | --- |
| 4A — SQLite foundation | [#41](https://github.com/Miguelosaurus/Swift-Sim/pull/41) | Phase 3G / `7367fa2` | `d653b3f` | `31026437268` passed | Open, draft, unmerged |
| 4B — pairing repositories | [#44](https://github.com/Miguelosaurus/Swift-Sim/pull/44) | #41 / `d653b3f` | `0f8e65a` | `31028680549` passed | Open, draft, unmerged |
| 4C — pairing import/resume | [#45](https://github.com/Miguelosaurus/Swift-Sim/pull/45) | #44 / `0f8e65a` | `6781dea` | `31033205619` passed | Open, draft, unmerged |
| 4D1 — pairing shadow comparison | [#46](https://github.com/Miguelosaurus/Swift-Sim/pull/46) | #45 / `6781dea` | `7443e7e` | `31036122449` passed | Open, draft, unmerged |
| 4D2 — pairing shadow observer | [#47](https://github.com/Miguelosaurus/Swift-Sim/pull/47) | #46 / `7443e7e` | `1364fa1` | `31039161870` passed | Open, draft, unmerged |
| E1 — pairing authority state | [#48](https://github.com/Miguelosaurus/Swift-Sim/pull/48) | Phase 4D2 / `1364fa1` | `974db19` | `31041703590` passed | Open, draft, unmerged |
| E2 — locked legacy snapshot | [#50](https://github.com/Miguelosaurus/Swift-Sim/pull/50) | #48 / `974db19` | `bf7830c` | `31043513490` passed | Open, draft, unmerged |
| E2 — authority selector | [#49](https://github.com/Miguelosaurus/Swift-Sim/pull/49) | #50 / `bf7830c` | `ff96203` | `31045149408` passed | Open, draft, unmerged |
| E3 — cutover preparation | [#52](https://github.com/Miguelosaurus/Swift-Sim/pull/52) | #49 / `ff96203` | `8ff4ae8` | `31047728488` passed | Open, draft, unmerged |
| E3B — cutover coordinator | [#53](https://github.com/Miguelosaurus/Swift-Sim/pull/53) | #52 / `8ff4ae8` | `ec1bd4e` | `31315600274` passed | Open, draft, unmerged |
| E4 — rollback export | [#54](https://github.com/Miguelosaurus/Swift-Sim/pull/54) | #53 / `ec1bd4e` | `3100bc0` | `31316795096` passed | Open, draft, unmerged |
| 4F — device-build SQLite shadow repository | [#95](https://github.com/Miguelosaurus/Swift-Sim/pull/95) | Phase 3 completion ledger / `94e5686` | `6ddd0ad`; final clean-tree head `bc55ccd` | `31479976397` passed | Open, draft, unmerged |
| 4G — locked device-build legacy snapshot | [#96](https://github.com/Miguelosaurus/Swift-Sim/pull/96) | #95 / `bc55ccd` | `e850844` | `31481810512` passed | Open, draft, unmerged |
| 4H — resumable device-build legacy import | [#98](https://github.com/Miguelosaurus/Swift-Sim/pull/98) | #97 / `026672a` | `6ba637f` | `31484093720` passed | Open, draft, unmerged |
| 4I — device-build shadow comparison/evidence | [#99](https://github.com/Miguelosaurus/Swift-Sim/pull/99) | #98 / `6ba637f` | `49adc9c` | `31502611382` passed | Open, draft, unmerged |
| 4J — best-effort device-build shadow observer | [#101](https://github.com/Miguelosaurus/Swift-Sim/pull/101) | #99 / `49adc9c` | `3848fd0` | `31504098733` passed | Open, draft, unmerged |
| 4K — legacy device-build lock identity compatibility | [#102](https://github.com/Miguelosaurus/Swift-Sim/pull/102) | #101 / `3848fd0` | `a7a5132` | `31505392635` passed | Open, draft, unmerged |
| 4L — authorized deferred build-read shadow hook | [#103](https://github.com/Miguelosaurus/Swift-Sim/pull/103) | #102 / `a7a5132` | `c0d566b` | `31507362584` passed | Open, draft, unmerged |
| 4M — device-build shadow runtime composition | [#104](https://github.com/Miguelosaurus/Swift-Sim/pull/104) | #103 / `c0d566b` | `d634199` | `31508718050` passed | Open, draft, unmerged |
| 4N — revision-fenced build shadow evidence | [#105](https://github.com/Miguelosaurus/Swift-Sim/pull/105) | #104 / `d634199` | `d7f4a6b` | `31512035071` passed | Open, draft, unmerged |
| 4O — helper resource lifecycle ownership | [#106](https://github.com/Miguelosaurus/Swift-Sim/pull/106) | #105 / `d7f4a6b` | `5bc3cb0` | `31512813692` passed | Open, draft, unmerged |
| 4P — fail-open shadow startup | [#107](https://github.com/Miguelosaurus/Swift-Sim/pull/107) | #106 / `5bc3cb0` | `498418d` | `31513868022` passed | Open, draft, unmerged |
| 4Q — canonical shared DB/backup/lock paths | [#108](https://github.com/Miguelosaurus/Swift-Sim/pull/108) | #107 / `498418d` | `d812213` | `31513970006` passed | Open, draft, unmerged |
| 4R — raw-source-loadable shadow runtime | [#109](https://github.com/Miguelosaurus/Swift-Sim/pull/109) | #108 / `d812213` | `445660e` | `31515102535` passed | Open, draft, unmerged |
| 4S — optional shadow compatibility loader | [#110](https://github.com/Miguelosaurus/Swift-Sim/pull/110) | #109 / `445660e` | `8f790b6` | `31516036240` passed | Open, draft, unmerged |
| 4T — live optional device-build shadow wiring | [#111](https://github.com/Miguelosaurus/Swift-Sim/pull/111) | #110 / `8f790b6` | `cf7e914` | `31516642628` passed | Open, draft, unmerged |
| 4U — private live-shadow SQLite permissions | [#112](https://github.com/Miguelosaurus/Swift-Sim/pull/112) | #111 / `cf7e914` | `588aacc` | `31517749763` passed; live oracles `31517815886`, `31517976818` passed | Open, draft, unmerged |

PRs #42 and #43 are closed and superseded by clean PR #44. PR #51 (`7615de6`) is closed and superseded by the clean E3 PR #52; none is part of the live ancestry. The initial E4 Verify run `31316632344` at `7ce31e6` and the ledger-only run `31316708706` failed on the architecture source-text-test cap; `3100bc0` removed that classification by using the injected file-store reader, Verify `31316795096` passed, and the final documentation head `b1fac0d` passed `31317114243`.

### E3B completion record

- Preserved the existing history, including diagnostic commit `7083ad2`; applied the canonical Prettier output in normal commit `ec1bd4e` without rewriting or force-pushing.
- Restored the repository-wide formatter gate and passed the focused coordinator suite (8/8), the full local Node 24 check, the isolated Homebrew gate, workflow YAML/shell gates, and iOS Simulator tests (30/30).
- PR #53 Verify run `31315600274` passed at the exact `ec1bd4e` head.

### E4 outcome and invariants

- Added an unwired `PairingLockedLegacyWriter` and `PairingRollbackCoordinator` that keep credential and invitation locks held in bytewise order through SQLite read, pre-overwrite backups, atomic 0600 writes, 0600 backup publication under 0700 parents, rereads, validators, normalization, projection-hash comparison, and the revision/source/window-fenced rollback CAS.
- The exporter requires a non-null SQLite credential, preserves the PairingStore credential object and PairingInviteStore invitation-array shapes, uses the current SQLite snapshot (including post-import changes), never deletes backups, and recognizes only the exact completed legacy epoch on retry.
- Real temporary filesystem/SQLite fault-injection coverage passed 14/14 focused tests: backup publication; credential and invitation writes; credential and invitation rereads; projection verification; interruption immediately before CAS; interruption immediately after successful CAS; SQLite CAS failure; missing credential; expiry/finalization refusal; contention; lock ordering/release; immutable results; and retry behavior.
- No production composition, migration invocation, service, credential, installation, or real `~/.swift-sim` state was touched.

### E4 local validation

- Node 24 `npm run check`: passed syntax for 452 JavaScript files, architecture inventory for 122 production sources, 55 Markdown links, strict TypeScript, formatting, lint, 463 source tests, 139 compiled tests, hermetic/compiled runtime checks, 261 package paths, isolated package install, and formula validation.
- `SWIFT_SIM_RUN_CLEAN_HOMEBREW=1 bash scripts/verify-homebrew-package.sh`: passed isolated archive installation, Node 24 launchers, unique-port service identity/restart, assets, setup, and doctor. Existing Homebrew launchers remained untouched; the known dylib header warning remains diagnostic only.
- All four workflow YAML files and the required release shell scripts passed their syntax gates.
- The exact workflow iOS Simulator command passed 30/30 tests with 0 failures on simulator `FC06262E-96E4-4B4E-ADAB-C9D5FFE8927D`.

### E4 self-review and residuals

| Severity | Found | Fixed | Remaining |
| --- | ---: | ---: | ---: |
| P0 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 |
| P2 | 0 | 0 | 0 |
| P3 | 0 | 0 | 0 |

The E4 pairing rollback slice has no remaining finding from its focused audit. Phase 4F and 4G now cover the first non-pairing transactional domain boundary for device-build state, but full Phase 4 remains incomplete: device-build import/checkpoint/shadow comparison and authority composition, a production-compatible legacy build-lock identity provider, session-domain repositories/migration, schema/migration/permission/orphan diagnostics, redacted export, corruption guidance, previous-tag upgrade proof, and full cutover/rollback evidence are still required. Production rollback/cutover remains unauthorized, and final persistent-local/device evidence and Miguel merge authorization remain pending.

### Phase 4F — device-build SQLite shadow repository

- PR #95 adds a typed `DeviceBuildStateRepository` for builds, app archive state, artifact-cleanup jobs, and delivery-reference cleanup jobs without changing the live JSON authority.
- SQLite migration version 6 adds four entity-specific STRICT tables. Full validated entity projections remain preserved as JSON while extracted columns are indexed and CHECK-bound back to the JSON projection, avoiding a new opaque whole-domain blob table.
- Snapshot replacement is one SQLite transaction across all four collections. Focused evidence proves extension-field round trips, duplicate/pre-validation failure containment, extracted-column mismatch rejection, and rollback to the prior snapshot after a SQL CHECK fails after deletion/insertion has begun.
- Final clean product tree is `ea33f7b445664b3bd08b9770f5753dbca8f355cc`. The intended implementation commit is `6ddd0ad6910d64b5874fc4444c72397367a24714`; after a transient metadata-tool mistake created a top-level `noop` file, ordinary corrective child `bc55ccdf1af7f9f18c9757ffbefaef63944b7f70` removed it and restored the exact intended tree without history rewriting. Natural corrective Verify #872 / run `31479976397` passed full Node/package, clean Homebrew, YAML/shell, and iOS gates.
- This slice is migration/shadow infrastructure only. `device-builds.json` remains the sole production source of truth.

### Phase 4G — locked device-build legacy snapshot

- PR #96 / `e8508440459d2f649432e4ce3c02ae84d1997b3a` adds the read-only legacy-source boundary needed before device-build import. It never constructs `DeviceBuildStore`, so migration reads cannot compact state, expire tokens, recover renewals, drain cleanup artifacts, or start maintenance behavior.
- The reader takes an injected legacy-compatible lock, backs up exact source bytes before parse/version acceptance, normalizes older supported state in memory using the same existing pure build normalizer, preserves legacy-compatible extension fields, and fails closed on malformed/future-version state. It emits deterministic `sourceRevision`, normalized `projectionHash`, source version, record count, and deeply frozen projection evidence.
- The migration callback must remain synchronous, keeping later import work inside the source-lock lifetime. Strengthened oracle run `31481348264` proves the reader's own source read, backup write, and backup verification read all occur while the lock is held.
- Authoritative natural Verify #873 / run `31481810512` passed full Node/package, isolated clean Homebrew, YAML/shell, and iOS gates on the exact product head.
- Production lock composition is deliberately deferred: the legacy build lock uses a PID-reuse-safe `/bin/ps ... lstart` `startedAt` token whose representation differs from the generic kernel identity provider. A later composition slice must supply an exactly compatible identity provider rather than weakening stale-lock checks to PID-only behavior.
- No SQLite import, shadow observer, production reader/writer, authority switch, legacy deletion, or real-user-state operation is introduced.

### Phase 4H–4U — device-build import through live optional shadow

- Phase 4H added the resumable device-build legacy import/checkpoint coordinator while preserving source-lock lifetime and JSON authority.
- Phase 4I–4J added redacted per-entity shadow comparison/evidence and a failure-contained observer. Phase 4K proved exact compatibility with the legacy `/bin/ps ... lstart` `startedAt` lock identity rather than weakening PID-reuse fencing.
- Phase 4L observes only successful authorized read-only build-capability operations after response publication. Mutation paths remain JSON-only and are not shadow-observed.
- Phase 4M–4N assembled the SQLite shadow runtime and added revision fencing: live build comparison occurs only when JSON and SQLite share the same monotonic build revision; missing/stale SQLite rows are skipped instead of recorded as false mismatch evidence.
- Phase 4O–4Q added explicit lifecycle close ownership, fail-open JSON-only startup, one shared sibling `state.sqlite`, domain-scoped migration backups, and the exact legacy source-lock protocol.
- Phase 4R removed emitted-only TypeScript runtime dependencies from the concrete persistence graph and proves the full shadow runtime loads directly from the raw source tree.
- Phase 4S–4T dynamically compose the optional shadow into helper `serve`: interrupted JSON build recovery runs before the locked import snapshot; every shadow-specific loader/path/SQLite/schema/lock/backup/import failure degrades to JSON-only startup; the observer is supplied only to the authorized read hook; graceful shutdown owns the DB close. No production SQLite read/write authority is enabled.
- Phase 4T hosted live oracle `31516751742` proved schema v7/checkpoint creation, byte-equal content-addressed backup, SQLite integrity, unchanged JSON SHA, restart idempotency, and deliberate SQLite-path failure falling back to JSON-only startup. It also exposed a 0644 new DB permission.
- Phase 4U fixes fresh DB/WAL/SHM creation under a bounded 077 umask and restores the previous process umask. Verify `31517749763` plus independent hardened live oracles `31517815886` and `31517976818` prove state root 0700, DB 0600, backup directory 0700, backup 0600, WAL/SHM 0600 when present, unchanged JSON, restart idempotency, integrity, and fail-open fallback.
- The next evidence boundary is persistent local-machine shadow verification against the actual Swift Sim state/service. Device-build SQLite authority remains unauthorized until that evidence is reviewed. Phase 4 still requires fenced cutover/read-only rollback, device-build rollback export, session/remaining transactional domains, doctor/export/corruption support, previous-tagged-release upgrade proof, and the final phase gate.

## Cross-phase reliability correction — helper state growth

- Source fix preserved at `origin/codex/fix-helper-state-growth` / `36d3fd4d03495f0c373a85d55e0a01e1a272cbe0`.
- Active-ancestry port: [PR #55](https://github.com/Miguelosaurus/Swift-Sim/pull/55), stacked from PR #54 final head `b1fac0df3360fdc68ca76d910e467b8a1f4944d7`.
- Initial behavior port: `9d49cdfa97c27fb152914e73a454e80e4f188376`.
- Corrected implementation after independent adversarial review: `97c305b`.

The port preserves the original 500-line/64-KiB newest diagnostic tail, version-6 legacy compaction, healthy-helper startup short circuit, and disposable-HOME compiled-runtime verification. It replaces the old source-text startup assertions with compiled-package behavior evidence and does not increase the architecture ratchets. Independent review found three P2 evidence/durability gaps in the initial port: bespoke publication lacked fsync/fault proof, duplicate-start proof needed the real process entrypoint, and verifier-HOME isolation needed a behavioral mutation sentinel. The final implementation uses `NodeAtomicFileStore` publication with file and directory synchronization, proves byte-identical legacy state after injected publication failure, exercises the official compiled entrypoint against a healthy helper, and verifies caller state remains unchanged before cleaning the isolated probe root. The corrective re-review reported no remaining P0–P3 findings.

Local Node 24 validation passed 46/46 focused device-build tests, 468/468 source tests, 139/139 compiled tests, the hermetic compiled runtime, 122-source architecture inventory, 55-file documentation check, strict types, formatting, lint, 261 package paths, isolated package installation, and formula validation. The clean Homebrew gate passed isolated archive installation, Node 24 launchers, unique-port service identity/restart, assets, setup, and doctor while preserving existing launchers; the known dylib-header/link warning remained diagnostic only. Workflow YAML and required shell syntax gates passed. The exact workflow iOS Simulator command passed 30/30 tests with 0 failures on simulator `FC06262E-96E4-4B4E-ADAB-C9D5FFE8927D`. PR #55 exact-head Verify run `31319696947` passed; the PR remains draft and later persistent-service/release-candidate evidence is still required before merge.

## Decision log index

| ADR | Decision | Status |
| --- | --- | --- |
| [ADR-0001](../adr/ADR-0001-typescript-compile-to-dist.md) | TypeScript build and runtime model | Accepted |
| [ADR-0002](../adr/ADR-0002-explicit-infrastructure-ports.md) | Explicit process and filesystem infrastructure ports | Accepted |
| [ADR-0003](../adr/ADR-0003-sqlite-domain-state-filesystem-runtime.md) | SQLite domain state / filesystem runtime journal split | Accepted |
| [ADR-0004](../adr/ADR-0004-swift-analyzer-boundary.md) | SwiftSyntax analyzer boundary | Accepted |
| [ADR-0005](../adr/ADR-0005-companion-feature-architecture.md) | Companion feature-state architecture | Accepted |

## Final completion record

Complete only after Phase 10 and final merge authorization.

- Final release:
- Final main SHA:
- Clean install evidence:
- Upgrade/migration evidence:
- Physical-device evidence:
- External beta evidence:
- Remaining published limitations:
- Deleted compatibility paths:
- Deferred future work:
