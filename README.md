# Swift Sim

Swift Sim lets you test a Mac-hosted Xcode Simulator from your iPhone while Codex edits your SwiftUI app remotely.

The idea is simple:

1. Codex edits your iOS app on your Mac.
2. Codex builds and launches the app in the Mac's local Xcode Simulator.
3. Swift Sim starts or reuses a simulator session.
4. Codex gives you an **Open Simulator in Companion App** link.
5. You tap the link on your iPhone and control the live Mac Simulator from the native companion app.

Your app code never runs on the iPhone companion. The iPhone only views and controls the Simulator running on your Mac.

## What Is Included

- `mac-helper/`  
  A lightweight local helper/server for Mac. It tracks sessions, returns companion links, and wraps the current `serve-sim` capture/control foundation behind a transport boundary. Codex preview uses MJPEG; the native phone path uses its headless VideoToolbox H.264 stream.

- `Companion/`  
  A native SwiftUI iOS app that opens Swift Sim links, shows the simulator stream, exposes controls, and displays logs/status.

- `plugins/swift-sim-companion/`  
  A repo-local Codex plugin skill describing the Codex handoff workflow.

## Requirements

- Apple silicon Mac.
- macOS with Xcode installed.
- Node.js 20 or newer.
- Tailscale installed on the Mac and iPhone.
- A bootable iOS Simulator runtime in Xcode.
- For installing the companion app on your physical iPhone: an Apple Developer team configured in Xcode.

## Install

From this repo:

```sh
npm install
npm run check
```

Verify Xcode can see your simulators:

```sh
xcrun simctl list devices available
```

## Start The Mac Helper

Run:

```sh
node mac-helper/bin/swift-sim-helper.js serve
```

By default the helper listens only on:

```text
http://127.0.0.1:47217
```

Keep this terminal running.

## Make It Reachable From Your Phone

In a second terminal, ask Swift Sim to check the Mac setup:

```sh
node mac-helper/bin/swift-sim-helper.js setup-status
```

If Tailscale is installed, connected, and already serving the helper, this prints:

```json
{
  "ok": true,
  "suggestedRemoteBaseUrl": "https://your-mac.your-tailnet.ts.net"
}
```

Use `suggestedRemoteBaseUrl` as your `remote-base-url`.

If the check says Tailscale Serve is missing, expose the helper privately:

```sh
tailscale serve 47217
```

Tailscale prints an HTTPS URL like:

```text
https://your-mac.your-tailnet.ts.net
```

Use that as your `remote-base-url`.

## Pair The iOS Companion

Swift Sim does not require an account or login for v1. Pairing is private to your Tailnet:

1. Keep the Mac helper running.
2. Keep Tailscale connected on both the Mac and iPhone.
3. Generate a pairing link:

   ```sh
   node mac-helper/bin/swift-sim-helper.js pair \
     --remote-base-url https://your-mac.your-tailnet.ts.net
   ```

4. Open the printed `universalLink` on your iPhone.

The iOS app stores the paired Mac URL and helper token locally. The Mac Helper panel in the app shows:

- green: helper reachable
- yellow: checking
- red: helper unreachable
- gray: no Mac paired

Tap the Mac Helper panel to test the connection, relink with a new pairing URL, or forget the Mac.

## Start A Simulator Session

Boot a simulator and copy its UDID:

```sh
xcrun simctl list devices booted
```

Then start or reuse a Swift Sim session:

```sh
node mac-helper/bin/swift-sim-helper.js start-session \
  --project /absolute/path/to/YourApp.xcodeproj \
  --scheme YourApp \
  --simulator YOUR-SIMULATOR-UDID \
  --remote-base-url https://your-mac.your-tailnet.ts.net \
  --transport auto
```

The command prints JSON. Look for:

```json
{
  "codex": {
    "localPreviewUrl": "http://127.0.0.1:..."
  },
  "links": {
    "universalLink": "https://your-mac.your-tailnet.ts.net/s/...",
    "customScheme": "swift-sim://session/..."
  }
}
```

Codex should first open `codex.localPreviewUrl` in the Codex in-app browser/sidebar to confirm the nested simulator is rendering. Then send the companion link to your iPhone. Both views target the same Simulator UDID. For Tailscale-first v1, include the `customScheme` fallback because it is the most reliable direct-open path into the native iOS app.

## Transport Status

Swift Sim has a stable session/link API, but two different transport roles:

- `native-companion`: default phone transport. Current `serve-sim` captures the CoreSimulator framebuffer headlessly and hardware-encodes H.264 with VideoToolbox. Swift Sim proxies its `/stream.avcc` endpoint and renders it natively with `AVSampleBufferDisplayLayer`.
- `serve-sim`: compatibility fallback and Codex sidebar preview using MJPEG. It uses more bandwidth and should not be the normal iPhone path.

The companion does not guess device corner radii. The helper resolves the selected simulator's CoreSimulator device profile and serves its model-specific `framebufferMask` asset through the authenticated session API. The iOS app applies that vector mask to the live video, so supported simulator screens keep the same silhouette Xcode uses.

The native path is self-healing. The iOS decoder preserves H.264 frame order and reconnects for a fresh keyframe if decoding stalls. The Mac helper also watches for a `serve-sim` process that still accepts input but has stopped emitting media; it restarts only that tracked simulator stream and continues the existing companion response.

Check what your helper supports:

```sh
node mac-helper/bin/swift-sim-helper.js setup-status
```

The `transport` section reports the active phone path. A healthy current setup reports `native-companion`. If it says `serve-sim`, upgrade `serve-sim` or inspect the helper log to see why AVCC startup fell back.

## Build The Companion App

Fast path from the terminal:

```sh
DEVELOPMENT_TEAM=YOURTEAMID \
PRODUCT_BUNDLE_IDENTIFIER=com.yourname.SwiftSimCompanion \
./scripts/ios/run-on-device.sh
```

Use the same `PRODUCT_BUNDLE_IDENTIFIER` every time you install locally. iOS treats a different bundle id as a different app and will show a second icon.

If you have multiple devices connected:

```sh
DEVICE_UDID=YOUR-DEVICE-UDID ./scripts/ios/run-on-device.sh
```

Manual Xcode path:

Open:

```text
Companion/SwiftSimCompanion.xcodeproj
```

Before installing on your iPhone:

1. Select the `SwiftSimCompanion` target.
2. Set your Apple Developer Team.
3. Change the bundle id from `dev.local.SwiftSimCompanion` to one you own.
4. In `SwiftSimCompanion.entitlements`, replace:

   ```text
   applinks:YOUR-TAILSCALE-HOST.ts.net
   ```

   with your actual Tailscale host, for example:

   ```text
   applinks:your-mac.your-tailnet.ts.net
   ```

5. Run the app on your iPhone from Xcode.

## Universal Links

The helper serves:

```text
/.well-known/apple-app-site-association
```

Set this environment variable before starting the helper so the AASA response matches your signed app:

```sh
export SWIFT_SIM_IOS_APP_ID="TEAMID.your.bundle.id"
node mac-helper/bin/swift-sim-helper.js serve
```

`TEAMID` is your Apple Developer Team ID. The bundle id must match the companion app.

If universal links are not working yet, the `swift-sim://` custom scheme still opens the app.

For public/TestFlight builds, the `swift-sim://` custom scheme is the reliable direct-open path for per-user Tailscale hosts. Universal links require the iOS app to be signed with an Associated Domains entitlement for the exact host that serves the AASA file. A single public build cannot include every user's private `*.ts.net` host, so universal links are best for a fixed Swift Sim domain or for local developer builds where you set your own Tailscale host in entitlements.

When the iOS app opens a session, it loads the helper's authenticated stream endpoint directly:

```text
/api/sessions/<session-id>/stream
```

The model-specific screen mask is available at:

```text
/api/sessions/<session-id>/frame-mask
```

Both endpoints require the same opaque session token. The mask response never exposes the simulator UDID or Xcode's local device-profile path.

The `/s/<session-id>` route is only a browser fallback page for people who do not have the app installed or whose universal-link association is not active.

Simulator input is routed through the installed `serve-sim` control channel:

- Taps use normalized simulator coordinates.
- One-finger drag and swipe gestures use `serve-sim gesture` events.
- Hardware controls, rotation, Dynamic Type, and contrast controls use scoped helper routes.
- The companion keyboard forwards each key immediately as USB HID events over a persistent simulator control channel. It does not collect a message and paste it as one batch.
- H.264 improves video latency and bandwidth; it does not by itself add missing input capabilities. Multi-touch gestures such as pinch-to-zoom still depend on `serve-sim` exposing stable multi-touch gesture events.

Universal links support both:

```text
/pair
/s/*
```

## Codex Workflow

### Install The Codex Plugin

This repo includes a Codex plugin/skill at:

```text
plugins/swift-sim-companion
```

After installing/enabling **Swift Sim Companion** in Codex, future Codex sessions can use the `remote-simulator-companion` skill whenever they need to hand a Mac Simulator session to the iOS companion app.

The stable command used by the skill is:

```sh
SWIFT_SIM_HOME=/path/to/Swift-Sim \
$SWIFT_SIM_HOME/scripts/codex/open-simulator-session.sh \
  --project /absolute/path/to/YourApp.xcodeproj \
  --scheme YourApp \
  --simulator YOUR-SIMULATOR-UDID \
  --remote-base-url https://your-mac.your-tailnet.ts.net
```

It starts the helper if needed, reuses existing sessions when possible, and prints the companion links as JSON.
It also prints `codex.localPreviewUrl` for Codex-only local browser verification before the phone handoff.
On first use, Codex should run:

```sh
node $SWIFT_SIM_HOME/mac-helper/bin/swift-sim-helper.js setup-status
```

If setup is ready, Codex should use `suggestedRemoteBaseUrl`. If not, it should follow the printed `nextSteps` instead of guessing a Tailscale URL.

### What Codex Should Do

After Codex successfully builds and launches your SwiftUI app on the Mac Simulator, it should run:

```sh
SWIFT_SIM_HOME=/path/to/Swift-Sim \
$SWIFT_SIM_HOME/scripts/codex/open-simulator-session.sh \
  --project "<absolute-project-or-workspace-path>" \
  --scheme "<scheme>" \
  --simulator "<simulator-udid>" \
  --remote-base-url "<tailscale-url>"
```

Codex should end its response with:

```md
[Open Simulator in Companion App](https://your-mac.your-tailnet.ts.net/s/...)
```

For Tailscale-first sessions, Codex should also include the `swift-sim://session/...` fallback. If the ChatGPT app opens the HTTPS link in a browser, paste the fallback into Swift Sim's **Paste Link** sheet.

Codex should not paste `codex.localPreviewUrl`, local ports, Simulator UDIDs, or project paths into the final message. Those are only for local verification.

## Security Model

- The helper binds to localhost by default.
- Remote access is private through Tailscale.
- Pairing uses a helper token generated on your Mac.
- Session links use opaque session ids and tokens.
- Pairing tokens and session tokens are separate.
- Remote session creation and adapter inspection require the pairing token.
- Session status does not expose local stream URLs, local ports, process ids, project paths, or simulator UDIDs.
- User project code is not sent to the iPhone companion for execution.
- Stop only the specific simulator session you own; do not run unscoped `serve-sim --kill`.

## Current V1 Limits

- Headless simulator capture, H.264 encoding, and input use `serve-sim` through adapters.
- The iOS companion decodes H.264 natively; MJPEG remains a compatibility fallback.
- Native H.264 and the helper include bounded stall recovery, but reconnection can still produce a brief visual pause on a poor cellular path.
- WebRTC remains a later upgrade only if the AVCC-over-Tailscale path needs stronger congestion control or recovery.
- Universal links require your own Apple team, bundle id, and Tailscale host.
- The Codex plugin is currently a repo-local workflow skill, not a packaged marketplace install.

## Verify

Run helper tests:

```sh
npm run check
```

Build the companion for Simulator:

```sh
xcodebuild \
  -project Companion/SwiftSimCompanion.xcodeproj \
  -scheme SwiftSimCompanion \
  -sdk iphonesimulator \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  build
```
