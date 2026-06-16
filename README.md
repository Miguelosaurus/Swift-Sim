# Swift Sim

Swift Sim lets you test a Mac-hosted Xcode Simulator from your iPhone while Codex edits your SwiftUI app remotely.

The idea is simple:

1. Codex edits your iOS app on your Mac.
2. Codex builds and launches the app in the Mac's local Xcode Simulator.
3. Swift Sim starts or reuses a simulator stream.
4. Codex gives you an **Open Simulator in Companion App** link.
5. You tap the link on your iPhone and control the live Mac Simulator from the native companion app.

Your app code never runs on the iPhone companion. The iPhone only views and controls the Simulator running on your Mac.

## What Is Included

- `mac-helper/`  
  A lightweight local helper/server for Mac. It wraps the current `serve-sim` command behind an adapter, tracks sessions, and returns companion links.

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

In a second terminal, expose the helper privately through Tailscale:

```sh
tailscale serve 47217
```

Tailscale prints an HTTPS URL like:

```text
https://your-mac.your-tailnet.ts.net
```

Use that as your `remote-base-url`.

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
  --remote-base-url https://your-mac.your-tailnet.ts.net
```

The command prints JSON. Look for:

```json
{
  "links": {
    "universalLink": "https://your-mac.your-tailnet.ts.net/s/...",
    "customScheme": "swift-sim://session/..."
  }
}
```

Send the `universalLink` to your iPhone. If universal links are not configured yet, use the `customScheme` fallback.

## Build The Companion App

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

## Codex Workflow

After Codex successfully builds and launches your SwiftUI app on the Mac Simulator, it should run:

```sh
node /path/to/Swift-Sim/mac-helper/bin/swift-sim-helper.js start-session \
  --project "<absolute-project-or-workspace-path>" \
  --scheme "<scheme>" \
  --simulator "<simulator-udid>" \
  --remote-base-url "<tailscale-url>"
```

Codex should end its response with:

```md
[Open Simulator in Companion App](https://your-mac.your-tailnet.ts.net/s/...)
```

## Security Model

- The helper binds to localhost by default.
- Remote access is private through Tailscale.
- Session links use opaque session ids and tokens.
- User project code is not sent to the iPhone companion for execution.
- Stop only the specific simulator session you own; do not run unscoped `serve-sim --kill`.

## Current V1 Limits

- Streaming uses `serve-sim` through an adapter.
- ScreenCaptureKit/WebRTC is intentionally deferred.
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
