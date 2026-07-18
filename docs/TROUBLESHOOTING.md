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

## The Coding Agent Does Not Know Swift Sim

Run:

```sh
swift-sim setup
```

Then refresh the host agent:

- Codex: start a new thread.
- Cursor: start a new agent session or reload the Cursor window.
- Claude Code: run `/reload-plugins` or start a new session.
- OpenCode: start a new session so its skill inventory is rebuilt, then run `swift-sim doctor`.

Use `swift-sim doctor --json` and inspect `deviceInstalls.agents`. The current host should report `ready: true`, and `deviceInstalls.agentIntegrations.ready` should be true.

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

Retry through the coding agent or run:

```sh
swift-sim build-device \
  --project "<absolute project path>" \
  --scheme "<scheme>" \
  --allow-provisioning-updates
```

Use `--workspace` for workspace-based projects. Report the exact Xcode signing error rather than replacing the app or changing its bundle identifier automatically.

## Remote Hot Reload Is Unavailable

Run:

```sh
swift-sim live-status \
  --project "/absolute/App.xcodeproj/project.pbxproj"
```

The JSON reports the missing prerequisite. Common causes are:

- InjectionNext is not installed in `/Applications`.
- Tailscale is disconnected on the Mac or iPhone.
- The project does not link `SwiftSimLive`.
- Debug `OTHER_LDFLAGS` does not contain `-Xlinker -interposable`.
- InjectionNext **Enable Devices** is off or the development signing identity was not selected.
- The installed app is a Release build rather than the prepared Debug build.

Do not make port 8887 public to work around connectivity. Use the normal Swift Sim signed update link until the private lane is healthy.

## A Live Edit Did Not Appear

Run `swift-sim route-change` with the before and after Swift files. If it returns `build-device`, the change crossed a structural boundary and needs a new link.

If it returns `hot-reload`, keep the app in the foreground and unlocked, confirm both devices are on Tailscale, and inspect InjectionNext for a green success or yellow compile failure. Compiler errors, a disconnected app, a locked device, or no success confirmation should trigger the normal `swift-sim build-device` fallback. Do not repeatedly inject a structural change.

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

Open the saved version in Swift Sim and tap **Generate New Link**. The trusted Mac must be online and still have the saved app file. Swift Sim creates another two-hour link without rebuilding the project.

If the Mac is not connected or the saved app was deleted, ask your coding agent to build the app again. Links can also end early if the Mac sleeps, restarts, or loses internet access.

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

For device builds, Safari hosts the secure handoff because random temporary tunnel hosts cannot all be universal-link domains. Tap **Open in Swift Sim to Install**. If iOS does not switch apps, use the page's copy-link action and paste the link into Swift Sim. **Install directly** remains available as a fallback, but that path cannot add the build to the companion's local history.

For Simulator sessions, arbitrary private Tailscale hosts cannot all be declared as universal-link domains in a public companion build. Use the printed `swift-sim://session/...` fallback or paste it into the app.

## App Still Says Installing

The Mac helper confirms requested installs automatically in the background. The iPhone can connect wirelessly over the local network after it has been paired once in Xcode; USB also works. Open Swift Sim again to sync the result.

For troubleshooting, confirm the exact installed version from the Mac:

```sh
swift-sim list-apps
swift-sim verify-device-build --build-id "<opaque-build-id>"
```

`verified` means Apple developer tooling found the exact bundle and version. `different-version` means the app is installed but the requested version is not. `not-installed` means a reachable iPhone did not contain the app. `unknown` means the phone could not be reached; it does not mean installation failed, and it does not erase a known installation request.

## The Same App Appears Twice

Run `swift-sim list-apps` and compare the bundle identifier and signing team. Swift Sim intentionally separates builds when either changes because iOS treats that as a different update identity. Builds with the same bundle identifier and team are stored as one app history.

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
