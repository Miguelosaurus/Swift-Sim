# Setup

Swift Sim has three components:

1. The Mac package contains the CLI and helper.
2. The agent integration contains the Swift Sim workflow.
3. The iPhone companion manages apps, builds, and optional remote features.

`swift-sim setup` installs the first two components from the same Homebrew release.

## Requirements

- Apple silicon Mac
- Xcode
- Homebrew
- at least one supported coding agent running locally on the Mac
- Apple Developer account configured in Xcode
- iPhone included in the development or ad-hoc provisioning profile

Tailscale is optional. It is required only for Mac pairing, **Build Current Code**, remote hot reload, and Simulator preview.

## 1. Prepare A Local Coding Agent

Choose a supported agent. Run it on the Mac that contains the iOS project.

| Agent | Mac requirement | Phone handoff |
| --- | --- | --- |
| Codex | Codex desktop app | Continue the Mac task from the ChatGPT or Codex mobile app |
| Cursor | Cursor 3.9 or newer with Remote Control enabled | Continue the local agent from Cursor for iOS |
| Claude Code | Claude Code 2.1.51 or newer | Run `claude remote-control`, then open the session from the Claude mobile app |
| OpenCode | Local OpenCode installation | Use the local session through a remote or mobile client that you trust |

Keep the agent session on the Mac. A cloud agent cannot use the Mac's Xcode installation, signing credentials, helper, or Simulator state.

## 2. Install The Mac Package

Run:

```sh
brew install miguelosaurus/tap/swift-sim
swift-sim setup
swift-sim doctor
```

Setup performs these actions:

- starts the helper with Homebrew services
- installs or refreshes each detected agent integration
- checks Xcode and signing readiness
- reports optional private features separately

The iPhone-build workflow is ready when the report shows that Xcode, the helper, and at least one agent integration are ready.

You do not need a repository clone or a manual skill copy.

## 3. Install The iPhone Companion

[Install the Swift Sim TestFlight beta](https://testflight.apple.com/join/HMUUFYNK). Open it one time.

The companion provides:

- one library entry for each app identity
- build and update history
- archive and restore controls
- connected-device installation verification
- Mac pairing and **Build Current Code**
- optional Simulator viewing and control

An install link can also work in Safari. The companion is the intended app-management experience.

## 4. Prepare Xcode Signing

Open Xcode. Add your Apple Developer account under **Settings > Accounts**.

Configure the app target with a bundle identifier that belongs to the selected team. Make sure the provisioning profile includes the destination iPhone.

Swift Sim does not receive your Apple password or account session. Xcode performs archive, signing, and export operations.

## 5. Build The First App

Open the local agent session for the iOS project. Ask:

```text
Build this app to my iPhone with Swift Sim
```

The agent performs these actions:

1. Check device-build readiness.
2. Identify the project or workspace and scheme.
3. Create a development-signed IPA.
4. Start a restricted temporary delivery link.
5. Return **Open in Swift Sim to Install**.

Open the link on the iPhone. Review the recorded version. Tap **Install**.

The link works on cellular and other networks. Tailscale is not required. Keep the Mac awake and online until the installation request opens.

If the companion is not installed, the HTTPS page provides **Install directly**. That fallback does not add the build to the companion history.

## Update An Existing App

Ask the agent to build the app again.

Keep these values compatible with the installed app:

- bundle identifier
- Apple Developer team
- keychain access groups
- app-group entitlements

iOS then installs the build as an update and preserves the app container. Swift Sim adds the build to the existing app history.

Do not uninstall the app before an update.

## Pair The iPhone With The Mac

Pairing enables **Build Current Code**, install verification, and Simulator diagnostics.

Before you start, install Tailscale on the Mac and iPhone. Sign in to the same Tailnet. The devices do not need the same Wi-Fi network.

In the iPhone companion, tap **Pair Now**, then **Set Up With My Agent**. Share the prepared request with the local coding agent.

For the QR flow, first check the private route:

```sh
swift-sim setup-status
```

Continue only when the report contains `ok: true`. Then run:

```sh
swift-sim pair --qr
```

In the companion, open **Mac Connection > Scan Pairing QR**. Scan the displayed code.

The invitation is valid for five minutes by default. It can be used one time. Use `--ttl-minutes 1` through `--ttl-minutes 15` to select another invitation window.

If camera access is unavailable, run `swift-sim pair`. Open its universal link or paste its custom-scheme link into **Open or Paste Pairing Link**.

Opening a pairing link is not proof of success. The companion verifies the helper before it saves the Mac.

A USB cable is not used for Swift Sim pairing. Xcode can still require a cable when it registers a new development device for the first time.

## Build Current Code From The iPhone

Complete one successful device build and pair the Mac first. Then open the app in Swift Sim and tap **Build Current Code**.

The paired Mac builds the working tree at its saved path. The build includes uncommitted changes. Swift Sim does not pull, commit, edit, or switch branches.

The helper compares the current bundle identifier and signing team with the trusted prior build. It stops if either value changed.

**Create New Install Link** does not build the project. It republishes a saved IPA.

## Optional Live Simulator Preview

Use this feature only when you want to control the Mac Simulator from the iPhone.

1. Connect the Mac and iPhone to the same Tailnet.
2. Run on the Mac:

   ```sh
   tailscale serve 47217
   swift-sim setup-status
   ```

3. Continue only when `setup-status` reports `ok: true`.
4. Ask the local coding agent:

   ```text
   Open a live Simulator preview in Swift Sim
   ```

Do not use Tailscale Funnel. Simulator controls must remain private to the Tailnet.

## Optional Remote iPhone Hot Reload

Remote hot reload updates compatible function implementations in a running Debug app. It is separate from Simulator preview.

Same Wi-Fi is not required. The Mac and iPhone must be connected to the same private Tailnet.

Complete this setup one time:

1. Run `swift-sim setup`.
2. Ask the coding agent to enable Swift Sim live edits.
3. Review the project change. It adds the `SwiftSimLive` package and one `.swiftSimLive()` modifier at the root SwiftUI view.
4. Connect Tailscale on the Mac and iPhone.
5. Start the live session:

   ```sh
   swift-sim live-start \
     --project "/absolute/App.xcodeproj/project.pbxproj"
   ```

6. Create the first live-enabled build:

   ```sh
   swift-sim build-device \
     --project "/absolute/App.xcodeproj" \
     --scheme "App" \
     --configuration Debug \
     --allow-provisioning-updates
   ```

Install the build through Swift Sim. Open it and keep it running during the edit loop.

The agent runs `swift-sim deliver-change` once after each completed logical edit. Compatible edits use the private live lane. Structural, mixed, non-Swift, unavailable, and unproven edits use a signed build.

Do not publish port 8887 through Funnel, Cloudflare Quick Tunnel, public DNS, router forwarding, or a public firewall rule.

Do not add live loading to Release, TestFlight, or App Store configurations.

## Swift Package Manager Version Pin

The `SwiftSimLive` package intentionally pins the Swift Sim InjectionNext fork
to an immutable revision. The upstream semver tags do not contain Swift Sim's
headless control protocol, so changing the dependency to a stable InjectionNext
version removes the engine behavior that live registration requires.

If SwiftPM reports that a stable Swift Sim package depends on an unstable
`InjectionNext` revision, pin Swift Sim itself to an immutable commit in the
app's `Package.swift`:

```swift
.package(
    url: "https://github.com/Miguelosaurus/Swift-Sim.git",
    revision: "<immutable Swift Sim commit>"
)
```

Use the commit from the Swift Sim release being installed. Do not use an exact
Swift Sim version until the engine fork publishes a semver tag for the matching
control-protocol revision.

## Update Swift Sim

Run:

```sh
swift-sim update
```

The command upgrades Homebrew and refreshes each detected agent integration. It does not change an agent session that is already running.

After an update, start a new agent session. This lets the agent load the new workflow.

## Next

- [Troubleshooting](TROUBLESHOOTING.md)
- [Agent Workflows](AGENT_WORKFLOWS.md)
- [Security](SECURITY.md)
- [Documentation Guide](README.md)
