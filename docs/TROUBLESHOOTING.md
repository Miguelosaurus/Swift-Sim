# Troubleshooting

Start with the readiness check:

```sh
swift-sim doctor
```

Fix only the item marked `needs-attention`. The report separates normal iPhone builds from optional private features.

## `swift-sim` Is Not Found

Run:

```sh
brew install miguelosaurus/tap/swift-sim
swift-sim setup
```

If the command is still missing, open a new terminal.

## The Coding Agent Does Not Know Swift Sim

Run:

```sh
swift-sim setup
```

Then refresh the agent:

- Codex: reload the integration if supported, or start a new agent session to
  load changed packaged instructions.
- Cursor: start a new agent session or reload the Cursor window.
- Claude Code: run `/reload-plugins` or start a new session.
- OpenCode: start a new session.

For detailed status, run `swift-sim doctor --json`. The current host must report `ready: true` under `deviceInstalls.agents`.

## The Mac Helper Is Unavailable

Follow the typed `deliver-change` failure before selecting recovery. The
health request checks the local helper, independently of the private live
engine connection. A timeout, refusal, or malformed response does not establish
that first-time setup is missing. Setup and doctor readiness describe
prerequisites; they do not prove that a later health request or live edit succeeds.

For explicit diagnosis, check the service and local health response:

```sh
brew services list | grep swift-sim
curl http://127.0.0.1:47217/health
```

The health response must identify `swift-sim-helper`, report `"ok": true`,
and match the CLI's package version and runtime protocol. `ok` alone is
insufficient. Keep raw responses and logs private.

- Timeout: the bounded request expired. Inspect local helper responsiveness;
  do not infer that the app or integration is missing.
- Connection refused: no listener accepted the connection. Start the intended
  helper through `swift-sim setup` if it is stopped.
- HTTP failure or invalid health data: inspect the local listener and response
  contract before restarting anything.
- Wrong helper identity: identify the listener; do not terminate an unrelated
  process or overwrite project setup.
- Version/protocol mismatch: align the installed CLI and helper. Use
  `swift-sim update` for an installed release or setup from the intended source
  checkout. Reload the agent integration only if its instructions or version
  contract actually changed.

After same-version helper recovery, continue in the existing agent session.
Do not repeat live delivery blindly, especially after a partial application.

If it does not, inspect the logs:

```sh
tail -n 100 ~/.swift-sim/helper.log
tail -n 100 "$(brew --prefix)/var/log/swift-sim.log"
```

## A Device Build Fails During Signing

Swift Sim uses normal Xcode signing. It does not bypass Apple provisioning rules.

Check these items:

- An Apple Developer account is present in Xcode Settings.
- The target has a valid team and bundle identifier.
- The iPhone is registered with the team.
- The App ID has the required capabilities.
- The provisioning profile contains the destination iPhone.

Retry through the coding agent or run:

```sh
swift-sim build-device \
  --project "<absolute project path>" \
  --scheme "<scheme>" \
  --allow-provisioning-updates
```

Use `--workspace` for an `.xcworkspace` project.

Report the exact Xcode signing error. Do not change the bundle identifier or signing team automatically.

## Remote Hot Reload Is Unavailable

Run:

```sh
swift-sim live-status \
  --project "/absolute/App.xcodeproj/project.pbxproj"
```

The JSON identifies the missing prerequisite. Common causes are:

- The private engine was not provisioned by `swift-sim setup`.
- Tailscale is disconnected on the Mac or iPhone.
- The project does not link `SwiftSimLive`.
- The installed Debug app was built before the managed live settings were added.
- Swift Sim cannot find the development identity used by the installed app.
- The installed app is a Release build.

Patches must use the same Apple team as the installed app. If signing waits, find the macOS private-key prompt. Select **Always Allow** for the matching development key.

If the key is unavailable, resolve signing before retrying preparation. Do not
turn a requested hot reload into an automatic full app build.

Do not make port 8887 public.

## A Live Edit Did Not Appear

Run `swift-sim deliver-change` with the before and after Swift files.

The command owns immutable classification, warm readiness, durable intent and
current-request proof. Compatible edits wait for the app and do not select a
full build because of a connection failure. Use `--live-only` for a hot-reload
acceptance test; see [asynchronous delivery](ASYNC_HOT_RELOAD.md).

Interpret the result:

| Result | Meaning | Action |
| --- | --- | --- |
| `hot-reloaded` | The running app acknowledged the replacement, refresh, and new revision. | Test the running app. |
| `queued` | Intent is durable and incomplete. | Read `live-delivery-status`; allow the matching Debug app to run when convenient. |
| `install-link-ready` | A structural edit required a signed build. | Open the returned install link. |
| `needs-user-action` | A prerequisite needs manual action. | Follow the returned action. |
| `failed` | Swift Sim could not complete either safe path. | Inspect the returned failure. |

A compiled patch or loaded library is not proof of success.

Do not repeatedly inject the same edit. Do not run screenshots or repeated doctor checks before a normal warm delivery.

## Live-Enabled Debug Build Has a Linker Compatibility Failure

The managed live build uses `-interposable`. Some Apple linker versions can
emit an unresolved import from the binary's own image even though the symbol
exists there as a private definition. The app can compile, sign, and install
successfully, then terminate in dyld before startup. Native Rust/serde
dependencies are one reported case. The upstream maintainer tracks this as
[InjectionIII issue 569 and FB22853074](https://github.com/johnno1962/InjectionIII/issues/569).

Swift Sim inspects live-enabled Debug images before packaging/install-link
publication and rejects the known unresolved self-import shape. An inspection
failure is not a launchability pass. Do not install a rejected build or treat
it as a signing failure. This guard detects the known defect; it is not proof
that an app will cold-launch or that all dyld failures have been excluded.

If the selected Xcode toolchain provides and supports `ld-classic`, review an
application-target **Debug-only** workaround in Other Linker Flags:

```text
$(inherited) -fuse-ld=$(TOOLCHAIN_DIR)/usr/bin/ld-classic
```

Preserve any existing project-specific workaround. Do not force the classic
linker for every project, dependency target, or shipping configuration. If the
workaround is unavailable or unsuitable, use the ordinary signed-build lane
without managed live integration. Rebuild and cold-launch before attempting
another live edit; never uninstall or reset app data as a workaround.

## The Temporary Delivery Link Fails

Check the delivery process:

```sh
swift-sim device-delivery-status
tail -n 100 ~/.swift-sim/device-delivery.log
```

Stop a stale process:

```sh
swift-sim device-delivery-stop
```

Then build the app again.

Device installation does not require Tailscale. Do not expose the full Simulator helper as a workaround.

## An Install Link Expired

Open the saved build in Swift Sim. Tap **Create New Install Link**.

The trusted Mac must be online. The saved IPA must still exist. Swift Sim creates a new link without rebuilding the project.

If the saved IPA is unavailable, ask the coding agent to build the app again.

A temporary link can end early when the Mac sleeps, restarts, or loses internet access. A closed `trycloudflare.com` hostname is expected after its tunnel stops.

## Build Current Code Fails

Confirm these prerequisites:

- The app has a previous successful device build.
- The iPhone is paired with the Mac.
- Tailscale is online on both devices.
- The Mac is awake and its helper is running.
- The project remains at its saved path.

**Build Current Code** builds the current working tree on the Mac. It includes uncommitted changes. It does not pull, commit, or switch branches.

If Swift Sim reports an identity change, open the project on the Mac. Create a new trusted device build there. The remote build stops when the bundle identifier or signing team changes.

**Create New Install Link** republishes a saved IPA. It does not compile current source.

## The App Was Installed As A Second App

The bundle identifier or signing team changed. iOS treats the build as a different app.

Use the original bundle identifier and team for updates that must preserve app data.

## Login Or Keychain Data Is Missing After An Update

The signing team, keychain access groups, or app-group entitlements can make protected data unavailable.

Compare the old and new signed entitlements before you install another update.

## Simulator Preview Is Not Configured

This problem does not block iPhone builds.

For Simulator preview, connect the Mac and iPhone to the same Tailnet. Then run:

```sh
tailscale serve 47217
swift-sim setup-status
```

Continue only when `setup-status` reports `ok: true`. Use its exact `suggestedRemoteBaseUrl`.

Do not use Tailscale Funnel.

## The Companion Shows No Mac Or A Gray Status

Tap **Pair Now**, then **Set Up With My Agent**. Share the prepared request with the local coding agent.

If the companion reports an expired token, generate a new pairing link.

If the companion cannot reach the Mac, check Tailscale on both devices. The devices need internet access and the same Tailnet. They do not need the same Wi-Fi network or a USB cable.

For manual recovery, run:

```sh
swift-sim setup-status
swift-sim pair
```

Open the returned link on the iPhone. If Safari does not switch apps, paste the `swift-sim://pair?...` link into Swift Sim.

## QR Pairing Fails

Check the private route first:

```sh
swift-sim setup-status
```

Continue only when the report contains `ok: true`. Then create a new invitation:

```sh
swift-sim pair --qr
```

Scan it from **Mac Connection > Scan Pairing QR**.

An invitation expires after five minutes by default. It can be consumed one time. If the app reports that it expired or was used, create a new invitation.

If camera access is denied, enable Camera for Swift Sim in **Settings > Privacy & Security > Camera**. You can also use **Open or Paste Pairing Link** with the normal `swift-sim pair` output.

If scanning succeeds but helper verification fails, start a new QR flow. A different client cannot reuse an invitation that was already claimed.

## An HTTPS Link Opens Safari

For device builds, Safari provides the secure handoff. Tap **Open in Swift Sim to Install**.

If iOS does not switch apps, copy the link and paste it into Swift Sim. **Install directly** remains available, but it does not add the build to Swift Sim history.

For Simulator sessions, use the printed `swift-sim://session/...` link or paste it into the companion.

## Installation Is Not Verified

Swift Sim uses distinct installation states:

| State | Meaning | Action |
| --- | --- | --- |
| **Install opened** | iOS displayed the installation prompt. Installation is not verified. | Wait for helper verification or run the verification command. |
| **Installed** | The Mac helper verified the exact bundle version on a reachable iPhone. | Test the app. |
| `different-version` | The app is installed, but the requested version is not. | Install the requested build or verify the intended version. |
| `not-installed` | A reachable iPhone does not contain the requested app. | Open the install link again. |
| `unknown` | The iPhone could not be reached. | Connect the iPhone, then retry. |

Verify the exact build from the Mac:

```sh
swift-sim list-apps
swift-sim verify-device-build --build-id "<opaque-build-id>"
```

`unknown` does not mean that installation failed. It does not erase a known installation request.

## The Same App Appears Twice

Run `swift-sim list-apps`. Compare the bundle identifier and signing team.

Swift Sim creates a separate app identity when either value changes. Builds with the same bundle identifier and team share one app history.

## The Simulator Is Blank, Frozen, Or Behind

Run:

```sh
swift-sim setup-status
tail -n 100 ~/.swift-sim/helper.log
```

Check `transport.activeForPhone`:

- `native-companion`: keep the session open while the decoder requests a new keyframe. If recovery fails, create a new session.
- `serve-sim`: this compatibility path can be slower on cellular networks.

Do not run an unscoped `serve-sim --kill`. Swift Sim stops only the tracked Simulator stream.

## Keyboard Input Is Delayed

Current companion builds use **Live Keyboard** and one persistent control channel.

If the old **Send Text** sheet appears, update the companion. Then restart the helper.

## Reset Local State

Stop active delivery first:

```sh
swift-sim device-delivery-stop
```

Swift Sim stores local state under `~/.swift-sim`.

Remove only the affected session or build records. Delete the complete directory only when you intentionally want a clean reset.
