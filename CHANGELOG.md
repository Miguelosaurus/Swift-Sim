# Changelog

Notable changes to Swift Sim are recorded here. The project follows [Semantic Versioning](https://semver.org/) for tagged Homebrew releases.

## Unreleased

## 0.5.0 - 2026-07-22

### Added

- A user-transparent headless live engine that Swift Sim provisions, verifies, launches, and configures without a separate Mac app workflow.
- Deterministic compiler-command capture and source injection with request-correlated completion in place of file-watcher timing.
- Private Tailscale userspace forwarding for remote iPhones that are not on the Mac's Wi-Fi.
- Compiler-supported SwiftUI dynamic replacements with a root-revision acknowledgment, so zero-effect patches fail without screenshot analysis.
- Physical-iPhone end-to-end proof over a private Tailnet, including two consecutive acknowledged SwiftUI replacements in under one second each without rebuilding or reinstalling the app.
- Multi-file hot reload routing that patches implementation-only Swift changes together and sends the entire edit through a signed rebuild when any file changes structure.

### Changed

- Pinned the live client to Swift Sim's thin `swift-sim-engine` fork while keeping upstream changes mergeable.
- Made setup, doctor, build metadata, and agent routing describe one Swift Sim feature instead of exposing the underlying engine.
- Made live-enabled Debug builds fully managed: Swift Sim supplies the compiler/linker settings, uses Xcode's Debug dylib layout, and packages the signed app as a regular IPA.
- Made first-time development provisioning select a reachable physical iPhone so Xcode can register it automatically, and made userspace Tailscale discovery fail fast instead of hanging behind a stale system CLI.
- Updated the pinned engine to avoid multicast loops on Swift Sim's explicit Tailnet route and to sign physical-device patches without blocking its main queue.
- Bounded stale live-engine logs on restart so a transport failure cannot leave an unbounded diagnostic file.
- Added a noninteractive signing preflight before engine startup, avoiding a delayed first-patch failure when macOS has not granted private-key access.
- Bounded persisted device-build logs and throttled progress writes to keep long Xcode builds responsive.
- Switched Homebrew releases to checksum-pinned, explicit GitHub release bundles that are never replaced in place.

## 0.3.0 - 2026-07-18

### Added

- Debug-only remote iPhone hot reload over a private Tailnet using the new `SwiftSimLive` root modifier and pinned InjectionNext engine.
- `live-status`, `live-start`, `classify-change`, and `route-change` commands for setup diagnosis and automatic hot-reload-versus-rebuild routing.
- A conservative Swift declaration-surface classifier with normal signed-build fallback for structural and non-Swift changes.
- A native Live Edits card for compatible Debug builds in the iPhone companion.
- Automatic background reconciliation of requested iPhone installs with exact version and build matching.
- In-app creation of a fresh install link after an existing link expires.
- Native iOS regression tests for install-state behavior and paired-Mac fallback.
- First-run actions for pasting install and Simulator links.
- Public contribution, conduct, security, issue, and pull-request guidance.

### Changed

- Expanded the shared agent contract so Codex, Cursor, Claude Code, and OpenCode select the live lane only when it is safe and provably connected.
- Reworked the iPhone install screen around plain-language status, app-data behavior, link availability, and optional technical details.
- Simplified app-library, history, Simulator, and Mac-connection copy.
- Made the install handoff resilient to the initial status refresh and external iOS URL callback, so the first tap can complete the install flow.
- Added repeated `--build-setting KEY=VALUE` overrides for device builds and documented the shared signing/build-metadata behavior.

## 0.2.3 - 2026-07-05

- Made Homebrew releases and installed agent integrations reproducible from one versioned package.

## 0.2.2 - 2026-07-05

- Released the version-matched Swift Sim integration across Codex, Cursor, Claude Code, and OpenCode.

## 0.2.1 - 2026-07-03

- Rebound Codex installation to the packaged Swift Sim marketplace and aligned the companion release.

## 0.2.0 - 2026-07-03

- Added the app library, build history, signed iPhone delivery, and production build timestamp handling.

## 0.1.0 - 2026-07-03

- Initial tagged release.
