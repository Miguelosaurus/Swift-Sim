# Swift Sim Architecture Consolidation Master Plan

Status: execution plan

Baseline when this plan was written: `main` after `a132c4221406f21a5fc7399e6cd0ba1d4ffa7c08`

This plan converts Swift Sim from a technically serious but overgrown public beta into a codebase that an experienced maintainer can understand, extend, and verify without depending on hidden runtime behavior or repeated adversarial patching.

The plan is intentionally incremental. It must not be implemented as one rewrite or one giant pull request.

## 1. Desired end state

A new contributor should be able to answer these questions from the module tree and public interfaces:

1. Where does a CLI command enter the system?
2. Which component owns a child process?
3. Which component owns durable state?
4. Which routes are public, paired-Mac-only, session-token-only, or local-only?
5. Why was a Swift edit routed to hot reload or a signed rebuild?
6. Which operation is safe to retry?
7. Which failure is recoverable after a crash?
8. Which tests prove each claim?

The answer must not depend on knowing that an entrypoint imported a preload that replaced a generic Node API.

The target shape is:

```text
CLI / service entrypoints
  -> typed command and HTTP adapters
    -> application services
      -> explicit infrastructure ports
        -> process supervisor
        -> command runner
        -> durable state repository
        -> runtime lease and journal store
        -> artifact store
        -> network clients

Live delivery
  -> edit-set contract
    -> Swift analyzer
    -> routing policy
    -> live engine controller
    -> patch compiler / loader
    -> proof evaluator
    -> signed-build fallback

iOS companion
  -> small feature models
    -> typed helper client
    -> local repositories
    -> navigation coordinator
```

## 2. Non-negotiable product invariants

Every phase must preserve the full invariant list in `ARCHITECTURE_CONSOLIDATION_INVARIANTS.md`. The most important are:

- source, signing credentials, project paths, and saved artifacts remain on the Mac;
- the full helper remains localhost-only by default;
- the temporary public gateway never gains pairing, app-library mutation, build creation, Simulator control, or live-patch routes;
- hot reload remains Debug-only and private-Tailnet-only;
- a false hot-safe result is worse than a conservative rebuild;
- install success is never inferred from opening a page or requesting installation;
- process termination always requires exact verified ownership;
- user-visible behavior and existing stored data remain compatible through each migration;
- the normal workflow remains `install -> pair when needed -> build -> open -> install or live update -> verify`.

## 3. Major architecture decisions

### 3.1 TypeScript becomes the canonical Node source language

Do not perform a flag-day rewrite.

Use a mixed-source compiler transition:

- Node source remains under the existing `mac-helper/`, `scripts/`, and benchmark trees.
- Add `typescript` and a `NodeNext` build configuration.
- Begin with `allowJs: true` so JavaScript and TypeScript compile into one `dist/` tree.
- Production and test entrypoints eventually execute the compiled tree, not source files directly.
- Migrate cohesive modules from `.js` to `.ts` one responsibility at a time.
- Keep `.js` import specifiers in TypeScript source where required by Node ESM output.
- Enable strictness in controlled stages, but the final state must include `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` unless a documented TypeScript limitation blocks one option.
- Do not introduce `any` as the default escape hatch. Temporary unsafe boundaries must use `unknown`, runtime validation, and a named TODO with an issue or phase reference.

The first types to define are domain contracts, not implementation classes:

- session and stream state;
- app and device-build state;
- pairing and invitation state;
- public and private HTTP projections;
- command execution result;
- process identity;
- runtime lease and journal records;
- delivery outcome and live proof;
- repository transaction interfaces.

### 3.2 Raise the supported Node floor before relying on new platform APIs

Node 20 is no longer an acceptable long-term floor for this consolidation. Move the supported runtime to a currently supported LTS line and pin the Homebrew package and CI matrix intentionally.

The implementation phase must verify the exact chosen Node line through:

- a clean Homebrew install;
- package scripts;
- helper service startup and restart;
- child-process ownership tests;
- native package compatibility, if any native dependency is introduced.

Do not silently use APIs unavailable on the declared minimum Node version.

### 3.3 Replace implicit runtime patching with explicit infrastructure ports

The target infrastructure interfaces are:

- `CommandRunner`: async and sync command execution, deadlines, process groups, output bounds, cancellation;
- `ProcessSupervisor`: spawn identity, ownership verification, graceful shutdown, exact-group termination, recovery;
- `AtomicFileStore`: private file creation, fsync, rename, containment, structured reads;
- `LockManager`: acquisition, owner identity, stale reclamation, quarantine, release;
- `RuntimeJournalStore`: worker and engine journals that must exist outside the domain database;
- `ArtifactStore`: path-safe artifact creation, lookup, retention, and deletion;
- `RequestOriginPolicy`: loopback/proxy trust and external-base derivation;
- `Clock` and `IdGenerator`: deterministic tests;
- `Logger`: redaction-aware structured events.

Application modules receive these dependencies explicitly from a composition root. They must not rely on import order to install behavior.

During migration, existing preloads may call the new implementations as compatibility shims. The allowed preload surface must only decrease. No new preload or monkey patch may be added without an explicit architecture-plan amendment.

### 3.4 Use SQLite for domain state, not for process ownership

The current JSON stores have evolved into a custom transactional database. Replace domain-state persistence behind a repository interface.

Target database:

```text
~/.swift-sim/state.sqlite
```

Use transactions, foreign keys, a schema-version table, and bounded busy handling. Prefer WAL after proving it behaves correctly on supported local filesystems.

Move these records into the database:

- apps and ordered build history;
- device builds and delivery references;
- sessions and public stream projection;
- pairing installation identity and durable credential metadata;
- pairing invitations and idempotent claim state;
- remote-build recipes and idempotency keys;
- install observations and verification state;
- durable cleanup jobs.

Keep these as explicit private filesystem records:

- child-process ownership journals required before or during process publication;
- runtime leases and lock owner files used for cross-process mutual exclusion;
- engine socket, PID identity, and early-start handoff records;
- artifacts, manifests, logs, and generated packages.

SQLite does not authorize process termination. Exact kernel identity and explicit process supervision remain mandatory.

The storage adapter must isolate the selected SQLite API. If the chosen API is still evolving, confine it to one module and test it against the pinned Node version.

### 3.5 Replace the handwritten Swift parser with a typed analyzer boundary

The current classifier must first be isolated behind this contract:

```ts
interface SwiftEditAnalyzer {
  analyze(editSet: EditSet): Promise<SwiftAnalysisResult>;
}
```

The long-term target is a small Swift analyzer built with SwiftSyntax/SwiftParser that emits versioned JSON containing the declaration surface required by Swift Sim. TypeScript compares analyzer outputs and applies routing policy.

Do not delete the existing classifier until a differential corpus proves the replacement.

Required analyzer behavior:

- parse ordinary, raw, extended, multiline, and interpolated strings correctly;
- parse nested comments, attributes, wrappers, conditional compilation, availability checks, regex literals, declarations, signatures, stored state, accessors, macros, imports, extensions, actors, generics, initializers, subscripts, and build-affecting surfaces;
- return a structured unsupported result, never guess after a parse failure;
- use a versioned JSON protocol;
- enforce a hard timeout and output limit;
- fail closed to signed rebuild when unavailable, incompatible, timed out, or malformed.

Acceptance rule: the new analyzer may be more conservative than the old classifier. It may not be more permissive for any corpus case without physical-device proof and a documented reason.

### 3.6 Split orchestration by responsibility

#### Mac helper

`swift-sim-helper` becomes a thin composition root. Target modules:

```text
mac-helper/
  bin/
    swift-sim-helper-entry.ts
  src/
    app/
      createHelperRuntime.ts
      helperService.ts
      commandDispatcher.ts
    commands/
      sessionCommands.ts
      deviceBuildCommands.ts
      pairingCommands.ts
      setupCommands.ts
    http/
      createRouter.ts
      routeContext.ts
      routes/
        healthRoutes.ts
        pairingRoutes.ts
        sessionRoutes.ts
        appRoutes.ts
        deviceBuildRoutes.ts
        artifactRoutes.ts
    domain/
    infrastructure/
```

Route files authorize first, validate second, call one application service, and project one response. They do not spawn processes or mutate files directly.

#### Live reload

Target modules:

```text
mac-helper/src/live/
  contracts.ts
  classify/
    analyzerClient.ts
    routingPolicy.ts
    legacyAnalyzer.ts
  xcode/
    containerDiscovery.ts
    schemeSelection.ts
    buildSettings.ts
    compilationCapture.ts
  engine/
    engineController.ts
    engineOwnership.ts
    engineProtocol.ts
    engineRecovery.ts
  patch/
    patchCompiler.ts
    patchBundle.ts
    patchLoader.ts
    proofEvaluator.ts
  delivery/
    deliverChange.ts
    recoveryPolicy.ts
```

No module in this tree should combine lexical analysis, Xcode discovery, process ownership, and patch delivery.

#### iOS companion

Target feature split:

```text
Companion/SwiftSimCompanion/
  App/
    SwiftSimCompanionApp.swift
    AppCoordinator.swift
  Networking/
    HelperAPIClient.swift
    HelperContracts.swift
  Persistence/
    ManagedAppRepository.swift
    RecentSessionRepository.swift
    PairingRepository.swift
  Features/
    Home/
    Pairing/
    Simulator/
    DeviceBuild/
    AppLibrary/
  SharedUI/
  Models/
```

`SessionStore` must be reduced to coordination and eventually removed or renamed. Network requests, persistence, feature state, and navigation must not remain in one class.

Use `@MainActor` feature models and protocol-driven dependencies. Move non-UI persistence/network work into actors or sendable services where appropriate. Preserve current UX during the refactor.

### 3.7 Tests must prove behavior through stable seams

Replace source-text assertions with behavior tests.

Temporary source assertions may remain only while their replacement test is added in the same or immediately following PR. Track the count in CI and require it to decrease; never add a new source-text assertion.

Testing layers:

1. Pure unit tests for policy, validation, projections, migrations, and error mapping.
2. Component tests using real temporary directories/databases and fake clocks/process identities.
3. Process integration tests that launch the built helper/gateway/manager with an isolated `HOME`.
4. Contract tests for public and private HTTP surfaces.
5. Release tests against the compiled package tree.
6. Physical-device gates for claims that only hardware can prove.

Fault-injection coverage must include:

- crash before and after durable publication;
- stale and reused PIDs;
- malformed and partial records;
- lock replacement during reclamation;
- helper restart during build, delivery, and live registration;
- timeout with descendants still running;
- pairing change during an in-flight response;
- database busy, failed migration, and interrupted migration;
- analyzer timeout, malformed response, and version mismatch;
- public-route attempts to access private capabilities.

### 3.8 Preserve decisions, remove review churn from the public mental model

Do not rewrite Git history.

Replace round-by-round review documents with durable architecture records:

- extract lasting decisions into ADRs;
- keep one short archived review index if historical traceability is useful;
- remove review ledgers from normal documentation navigation;
- delete redundant internal handoff files after their decisions are captured;
- keep public docs focused on product behavior, setup, security, recovery, and contribution.

The repository should not advertise its internal AI review loop as part of the product architecture.

### 3.9 Normalize package and release boundaries

The Swift package must eventually be consumable through normal immutable releases without forcing downstream apps to pin Swift Sim by commit because of an unstable transitive fork revision.

Target:

- create reviewed semantic-version tags for the thin InjectionNext fork or split the Swift Sim control protocol into a separately versioned package;
- use exact compatible versions in `Package.swift`;
- keep the engine app asset separately signed and checksum-pinned;
- document one version-compatibility matrix;
- test release archive, Homebrew formula, helper protocol, plugin manifests, companion version, Swift package, and engine asset together.

Do not expand the fork beyond the minimal headless/control changes Swift Sim requires.

## 4. Execution sequence

Each numbered phase is a separate draft PR. A phase may be split further, but phases must not be combined merely to move faster.

### Phase 0 — Baseline and architectural guardrails

Purpose: create a trustworthy reference point before structural edits.

Changes:

- record current file/module responsibility inventory;
- record current test counts and release commands without hard-coding them into product copy;
- add architecture fitness checks that prohibit new preloads, new source-text tests, new direct process spawning outside an allowlisted infrastructure boundary, and new destructive filesystem calls outside an allowlisted artifact/lock boundary;
- add a machine-readable inventory of existing preloads and source-text tests;
- fix obvious repository polish errors such as stale workflow badges;
- create ADR template and initial ADRs for TypeScript, explicit infrastructure ports, storage split, and Swift analyzer direction.

Gate:

- no production behavior change;
- full existing validation passes;
- inventory is generated from the tree, not manually falsifiable.

### Phase 1 — TypeScript compiler and package execution foundation

Purpose: make compiled, typed code possible without changing behavior.

Changes:

- choose and pin the supported Node LTS line;
- add TypeScript, build configs, source maps, and compiled `dist/` output;
- compile existing JavaScript with `allowJs`;
- make tests able to run against `dist/`;
- add strict typed contract modules and runtime validators;
- add formatter and linter with narrow initial rules;
- update Homebrew/release packaging to include only intended runtime files;
- add CI for source build, package build, and compiled-tree tests.

Gate:

- source-tree and compiled-tree behavior match;
- package entrypoints resolve from a clean archive;
- no runtime transpiler in production;
- no broad lint disable file;
- no generated `dist/` committed unless the release architecture explicitly requires it.

### Phase 2 — Explicit infrastructure primitives

Purpose: create named, testable replacements for hidden runtime behavior.

Changes:

- implement typed `CommandRunner`, `ProcessSupervisor`, `AtomicFileStore`, `LockManager`, `ArtifactStore`, `RequestOriginPolicy`, `Clock`, and `Logger`;
- move existing hardening logic behind these APIs with characterization tests;
- add dependency injection through a runtime container;
- keep preloads as temporary adapters that delegate to the same implementations;
- forbid new direct infrastructure access outside the infrastructure layer.

Gate:

- identical timeout, descendant cleanup, ownership, redaction, and containment behavior;
- process integration tests exercise the real compiled entrypoints;
- no weakening of fail-closed behavior.

### Phase 3 — Helper and HTTP decomposition

Purpose: reduce the helper entrypoint to composition and routing.

Changes:

- extract command parsing and handlers;
- extract route modules by authorization boundary;
- create typed request context and projection functions;
- remove module-global singleton construction from imported production modules;
- centralize service startup, timers, sockets, and graceful shutdown;
- preserve route paths and response contracts.

Gate:

- helper entrypoint is primarily wiring;
- route authorization matrix has contract tests;
- public gateway still returns `404` for every private route;
- no route directly spawns a process or mutates persistence.

### Phase 4 — Repository interfaces and SQLite migration

Purpose: remove the custom JSON database while preserving crash recovery.

Changes:

- define typed repository interfaces and transactions;
- implement SQLite schema and migrations behind one adapter;
- build one-time import from legacy JSON with backup and resumability;
- dual-read in shadow mode first and compare projections;
- then switch writes to SQLite with a rollback window;
- retain explicit runtime journals and leases outside SQLite;
- add `swift-sim doctor` checks for schema, migration, permissions, and orphan artifacts;
- add export/redacted diagnostic support.

Gate:

- migration is idempotent and interruption-safe;
- old data remains readable after rollback during the defined rollback window;
- no duplicate apps/builds/sessions after repeated migration attempts;
- all domain mutations are transactional;
- database corruption fails closed and produces actionable recovery guidance;
- clean Homebrew upgrade from the previous tagged release succeeds.

### Phase 5 — Remove preload and monkey-patch architecture

Purpose: make guarantees visible at call sites.

Changes:

- migrate process execution to `CommandRunner`/`ProcessSupervisor`;
- migrate locks and atomic publication to explicit stores;
- migrate HTTP origin/capability checks to middleware/policy objects;
- migrate artifact containment to `ArtifactStore`;
- remove preload imports one capability at a time;
- delete compatibility preloads when zero production call sites depend on them;
- add an architecture test that production entrypoints do not replace built-in module functions or class prototypes.

Gate:

- packaged and raw entrypoints share the same explicit runtime container;
- no Node built-in monkey patch remains;
- no import-order-dependent safety behavior remains;
- all prior adversarial lifecycle regressions still pass.

### Phase 6 — Live reload module split

Purpose: separate classification, Xcode, engine, patch, proof, and fallback responsibilities before changing the analyzer.

Changes:

- move contracts first;
- extract pure routing policy;
- extract Xcode container/scheme/signing/compilation capture;
- extract engine ownership/control/recovery;
- extract patch compilation/loading/proof;
- keep the existing classifier behind `SwiftEditAnalyzer`;
- replace source-text lifecycle assertions with injected-dependency/process tests.

Gate:

- old and new delivery envelopes are equivalent for the complete corpus;
- physical-device benchmark results do not regress beyond an agreed tolerance;
- `liveReload` facade is small and compatibility-only or deleted.

### Phase 7 — SwiftSyntax analyzer replacement

Purpose: remove the partial Swift parser from TypeScript.

Changes:

- implement versioned Swift analyzer executable/library;
- create analyzer client with timeout, output bounds, checksum/version verification, and fail-closed fallback;
- run old and new analyzers over every corpus case and real captured edit set;
- publish differential report;
- switch routing to the new analyzer only after acceptance;
- retain the legacy analyzer behind a temporary diagnostic flag for one release, never as an automatic permissive fallback;
- delete handwritten parsing only after the rollback release window.

Gate:

- zero newly permissive cases without physical proof;
- malformed/unsupported syntax always rebuilds;
- analyzer installation and upgrade work through Homebrew release packaging;
- clean machines do not compile the analyzer unexpectedly during normal use unless that is an explicit product decision.

### Phase 8 — iOS companion feature architecture

Purpose: split state, networking, persistence, and UI without redesigning the product.

Changes:

- create typed helper API client and endpoint contracts;
- extract pairing, Simulator, device-build, and app-library feature models;
- move local storage into repositories;
- introduce app coordinator/navigation state;
- split `ContentView.swift` by feature and shared components;
- split `SessionStore.swift` until it is removed or a small compatibility coordinator;
- add deterministic tests for response revision fencing, pairing replacement, app ownership, install state, and cancellation.

Gate:

- current UI behavior and accessibility remain intact;
- no feature model exceeds an agreed responsibility/size threshold without ADR justification;
- networking is mockable without global `URLSession.shared` use in feature logic;
- all UI state mutations remain actor-safe.

### Phase 9 — Test, documentation, and release consolidation

Purpose: finish the maintainability transition.

Changes:

- remove remaining source-text tests;
- delete obsolete handoff and review-round documents after extracting ADRs;
- add architecture overview for contributors;
- fix all stale badges and release references;
- add package-content and clean-install tests;
- add multi-project/multi-target fixture coverage;
- normalize Swift package and engine fork versioning;
- add changelog and migration guide.

Gate:

- zero source-text implementation assertions;
- zero preload inventory entries;
- package contains no internal review artifacts required only by prior agents;
- clean release install and upgrade are repeatable.

### Phase 10 — Product reliability proof

Purpose: earn the final step from strong beta to mature product.

Run a documented compatibility matrix across:

- fresh and upgraded Macs;
- supported macOS and Xcode versions;
- `.xcodeproj` and `.xcworkspace`;
- single and multiple shared schemes;
- automatic and manual signing cases;
- USB, local-network, private Tailnet, cellular install-link use;
- interrupted builds, helper restart, Mac sleep/wake, expired links, stale pairings;
- representative SwiftUI, UIKit bridge, package, resource, entitlement, and structural edits;
- at least a small set of external beta users who did not develop Swift Sim.

Because Swift Sim intentionally has no analytics service, collect evidence through opt-in redacted diagnostic bundles, structured issue templates, and explicit beta reports.

Gate:

- onboarding, install, update, recovery, and uninstallation are documented and repeatable;
- common failures produce one actionable recovery path;
- release claims match measured evidence;
- unresolved compatibility limits are published honestly.

## 5. Pull-request sizing and sequencing rules

- Prefer 200–800 changed production lines per PR when practical.
- A PR may be larger when it moves code mechanically and proves behavior equivalence.
- Never mix a storage migration, process-ownership rewrite, and user-visible feature.
- Every PR starts from current `main`, not from a long-lived chain, unless the immediately previous phase has not merged and the dependency is unavoidable.
- Each PR must state which invariants it touches.
- Each PR must include rollback instructions.
- Mechanical extraction comes before behavior change.
- New architecture must run in shadow or compatibility mode before replacing a durable path.
- Delete the old path only after the replacement has passed the defined release window.

## 6. Success metrics

The consolidation is complete when all are true:

- TypeScript is canonical for Node production code.
- The declared Node version is supported and tested.
- No production preload monkey-patches Node built-ins or prototypes.
- No central file combines unrelated classification, process, persistence, HTTP, and delivery responsibilities.
- Domain state uses transactional repository APIs and a versioned database.
- Runtime process ownership remains explicit and independently recoverable.
- Swift classification uses a real Swift parser/analyzer boundary.
- The iOS companion has feature-scoped models and clients.
- No test asserts exact production source text or function layout.
- Public documentation does not expose internal review churn as product architecture.
- Clean install, upgrade, migration, build, install, verification, live update, fallback, recovery, and removal paths are proven.

Line count is not the primary metric, but the following are healthy targets:

- composition entrypoints under 300 lines;
- route modules under 400 lines;
- feature models generally under 500 lines;
- no production file over 800 lines without an ADR explaining why cohesion is better than further extraction.

## 7. Explicitly rejected approaches

Do not:

- rewrite the entire Node helper in one PR;
- rewrite the Node helper in Swift merely for language uniformity;
- move private control or source to a cloud backend;
- use SQLite as proof that process ownership is solved;
- keep both JSON and SQLite as permanent writable sources of truth;
- introduce a runtime TypeScript loader into the shipped helper;
- add a large framework only to obtain dependency injection;
- make the new Swift analyzer permissive to improve benchmark numbers;
- hide failed physical attempts from evidence reports;
- rewrite Git history to conceal AI-assisted development;
- continue endless unscoped review rounds instead of completing the planned architecture phases.

## 8. Completion ownership

The executing agent must maintain `ARCHITECTURE_CONSOLIDATION_PROGRESS.md` on the implementation branch or in each phase PR. It must record:

- exact base and head;
- phase and subphase;
- invariants touched;
- files moved versus behavior changed;
- tests added and removed;
- source-text assertion count;
- preload count;
- JavaScript/TypeScript production file count;
- largest production files;
- migration/rollback state;
- validation performed;
- residual risks and next phase.

A phase is not complete merely because tests pass. It is complete when its old architecture has either been removed or has an explicit time-bounded compatibility role.