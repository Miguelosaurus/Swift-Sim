# Troubleshooting

For setup problems, run `swift-sim doctor` and address the item marked `needs-attention`. Optional private features are reported separately from iPhone builds. For a pending edit, check its existing status before retrying.

## `swift-sim` Is Not Found

Run `brew trust --formula miguelosaurus/tap/swift-sim`, `brew install miguelosaurus/tap/swift-sim` and `swift-sim setup`. If the command is still missing, open a new terminal.

## Update Refuses An Untrusted Tap

Homebrew 7 refuses formulae from taps you have not trusted. Run `brew trust --formula miguelosaurus/tap/swift-sim` once, then `swift-sim update` again. Your installed version keeps working meanwhile.
`swift-sim update` prints this command when it happens.

## The Coding Agent Does Not Know Swift Sim

Run `swift-sim setup`, then reload the integration or start a new agent session. In Cursor you can reload the window; in Claude Code you can run `/reload-plugins`. For details, `swift-sim doctor --json` reports readiness under `deviceInstalls.agents`.

## The Mac Helper Is Unavailable

Follow the reported recovery action. A timeout or refused connection does not by itself mean setup is missing. To inspect the service and response:

```sh
brew services list | grep swift-sim
curl http://127.0.0.1:47217/health
```

The response should identify `swift-sim-helper`, say `ok: true`, and match the CLI version and runtime protocol. If the helper is stopped, `swift-sim setup` can start it. For a different listener or invalid response, identify the cause before restarting or terminating anything. Use `swift-sim update` for installed version drift. Reload the agent only when its instructions or version contract changed. Logs may contain private information:

```sh
tail -n 100 ~/.swift-sim/helper.log
tail -n 100 "$(brew --prefix)/var/log/swift-sim.log"
```

## A Device Build Fails During Signing

Check the Xcode account, target team and bundle identifier, registered iPhone, App ID capabilities and provisioning profile. Share the exact Xcode error with your agent. Do not change the bundle identifier or signing team as a workaround. To retry directly:

```sh
swift-sim build-device --project "<absolute project path>" --scheme "<scheme>" --allow-provisioning-updates
```

Use `--workspace` for an `.xcworkspace`.

## A Signed Debug Build Stops During Live Compiler Registration

Keep the failed build and Xcode result bundle. With matching transactional-registration components, try `swift-sim resume-device-build --build-id "<build-id>"`. It checks the preserved build and inputs before finishing registration and packaging. If they cannot be verified, it stops and explains why. A timeout does not confirm completion.

## Remote Hot Reload Is Unavailable

Run:

```sh
swift-sim live-status --project "/absolute/App.xcodeproj/project.pbxproj"
```

Check the reported prerequisite. Common causes include disconnected Tailscale, a missing engine or SwiftSimLive integration, an older Debug build, a missing development signing identity, or a Release build. Patches need the same Apple team as the installed app. If signing waits for a macOS key prompt, allow access to the matching development key. Do not make port 8887 public. See [hot reload](ASYNC_HOT_RELOAD.md).

## A Live Edit Did Not Appear

Check the existing request with `swift-sim live-delivery-status --request "<request-id>"`. A queued edit waits for the matching Debug app; return to it when ready. `hot-reloaded` confirms the refresh. Follow the returned guidance for a failure or uncertain result rather than sending the same edit again. A queued edit that fails later appears as `previousFailure` on the agent's next delivery and is explained in Companion. See [hot reload status](ASYNC_HOT_RELOAD.md#request-and-status).

## Live-Enabled Debug Build Has a Linker Compatibility Failure

Some Apple linkers can emit unresolved self-imports for private aliases in native libraries when global `-interposable` is enabled. During a managed Debug build, Swift Sim reads the app target's LinkFileList just before linking and scopes interposability to external definitions in its compiled objects. Linked static archives are outside that list. Swift Sim checks the final Debug image, then registers the app target's Swift compiler commands before packaging. Those commands retain the inputs needed to import linked dependencies. See [InjectionIII issue 569](https://github.com/johnno1962/InjectionIII/issues/569).

If Swift Sim cannot confirm the scoped link or finds unresolved private self-imports, it tries a normal signed Debug archive. The archive must pass the compatibility check before export. A successful fallback reports that hot reload is off for that build. If the archive also fails, check the target's Debug link diagnostics for private aliases or custom interposition flags. Cold-launch a successfully installed live-enabled Debug build before sending a live edit.

## The Temporary Delivery Link Fails

Check `swift-sim device-delivery-status` and `~/.swift-sim/device-delivery.log`. If the delivery process is stale, run `swift-sim device-delivery-stop` and build again. Device installation does not require Tailscale. Do not expose the Simulator helper as a workaround.

## An Install Link Expired

Open the saved build in Companion and tap **Create new install link**. The Mac must be online and the saved IPA must still exist. If it does not, ask the agent for a new build. A temporary link can also end when the Mac sleeps, restarts or loses internet access.

## A new build fails

Confirm a previous successful device build, pairing, Tailscale on both devices, an awake Mac and helper, and the saved project path. **New build** uses the current working tree, including uncommitted changes. If the bundle identifier or signing team changed, create a new trusted device build on the Mac. See [setup](SETUP.md#build-from-your-iphone).

## The App Was Installed As A Second App

A different bundle identifier or signing team creates a different app identity. Use the original values for updates that must preserve app data.

## Login Or Keychain Data Is Missing After An Update

Compare the old and new signing team, keychain access groups and app-group entitlements before installing another update.

## Simulator Preview Is Not Configured

This does not block iPhone builds. Connect both devices to the same Tailnet and run `tailscale serve 47217` followed by `swift-sim setup-status`. Continue when it reports `ok: true`; use its suggested remote URL. Do not use Tailscale Funnel.

## The Companion Shows No Mac Or A Gray Status

Tap **Connect your Mac > Set up with agent** and share the request with the local agent. Check Tailscale and internet access on both devices. They need the same Tailnet, not the same Wi-Fi or a USB cable. For manual pairing, run `swift-sim setup-status` and `swift-sim pair`; open or paste the returned link in Companion.

## QR Pairing Fails

Check `swift-sim setup-status` for `ok: true`, then run `swift-sim pair --qr` and scan from **Mac connection > Scan code**. Invitations are single-use and expire after five minutes by default. Generate a new one if expired, used, or verification failed after a scan. If camera access is unavailable, use the link from `swift-sim pair` instead. See [pairing](SETUP.md#pair-the-iphone-with-the-mac).

## An HTTPS Link Opens Safari

For a device build, tap **Open in Swift Sim to Install**. If iOS does not switch apps, copy and paste the link into Companion. **Install directly** does not add the build to Companion history. For a Simulator session, use or paste the printed `swift-sim://session/...` link.

## Installation Is Not Verified

**Install opened** means a handoff was opened, not that installation finished. `unknown` means the phone could not be reached, not that installation failed. Check the exact build when the phone is reachable:

```sh
swift-sim list-apps
swift-sim verify-device-build --build-id "<build-id>"
```

A verified **Installed** result identifies the requested bundle version. If the result says `different-version` or `not-installed`, check the intended build and install it if needed.

## The Same App Appears Twice

Run `swift-sim list-apps` and compare bundle identifiers and signing teams. A different identifier or team creates a separate app identity.

## The Simulator Is Blank, Frozen, Or Behind

Run `swift-sim setup-status` and inspect `~/.swift-sim/helper.log`. For `native-companion`, keep the session open while the decoder requests a new keyframe; create a new session if recovery fails. The `serve-sim` compatibility path can be slower on cellular. Do not use an unscoped `serve-sim --kill`.

## Keyboard Input Is Delayed

Current Companions use **Live Keyboard**. If the old **Send Text** sheet appears, update the Companion and restart the helper.

## Local State Did Not Move To SQLite

The helper moves existing installs to SQLite when it starts. If that fails, Swift Sim keeps working from its JSON files and retries about once a day. The reason code is in `~/.swift-sim/storage-migration.json` and `~/.swift-sim/helper.log`. The original JSON files are never modified; after a successful move they are kept as backups for 30 days.

## Reset Local State

Stop active delivery with `swift-sim device-delivery-stop`. State lives under `~/.swift-sim`, mainly in `state.sqlite`. Do not edit that database by hand. For a clean reset, stop the helper and move the whole directory aside rather than deleting individual files.
