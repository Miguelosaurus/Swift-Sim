# Setup

Swift Sim has three components: the Mac package, a coding-agent integration, and the iPhone companion. The Mac package and every detected agent integration are installed together from one Homebrew release.

## 1. Prepare A Local Coding Agent

Choose at least one supported agent and make sure it runs on the Mac that contains the iOS project:

| Agent | Mac requirement | Phone handoff |
| --- | --- | --- |
| Codex | Codex desktop app | Continue the Mac thread from the ChatGPT/Codex mobile app |
| Cursor | Cursor 3.9+ with Remote Control enabled in the Agents Window | Continue the local agent from Cursor for iOS |
| Claude Code | Claude Code 2.1.51+ signed in through claude.ai | Run `claude remote-control` and open the session from the Claude mobile app |
| OpenCode | A local OpenCode installation | Use the local session through your preferred remote or mobile client |

Keep the agent session local. Cloud agents cannot use the Xcode installation, signing credentials, helper, or Simulator state on your Mac.

## 2. Install The Mac Package And Agent Integration

Requirements:

- Apple silicon Mac
- Xcode
- Homebrew
- at least one supported local coding agent

Run:

```sh
brew install miguelosaurus/tap/swift-sim
swift-sim setup
```

`swift-sim setup` performs the complete Mac-side setup:

- starts the helper with Homebrew services
- installs the Codex plugin when Codex is detected
- installs the Cursor skill when Cursor is detected
- registers and installs the Claude Code plugin when Claude Code is detected
- installs the shared skill in OpenCode's global skills directory when OpenCode is detected
- checks Xcode and local signing readiness

No repository clone or manual skill copy is required. Setup skips agents that are not installed.

Check the result at any time:

```sh
swift-sim doctor
```

The report has three sections:

- Xcode and signing
- detected coding-agent integrations
- optional live Simulator networking

The iPhone-install workflow is ready when Xcode, the helper, and at least one agent integration are ready.

## 3. Install The iPhone Companion

[Install the public Swift Sim TestFlight beta](https://testflight.apple.com/join/HMUUFYNK) and open it once.

The companion provides:

- one organized library entry per prototype app
- build and update history
- archive and restore controls
- connected-device verification
- optional live Simulator viewing and control

Device-build links can still install through Safari, but the companion is the management hub and the intended mobile experience.

## 4. Prepare Xcode Signing

Open Xcode once and add your Apple Developer account under **Settings > Accounts**. The target must use a bundle identifier owned by that team, and the destination iPhone must be included by the provisioning profile.

Swift Sim never receives your Apple password or account session. It asks Xcode to perform normal archive, signing, and export operations.

## 5. Install Your First App

From the local agent session working on the iOS project, ask:

```text
Build this app to my iPhone with Swift Sim
```

The agent will:

1. Run `swift-sim doctor --json`.
2. Identify the project or workspace and scheme.
3. Archive and export a development-signed IPA.
4. Start a restricted temporary HTTPS delivery tunnel.
5. Return **Open in Swift Sim to Install**.
6. Open Swift Sim, review the recorded version, and tap **Install**.

The HTTPS handoff includes a clearly labeled **Install without Swift Sim** fallback for phones without the companion. That fallback is intentionally secondary because iOS does not notify Swift Sim about installs initiated outside the app.

Open the link on the iPhone and choose **Install**. It works over cellular or any network; Tailscale is not involved. The Mac must remain awake and online until installation finishes.

## Updating An Existing App

Ask the agent to build to the phone again. Keep the same bundle identifier, Apple Developer team, and compatible keychain/app-group entitlements. iOS installs over the existing app and preserves its app container.

Swift Sim groups builds by bundle identifier plus team. Rebuilding the same app creates one new history row, not another app card.

## Optional Live Simulator Preview

Only configure this lane when you want to control the Mac Simulator from Swift Sim:

1. Install Tailscale on the Mac and iPhone.
2. Sign in to the same Tailnet.
3. Run on the Mac:

   ```sh
   tailscale serve 47217
   swift-sim doctor
   ```

4. Ask the local agent:

   ```text
   Open a live Simulator preview in Swift Sim
   ```

Same Wi-Fi is not required. Do not use Tailscale Funnel; Simulator controls should remain private to the Tailnet.

## Optional Remote iPhone Hot Reload

Remote hot reload is separate from Simulator preview. It keeps a regular development-signed Debug app on the iPhone and replaces compatible function implementations while it runs. Same Wi-Fi is not required, but the Mac and iPhone must be connected to the same private Tailnet.

One-time setup:

1. Install [InjectionNext](https://github.com/johnno1962/InjectionNext/releases) in `/Applications`.
2. In the target project, add `https://github.com/Miguelosaurus/Swift-Sim` as a package dependency and link `SwiftSimLive`.
3. Add `.swiftSimLive()` once to the root SwiftUI view.
4. Add the Debug-only linker flags `-Xlinker` and `-interposable`. Set `EMIT_FRONTEND_COMMAND_LINES=YES` and `COMPILATION_CACHE_ENABLE_CACHING=NO` for Debug.
5. Connect Tailscale on the Mac and iPhone.
6. Run `swift-sim live-start --project "/absolute/App.xcodeproj/project.pbxproj"`, enable **Enable Devices** in InjectionNext, and select the development signing identity when it asks.

Check the machine-readable setup state:

```sh
swift-sim live-status \
  --project "/absolute/App.xcodeproj/project.pbxproj"
```

Build the first live-enabled app with the returned `host`:

```sh
INJECTION_HOST="<mac-tailscale-ip>" swift-sim build-device \
  --project "/absolute/App.xcodeproj" \
  --scheme "App" \
  --configuration Debug \
  --build-setting EMIT_FRONTEND_COMMAND_LINES=YES \
  --build-setting COMPILATION_CACHE_ENABLE_CACHING=NO \
  --build-setting 'OTHER_LDFLAGS=$(inherited) -Xlinker -interposable' \
  --allow-provisioning-updates
```

Install that build normally through Swift Sim, open it, and leave it running while editing. The shared agent skill routes compatible body changes through live injection and automatically returns to the normal signed-update workflow for structural changes.

Do not publish port 8887 through Funnel, Cloudflare Quick Tunnel, router port forwarding, or a public firewall rule. Do not add the live package or flags to Release/App Store configurations.

## Updating Swift Sim

```sh
swift-sim update
```

This upgrades Homebrew and refreshes every detected agent integration from the same package.

## Next

- [Agent Workflows](AGENT_WORKFLOWS.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Security](SECURITY.md)
