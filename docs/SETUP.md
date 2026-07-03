# Setup

This guide takes a new checkout from zero to simulator preview and real iPhone installs. Swift Sim has no account system. Simulator pairing uses Tailscale; signed iPhone installs use temporary public HTTPS links and do not require Tailscale.

## 1. Install The Mac Prerequisites

Install:

- Xcode and at least one iOS Simulator runtime
- Node.js 20 or newer
- Tailscale on the Mac and iPhone if you want simulator preview

For simulator preview, sign in to the same Tailnet on both devices. Same Wi-Fi is not required; the iPhone can use cellular. Skip Tailscale entirely if you only need real-device installs.

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

## 3. Configure Private Simulator Access

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

## 7. Build A Real App To The iPhone

Device builds are separate from simulator preview. The Mac archives and signs your app, then Swift Sim creates a temporary public HTTPS link through Cloudflare Quick Tunnels. The iPhone installs the real `.ipa`. No Swift Sim login, Cloudflare login, Tailscale connection, or same-network connection is required.

Requirements:

- Your app must build for `generic/platform=iOS`.
- Xcode signing must be configured for your Apple Developer team.
- The iPhone must be registered in that team or included by the development/ad-hoc provisioning profile.
- Use the same bundle identifier and signing team to update an existing install without losing app data.
- Keep the Mac online until the iPhone finishes installing.

Run a first build manually:

```sh
scripts/codex/build-device.sh \
  --project /absolute/path/to/YourApp.xcodeproj \
  --scheme YourApp \
  --allow-provisioning-updates
```

Use `--workspace /absolute/path/to/YourApp.xcworkspace` instead of `--project` for workspace-based apps.

On first use, Swift Sim downloads Cloudflare's tunnel helper through `npx`. This is automatic and does not create an account. Quick Tunnels are intended for temporary development and testing, which is exactly the device-build use case; see [Cloudflare's Quick Tunnel documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/). The command prints JSON with:

- `state`: `ready` means the IPA and install page are available.
- `links.universalLink`: opens the temporary browser install page from any network.
- `links.customScheme`: opens Swift Sim directly.
- `links.installURL`: opens iOS installation directly from the manifest.

Open the install link on the iPhone. If iOS asks for confirmation, accept it from the Home Screen.

Install links last two hours by default. The Mac must remain awake and online until installation finishes. To use a shorter window, pass `--ttl-minutes <5-120>` or set `SWIFT_SIM_DEVICE_TTL_MINUTES`.

Swift Sim does not uninstall your app by default. iOS performs an update when the bundle identifier, team, and entitlements match the existing app, so logins and app data stay in place. Changing those values installs a different app or can break access to previous data.

Xcode uses the Apple Developer account already configured on the Mac. Swift Sim does not ask for, read, transmit, or store Apple account credentials.

For Codex, say:

```text
Build this to my iPhone with Swift Sim
```

Codex should use the same device-build lane and end with an **Install on iPhone** link.

### Custom Delivery URL

The default account-free Quick Tunnel is intentionally temporary and lasts two hours unless configured otherwise. To use your own stable HTTPS endpoint instead:

```sh
scripts/codex/build-device.sh \
  --project /absolute/path/to/YourApp.xcodeproj \
  --scheme YourApp \
  --delivery custom \
  --remote-base-url https://your-host.example
```

This compatibility mode assumes the URL already reaches a trusted helper deployment. Keep it private or independently secure it; do not expose the full simulator helper publicly. The managed Quick Tunnel is the safer default for public install links because it exposes only the restricted gateway.

## Link Behavior

The temporary HTTPS device-build link is designed to open as a normal install webpage. It does not need to open the companion app. The page can install the app directly, and its **Open in Swift Sim** button uses the `swift-sim://` custom scheme when build status or logs are useful.

Simulator links still use the `swift-sim://` custom scheme as the reliable fallback for arbitrary private Tailnet hosts.

Public/TestFlight builds intentionally omit Associated Domains because they cannot declare every user's private hostname. To enable an HTTPS universal link for your own signed source build:

1. Add the Associated Domains capability to the `SwiftSimCompanion` target and add `applinks:YOUR-TAILSCALE-HOST.ts.net`, replacing the placeholder with the exact helper hostname.
2. Start the helper with the matching signed application identifier:

   ```sh
   export SWIFT_SIM_IOS_APP_ID="TEAM_ID.your.bundle.identifier"
   npm start
   ```

3. Rebuild and reinstall the companion.

A public/TestFlight build cannot include every private Tailscale hostname or random `trycloudflare.com` hostname in its entitlement. This is fine for device builds because the HTTPS page itself owns the install action. Keep the custom scheme fallback for opening Swift Sim directly.

## Next

- Install the Codex integration: [Codex Workflow](CODEX_WORKFLOW.md)
- Understand the trust boundary: [Security](SECURITY.md)
- Diagnose setup failures: [Troubleshooting](TROUBLESHOOTING.md)
