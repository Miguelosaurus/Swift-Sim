# Swift Sim

Swift Sim lets you view and control a Mac-hosted Xcode Simulator from an iPhone while Codex works on the project remotely.

Codex remains the only coding agent. Project code builds and runs on the Mac; the iPhone companion is only a secure simulator viewer and controller.

## How It Works

1. Codex edits, builds, and launches your app in a specific Xcode Simulator.
2. The Swift Sim helper starts or reuses a stream for that same Simulator UDID.
3. Codex verifies the simulator in its local sidebar preview.
4. Codex returns an **Open Simulator in Companion App** link.
5. The native iOS companion opens the live session through your private Tailnet.

The normal phone path uses headless H.264 from `serve-sim`, native iOS decoding, live touch input, hardware controls, logs, and immediate HID keyboard forwarding.

## Requirements

- Apple silicon Mac
- Xcode with an iOS Simulator runtime
- Node.js 20 or newer
- Tailscale on the Mac and iPhone
- Apple Developer signing to install the companion from source

## Quick Start

Clone the repository, then prepare the helper:

```sh
npm ci
npm run check
npm start
```

In another terminal, check remote access:

```sh
node mac-helper/bin/swift-sim-helper.js setup-status
```

If Tailscale Serve is not configured:

```sh
tailscale serve 47217
```

Build the companion onto a connected iPhone:

```sh
DEVELOPMENT_TEAM=YOUR_TEAM_ID \
PRODUCT_BUNDLE_IDENTIFIER=com.yourname.SwiftSimCompanion \
./scripts/ios/run-on-device.sh
```

Generate a pairing link using the `suggestedRemoteBaseUrl` printed by `setup-status`:

```sh
node mac-helper/bin/swift-sim-helper.js pair \
  --remote-base-url https://your-mac.your-tailnet.ts.net
```

Open the printed link on the iPhone. The app needs no Swift Sim account or login.

For the complete first-time flow, read [Setup](docs/SETUP.md).

## Codex Integration

The included Codex plugin teaches Codex to:

- build and verify the app in one selected Simulator
- open that same simulator in the Codex sidebar
- start or reuse the native companion session
- diagnose missing helper, Tailscale, pairing, and stream setup
- return the companion link after a successful run

The plugin source is at `plugins/swift-sim-companion`.

See [Codex Workflow](docs/CODEX_WORKFLOW.md) for installation and the exact handoff contract.

## Repository Layout

```text
Companion/                     Native SwiftUI iOS companion
mac-helper/                    Local session, stream, and control server
plugins/swift-sim-companion/  Codex workflow plugin
scripts/codex/                 Stable Codex session wrapper
scripts/ios/                   Physical-device build helper
test/                          Node helper tests
```

## Documentation

- [Setup](docs/SETUP.md): install, Tailscale, pairing, and first session
- [Codex Workflow](docs/CODEX_WORKFLOW.md): plugin installation and expected Codex behavior
- [Architecture](docs/ARCHITECTURE.md): components, transports, recovery, and session API
- [Security](docs/SECURITY.md): trust boundaries, tokens, and current limitations
- [Troubleshooting](docs/TROUBLESHOOTING.md): symptom-based recovery steps
- [Development](docs/DEVELOPMENT.md): tests, builds, validation, and contribution notes

## Current Limits

- Multi-touch fidelity depends on what the installed `serve-sim` version exposes. Do not assume pinch-to-zoom is complete.
- Universal links cannot be pre-entitled for every user's private `*.ts.net` hostname. The `swift-sim://` link is the reliable per-user fallback.
- Session tokens do not yet expire or have a per-session deletion flow. Treat links as durable credentials and follow [Security](docs/SECURITY.md) if one is exposed.
- WebRTC is deferred. V1 uses AVCC H.264 over Tailscale with bounded decoder and encoder recovery.

## Security Summary

The helper binds to `127.0.0.1` by default. Tailscale Serve exposes it only inside the user's Tailnet. Pairing and session routes require opaque tokens, and public session responses omit project paths, local ports, process IDs, and Simulator UDIDs.

Read [Security](docs/SECURITY.md) before exposing the helper through anything other than private Tailscale Serve.

## License

Swift Sim is open source under the [MIT License](LICENSE).
