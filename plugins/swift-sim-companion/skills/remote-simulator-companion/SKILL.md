---
name: remote-simulator-companion
description: Use when a Codex, Cursor, Claude Code, or OpenCode agent should hot reload a supported Swift edit on a remote iPhone, install or update a signed iOS app through Swift Sim, help configure Swift Sim, or preview an iOS app through the optional live Simulator companion.
---

# Remote Simulator Companion

The host remains the only coding agent. This skill uses Swift Sim for three workflows:

- Hot reload compatible implementation and SwiftUI body edits into a running Debug app on a remote iPhone.
- Build, sign, and serve a real iPhone `.ipa` install/update from the Mac.
- Preview an app in the Mac-hosted Xcode Simulator from the native Swift Sim iOS companion app.

Real iPhone installs are the universal fallback. They work without Tailscale, simulator pairing, or a Swift Sim account. Remote hot reload is an optional Debug-only acceleration lane over the user's private Tailnet. Live Simulator preview is a separate optional workflow.

Important transport reality:

- `serve-sim` supplies the headless CoreSimulator framebuffer, VideoToolbox H.264 encoder, and simulator control channel.
- `native-companion` is the default phone transport. It proxies `serve-sim`'s `/stream.avcc` endpoint and decodes H.264 natively in the iOS app.
- MJPEG remains the local agent preview and compatibility fallback.
- The helper resolves Xcode's model-specific CoreSimulator `framebufferMask`; the companion applies it to the stream instead of drawing a hardcoded phone border.
- If setup-status reports `activeForPhone: "serve-sim"`, tell the user they are on the fallback path. Do not promise Bitrig-grade latency, pinch, or full gesture fidelity on that path.

Use this skill when:

- The user asks to test an iOS/SwiftUI change remotely from their phone.
- The user asks for the simulator companion link.
- The user asks to build, install, or update the app on their iPhone.
- The coding agent has just built or launched an iOS app in Simulator and should hand off the live session.
- The user says “open simulator in companion app,” “Swift Sim,” “remote simulator,” or similar.

Do not use this skill to create a second AI agent. The helper is only a simulator/session and device-build server.

## Choose The Correct Lane

Use the device-build lane when the user says:

- build to my phone
- install on iPhone
- update the app on my phone
- test real device APIs
- TestFlight is too slow for this loop

Also prefer the device-build lane when the user simply asks to test on their phone and does not explicitly ask for a Simulator. This is Swift Sim's default product path.

Use the simulator lane when the user explicitly asks for a quick preview, live Simulator interaction, Simulator logs, or a local agent preview.

Use the remote hot-reload lane only when all of these are true:

- The app already has a Swift Sim live-enabled Debug build running on the iPhone.
- `swift-sim live-status --project "<path-to-project.pbxproj>"` reports `ready: true`.
- The Mac and iPhone are connected to the same private Tailnet.
- The proposed edit changes implementation bodies, literal styling, layout, modifiers, or computed SwiftUI composition without changing declarations.

Stored-property changes, new or removed declarations, signature changes, imports, assets, localized strings, package dependencies, build settings, resources, Info.plist, entitlements, capabilities, and signing changes always use the device-build lane.

Do not uninstall the user's app for the device-build lane. Swift Sim's default path preserves app data by installing over the existing app. Warn the user if bundle identifier, signing team, or entitlements changed.

## Required Inputs

For every workflow you need:

- Absolute project or workspace path.
- Scheme.

Simulator preview additionally needs a booted or selected Simulator UDID and the private Tailscale Serve URL.

## Setup Contract

Always use the installed `swift-sim` CLI. Do not ask normal users to clone the repository, run Node scripts by path, set `SWIFT_SIM_HOME`, or manually copy the plugin.

At the first Swift Sim request in a thread, run:

```bash
command -v swift-sim
swift-sim doctor --json
```

If `swift-sim` is missing, offer to run the primary installation flow:

```bash
brew install miguelosaurus/tap/swift-sim
swift-sim setup
```

`swift-sim setup` starts the helper, installs or refreshes the Swift Sim integration for every detected supported agent, and prints a readiness summary. It configures Codex, Cursor, Claude Code, and OpenCode independently from the same packaged skill. After setup, use `swift-sim doctor --json` to diagnose only what remains.

Read the report as three independent sections:

- `deviceInstalls`: primary workflow. Xcode, helper, and at least one supported agent integration must be ready. Tailscale is irrelevant.
- `remoteHotReload`: optional Debug-only workflow. Swift Sim manages its private engine; the Mac and iPhone need a private Tailscale route.
- `simulatorPreview`: optional workflow. Only require this section when the user requested live Simulator preview.

When something is missing, explain and fix only the reported `needs-attention` item. Never dump the entire setup guide. If Xcode signing is informational, continue; the first project build provides the authoritative signing check.

For detailed Simulator transport status, run:

```bash
swift-sim setup-status
```

For simulator preview, if `ok` is true, use `suggestedRemoteBaseUrl`. If `ok` is false, follow `nextSteps` and explain only the missing pieces. For a device build, `deviceBuildReady` only requires the local helper; Tailscale setup is irrelevant.

Also inspect the returned `transport` section. If `transport.activeForPhone` is `serve-sim`, the companion link works through the fallback stream. If the user is testing latency, zoom, pinch, or full simulator controls, be explicit that the native transport is the correct target and the fallback is only for proof-of-loop.

If `SWIFT_SIM_REMOTE_BASE_URL` is already set, use it after setup-status confirms the helper path is viable. If no remote URL can be discovered, ask the user for their Tailscale Serve URL or tell them to run:

```bash
tailscale serve 47217
```

Use the HTTPS Tailscale Serve URL printed by that command, for example `https://your-mac.your-tailnet.ts.net`. Do not suggest Tailscale Funnel or any public internet exposure for v1 unless the user explicitly accepts the extra risk.

## Setup And Pairing Awareness

Swift Sim has two different link types:

- Pairing links: `/pair?...` links teach the native iOS app which Mac helper to trust.
- Session links: `/s/<opaque-session-id>?token=...` links open a live simulator session.

The iOS app does not use an account or login. If the user says the app shows **Pair a Mac**, a gray status light, missing Mac setup, or asks to relink, generate a pairing URL:

```bash
swift-sim pair \
  --remote-base-url "<tailscale-serve-url>"
```

Return the printed `links.universalLink` as a Markdown link labeled:

```text
Pair Swift Sim Companion
```

If universal links do not open the app, provide `links.customScheme` as the fallback. Pairing is separate from simulator session links: a user can have a valid session link and still need to pair the app for helper status, relink, and Test Connection to work.

Expected iOS helper status lights:

- gray: no Mac is paired. Generate and open a pairing link.
- yellow: the app is checking helper reachability.
- green: helper reachable through the paired Tailscale URL.
- red: helper unreachable. Check Tailscale, Tailscale Serve, helper process, and pairing URL.

When setup is healthy and the app is unpaired, the coding agent should give the pairing link directly. When setup is not healthy, guide the user through the exact missing step first, for example installing/signing into Tailscale, starting the helper, or running `tailscale serve 47217`.

## Workflow

1. Build and launch the iOS app on a specific Simulator UDID.
   - Prefer XcodeBuildMCP when available.
   - Use the existing project scheme and selected simulator.
   - Do not edit the user's project just to support Swift Sim.

2. Verify the app launched.
   - Prefer XcodeBuildMCP screenshot or UI description.
   - If XcodeBuildMCP is unavailable, use normal `xcodebuild`/`simctl` verification.

3. Start or reuse the Swift Sim session with the wrapper for that exact same Simulator UDID:

   ```bash
   swift-sim start-session \
     --project "<absolute-project-or-workspace-path>" \
     --scheme "<scheme>" \
     --simulator "<simulator-udid>" \
     --remote-base-url "<tailscale-serve-url>" \
     --transport auto
   ```

   The wrapper starts the helper if needed, keeps it bound to localhost, then asks the helper to start or reuse the best available transport. With `serve-sim` 0.1.41 or newer, `auto` resolves to `native-companion`; otherwise it falls back to MJPEG.

4. Parse the returned JSON. In Codex, first use:

   ```text
   codex.localPreviewUrl
   ```

   Open that URL in the Codex in-app browser/sidebar and verify the nested simulator renders a real frame. In Cursor or Claude Code, verify through available local screenshot/UI tools instead. This URL is local verification metadata only. Do not include it in the user-facing response.

5. Confirm the phone companion link points at the same helper session:

   ```text
   links.universalLink
   ```

   Also keep `links.customScheme` available. For Tailscale-first v1 it is often the most reliable direct-open link into the native iOS app, because universal links require the app to be signed for the exact associated domain.

6. End the agent response with a Markdown link labeled exactly:

   ```text
   Open Simulator in Companion App
   ```

   Example:

   ```md
   [Open Simulator in Companion App](https://example.ts.net/s/opaque-session?token=opaque-token)
   ```

   If the session uses a per-user Tailscale host, also include the `swift-sim://session/...` fallback link or code block. Tell the user to paste that fallback into Swift Sim's Paste Link sheet if ChatGPT opens the HTTPS link in a browser.

## Remote Hot Reload Workflow

This lane keeps a regular signed Debug app installed on the iPhone, then sends same-team-signed implementation patches to the running process. It does not stream a Simulator. It is never a Release, TestFlight, or App Store mechanism.

One-time project preparation:

1. Add `https://github.com/Miguelosaurus/Swift-Sim` as a Swift Package dependency and link the `SwiftSimLive` product to the app target.
2. Add `.swiftSimLive()` once to the app's root SwiftUI view. Do not add it to every view or every source line.
3. Run `swift-sim setup`. Swift Sim installs and manages its checksum-verified headless engine and resolves the app's development identity; never ask the user to install or operate a separate injection app.
4. Connect both devices to the same private Tailnet. Never expose injection port 8887 through Tailscale Funnel, a public tunnel, or a public firewall rule.

Inspect and launch the lane:

```bash
swift-sim live-status \
  --project "<absolute-project.xcodeproj/project.pbxproj>"

swift-sim live-start \
  --project "<absolute-project.xcodeproj/project.pbxproj>"
```

Create the initial Debug device build normally. Swift Sim supplies the Tailscale host and all required Debug compiler/linker settings:

```bash
swift-sim build-device \
  --project "<absolute-project-path>" \
  --scheme "<scheme>" \
  --configuration Debug \
  --allow-provisioning-updates
```

The user installs this initial build through the normal **Open in Swift Sim to Install** handoff. After it launches and connects, future compatible saves can arrive without rebuilding or reinstalling the `.ipa`.

Before or immediately after each Swift edit, compare the prior file and proposed/current file:

```bash
swift-sim route-change \
  --before "<path-to-before.swift>" \
  --after "<path-to-current.swift>" \
  --project "<absolute-project.xcodeproj/project.pbxproj>"
```

Honor the returned `action`:

- `hot-reload`: report the patch only after the correlated engine report confirms a real replacement, root refresh acknowledgment, and nonzero revision. Do not capture or analyze a screenshot for each edit.
- `hot-reload-failed`: immediately use the Device Build Workflow and return a fresh update link. Do not describe the failed attempt as a partial success.
- `build-device`: immediately use the Device Build Workflow and return a fresh update link. Do not ask the user to decide which lane to use.
- `none`: no runtime action is needed.

The classifier is intentionally conservative. The engine can replace compiled function implementations; it cannot safely reshape live Swift metadata. If a multi-file change includes even one rebuild-required file, rebuild the whole app. Non-Swift file changes always rebuild.

Hot reload is a speed feature, not a delivery guarantee. If the patch does not appear within a few seconds, the app disconnected, compilation failed, the device locked, the Tailnet route is unavailable, or the agent cannot prove injection success, fall back to `swift-sim build-device`. Preserve the existing bundle identifier and team so app data remains intact.

## Device Build Workflow

This lane creates a real signed iPhone app install. It does not use simulator streaming.

Required inputs:

- Absolute project or workspace path.
- Scheme.
- A valid Apple Developer signing setup in Xcode.

Before building, run `swift-sim doctor --json` and confirm `deviceInstalls.ready` is true. Do not require `simulatorPreview.ready` for this lane. The default lane signs locally, starts an account-free temporary HTTPS tunnel to a device-build-only gateway, and works without Tailscale or a Swift Sim login. Xcode uses the Apple Developer account already configured on the Mac; Swift Sim never handles Apple credentials.

Install links last two hours by default. Use `--ttl-minutes <5-120>` only when the user requests a shorter window. The Mac must remain awake and online until installation finishes.

Run:

```bash
swift-sim build-device \
  --project "<absolute-project-path>" \
  --scheme "<scheme>" \
  --allow-provisioning-updates
```

Use `--workspace "<absolute-workspace-path>"` instead of `--project` for `.xcworkspace` apps.

For an explicit Xcode build-setting override, pass one or more repeated `--build-setting KEY=VALUE` options. Swift Sim validates the format and applies the same settings while reading build metadata and archiving, so install history matches the signed app. Use uppercase setting names and quote the complete argument.

Parse the returned JSON:

- `state` must be `ready` before telling the user it can install.
- `links.universalLink` is the user-facing Swift Sim handoff page.
- `links.customScheme` opens the build in Swift Sim directly.
- `links.installURL` can launch the OTA install directly.
- `signing.warnings` should be summarized if present.
- `delivery.mode` should be `quick-tunnel` unless the user explicitly configured a custom delivery URL.

End the agent response with a Markdown link labeled exactly:

```text
Open in Swift Sim to Install
```

Example:

```md
[Open in Swift Sim to Install](https://random-words.trycloudflare.com/d/opaque-build?token=opaque-token)
```

The HTTPS page attempts to open the native companion first. The companion records the build before presenting its install action, so it remains part of the app library and version history. Also include `links.customScheme` as the fallback when the coding-agent app opens HTTPS without handing off. The page's **Install without Swift Sim** action is a last-resort path for users who do not have the companion; explain that this fallback cannot update the companion's local history.

Update preservation rules:

- Same bundle identifier, team, and compatible entitlements: iOS updates the app and preserves the app container.
- Different bundle identifier: installs as a separate app and does not preserve the old app container.
- Different team or keychain/app-group entitlements: warn that login/keychain/shared-container data may not remain available.
- Never pass `--replace-app-data` unless the user explicitly asks for a clean install.

## App Library Contract

Swift Sim organizes prototypes by a stable identity derived from bundle identifier plus signing team. The same app must occupy one library slot; later builds become history under it. A different bundle identifier or team intentionally creates another app because iOS no longer treats it as the same update identity.

After a successful device build, always route the user through the Swift Sim handoff. The companion records a pending entry immediately, replaces it with authoritative build metadata from the helper, and groups later builds by bundle identifier plus signing team. Opening the install handoff uses the internal `requested` state, shown to the user as **Installation started**; it does not prove installation completed. iOS does not provide the companion an OTA completion callback.

The Mac helper automatically reconciles requested installs in the background when a trusted iPhone is available over the local network or USB. The companion syncs that result when it opens or returns to the foreground. Use the CLI below as a troubleshooting fallback when the user asks whether a build is installed:

```bash
swift-sim verify-device-build --build-id "<opaque-build-id>"
```

Report the returned installation state exactly:

- `verified`: Apple developer tooling found that app and version on a reachable iPhone.
- `different-version`: the app is present, but the reachable iPhone has another version or build.
- `not-installed`: a reachable iPhone was checked and did not contain the bundle identifier.
- `unknown`: no trusted physical iPhone could be checked. This must not erase a previously known install request.

Never claim device-wide inventory from the iOS companion alone. Do not use private installed-app APIs.

For library maintenance, inspect and act on opaque app IDs:

```bash
swift-sim list-apps
swift-sim list-apps --archived
swift-sim archive-app --app-id "<opaque-app-id>"
swift-sim archive-app --app-id "<opaque-app-id>" --restore
swift-sim delete-app --app-id "<opaque-app-id>"
```

Archiving preserves history and artifacts. Deleting removes Swift Sim's local history and artifacts. Neither action uninstalls an iPhone app. Do not expose an uninstall command through the public Quick Tunnel.

If signing fails, explain the exact Xcode error and the likely missing setup: developer team, registered device, App ID capability, provisioning profile, or bundle identifier ownership.

## Host-Specific Execution

### Codex With XcodeBuildMCP

Use this sequence:

1. `session_show_defaults` to check current project/workspace, scheme, and simulator.
2. Set defaults if needed.
3. `build_run_sim`.
4. Verify with screenshot or UI description.
5. Run `swift-sim start-session` with the same Simulator UDID.
6. Open `codex.localPreviewUrl` in the Codex in-app browser and verify the nested simulator frame.
7. Return the companion link.

### Cursor, Claude Code, Or OpenCode

Use a local Mac session controlled by the host's remote surface. Cursor Remote Control and Claude Code Remote Control provide official mobile surfaces. OpenCode support installs the same global skill for users who connect to their local OpenCode session through their own remote or mobile surface. Do not move the build to a cloud agent: Xcode, signing credentials, the helper, and Simulator state live on this Mac.

Use the repository's normal build/run script when available. Otherwise use `xcodebuild`, `simctl`, and the installed `swift-sim` CLI. Cursor, Claude Code, and OpenCode do not need the Codex-only nested browser proof before returning a companion link.

### Without XcodeBuildMCP

Use the repo's normal build/run script if it has one. Otherwise:

1. Build with `xcodebuild`.
2. Install with `xcrun simctl install`.
3. Launch with `xcrun simctl launch`.
4. Start the Swift Sim companion session.

## Requirements

- Do not create or invoke a separate coding agent.
- Do not expose project source paths, simulator UDIDs, local ports, or stream internals in the user-facing link.
- Do not expose IPA paths, archive paths, signing file paths, device UDIDs, or Apple team IDs in the user-facing link.
- Keep the framebuffer-mask endpoint behind the same opaque session token. Do not expose its source path from Xcode's device profile.
- `codex.localPreviewUrl` and `codex.simulatorUDID` are local workflow metadata for hosts that can use them. In Codex, use them to prove the nested simulator and phone companion share one Simulator session. Never paste them into the final user message.
- Keep the full simulator helper bound to localhost and expose simulator access only through private Tailscale Serve.
- Device builds may expose only the separate token-scoped gateway through the managed expiring Quick Tunnel. Its only mutations are install-request tracking and connected-device verification for that build.
- Do not use Tailscale Funnel for simulator setup. Prefer private Tailnet access.
- Do not imply that universal links work automatically for every Tailscale or Quick Tunnel host. Device build HTTPS links intentionally open an install webpage; use `swift-sim://` when opening the native companion is useful.
- Input uses the installed `serve-sim` control channel on both video transports. Do not promise complete multi-touch pinch/zoom unless `serve-sim-info` proves the installed version supports stable multi-touch gesture JSON.
- Never run an unscoped `serve-sim --kill`; stop only the session/UDID owned by this workflow.
- The iPhone companion only views and controls the Mac Simulator. It does not execute project code.
- If the helper fails, report the helper log path: `~/.swift-sim/helper.log`.
- Treat pairing tokens and session tokens as secrets. Do not paste them into public issues, PRs, logs, or docs.
- Treat device-build tokens as secrets. A build link can download a signed IPA until revoked or expired.
- Session tokens do not currently expire automatically. Treat links as durable credentials; Stop ends the tracked stream but is not complete token revocation in V1.
- Device-build pages are temporary, but local IPA artifacts remain under `~/.swift-sim/device-builds/` until deleted.
- Device-build links expire after two hours by default and can fail earlier if the Mac sleeps, restarts, loses internet access, or the Quick Tunnel exits. If the companion is paired and the Mac still has the saved IPA, use **Generate New Link** in the app. Otherwise generate a fresh build.

## Troubleshooting

Use these branches when setup or links fail:

- Missing `swift-sim`: install the signed release through Homebrew, then run setup.

  ```bash
  brew install miguelosaurus/tap/swift-sim
  swift-sim setup
  ```

- Missing simulator remote URL: ask for the Tailscale Serve HTTPS URL or have the user run:

  ```bash
  swift-sim setup-status
  tailscale serve 47217
  ```

- Helper not healthy locally: check:

  ```bash
  curl http://127.0.0.1:47217/health
  ```

  If it fails, start the helper:

  ```bash
  swift-sim serve
  ```

  Then inspect `~/.swift-sim/helper.log` if it still fails.

- iOS app shows gray / **Pair a Mac**: generate a pairing link with the `pair` command and tell the user to open it on the iPhone.

- iOS app shows red / offline: verify Tailscale is connected on both Mac and iPhone, run `tailscale serve status` on the Mac, confirm the helper is running, then generate a fresh pairing link.

- Universal link opens Safari instead of the app: universal links are not configured for the installed build, or iOS has not associated the app yet. Give the `swift-sim://...` fallback link. Also check the app entitlement host and `SWIFT_SIM_IOS_APP_ID`.

- HTTPS link opens the browser fallback page inside ChatGPT: this is expected when the companion app is not associated with that host. Tell the user to tap the page's open button or paste the `swift-sim://session/...` fallback into the Swift Sim app.

- Session link says unauthorized or unknown session: create a fresh session with `swift-sim start-session`, then return the new **Open Simulator in Companion App** link.

- Stream is blank, zoomed, slow, or controls do not work: run `setup-status` and check `transport.activeForPhone`. If it is `serve-sim`, treat the issue as fallback-transport quality unless local `serve-sim` is obviously dead. On `native-companion`, leave the link open for several seconds first: the app reconnects its decoder and the helper restarts a tracked `serve-sim` encoder that accepts input but emits no media. If it still fails, inspect `~/.swift-sim/helper.log`, create a fresh session, and never use an unscoped `serve-sim --kill`.

- Keyboard opens but typing is delayed or arrives as a batch: current builds should show **Live Keyboard** and forward each key as USB HID events through one persistent control channel. Rebuild the iOS companion and restart the Mac helper if the old **Send Text** sheet is still present.

- User asks whether login is required: no Swift Sim or Cloudflare account is required. Simulator trust uses the user's Tailnet plus pairing/session tokens; device delivery uses an expiring public gateway plus one opaque build token.

- Device build fails signing: check that Xcode has the team selected, the bundle identifier belongs to the team, the iPhone is registered, capabilities are enabled, and try `--allow-provisioning-updates`.

- Device delivery tunnel fails: run `device-delivery-status`, inspect `~/.swift-sim/device-delivery.log`, stop stale delivery with `device-delivery-stop`, then rebuild. Do not redirect device builds to Tailscale merely because the default tunnel had a transient failure.

- Device build installs as a second app: the bundle identifier changed. Tell the user to keep the same bundle identifier to preserve app data.

- Device build updates but login/keychain data is missing: signing team or keychain/access-group entitlements likely changed.

## Useful Commands

Generate a setup/relink URL for the native iOS companion:

```bash
swift-sim pair \
  --remote-base-url "<tailscale-serve-url>"
```

Give the user the returned `links.universalLink` when they need to pair the phone with the Mac helper. This is separate from simulator session links.

Inspect the current `serve-sim` adapter capability:

```bash
swift-sim serve-sim-info
```

Manually start the helper:

```bash
swift-sim serve
```

Check helper health:

```bash
curl http://127.0.0.1:47217/health
```

Build a real device install:

```bash
swift-sim build-device \
  --project "<absolute-project-path>" \
  --scheme "<scheme>" \
  --allow-provisioning-updates
```
