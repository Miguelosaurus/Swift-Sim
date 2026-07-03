<p align="center">
  <img src="Companion/SwiftSimCompanion/Assets.xcassets/AppIcon.appiconset/AppIcon.png" width="180" alt="Swift Sim app icon">
</p>

<h1 align="center">Swift Sim</h1>

<p align="center">
  Install signed iPhone builds from Codex, with optional live Simulator preview.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="Apache 2.0 license"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%2B%20iOS-lightgrey.svg" alt="macOS and iOS">
  <img src="https://img.shields.io/badge/SwiftUI-native-orange.svg" alt="Native SwiftUI companion">
</p>

Swift Sim closes the remote iOS development loop without adding another AI agent. Codex edits and builds on your Mac. Xcode signs the app with your existing Apple Developer setup. Your iPhone installs the real app from a temporary authenticated link.

Live Simulator control is also available when you want a faster visual loop. It is optional and uses private Tailscale access.

## Install

```sh
brew install miguelosaurus/tap/swift-sim
swift-sim setup
```

That is the complete Mac setup. `swift-sim setup`:

- starts the local helper as a background service
- installs the bundled, version-matched Swift Sim plugin in Codex
- checks Xcode and signing readiness
- reports Simulator preview separately when Tailscale is available

No Swift Sim account, Cloudflare account, repository clone, or manual plugin installation is required.

## Use It

For the primary real-device workflow, ask Codex:

```text
Build this app to my iPhone with Swift Sim
```

Codex archives and signs the app, then returns an **Install on iPhone** link that works on any network. Tailscale is not required. Links last two hours by default.

Updates preserve the existing app container when the bundle identifier, Apple team, and entitlements stay compatible. Swift Sim never uninstalls first unless you explicitly request a clean install.

The companion organizes installs as an app library. One app occupies one slot; every later build becomes a versioned entry in that app's history. You can archive dormant prototypes or delete their Swift Sim history without confusing either action with uninstalling the app from iOS.

For a quick live preview, ask:

```text
Open a live Simulator preview in Swift Sim
```

Simulator preview requires Tailscale on the Mac and iPhone because it exposes interactive controls through your private Tailnet. Same Wi-Fi is not required.

## Requirements

### iPhone installs

- Apple silicon Mac
- Xcode
- Homebrew
- Apple Developer signing configured in Xcode
- iPhone included by the development or ad-hoc provisioning profile

### Optional Simulator preview

- An iOS Simulator runtime in Xcode
- Tailscale on the Mac and iPhone
- The Swift Sim iOS companion

Run `swift-sim doctor` at any time for a short readiness report. It keeps iPhone-install requirements separate from optional Simulator requirements.

## What Runs Where

- **Codex** remains the only coding agent.
- **Mac helper** builds, signs, serves install artifacts, and manages Simulator sessions.
- **iPhone** installs the signed app or views and controls the Mac Simulator.
- **Cloudflare Quick Tunnel** temporarily carries only token-protected build downloads.
- **Tailscale Serve** is used only for private Simulator streaming.

Swift Sim never reads or transmits your Apple ID password. Xcode owns signing credentials and provisioning.

## Documentation

- [Setup](docs/SETUP.md): the complete two-command setup and first build
- [Codex Workflow](docs/CODEX_WORKFLOW.md): plugin behavior and handoff contracts
- [Security](docs/SECURITY.md): signing, tokens, network boundaries, and expiry
- [Troubleshooting](docs/TROUBLESHOOTING.md): symptom-based fixes
- [Architecture](docs/ARCHITECTURE.md): helper, delivery, and Simulator transports
- [Development](docs/DEVELOPMENT.md): contributor-only source workflow
- [Privacy](docs/PRIVACY.md): data handling and third parties

## Current Limits

- Quick Tunnel links are temporary and have no uptime guarantee. Generate a new build if one ends early.
- iOS does not report OTA install completion to another app. Swift Sim records the install request and verifies the installed version through Apple developer tooling whenever the iPhone is reachable from the Mac.
- Simulator multi-touch fidelity depends on the pinned `serve-sim` transport.
- Arbitrary private Tailscale hosts cannot all be universal-link entitlements; the `swift-sim://` fallback remains available.

## Contributing

The repository is the single source for the Homebrew release, helper, Codex plugin, and native companion. Source installation is documented only for contributors in [Development](docs/DEVELOPMENT.md); users should use the Homebrew release so every component stays on the same version.

Swift Sim is open source under the [Apache License 2.0](LICENSE).
