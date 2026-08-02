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

- The private engine was not provisioned by `swift-sim setup`.
- Tailscale is disconnected on the Mac or iPhone.
- The project does not link `SwiftSimLive`.
- The installed Debug app predates Swift Sim's managed live build settings.
- Swift Sim could not find the development identity used by the installed app.
- The installed app is a Release build rather than the prepared Debug build.

Physical-device patches must be signed by the same Apple team as the installed app. If compilation completes but signing waits, look for the one-time macOS private-key prompt and choose **Always Allow**. Do not switch teams on an installed bundle: iOS rejects that as an incompatible update. If the matching private key is unavailable or cannot be authorized, use the normal signed-build lane.

Do not make port 8887 public to work around connectivity. Use the normal Swift Sim signed update link until the private lane is healthy.

## A Live Edit Did Not Appear

Run `swift-sim deliver-change` with the before and after Swift files. It owns
classification, warm readiness, one bounded recovery, strict proof, and the
signed-build fallback. `hot-reloaded` is success only when the running app
acknowledged an applied replacement, refresh, and new revision.

An `install-link-ready` result means the edit crossed a structural boundary or
live proof was unavailable; open the returned link. A compiler error, missing
replacement descriptor, missing refresh acknowledgment, disconnected or
locked device, timeout, or partial application is not a live success. Do not
run screenshots, repeat doctor/status checks, or repeatedly inject the same
edit. `route-change` remains available for diagnostics and benchmarks.

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

## Build Current Code From iPhone

Open an app in Swift Sim and tap **Build Current Code**. The trusted Mac builds
the exact working tree already on disk, including uncommitted changes, then
opens the normal install flow. It does not pull, commit, or switch branches.
This works remotely from anywhere through the private Tailnet; no cable or
shared Wi-Fi is required.

This action needs a previous successful device build, one-time Mac pairing,
Tailscale online on both devices, the Mac awake with its helper running, and the
saved project at its original path. Pairing is how the app securely learns which
Mac may run Xcode; it is not a local-network or USB connection. If Swift Sim
reports an identity change, open the project on the Mac and create a new trusted
device build there; the remote rebuild intentionally refuses to turn an update
into a different app.

**Create New Install Link** is different: it republishes the previously saved
IPA and does not compile newer source changes.

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

Mac pairing enables **Build Current Code**, install verification, and Simulator
diagnostics. Tap **Pair Now**, then **Set Up With My Agent**. Share the prepared
request with your local coding agent; it will inspect the Mac, guide the missing
iPhone step, and send back the pairing link.

The companion verifies the Mac before saving it. If it says the token expired,
generate a fresh link. If it says the Mac is unreachable, check Tailscale on
both devices. First-time pairing requires internet access and the same Tailnet,
not the same Wi-Fi network. A USB cable does not help Swift Sim pairing and is
not required. Opening the pairing link from another app should take Swift Sim
directly to **Mac Connection** while verification runs.

If a newly fixed pairing flow still shows the old generic **Paired Mac** screen,
confirm the updated companion was actually installed. Rotating or regenerating
a pairing link updates the credential only; it cannot update an older iPhone
app or Homebrew CLI. For unreleased repository testing, use a distinct companion
build number and verify that exact build on the device.

For manual recovery, generate a fresh pairing link:

```sh
swift-sim setup-status
swift-sim pair
```

Open the returned link on the iPhone. If Safari does not switch apps, paste the returned `swift-sim://pair?...` link into Swift Sim.

## HTTPS Link Opens Safari Instead Of Swift Sim

For device builds, Safari hosts the secure handoff because random temporary tunnel hosts cannot all be universal-link domains. Tap **Open in Swift Sim to Install**. If iOS does not switch apps, use the page's copy-link action and paste the link into Swift Sim. **Install directly** remains available as a fallback, but that path cannot add the build to the companion's local history.

For Simulator sessions, arbitrary private Tailscale hosts cannot all be declared as universal-link domains in a public companion build. Use the printed `swift-sim://session/...` fallback or paste it into the app.

## Install Opened But Is Not Verified

**Install opened** means iOS showed the install prompt, so Swift Sim no longer leaves an endless progress state. It does not claim that iOS finished installing. The Mac helper upgrades the entry to **Installed** automatically after it verifies the exact version on a reachable iPhone. The iPhone can connect wirelessly over the local network after it has been paired once in Xcode; USB also works. Open Swift Sim again to sync the result.

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
