# Setup

This guide takes a new checkout from zero to a simulator session on an iPhone.

## 1. Install The Mac Prerequisites

Install:

- Xcode and at least one iOS Simulator runtime
- Node.js 20 or newer
- Tailscale on the Mac
- Tailscale on the iPhone

Sign in to the same Tailnet on both devices. Same Wi-Fi is not required; the iPhone can use cellular.

Verify the tools:

```sh
node --version
xcodebuild -version
tailscale status
xcrun simctl list devices available
```

## 2. Prepare Swift Sim

From the repository root:

```sh
npm ci
npm run check
```

Start the helper:

```sh
npm start
```

It listens on `http://127.0.0.1:47217` by default. Keep this terminal running.

Verify it locally:

```sh
curl http://127.0.0.1:47217/health
```

Expected result:

```json
{
  "ok": true,
  "helper": "swift-sim-helper"
}
```

## 3. Configure Private Remote Access

Run:

```sh
node mac-helper/bin/swift-sim-helper.js setup-status
```

When setup is complete, the JSON includes:

```json
{
  "ok": true,
  "suggestedRemoteBaseUrl": "https://your-mac.your-tailnet.ts.net"
}
```

If `tailscaleServe.configured` is false, run:

```sh
tailscale serve 47217
```

Run `setup-status` again and use its exact `suggestedRemoteBaseUrl`. Do not guess the Tailnet hostname.

Do not use Tailscale Funnel for the default V1 setup. Funnel makes the endpoint public; Tailscale Serve keeps it private to the Tailnet.

## 4. Install The iOS Companion

### Terminal Method

Connect the iPhone once over USB, trust the Mac, and make sure Xcode recognizes it.

Run:

```sh
DEVELOPMENT_TEAM=YOUR_TEAM_ID \
PRODUCT_BUNDLE_IDENTIFIER=com.yourname.SwiftSimCompanion \
./scripts/ios/run-on-device.sh
```

If more than one iOS device is connected:

```sh
DEVELOPMENT_TEAM=YOUR_TEAM_ID \
PRODUCT_BUNDLE_IDENTIFIER=com.yourname.SwiftSimCompanion \
DEVICE_UDID=YOUR_DEVICE_UDID \
./scripts/ios/run-on-device.sh
```

Use the same bundle identifier for future builds. Changing it creates a second app installation.

### Xcode Method

1. Open `Companion/SwiftSimCompanion.xcodeproj`.
2. Select the `SwiftSimCompanion` target.
3. Choose your Apple Developer Team.
4. Replace `dev.local.SwiftSimCompanion` with a bundle identifier you own.
5. Select the connected iPhone as the run destination.
6. Build and run.

The custom URL scheme works without an Associated Domain. See [Universal Links](#universal-links) if you want to configure one for your own signed build.

## 5. Pair The iPhone With The Mac

Generate a pairing link with the exact URL from `setup-status`:

```sh
node mac-helper/bin/swift-sim-helper.js pair \
  --remote-base-url https://your-mac.your-tailnet.ts.net
```

Open the printed `links.universalLink` on the iPhone. If it opens a browser instead of Swift Sim, open `links.customScheme`, or paste that `swift-sim://pair?...` value into the app's Paste Link sheet.

Pairing stores the Mac helper URL and pairing token locally on the iPhone. No Swift Sim account is involved.

The Mac status light means:

- gray: no Mac paired
- yellow: checking the helper
- green: helper reachable
- red: helper unreachable

## 6. Start The First Session

Boot a simulator and launch the app you want to test. Then run:

```sh
SWIFT_SIM_HOME=/absolute/path/to/Swift-Sim \
$SWIFT_SIM_HOME/scripts/codex/open-simulator-session.sh \
  --project /absolute/path/to/YourApp.xcodeproj \
  --scheme YourApp \
  --simulator YOUR_SIMULATOR_UDID \
  --remote-base-url https://your-mac.your-tailnet.ts.net
```

The command prints JSON containing:

- `codex.localPreviewUrl`: local Codex-only preview
- `links.universalLink`: HTTPS companion link
- `links.customScheme`: reliable iOS app fallback

Open either companion link on the iPhone. The companion displays the same Mac Simulator selected by `--simulator`.

## Universal Links

The `swift-sim://` custom scheme works without Associated Domains and is the reliable V1 path for arbitrary private Tailnet hosts.

Public/TestFlight builds intentionally omit Associated Domains because they cannot declare every user's private hostname. To enable an HTTPS universal link for your own signed source build:

1. Add the Associated Domains capability to the `SwiftSimCompanion` target and add `applinks:YOUR-TAILSCALE-HOST.ts.net`, replacing the placeholder with the exact helper hostname.
2. Start the helper with the matching signed application identifier:

   ```sh
   export SWIFT_SIM_IOS_APP_ID="TEAM_ID.your.bundle.identifier"
   npm start
   ```

3. Rebuild and reinstall the companion.

A public/TestFlight build cannot include every user's private Tailscale hostname in its entitlement. A future fixed Swift Sim link domain can provide universal-link behavior for public builds; until then, keep the custom scheme fallback.

## Next

- Install the Codex integration: [Codex Workflow](CODEX_WORKFLOW.md)
- Understand the trust boundary: [Security](SECURITY.md)
- Diagnose setup failures: [Troubleshooting](TROUBLESHOOTING.md)
