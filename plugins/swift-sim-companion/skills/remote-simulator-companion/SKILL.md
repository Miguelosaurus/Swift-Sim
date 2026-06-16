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
- Remote base URL, normally the Tailscale Serve HTTPS URL for the Mac helper.
- The Swift Sim checkout path in `SWIFT_SIM_HOME`, or a workspace that contains this repo.

If the remote URL is not provided, check `SWIFT_SIM_REMOTE_BASE_URL`. If neither exists, ask the user for the Tailscale Serve URL or tell them to run:

```bash
tailscale serve 47217
```

## Workflow

1. Build and launch the iOS app on a specific Simulator UDID.
   - Prefer XcodeBuildMCP when available.
   - Use the existing project scheme and selected simulator.
   - Do not edit the user's project just to support Swift Sim.

2. Verify the app launched.
   - Prefer XcodeBuildMCP screenshot or UI description.
   - If XcodeBuildMCP is unavailable, use normal `xcodebuild`/`simctl` verification.

3. Start or reuse the Swift Sim session with the wrapper:

   ```bash
   SWIFT_SIM_HOME="/path/to/Swift-Sim" \
   "$SWIFT_SIM_HOME/scripts/codex/open-simulator-session.sh" \
     --project "<absolute-project-or-workspace-path>" \
     --scheme "<scheme>" \
     --simulator "<simulator-udid>" \
     --remote-base-url "<tailscale-serve-url>"
   ```

   The wrapper starts the helper if needed, keeps it bound to localhost, then asks the helper to start or reuse a `serve-sim` stream.

4. Parse the returned JSON. Prefer:

   ```text
   links.universalLink
   ```

   Use `links.customScheme` only as a fallback when `links.universalLink` is absent.

5. End the Codex response with a Markdown link labeled exactly:

   ```text
   Open Simulator in Companion App
   ```

   Example:

   ```md
   [Open Simulator in Companion App](https://example.ts.net/s/opaque-session?token=opaque-token)
   ```

## If XcodeBuildMCP Is Available

Use this sequence:

1. `session_show_defaults` to check current project/workspace, scheme, and simulator.
2. Set defaults if needed.
3. `build_run_sim`.
4. Verify with screenshot or UI description.
5. Run `scripts/codex/open-simulator-session.sh`.
6. Return the companion link.

## If XcodeBuildMCP Is Not Available

Use the repo's normal build/run script if it has one. Otherwise:

1. Build with `xcodebuild`.
2. Install with `xcrun simctl install`.
3. Launch with `xcrun simctl launch`.
4. Start the Swift Sim companion session.

## Requirements

- Do not create or invoke a separate coding agent.
- Do not expose project source paths, simulator UDIDs, local ports, or stream internals in the user-facing link.
- Keep the helper bound to localhost and expose it remotely through Tailscale Serve for v1.
- Never run an unscoped `serve-sim --kill`; stop only the session/UDID owned by this workflow.
- The iPhone companion only views and controls the Mac Simulator. It does not execute project code.
- If the helper fails, report the helper log path: `~/.swift-sim/helper.log`.

## Useful Commands

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
