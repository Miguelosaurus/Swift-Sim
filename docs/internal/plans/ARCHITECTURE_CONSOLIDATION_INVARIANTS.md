# Architecture Consolidation Invariants

These invariants are release gates for every architecture-consolidation pull request. They are not suggestions. A phase that cannot preserve an invariant must stop and propose an explicit product decision before changing behavior.

## 1. Trust and privacy

1. Project source remains on the user's Mac.
2. Apple credentials, signing identities, provisioning material, archives, and saved IPAs remain on the user's Mac.
3. The iPhone companion never receives source paths, archive paths, signing paths, raw process IDs, Simulator UDIDs, or raw tool output through public projections.
4. The full helper binds to loopback by default.
5. Simulator media, controls, pairing, remote build commands, and Debug live patches remain private-Tailnet capabilities.
6. The temporary public delivery gateway exposes only the exact token-scoped build routes documented for public delivery.
7. Public delivery must not expose app listing, app mutation, pairing, build creation, Simulator control, live-engine control, or arbitrary filesystem access.
8. Tokens remain separate by capability: pairing, session, and device build.
9. Logs and diagnostic bundles must redact credentials, absolute private paths, device identifiers, and signing details by default.
10. No analytics, account, source-code, or persistent artifact backend may be introduced as part of this refactor.

## 2. Build and install semantics

1. Xcode remains the authority for building and signing.
2. Swift Sim never claims to bypass Apple signing, provisioning, device registration, entitlement, or installation rules.
3. App updates preserve data by default by installing over the existing app rather than uninstalling first.
4. Bundle identifier and signing team remain the stable app identity boundary.
5. A phone-triggered rebuild uses only a previously trusted private recipe from the paired Mac.
6. A phone-triggered rebuild fails closed if the project disappears or the app identity changes.
7. Opening an install page is not installation success.
8. Recording an install request is not installation success.
9. `Installed` requires verification of the exact expected version and build on a reachable physical device.
10. A saved IPA may be republished without compiling current source; that operation must remain distinct from rebuilding current source.

## 3. Simulator lifecycle

1. Swift Sim stops only the tracked Simulator stream for the exact intended Simulator.
2. It never runs or emulates an unscoped `serve-sim --kill` operation.
3. Session reuse remains scoped by project, scheme, Simulator identity, and compatible transport.
4. Competing starts, stops, restarts, and recoveries remain serialized for the same runtime target.
5. A stale session cannot stop or overwrite a replacement runtime.
6. A helper crash during publication cannot leave an unowned runtime that later appears valid.
7. A malformed or unverifiable ownership record fails closed.
8. PID existence alone never proves ownership.
9. PID reuse must not authorize cleanup, termination, or adoption.
10. Recovery must distinguish a live replacement owner from a stale predecessor.

## 4. Process execution and shutdown

1. Every bounded external command has a parent-enforced deadline.
2. A timed-out noninteractive command cannot leave descendants running.
3. Interactive inherited-stdio commands preserve terminal Ctrl-C behavior.
4. Delayed cleanup cannot signal a recycled PID or process group.
5. Graceful shutdown has a bounded hard deadline.
6. One-shot commands retain normal signal behavior and are not treated as long-running services.
7. A failed child publication rolls back only the exact verified child process/group.
8. Startup recovery never signals a live unverifiable legacy worker record.
9. Process identity verification occurs before destructive action.
10. Process ownership logic remains testable without depending on global monkey patches after the preload-removal phase.

## 5. Durable state

1. Existing users' state remains migratable from the previous tagged release.
2. Migration is idempotent.
3. Migration can resume or roll back after interruption.
4. A repeated migration attempt cannot duplicate apps, builds, sessions, recipes, invitations, or cleanup jobs.
5. Domain-state writes are transactional after the SQLite cutover.
6. There is exactly one writable source of truth after the migration window.
7. Runtime ownership journals remain independently recoverable when the domain database is unavailable.
8. Database state never authorizes process termination without external identity proof.
9. Malformed state is preserved for diagnosis unless safe repair is proven.
10. State and credential files retain owner-only permissions.
11. Artifact deletion remains contained to Swift Sim-owned roots.
12. Cleanup jobs remain durable and retryable.
13. App/build history from another Mac or an ownerless install link cannot inherit mutation authority from the currently paired Mac.
14. Stale responses cannot overwrite state after pairing, view, app, build, or operation generations change.

## 6. Pairing and authorization

1. Pairing invitations remain short-lived, one-time, installation-bound credentials.
2. The helper stores only the invitation hash, not the reusable plaintext invitation.
3. Repeating the same claim with the same client nonce remains idempotent.
4. A different nonce cannot reuse a consumed invitation.
5. Invitation endpoints remain private and absent from the public delivery gateway.
6. Pairing replacement invalidates authority derived from the previous Mac where required.
7. Forwarded origin information is trusted only at the explicit loopback proxy boundary.
8. Authorization runs before state mutation or expensive work.
9. Public error responses do not reveal whether unrelated private resources exist.
10. Changing storage or routing modules must not broaden route authorization.

## 7. Live reload safety

1. Live reload remains limited to development-signed Debug builds.
2. Release, TestFlight, and App Store builds never include or activate the live client.
3. The live engine and patch channel remain private-Tailnet-only.
4. Imports, declarations, signatures, stored state, macros, packages, resources, entitlements, capabilities, signing, and other structural changes require a signed rebuild.
5. Parse failure, analyzer failure, version mismatch, timeout, malformed output, or uncertainty requires a signed rebuild.
6. Compiler success alone is not proof of a successful live update.
7. Screenshot change alone is not proof of a successful live update.
8. Success requires an applied replacement/interposition result and the required runtime/root revision acknowledgement.
9. Multi-file atomic claims require one successfully prepared and loaded atomic bundle.
10. Partial application is reported honestly and must not be retried as though no mutation occurred.
11. Recovery is bounded and cannot cross engine ownership generations.
12. Project, workspace, scheme, host target, signing identity, compilation map, and engine generation remain exact routing inputs.
13. The new Swift analyzer may be more conservative than the old analyzer.
14. A newly permissive analyzer result requires physical proof and a documented rationale.
15. Failed valid physical attempts remain in evidence records.

## 8. HTTP and contract compatibility

1. Existing public route paths and companion deep-link shapes remain compatible unless a versioned migration is explicitly planned.
2. Public and private projections remain distinct typed contracts.
3. Public projections continue to omit private filesystem and process details.
4. Response envelopes remain bounded.
5. Error messages remain redaction-safe.
6. Helper, CLI, companion, agent skill, plugin manifests, docs, and release metadata describe the same behavior.
7. Protocol changes require an explicit protocol version and compatibility policy.
8. Old companion/new helper and new companion/old helper behavior must be defined for every protocol change.
9. The temporary gateway cannot accidentally inherit the full helper router through module reuse.
10. Contract tests must prove the authorization matrix.

## 9. iOS companion behavior

1. Existing install, library, pairing, Simulator, and recovery user flows remain behaviorally equivalent during structural refactors.
2. First-tap install handoff remains reliable even if iOS suspends the app after opening the installer.
3. Pairing, app sync, build refresh, logs, and connection diagnostics remain fenced against stale async responses.
4. Local history survives expired links.
5. Same-identity history from another Mac or an ownerless link remains local-only and cannot gain remote mutation authority.
6. UI state mutations remain main-actor-safe.
7. Network and persistence work can be cancelled without applying stale state.
8. Accessibility labels, hints, focus, and controls are preserved or improved.
9. The refactor must not require a visual redesign.
10. Global `URLSession.shared` use must be removed from feature logic by the end of the companion phase.

## 10. Packaging and release

1. Homebrew installation remains the supported Mac installation path.
2. A clean release archive contains every required runtime file and no local build products, secrets, or obsolete agent handoffs.
3. Setup installs version-matched CLI, helper, and agent integrations.
4. Release assets are immutable; a changed artifact requires a new version.
5. Engine assets remain signed and checksum-pinned.
6. The InjectionNext fork remains thin and reviewable.
7. Swift package dependency resolution becomes semver-compatible before the consolidation is declared complete.
8. CI tests the compiled package tree, not only the source checkout.
9. A clean install and an upgrade from the previous tagged release are release gates.
10. The minimum Node version in `package.json`, Homebrew, CI, docs, and runtime checks must match.

## 11. Test integrity

1. No production regression is accepted merely because a source-text assertion passes.
2. No new test may assert an exact implementation source snippet, function order, or import order.
3. Existing source-text tests must be replaced with behavior tests and their count must decrease monotonically.
4. Tests must not skip or weaken security, type, lifecycle, or migration assertions to make refactors pass.
5. Tests must exercise compiled production entrypoints.
6. Process tests use isolated temporary state and must clean up exact owned descendants.
7. Migration tests use realistic previous-version fixtures.
8. Public-route negative tests remain mandatory.
9. Physical-device claims are not replaced by Simulator-only tests.
10. Every fixed race or crash window retains a focused regression test through module movement.

## 12. Maintainability gates

1. New modules have one clear responsibility.
2. Application services do not import generic filesystem or child-process APIs directly after the infrastructure-boundary phase.
3. Route handlers do not own persistence or child-process orchestration.
4. Entry modules do not execute destructive side effects merely by being imported.
5. The production dependency graph does not rely on preload import order.
6. Unsafe data enters through a runtime validator before becoming a typed domain object.
7. New `any`, broad eslint disables, TypeScript `@ts-ignore`, and test skips require a narrowly documented reason and removal phase.
8. No production file exceeds 800 lines without an ADR explaining why further extraction would reduce cohesion.
9. Internal review artifacts do not become permanent product documentation.
10. Each phase removes or time-bounds the compatibility layer it introduces.

## 13. Required PR declaration

Every consolidation PR must include this block in its description:

```text
Phase:
Base / head:
Behavior change: none | described below
Invariants touched:
Compatibility layer added:
Compatibility layer removal deadline:
Migration impact:
Rollback procedure:
Validation:
Residual risk:
Next phase:
```

If the executing agent cannot fill every field honestly, the PR is not ready to merge.