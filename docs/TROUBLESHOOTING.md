# Troubleshooting

Start with:

```sh
node mac-helper/bin/swift-sim-helper.js setup-status
```

Use the reported `nextSteps`. Do not guess the Mac hostname, helper port, or active transport.

## Helper Is Offline

Check localhost:

```sh
curl http://127.0.0.1:47217/health
```

If it fails:

```sh
npm start
```

Then inspect:

```sh
tail -n 100 ~/.swift-sim/helper.log
```

## Tailscale Is Not Ready

Verify both devices are signed into the same Tailnet. On the Mac:

```sh
tailscale status
tailscale serve status
```

If the helper is not served privately:

```sh
tailscale serve 47217
```

Run `setup-status` again and use its `suggestedRemoteBaseUrl`.

Same Wi-Fi is not required. Cellular works when both devices are online in the Tailnet.

## App Shows Pair A Mac Or A Gray Light

Generate a fresh pairing link:

```sh
node mac-helper/bin/swift-sim-helper.js pair \
  --remote-base-url "<suggestedRemoteBaseUrl>"
```

Open the link on the iPhone. Use the printed `swift-sim://pair?...` fallback if HTTPS opens in a browser.

## Mac Status Is Red

Check, in order:

1. Tailscale is connected on the Mac.
2. Tailscale is connected on the iPhone.
3. `curl http://127.0.0.1:47217/health` succeeds on the Mac.
4. `tailscale serve status` points to port `47217`.
5. The app is paired to the current `suggestedRemoteBaseUrl`.

Relink after changing the Tailscale hostname or helper URL.

## HTTPS Link Opens A Browser

This is expected when the installed app is not entitled for that exact hostname.

Use one of these paths:

- tap **Open Simulator in Companion App** on the fallback page
- open the printed `swift-sim://session/...` link
- open the printed `swift-sim://device-build/...` link for device builds
- paste the custom link into Swift Sim's Paste Link sheet

See [Setup: Universal Links](SETUP.md#universal-links) for optional entitlement configuration.

## Link Is Unauthorized Or Unknown

The token is wrong, the session no longer exists, or the link belongs to another helper state.

Create a fresh link by rerunning:

```sh
scripts/codex/open-simulator-session.sh \
  --project "<path>" \
  --scheme "<scheme>" \
  --simulator "<UDID>" \
  --remote-base-url "<suggestedRemoteBaseUrl>"
```

Do not edit token query parameters manually.

## Device Build Fails During Signing

Run the same command with `--allow-provisioning-updates` if you want Xcode to repair profiles:

```sh
scripts/codex/build-device.sh \
  --project "<path>" \
  --scheme "<scheme>" \
  --remote-base-url "<suggestedRemoteBaseUrl>" \
  --allow-provisioning-updates
```

Then check:

- the app builds for `generic/platform=iOS`
- Xcode has your Apple Developer team selected
- the bundle identifier belongs to that team
- the iPhone is registered in the Apple Developer account or included by the profile
- any required capabilities are enabled for that App ID

Swift Sim signs with your development setup. It does not bypass Apple's provisioning rules.

## Install Page Says Build Not Ready

The archive/export is still running or failed. Open the build in Swift Sim and check the log, or query:

```sh
curl "<build-status-url>"
```

If the state is `failed`, fix the Xcode error and ask Codex to build to phone again.

## Install Link Expired

Create a fresh device build. Install pages are intentionally temporary.

```sh
scripts/codex/build-device.sh \
  --project "<path>" \
  --scheme "<scheme>" \
  --remote-base-url "<suggestedRemoteBaseUrl>"
```

## App Installed As A Second App

The bundle identifier changed. iOS treats that as a different app and cannot reuse the old app container.

Use the same bundle identifier for every update build if you want app data and login state to remain.

## App Updated But Login Or Keychain Data Is Gone

Check whether the signing team, keychain access group, App Group, or other entitlements changed. iOS app data is preserved for normal updates, but keychain and shared-container access depends on compatible entitlements.

Build again with the original team and entitlements if you need the existing data.

## Stream Is Blank Or Frozen

Check the active phone transport in `setup-status`.

If `activeForPhone` is `native-companion`:

1. Leave the session open for several seconds. Decoder and encoder recovery is automatic.
2. Tap refresh once if the UI still shows no frame.
3. Confirm the Mac Simulator itself is updating.
4. Inspect `~/.swift-sim/helper.log` for recovery failures.
5. Create a fresh session if recovery cannot restore media.

Input may continue working while video is stalled. The helper specifically detects this case and restarts only the tracked simulator encoder.

If `activeForPhone` is `serve-sim`, the phone is using the compatibility fallback. Upgrade the installed `serve-sim` package to a version with AVCC support and restart the helper.

Never use an unscoped `serve-sim --kill`.

## Stream Is Zoomed Or Cropped

Create a fresh session for the exact Simulator UDID used by the build. The helper derives the video size and Xcode framebuffer mask from that simulator model; it does not use a hardcoded phone outline.

If the wrong model still appears, verify Codex did not build one simulator and start Swift Sim with another UDID.

## Gestures Work But Video Does Not Update

This means the control channel is alive while media is stalled. Wait for automatic recovery, then inspect the helper log. Do not replace the input path or reboot every simulator first; the media encoder is the narrower failure.

## Keyboard Is Delayed Or Sends A Whole Message

Current builds show **Live Keyboard** and forward each key immediately through USB HID events.

If the app still shows **Send Text**:

1. rebuild and reinstall the companion
2. restart the Mac helper
3. open a fresh session

The current keyboard supports the US-keyboard ASCII mapping exposed by `serve-sim`.

## Controls Affect The Wrong Simulator

Stop the session and rerun the handoff with the same Simulator UDID used for the build. Codex should verify `codex.simulatorUDID` internally before returning a link.

## Companion Will Not Install Or Launch

Confirm:

- the iPhone trusts the Mac
- Developer Mode is enabled on the iPhone
- the iPhone is unlocked while Xcode mounts development services
- Xcode has a valid development team
- the bundle identifier belongs to that team
- the phone is unlocked for the first launch

Then retry [Setup: Install The iOS Companion](SETUP.md#4-install-the-ios-companion).

If Xcode says the device is unavailable because the Developer Disk Image is not mounted, unlock the iPhone, keep it connected, accept any trust/developer prompt, then rerun the install command.
