# Phase 8 iOS Companion Feature-Boundary Map

Workstream: `P8-COMPANION-PREP`  
Class: preparatory  
Dispatch base: `38eee4bfb1eabc2184d92aa3e52fee28b139cbf5`  
ADR: `docs/internal/adr/ADR-0005-companion-feature-architecture.md`

## Scope

This report maps the **current** iOS companion into behavior-preserving Phase 8 ownership boundaries. It does not switch production feature ownership, helper routing, persistence authority, or UI behavior. Canonical roadmap, registry, progress, and current-handoff files are intentionally untouched.

## Current concentration

| Path | Approx. size | Current responsibilities |
| --- | ---: | --- |
| `Companion/SwiftSimCompanion/SessionStore.swift` | 98 KB | Main observable coordinator, link routing, pairing/helper networking, Simulator API, app/build library persistence, build/install flow, diagnostics, revision fencing, and most domain/wire models. |
| `Companion/SwiftSimCompanion/ContentView.swift` | 86 KB | Root route selection plus Home, library, app detail, build/install, pairing/settings, and shared presentation. |
| `Companion/SwiftSimCompanion/SimulatorStreamView.swift` | 36 KB | MJPEG/H.264 streaming, decoder queues, reconnect/watchdog, masks, and gesture normalization. |
| `Companion/SwiftSimCompanion/SwiftSimCompanionApp.swift` | 29 KB | Root lifecycle, incoming URLs, pairing confirmation, secure pairing persistence, and the legacy Swift request fence. |
| `Companion/SwiftSimCompanion/SimulatorSessionView.swift` | 25 KB | Simulator presentation, controls, console/keyboard/options, and stream selection. |
| `Companion/SwiftSimCompanion/SwiftSimLatestRequestProtocol.m` | 17 KB | Global latest-request and visible-session authorization fence. |
| `Companion/SwiftSimCompanion/SimulatorWebView.swift` | <1 KB | Minimal WKWebView fallback adapter; no current Swift source reference found at this base. |

The companion test target contains only `Companion/SwiftSimCompanionTests/InstallationStateTests.swift` at this base.

## Responsibility map

### Cross-feature coordinator/navigation

`SessionStore` currently owns `currentSession`, `currentDeviceBuild`, `selectedManagedAppID`, `isMacSettingsPresented`, incoming-link classification, and close/reopen transitions. `ContentView` chooses the top-level route directly from those values: Simulator, then device build, then managed app, then Home.

These are application/navigation responsibilities. They should eventually be expressed by an integration-owned coordinator/router rather than copied into feature stores.

Most ephemeral UI state is already correctly local: search/filter values, Home mode, sheet/disclosure state, confirmations, paste-link editing, and Simulator render state.

### Pairing/helper connection

Current behavior includes pairing-link/invite parsing, claim and verification, replacement/forget behavior, helper status, connection diagnostics, secure persisted pairing state, product error projection, and pairing-generation fencing.

The secure persistence implementation and the `PairedMac` encoding bridge live in different source files today. They form one migration unit: moving the model without preserving the persistence adapter would be unsafe and behavior-changing.

### App/build library

Current behavior includes managed app/build persistence, legacy build-history import, remote library synchronization, optimistic archive/delete with guarded rollback, per-app operation generations, mixed-source ownership rules, and invalidation when the paired Mac changes.

Important authority rules to preserve:

- remote sync removes only history owned by the syncing Mac;
- same-app history from another source remains preserved;
- mixed-source history becomes local-only rather than granting one Mac mutation authority over all builds;
- stale rollback cannot overwrite a newer local operation.

### Device build/install

Current behavior includes status-source selection/fallback, logs, current-source remote build requests, install-link renewal, synchronous install URL preparation, optimistic install state, system-open rollback, install-request synchronization, installation verification, and build-view generation fencing.

A critical presentation seam exists: when an install URL is already available, the system open is intentionally initiated from the original button event. Moving that first handoff behind asynchronous work can change iOS behavior. BuildInstall may prepare state and URLs, but the actual system-open callback must remain a presentation/integration responsibility.

### Simulator domain

Current behavior includes session status/log refresh, active transport, semantic controls and input, keyboard request ordering, recent-session persistence, connection diagnostics, and session-generation fencing.

### Live preview

The stream representable coordinators already form a useful specialized boundary. They own long-running stream resources, MJPEG/H.264 decoding, native backpressure/reconnect/watchdog behavior, frame masks, and input-coordinate normalization. They should move as a unit under LivePreview rather than into the general request/response client.

## Helper API/client boundary

The Mac helper already exposes separable server-side route families:

1. **Pairing/helper control** — helper reachability, pairing status and pairing claim.
2. **App library** — app listing, archive/delete, and build-current-source.
3. **Device build** — build status/logs, installation-request synchronization, verification, renewal, and install resources.
4. **Simulator session** — session status/logs/stream/frame-mask and semantic input/control operations.

Phase 8 should mirror these families with typed feature clients. It should not introduce one all-purpose client containing every helper endpoint.

Compatibility requirements for the client extraction:

- preserve current authorization placement and capability scoping;
- preserve the helper JSON error contract and current status-code interpretation;
- preserve direct-build versus paired-helper fallback behavior;
- preserve existing session/build capability URLs;
- preserve cancellation semantics relied on by request fencing.

Important asynchronous policy is also behavior, not incidental implementation detail:

- pairing claim has bounded retry for selected transient failures and distinguishes major terminal outcomes;
- build status can fall back between two existing sources;
- parent cancellation must not accidentally start fallback work;
- current-source build reuses one request identity across retries until success;
- archive/delete rollback is suppressed after a newer operation or pairing context;
- negative installation observations continue verification until the expected version is confirmed;
- Simulator diagnostics do not activate or supersede the visible session;
- keyboard requests remain ordered;
- long-lived stream lifetime follows view lifecycle.

## Shared request-fence seam

Two request-fence implementations exist. The Swift implementation is declared in `SwiftSimCompanionApp.swift`. `SwiftSimLatestRequestProtocol.m` installs itself at runtime, disables/unregisters the older implementation, and registers the newer fence.

The Objective-C fence is more than a transport utility. It derives visible Simulator selection from persisted recent-session state, tracks selection generations, distinguishes diagnostic requests from visible-session requests, fences status/log/input/stream traffic, and supports a narrow reconnect path.

Therefore these surfaces must remain **integration-owned** during Phase 8:

- global URLProtocol registration/replacement;
- visible-session selection authority;
- persisted recent-session ordering currently observed by the fence;
- request generation and selection-epoch semantics;
- any eventual fence removal/replacement.

Simulator and LivePreview feature agents should not independently edit this surface.

## Model ownership proposal

Do not move every type from `SessionStore.swift` into a global Models folder unchanged.

**Pairing-owned**

- paired-Mac metadata and pairing link/invite models;
- pairing status/claim wire DTOs;
- pairing error/state models;
- helper connection state, with display copy kept in presentation.

**Library-owned**

- `ManagedApp`;
- library persistence records and legacy import input;
- remote app-list wire DTOs;
- app ownership/archive metadata.

**BuildInstall-owned**

- device-build capability identity;
- device-build status/app/signing/delivery/installation/link models;
- verified-device and installation-state models;
- build log/error DTOs.

**Simulator-owned**

- Simulator session capability identity;
- `RecentSession` and transport/status/log models;
- gesture/multitouch events.

**Core only when truly cross-feature**

- common request/error primitives;
- stable date decoding if multiple clients require it;
- a read-only pairing context consumed by Library/BuildInstall;
- at most a narrow build summary/update protocol shared by Library and BuildInstall.

## UI/navigation state versus domain state

**Keep in views/presentation:** Home mode, search/filter state, archived toggle, paste-link editing/focus, alerts/disclosures, Simulator sheets, stream frame/render state, and install confirmation.

**Move to feature state:** pairing attempt/status/error, library sync/mutation state, build status/log/install operation state, and Simulator status/log/transport/diagnostics.

**Keep integration-owned:** top-level route, route produced by an incoming link, cross-feature settings presentation, root dependency construction, and scene lifecycle fan-out.

## Side effects and lifecycle ownership

| Side effect | Future owner |
| --- | --- |
| Root scene lifecycle and top-level link dispatch | integration shell |
| secure pairing persistence/migration | Pairing repository/security adapter |
| paired-Mac metadata persistence | Pairing repository |
| managed-library persistence/migration | Library repository |
| recent Simulator persistence | Simulator repository |
| normal request/response helper calls | feature clients over integration-owned HTTP primitive |
| system install URL open | presentation/user-gesture boundary |
| build polling | BuildInstall lifecycle |
| Simulator status refresh | Simulator lifecycle |
| long-lived stream/decoder resources | LivePreview rendering |
| latest-visible-session request fence | integration-owned compatibility seam |

## Existing characterization and gaps

The current unit tests already protect several high-risk semantics:

- synchronous first-tap install URL and expired-link rejection;
- install-state preservation;
- paired/direct build-source preference;
- opaque app identity for remote rebuilds;
- pairing link/invite parsing;
- stale pairing, Simulator, diagnostics, and build-response rejection;
- exact paired-Mac ownership for mutation;
- per-app operation generation logic;
- remote sync only deleting owned history and preserving foreign same-app history;
- continued installation verification after negative observations;
- substantial secure pairing persistence/migration/replacement behavior.

Before each relevant production cutover, add missing characterization for:

- injectable transport authorization/error/timeout/retry/cancellation behavior;
- full pairing claim -> verify -> persist outcomes;
- library legacy import/dedup and mixed-source sync/rollback;
- full build fallback, request-identity reuse, system-open failure rollback, and polling cancellation;
- direct Objective-C request-fence classification, diagnostic-vs-visible behavior, close/reopen generations, and reconnect behavior;
- ordered keyboard requests against a fake client;
- MJPEG fragmentation/recovery, H.264 queue bounds/watchdog, stale stream callbacks, mask replacement, and letterbox gesture normalization;
- root route/deep-link and scene-active refresh behavior.

This PREP branch intentionally does not introduce a new transport abstraction or visible-selection authority because either would begin the shared production cutover.

## Proposed disjoint Phase 8 packages

### `P8-CORE-INTEGRATION-SCAFFOLD` — serial prerequisite

Own the common request/error contract, minimal cross-feature protocols/models, dependency factories, coordinator/link-router protocol, reusable fake transport, shared Xcode membership, and a compatibility adapter to current behavior. It changes no feature authority.

### `P8-PAIRING` — parallel after scaffold

Own Pairing client/DTOs, secure repository adapter, persistence/migration, feature state/error taxonomy, and pairing-specific helper status. Root link confirmation and global request registration remain integration-owned.

### `P8-LIBRARY` — parallel after scaffold

Own Library repository, persistence compatibility adapter, legacy import, remote app client/DTOs, managed app/build merge rules, optimistic mutation/rollback, and focused tests. It consumes read-only pairing context and does not own root navigation or build execution.

### `P8-BUILD-INSTALL` — parallel after scaffold

Own DeviceBuild client/models, status/log fallback, renew/verify/install-request, current-source request identity, BuildInstall feature state, and install preparation/rollback. It consumes pairing context and a narrow Library build-summary/update contract. The actual system URL open remains a UI/integration callback.

### `P8-SIMULATOR` — parallel after scaffold

Own Simulator client/models, recent-session repository, feature state, diagnostics, keyboard sequencing, and semantic input/control. It consumes an integration-owned visible-selection identity while the legacy fence remains active. It does not own decoders/renderers or the global fence.

### `P8-LIVE-PREVIEW` — after Simulator action contract is stable

Own Simulator session presentation, MJPEG/H.264 render adapters/coordinators, masks, reconnect/watchdog/backpressure, gesture normalization, and retained web fallback. It consumes semantic Simulator actions/status through a protocol.

### `P8-COMPANION-INTEGRATION` — serialized cutover owner

Sole owner of production edits to:

- `SessionStore.swift` compatibility façade/removal;
- root `ContentView.swift` routing/composition;
- `SwiftSimCompanionApp.swift` lifecycle/dependency wiring;
- `SwiftSimLatestRequestProtocol.m` migration/removal decisions;
- shared networking/protocol/model files;
- cross-package Xcode target membership;
- final top-level coordinator.

Cut over one feature authority at a time only after its characterization passes.

## Dependency graph

```text
P8-CORE-INTEGRATION-SCAFFOLD
  +--> P8-PAIRING -----------+
  +--> P8-LIBRARY -----------+
  +--> P8-BUILD-INSTALL -----+--> P8-COMPANION-INTEGRATION
  +--> P8-SIMULATOR --> P8-LIVE-PREVIEW --+
```

Library and BuildInstall share only a narrow build-summary/update contract. Feature branches should add feature-owned files/tests and leave edits to the current monolithic coordinator for the integration owner.

## Recommended cutover order

1. core integration scaffold and fake transport;
2. Pairing;
3. Library;
4. BuildInstall;
5. Simulator domain while retaining the existing request fence;
6. LivePreview organization;
7. explicit characterization/decision for replacing the Objective-C request fence;
8. remove the compatibility `SessionStore` façade only after all feature/integration behavior passes together.

The request fence is a late migration, not opportunistic cleanup during Simulator extraction.

## Invariant review

- **Source of truth:** this PREP change introduces no new authority. Future feature stores must not become parallel writable authorities during migration.
- **Process/filesystem ownership:** no Mac helper process/filesystem ownership changes are proposed.
- **Privacy:** existing secure pairing storage and scoped capability behavior remain compatibility requirements; feature clients should not broaden persisted or logged sensitive data.
- **Migration/rollback:** pairing persistence migration and legacy library import must be characterized before movement; serialized cutovers should retain a reversible compatibility adapter until parity is proven.
- **Raw source/runtime:** no helper packaging or raw-source/runtime boundary changes.
- **Compatibility bridge:** the dual Swift/Objective-C fence arrangement is an existing bridge. Any new explicit selection/cancellation mechanism must define the old fence's removal point instead of leaving multiple authorities indefinitely.

## Outcome

The current companion can be split by feature without a rewrite, but independent agents should build behind narrow protocols while shared production cutovers remain serialized. The helper API already exposes useful domain boundaries. The highest-risk seams are the monolithic iOS coordinator, install user-gesture handoff, secure pairing persistence bridge, and global visible-session request fence.

No production behavior was changed by `P8-COMPANION-PREP`.