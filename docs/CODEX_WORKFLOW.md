# Codex Workflow

Swift Sim does not add another AI agent. Codex is the only coding agent; the Mac helper manages simulator sessions, media, input, and signed device-build artifacts. There is no Swift Sim account. Simulator pairing is private through Tailscale, while device-build links work independently from any network.

## Install The Plugin

The plugin source is:

```text
plugins/swift-sim-companion
```

Install or enable **Swift Sim Companion** from the local Codex marketplace used by your checkout. Start a new Codex thread after installing an updated plugin so the thread loads the current skill version.

The plugin contains the `remote-simulator-companion` skill. It activates when the user asks Codex to preview an iOS Simulator session or build a real iPhone install through Swift Sim.

## First Use In A Thread

Codex should discover setup before asking the user for values:

```sh
node "$SWIFT_SIM_HOME/mac-helper/bin/swift-sim-helper.js" setup-status
```

For simulator preview, Codex should:

1. Use `suggestedRemoteBaseUrl` when setup is healthy.
2. Follow `nextSteps` when a prerequisite is missing.
3. Inspect `transport.activeForPhone`.
4. Explain only the missing setup step instead of dumping the full setup guide.

If the app is unpaired, Codex should generate a pairing link:

```sh
node "$SWIFT_SIM_HOME/mac-helper/bin/swift-sim-helper.js" pair \
  --remote-base-url "<suggestedRemoteBaseUrl>"
```

Pairing links and simulator-session links are different. A valid session link does not pair the Mac status panel automatically.

For a device build, Codex only needs a healthy local helper and valid Xcode signing. Tailscale, simulator pairing, and `suggestedRemoteBaseUrl` are not prerequisites.

## Choose The Right Lane

Use **Preview in Simulator** when the user asks to see or interact with the app quickly, verify layout, inspect logs, or iterate on normal SwiftUI UI.

Use **Build to iPhone** when the user asks to install on their phone, test real-device APIs, use camera/Bluetooth/push/HealthKit/widgets, or validate an update on the actual app.

Do not build to phone by uninstalling first. The default behavior must preserve app data by installing over the existing app. Warn the user when bundle identifier, signing team, or entitlements changed.

When Codex is unsure which lane the user wants, prefer:

- simulator preview for fast visual/UI iteration
- device build for real hardware behavior or "install/update on my phone"

## Simulator Handoff Contract

Codex should use one exact Simulator UDID from build through handoff:

1. Select the project or workspace, scheme, and Simulator UDID.
2. Build and launch the app on that simulator.
3. Verify the launched UI.
4. Start or reuse a Swift Sim session for the same UDID.
5. Open the local preview in the Codex sidebar.
6. Confirm it renders a real frame.
7. Return the companion link.

The stable wrapper command is:

```sh
SWIFT_SIM_HOME=/absolute/path/to/Swift-Sim \
$SWIFT_SIM_HOME/scripts/codex/open-simulator-session.sh \
  --project "<absolute project or workspace path>" \
  --scheme "<scheme>" \
  --simulator "<simulator UDID>" \
  --remote-base-url "<Tailscale Serve URL>" \
  --transport auto
```

The wrapper starts the helper if needed, reuses a matching healthy session, and prints JSON.

## Output Rules

Codex uses these values internally:

- `codex.localPreviewUrl`
- `codex.simulatorUDID`

They prove that the sidebar preview and phone session point to the same simulator. Codex must not expose local ports, Simulator UDIDs, project paths, or stream internals in the final response.

The user-facing response should end with:

```md
[Open Simulator in Companion App](https://your-private-host/s/opaque-session?token=opaque-token)
```

For a per-user Tailscale host, Codex should also provide `links.customScheme`. If ChatGPT opens the HTTPS page in a browser, the user can paste the custom link into Swift Sim.

## Device Build Contract

Device builds archive/export a real `.ipa` on the Mac, signed through the Apple Developer account already configured in Xcode. Swift Sim does not handle Apple credentials. The iPhone only downloads and installs the artifact; it does not build project code.

Run:

```sh
"$SWIFT_SIM_HOME/scripts/codex/build-device.sh" \
  --project "<absolute project path>" \
  --scheme "<scheme>" \
  --allow-provisioning-updates
```

Use `--workspace` instead of `--project` for `.xcworkspace` apps.

Codex should parse the JSON and return:

```md
[Install on iPhone](https://random-words.trycloudflare.com/d/opaque-build?token=opaque-token)
```

The browser install page is the expected default and works without Tailscale. Also include `links.customScheme` when the native app is useful for build status and logs.

The default delivery mode starts an account-free Cloudflare Quick Tunnel to a separate device-build-only gateway. Codex should verify:

- `state` is `ready`
- `delivery.mode` is `quick-tunnel`
- the link uses HTTPS
- `signing.deviceInstallable` is true

If the user explicitly provides an independently secured endpoint, Codex may use `--delivery custom --remote-base-url <url>` instead. Never point a public custom URL at the unrestricted simulator helper.

Update rules:

- Same bundle ID + same team + compatible entitlements: safe update, app data should remain.
- Different bundle ID: new app, no existing app data.
- Different team or access groups: warn that keychain/app-group data may not carry over.
- Never pass `--replace-app-data` unless the user explicitly asks for a clean install.

Treat pairing, session, and device-build links as secrets. Do not paste them into commits, public issues, PR descriptions, or documentation examples with real values.

## Recovery Behavior

On the native path:

- the iOS app queues dependent H.264 frames in order
- decoder failure or backlog triggers a fresh stream connection and keyframe
- the helper detects an encoder that accepts input but emits no media
- recovery restarts only the tracked simulator stream
- live keyboard input uses persistent WebSocket HID events

Codex should allow several seconds for automatic recovery before replacing a session. If recovery fails, inspect `~/.swift-sim/helper.log`, then create a fresh session. Never run an unscoped `serve-sim --kill`.

## XcodeBuildMCP

When XcodeBuildMCP is available, Codex should prefer it for build, launch, screenshot, UI inspection, and interaction. Swift Sim starts only after the app has launched successfully.

When it is unavailable, Codex may use the project's normal scripts or `xcodebuild` plus `simctl`. The same-UDID requirement does not change.

## Skill Source Of Truth

The executable Codex instructions live in:

```text
plugins/swift-sim-companion/skills/remote-simulator-companion/SKILL.md
```

Keep that skill synchronized with [Setup](SETUP.md), [Security](SECURITY.md), and [Troubleshooting](TROUBLESHOOTING.md).
