# Contributing to Swift Sim

Thanks for helping improve Swift Sim. The project spans a Node.js Mac helper, a native SwiftUI companion, agent integrations, and release packaging. Changes should keep those pieces version-matched and preserve the local-first security model.

## Before You Start

- Search existing issues before opening a new one.
- Open a feature request before implementing behavior that would change the trust model, supported agents, or delivery architecture.
- Report security problems privately using [SECURITY.md](SECURITY.md), not a public issue.
- Keep the change small. Preserve hot-reload latency, notification delivery,
  app identity and user data. New background services, dependencies or network
  destinations need a concrete workflow benefit and an explicit design review.
- Read [AGENTS.md](AGENTS.md) if using a coding agent. The ordered architecture
  workstream protocol applies to that program, not to every ordinary bug fix.

## Where Changes Belong

| Area | Source |
| --- | --- |
| CLI and Mac helper | `mac-helper/src/`, with tests in `test/` |
| iPhone Companion | `Companion/SwiftSimCompanion/` and `Companion/SwiftSimCompanionTests/` |
| Debug SDK wrapper | `Sources/` and `Tests/`; engine fork pinned by `Package.swift` |
| Shared agent guidance | `plugins/swift-sim-companion/skills/remote-simulator-companion/` |
| Packaging and release | `scripts/release/`, `packaging/`, `mac-helper/compatibility.json` |
| User guides and proof | `docs/`; current guides are distinct from dated evidence/internal plans |

Edit source files, not generated `dist/`. Do not copy a second skill into each
agent host or update an engine pin independently of its compatibility contract.

## Local Setup

You need an Apple silicon Mac, Xcode, Node.js 24.x, and Homebrew. Node 24 is the
supported and CI-tested runtime for the shipped helper and release package.

```sh
npm ci
npm run check
SWIFT_SIM_DISABLE_CLIENT_AUTOCONNECT=1 swift test
```

Node tests use isolated fixtures. Do not run setup against your normal Mac state
just to test a patch. After building, use `node dist/mac-helper/bin/swift-sim-entry.js`
for source-checkout CLI checks. `npm link` replaces the global command; use it
only when deliberately switching your own installation.

Test the iPhone Companion on a Simulator owned by your task. Select its explicit
UDID with `xcrun simctl list devices available`, then run:

```sh
SWIFT_SIM_MANAGED_BUILD=1 xcodebuild test \
  -project Companion/SwiftSimCompanion.xcodeproj \
  -scheme SwiftSimCompanion \
  -destination "platform=iOS Simulator,id=$SIMULATOR_UDID" \
  -configuration Debug \
  -parallel-testing-enabled NO \
  -derivedDataPath .build/contributor-companion \
  CODE_SIGN_IDENTITY=-
```

Set `SIMULATOR_UDID` to that device first. The managed-build flag prevents the
scheme's ordinary Xcode import hook from touching your running helper. The SDK
test flag disables automatic client connection. Neither command proves phone
delivery. Physical tests need the owner's explicit availability and a restore
plan; never uninstall their app or assume a prepared build has been installed.

See [Development](docs/DEVELOPMENT.md) for device builds, integration validation, and manual end-to-end checks. Use the [Documentation Guide](docs/README.md) to find public guides, evidence, and internal records.

## Pull Requests

Keep each pull request focused and explain the user-visible result. Include:

- the problem being solved;
- screenshots or a short recording for UI changes;
- tests added or updated;
- the exact validation commands you ran;
- any security, privacy, signing, or compatibility impact.

Run checks appropriate to the change, and state what you did not test. UI changes
need actual light/dark screenshots and a large-text check. A fixture, Simulator,
build log, native receipt and external beta are different kinds of evidence.
Do not label a physical workflow verified from mocks or an installer callback.

Keep generated builds, recordings and diagnostics under ignored `.build/` paths;
retain only redacted, useful evidence in the repository. Stop task-owned
watchers, servers and Simulators when finished. Preserve other tasks' work and
shared SwiftPM checkouts; do not clean another contributor's cache or worktree.

Do not include real device identifiers, Apple Team IDs, signing identities, private hostnames, install links, tokens, or absolute home-directory paths in code, screenshots, logs, or fixtures.

## Project Rules

- The selected coding agent remains the only agent. Swift Sim must not spawn another one.
- Project builds and signing remain on the user's Mac.
- The install-link fallback must work without Tailscale; private remote features
  use the paired Tailnet.
- Simulator controls stay private to the user's Tailnet.
- Matching app updates should preserve app data; never uninstall first.
- Helper, CLI, skill, plugin manifests, documentation, and release metadata must describe the same behavior.
- User-facing copy should be direct, calm, and understandable without internal implementation terms.

By contributing, you agree that your contribution is licensed under the repository's [Apache License 2.0](LICENSE).

See [Releasing](docs/RELEASING.md) for the coordinated versions and publication
gates, [third-party sources](THIRD_PARTY.md) for pinned dependencies, and
[Code of Conduct](CODE_OF_CONDUCT.md) for participation expectations.
