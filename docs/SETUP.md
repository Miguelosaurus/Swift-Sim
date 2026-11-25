# Setup

Set up Swift Sim on the Mac that holds your iOS project, then install and test your app on your iPhone.

## Requirements

- Apple silicon Mac, Xcode, Homebrew and a local coding agent: Codex, Cursor, Claude Code or OpenCode.
- Apple Developer account configured in Xcode and an iPhone included in the development or ad-hoc provisioning profile.
- Tailscale on both devices, signed in to the same Tailnet, for pairing, remote builds, hot reload and Simulator preview. Install links can work without it.

Keep the Mac awake and online. A remote session must run its agent on that Mac; Swift Sim does not sync an unrelated cloud checkout or move conversations between hosts.

## Install the Mac package

```sh
brew trust --formula miguelosaurus/tap/swift-sim
brew install miguelosaurus/tap/swift-sim
swift-sim setup
swift-sim doctor
```

Homebrew 7 loads formulae from third-party taps only after you trust them; the first line trusts only this formula. Setup starts the helper using Homebrew services, installs or refreshes detected agent integrations, and checks Xcode and signing. You do not need to clone this repository or copy a skill. The build workflow is ready when Xcode, the helper and at least one agent integration are ready.

## Install the iPhone companion

Check [current availability](TESTFLIGHT.md#availability), then [install the Companion from TestFlight](https://testflight.apple.com/join/HMUUFYNK) when a beta build is available. Open it once. It manages your app library and builds, connects to your Mac, and offers optional Simulator preview.

## Prepare signing and the first app

In Xcode, add your Apple Developer account under **Settings > Accounts**. Give the app target a bundle identifier for your team and a provisioning profile that includes your iPhone. Xcode handles signing; Swift Sim does not receive your Apple password.

Open the project in your local agent and ask:

```text
Set up Swift Sim for this project so I can test changes on my iPhone.
Enable the supported Debug hot-reload workflow and deliver completed changes.
```

Review the project integration: it links SwiftSimLive for Debug and adds one `.swiftSimLive()` root modifier. Keep the app's identity and data. The first live-enabled build needs a signed Debug installation and cold launch. The agent checks the connection and delivers a small reversible edit to confirm the update actually appears. Setup or a connected engine alone does not confirm hot reload.

When Apple's trusted developer connection is reachable, Swift Sim can install and launch through Xcode. Otherwise follow the returned **Open in Swift Sim to Install** link and confirm the iOS installer. A matching installed Debug app can also request an install prompt when you return to it. Opening a link or requesting a prompt does not confirm installation. Apple may require initial device trust or a cable; Tailscale alone does not provide its developer connection.

After setup, the agent delivers each completed change in that chat. See [hot reload](ASYNC_HOT_RELOAD.md) for supported edits and status.

## Pair the iPhone with the Mac

Connect both devices to the same Tailnet; they do not need the same Wi-Fi network. In the empty Companion library, tap **Connect your Mac**, then **Set up with agent**, and share the prepared request with the local agent.

For QR pairing, run:

```sh
swift-sim setup-status
swift-sim pair --qr
```

Proceed to pairing only if `setup-status` reports `ok: true`. In Companion, open **Mac connection > Scan code**. The invitation is single-use and expires after five minutes by default; `--ttl-minutes` accepts 1–15. If the camera is unavailable, run `swift-sim pair` and open its universal link or paste the custom-scheme link into **Open or Paste Pairing Link**. The Companion verifies the helper before saving the Mac.

## Build from your iPhone

After pairing and one successful device build, open the app in Companion and tap **New build** beside Build history. Older Companions call it **Build Current Code**. The Mac builds the working tree at its saved path, including uncommitted changes. It does not pull, commit or switch branches. A changed bundle identifier or signing team stops the build. **Create new install link** republishes an existing saved IPA instead of compiling.

## Optional Live Simulator Preview

To control a Mac Simulator from the iPhone, connect both devices to the same Tailnet and run:

```sh
tailscale serve 47217
swift-sim setup-status
```

When the status reports `ok: true`, ask the agent to open a live Simulator preview in Swift Sim. Do not use Tailscale Funnel.

## Swift Package Manager Version Pin

Swift Sim 0.6.12 pins its matching engine 0.5.10. Apps can use the stable exact package version:

```swift
.package(
    url: "https://github.com/Miguelosaurus/Swift-Sim.git",
    exact: "0.6.12"
)
```

Do not substitute an unrelated upstream InjectionNext tag; it may lack Swift Sim's protocol.

## Update Swift Sim

```sh
swift-sim update
```

This upgrades Homebrew and refreshes detected agent integrations. If packaged instructions or the version contract changed, reload the integration or start a new agent session. Existing installs move to SQLite automatically, with JSON backups kept for 30 days.

For failures see [Troubleshooting](TROUBLESHOOTING.md). For optional alerts see [Notifications](NOTIFICATIONS.md); the activity inbox and background push have different requirements.
