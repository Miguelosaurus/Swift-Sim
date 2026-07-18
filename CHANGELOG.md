# Changelog

Notable changes to Swift Sim are recorded here. The project follows [Semantic Versioning](https://semver.org/) for tagged Homebrew releases.

## Unreleased

### Added

- A user-transparent headless live engine that Swift Sim provisions, verifies, launches, and configures without a separate Mac app workflow.
- Deterministic compiler-command capture and source injection with request-correlated completion in place of file-watcher timing.
- Private Tailscale userspace forwarding for remote iPhones that are not on the Mac's Wi-Fi.
- SwiftUI visual proof so a loaded patch with no rendered change is treated as failure and falls back to a fresh signed link.

### Changed

- Pinned the live client to Swift Sim's thin `swift-sim-engine` fork while keeping upstream changes mergeable.
- Made setup, doctor, build metadata, and agent routing describe one Swift Sim feature instead of exposing the underlying engine.

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
