---
name: remote-simulator-companion
description: Use when Codex has built or launched an iOS app on the local Mac Simulator and should hand the live simulator session to the Swift Sim native iOS companion app.
---

# Remote Simulator Companion

Codex remains the only coding agent. This skill starts or reuses the lightweight Swift Sim helper so the user can open and control the Mac-hosted Xcode Simulator from the native Swift Sim iOS companion app.

Use this skill when:

- The user asks to test an iOS/SwiftUI change remotely from their phone.
- The user asks for the simulator companion link.
- Codex has just built or launched an iOS app in Simulator and should hand off the live session.
- The user says “open simulator in companion app,” “Swift Sim,” “remote simulator,” or similar.

Do not use this skill to create a second AI agent. The helper is only a simulator/session server.

## Required Inputs

You need:

- Absolute project or workspace path.
- Scheme.
- Booted or selected Simulator UDID.
- The Swift Sim checkout path in `SWIFT_SIM_HOME`, or a workspace that contains this repo.
- Remote base URL, normally the Tailscale Serve HTTPS URL for the Mac helper. Discover it before asking the user.

Before the first pairing or simulator handoff in a Codex session, check setup:

```bash
node "$SWIFT_SIM_HOME/mac-helper/bin/swift-sim-helper.js" setup-status
```

If `ok` is true, use `suggestedRemoteBaseUrl` as the remote URL. If `ok` is false, follow `nextSteps` and explain only the missing pieces. This check is bounded and safe to run even when Tailscale or the helper is not ready.

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
node "$SWIFT_SIM_HOME/mac-helper/bin/swift-sim-helper.js" pair \
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

When setup is healthy and the app is unpaired, Codex should give the pairing link directly. When setup is not healthy, Codex should guide the user through the exact missing step first, for example installing/signing into Tailscale, starting the helper, or running `tailscale serve 47217`.

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
   SWIFT_SIM_HOME="/path/to/Swift-Sim" \
   "$SWIFT_SIM_HOME/scripts/codex/open-simulator-session.sh" \
     --project "<absolute-project-or-workspace-path>" \
     --scheme "<scheme>" \
     --simulator "<simulator-udid>" \
     --remote-base-url "<tailscale-serve-url>"
   ```

   The wrapper starts the helper if needed, keeps it bound to localhost, then asks the helper to start or reuse a `serve-sim` stream.

4. Parse the returned JSON. First use:

   ```text
   codex.localPreviewUrl
   ```

   Open that URL in the Codex in-app browser/sidebar and verify the nested simulator renders a real frame. This URL is for local Codex verification only. Do not include it in the user-facing response.

5. Confirm the phone companion link points at the same helper session:

   ```text
   links.universalLink
   ```

   Also keep `links.customScheme` available. For Tailscale-first v1 it is often the most reliable direct-open link into the native iOS app, because universal links require the app to be signed for the exact associated domain.

6. End the Codex response with a Markdown link labeled exactly:

   ```text
   Open Simulator in Companion App
   ```

   Example:

   ```md
   [Open Simulator in Companion App](https://example.ts.net/s/opaque-session?token=opaque-token)
   ```

   If the session uses a per-user Tailscale host, also include the `swift-sim://session/...` fallback link or code block. Tell the user to paste that fallback into Swift Sim's Paste Link sheet if ChatGPT opens the HTTPS link in a browser.

## If XcodeBuildMCP Is Available

Use this sequence:

1. `session_show_defaults` to check current project/workspace, scheme, and simulator.
2. Set defaults if needed.
3. `build_run_sim`.
4. Verify with screenshot or UI description.
5. Run `scripts/codex/open-simulator-session.sh` with the same Simulator UDID.
6. Open `codex.localPreviewUrl` in the Codex in-app browser and verify the nested simulator frame.
7. Return the companion link.

## If XcodeBuildMCP Is Not Available

Use the repo's normal build/run script if it has one. Otherwise:

1. Build with `xcodebuild`.
2. Install with `xcrun simctl install`.
3. Launch with `xcrun simctl launch`.
4. Start the Swift Sim companion session.

## Requirements

- Do not create or invoke a separate coding agent.
- Do not expose project source paths, simulator UDIDs, local ports, or stream internals in the user-facing link.
- `codex.localPreviewUrl` and `codex.simulatorUDID` are local workflow metadata only. Use them to prove the nested Codex simulator and the phone companion use the same Simulator session; never paste them into the final user message.
- Keep the helper bound to localhost and expose it remotely through Tailscale Serve for v1.
- Do not use Tailscale Funnel for default setup. Prefer private Tailnet access.
- Do not imply that universal links work automatically for every Tailscale host. A public iOS build cannot be pre-entitled for arbitrary `*.ts.net` hosts; use `swift-sim://` as the reliable v1 direct-open fallback.
- Never run an unscoped `serve-sim --kill`; stop only the session/UDID owned by this workflow.
- The iPhone companion only views and controls the Mac Simulator. It does not execute project code.
- If the helper fails, report the helper log path: `~/.swift-sim/helper.log`.
- Treat pairing tokens and session tokens as secrets. Do not paste them into public issues, PRs, logs, or docs.

## Troubleshooting

Use these branches when setup or links fail:

- Missing `SWIFT_SIM_HOME`: set it to the Swift Sim repo checkout, or run commands from a workspace that contains this repo.

  ```bash
  export SWIFT_SIM_HOME="/path/to/Swift-Sim"
  ```

- Missing remote URL: ask for the Tailscale Serve HTTPS URL or have the user run:

  ```bash
  node "$SWIFT_SIM_HOME/mac-helper/bin/swift-sim-helper.js" setup-status
  tailscale serve 47217
  ```

- Helper not healthy locally: check:

  ```bash
  curl http://127.0.0.1:47217/health
  ```

  If it fails, start the helper:

  ```bash
  node "$SWIFT_SIM_HOME/mac-helper/bin/swift-sim-helper.js" serve
  ```

  Then inspect `~/.swift-sim/helper.log` if it still fails.

- iOS app shows gray / **Pair a Mac**: generate a pairing link with the `pair` command and tell the user to open it on the iPhone.

- iOS app shows red / offline: verify Tailscale is connected on both Mac and iPhone, run `tailscale serve status` on the Mac, confirm the helper is running, then generate a fresh pairing link.

- Universal link opens Safari instead of the app: universal links are not configured for the installed build, or iOS has not associated the app yet. Give the `swift-sim://...` fallback link. Also check the app entitlement host and `SWIFT_SIM_IOS_APP_ID`.

- HTTPS link opens the browser fallback page inside ChatGPT: this is expected when the companion app is not associated with that host. Tell the user to tap the page's open button or paste the `swift-sim://session/...` fallback into the Swift Sim app.

- Session link says unauthorized, expired, or unknown session: create a fresh session by rerunning `scripts/codex/open-simulator-session.sh`, then return the new **Open Simulator in Companion App** link.

- Stream is blank or controls do not work: run `serve-sim-info`, inspect `~/.swift-sim/helper.log`, and restart only the tracked Swift Sim session. Do not replace the v1 `serve-sim` path with ScreenCaptureKit/WebRTC unless this repo has been explicitly upgraded.

- User asks whether login is required: no account is required for v1. The trust boundary is the user's Tailnet plus opaque pairing/session tokens generated by the Mac helper.

## Useful Commands

Generate a setup/relink URL for the native iOS companion:

```bash
node "$SWIFT_SIM_HOME/mac-helper/bin/swift-sim-helper.js" pair \
  --remote-base-url "<tailscale-serve-url>"
```

Give the user the returned `links.universalLink` when they need to pair the phone with the Mac helper. This is separate from simulator session links.

Inspect the current `serve-sim` adapter capability:

```bash
node "$SWIFT_SIM_HOME/mac-helper/bin/swift-sim-helper.js" serve-sim-info
```

Manually start the helper:

```bash
node "$SWIFT_SIM_HOME/mac-helper/bin/swift-sim-helper.js" serve
```

Check helper health:

```bash
curl http://127.0.0.1:47217/health
```
