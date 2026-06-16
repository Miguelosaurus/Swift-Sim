---
name: remote-simulator-companion
description: Use when Codex has built or launched an iOS app on the local Mac Simulator and should hand the live simulator session to the Swift Sim native iOS companion app.
---

# Remote Simulator Companion

Codex remains the only coding agent. This skill starts or reuses the lightweight Swift Sim helper so the user can open the Mac-hosted Simulator from the native iOS companion app.

## Workflow

1. Build and launch the iOS app on a specific Simulator UDID using the existing XcodeBuildMCP flow.
2. Verify the app launched with XcodeBuildMCP screenshot or UI description.
3. Start the helper if it is not already running:

   ```bash
   node /Users/miguel/Documents/Swift-Sim/mac-helper/bin/swift-sim-helper.js serve
   ```

4. Start or reuse a companion session:

   ```bash
   node /Users/miguel/Documents/Swift-Sim/mac-helper/bin/swift-sim-helper.js start-session \
     --project "<absolute-project-or-workspace-path>" \
     --scheme "<scheme>" \
     --simulator "<simulator-udid>" \
     --remote-base-url "<tailscale-serve-url>"
   ```

5. End the Codex response with a link labeled exactly:

   ```text
   Open Simulator in Companion App
   ```

   Prefer the returned `links.universalLink`. Include the custom-scheme fallback only if the universal link is not available.

## Requirements

- Do not create or invoke a separate coding agent.
- Do not expose project source paths, simulator UDIDs, local ports, or stream internals in the user-facing link.
- Keep the helper bound to localhost and expose it remotely through Tailscale Serve for v1.
- Never run an unscoped `serve-sim --kill`; stop only the session/UDID owned by this workflow.
