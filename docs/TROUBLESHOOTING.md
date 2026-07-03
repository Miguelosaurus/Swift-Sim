# Troubleshooting

Start with the structured readiness check:

```sh
swift-sim doctor
```

It separates primary iPhone-install requirements from optional Simulator-preview requirements. Fix only the item marked `needs-attention`.

## `swift-sim` Is Not Found

```sh
brew install miguelosaurus/tap/swift-sim
swift-sim setup
```

Open a new terminal after Homebrew finishes if the command is still missing.

## Codex Does Not Know Swift Sim

Run:

```sh
swift-sim setup
```

Then start a new Codex thread. Plugin instructions are loaded when a thread starts.

Use `swift-sim doctor --json` to confirm `deviceInstalls.codexPlugin.ready` is true.

## Mac Helper Is Unavailable

Run setup again, then check the service:

```sh
swift-sim setup
brew services list | grep swift-sim
curl http://127.0.0.1:47217/health
```

The health response should contain `"ok": true`. If it does not, inspect:

```sh
tail -n 100 ~/.swift-sim/helper.log
tail -n 100 "$(brew --prefix)/var/log/swift-sim.log"
```

## Device Build Fails During Signing

Swift Sim uses normal Xcode signing and does not bypass Apple's provisioning rules.

Check:

- an Apple Developer account is present in Xcode Settings
- the target has a valid team and bundle identifier
- the iPhone is registered with that team
- required capabilities are enabled for the App ID
- the provisioning profile contains the destination device

Retry through Codex or run:

```sh
swift-sim build-device \
  --project "<absolute project path>" \
  --scheme "<scheme>" \
  --allow-provisioning-updates
```

Use `--workspace` for workspace-based projects. Report the exact Xcode signing error rather than replacing the app or changing its bundle identifier automatically.

## Temporary Delivery Tunnel Fails

Check the restricted delivery process:

```sh
swift-sim device-delivery-status
tail -n 100 ~/.swift-sim/device-delivery.log
```

Then stop the stale process and rebuild:

```sh
swift-sim device-delivery-stop
```

Device installs do not require Tailscale. Do not route them through the full Simulator helper as a workaround.

## Install Link Expired Or Cannot Connect

Generate a fresh build. Links last two hours by default but can end earlier if the Mac sleeps, restarts, loses internet access, or the Quick Tunnel exits.

The old random `trycloudflare.com` hostname disappearing is expected after its tunnel closes. Durable hosting requires a separately secured custom delivery service.

## App Installed As A Second App

The bundle identifier changed. iOS treats it as a different app and cannot reuse the previous app container.

Keep the same bundle identifier for every update that should preserve app data.

## App Updated But Login Or Keychain Data Is Missing

The signing team, keychain access groups, or app-group entitlements probably changed. The main app container may still be present while protected shared data becomes inaccessible.

Compare the old and new signed entitlements before installing another update.

## Simulator Preview Is Not Configured

This does not block iPhone installs.

When live preview is wanted, connect the Mac and iPhone to the same Tailnet and run:

```sh
tailscale serve 47217
swift-sim setup-status
```

Use the exact `suggestedRemoteBaseUrl` returned by the command. Same Wi-Fi is not required. Do not use Tailscale Funnel.

## Companion Shows No Mac Or A Gray Status

Mac pairing is only for Simulator diagnostics. Generate a fresh pairing link:

```sh
swift-sim pair --remote-base-url "<suggestedRemoteBaseUrl>"
```

Open the returned link on the iPhone. If Safari does not switch apps, paste the returned `swift-sim://pair?...` link into Swift Sim.

## HTTPS Link Opens Safari Instead Of Swift Sim

For device builds, Safari is the expected install surface.

For Simulator sessions, arbitrary private Tailscale hosts cannot all be declared as universal-link domains in a public companion build. Use the printed `swift-sim://session/...` fallback or paste it into the app.

## Simulator Is Blank, Frozen, Or Falling Behind

Run:

```sh
swift-sim setup-status
tail -n 100 ~/.swift-sim/helper.log
```

Check `transport.activeForPhone`:

- `native-companion`: leave the session open for several seconds while the decoder requests a fresh keyframe. If recovery fails, create a fresh session.
- `serve-sim`: this is the compatibility fallback and can be slower over cellular.

Never run an unscoped `serve-sim --kill`; Swift Sim stops only the tracked Simulator stream.

## Keyboard Input Is Delayed

Current companion builds use **Live Keyboard** and forward individual USB HID events through one persistent control channel. If the old **Send Text** sheet appears, update the companion and restart the helper.

## Reset Local State

Stop active delivery first:

```sh
swift-sim device-delivery-stop
```

Swift Sim stores local state under `~/.swift-sim`. Remove individual affected session/build records rather than deleting the whole directory unless a clean reset is intentional.
