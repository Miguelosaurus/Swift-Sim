# Development

## Helper Tests

Run:

```sh
npm ci
npm run check
```

`npm run check` validates the helper entry point and runs the Node test suite.

## Build The iOS Companion For Simulator

```sh
xcodebuild \
  -project Companion/SwiftSimCompanion.xcodeproj \
  -scheme SwiftSimCompanion \
  -sdk iphonesimulator \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## Build The iOS Companion For A Device

```sh
DEVELOPMENT_TEAM=YOUR_TEAM_ID \
PRODUCT_BUNDLE_IDENTIFIER=com.yourname.SwiftSimCompanion \
./scripts/ios/run-on-device.sh
```

The script detects one connected iPhone by default. Set `DEVICE_UDID` when multiple devices are available.

## Validate The Codex Plugin

The plugin source is `plugins/swift-sim-companion`. After changing its skill, validate it with the current Codex plugin and skill validation tools, update its cachebuster, then reinstall it from the local marketplace.

Start a new Codex thread after reinstalling so the new skill text is loaded.

## Manual Session Test

1. Build and launch an app on a booted simulator.
2. Run `setup-status` and copy `suggestedRemoteBaseUrl`.
3. Run `scripts/codex/open-simulator-session.sh` with that simulator's UDID.
4. Open `codex.localPreviewUrl` locally.
5. Open the companion link on an iPhone over cellular.
6. Test tap, drag, keyboard, Home, rotation, logs, app backgrounding, and reconnect.
7. Leave the stream active beyond one minute, then mutate the simulator UI and confirm the phone updates.

## Repository Hygiene

Do not commit:

- personal Apple Team IDs
- signing certificate names
- physical device UDIDs
- private Tailscale hostnames or Tailnet names
- real pairing or session tokens
- absolute user home paths
- `.build` products
- `~/.swift-sim` state or logs

Use placeholders in documentation and examples.

## Scope Rules

- Keep Codex as the only coding agent.
- Keep project execution on the Mac Simulator.
- Keep the helper bound to localhost by default.
- Keep `serve-sim` behind the adapter and transport boundaries.
- Stop only the tracked simulator stream.
- Preserve the custom URL scheme as the reliable private-host fallback.
- Treat WebRTC as a measured future upgrade, not an automatic rewrite.

## Pull Requests

Keep changes focused. Include the commands used to verify helper tests, simulator builds, and any affected remote-session behavior. Redact links and local machine details from screenshots and logs.
