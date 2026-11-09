# Setup

Swift Sim has three components:

1. The Mac package contains the CLI and helper.
2. The agent integration contains the Swift Sim workflow.
3. The iPhone companion manages apps, builds, and optional remote features.

`swift-sim setup` installs the first two components from the same Homebrew release.

## Requirements

- Apple silicon Mac
- Xcode
- Homebrew
- at least one supported coding agent running locally on the Mac
- Apple Developer account configured in Xcode
- iPhone included in the development or ad-hoc provisioning profile

Tailscale is optional. It is required only for Mac pairing, **New build**, remote hot reload, and Simulator preview.

## 1. Prepare A Local Coding Agent

Choose a supported agent. Run it on the Mac that contains the iOS project.

Codex, Cursor, Claude Code and OpenCode use the same packaged Swift Sim skill.
Use the remote/mobile session supported by your chosen agent to continue work
on that Mac. Swift Sim does not synchronize an unrelated cloud checkout or
move an agent conversation between hosts.

Keep the agent session on the Mac. A cloud agent cannot use the Mac's Xcode installation, signing credentials, helper, or Simulator state.

## 2. Install The Mac Package

Run:

```sh
brew install miguelosaurus/tap/swift-sim
swift-sim setup
swift-sim doctor
```

Setup performs these actions:

- starts the helper with Homebrew services
- installs or refreshes each detected agent integration
- checks Xcode and signing readiness
- reports optional private features separately

The iPhone-build workflow is ready when the report shows that Xcode, the helper, and at least one agent integration are ready.

You do not need a repository clone or a manual skill copy.

## 3. Install The iPhone Companion

Check [current Companion availability](TESTFLIGHT.md#availability) first. The
previous public TestFlight builds have expired; an updated external build is a
launch requirement. When the current beta is available, [install it from
TestFlight](https://testflight.apple.com/join/HMUUFYNK) and open it once.

The companion provides:

- one library entry for each app identity
- build and update history
- archive and restore controls
- connected-device installation verification
- Mac pairing and **New build**
- optional Simulator viewing and control

An install link can also work in Safari. The companion is the intended app-management experience.

## 4. Prepare Xcode Signing

Open Xcode. Add your Apple Developer account under **Settings > Accounts**.

Configure the app target with a bundle identifier that belongs to the selected team. Make sure the provisioning profile includes the destination iPhone.

Swift Sim does not receive your Apple password or account session. Xcode performs archive, signing, and export operations.

## 5. Prepare The First App

Open the local agent session for the project and ask:

```text
Set up Swift Sim for this project so I can test changes on my iPhone.
Enable the supported Debug hot-reload workflow and deliver completed changes.
```

The agent checks the project, Xcode signing and matching components, prepares
one live-enabled Debug build, and returns the actual delivery result. Review
the one-time project integration: SwiftSimLive is linked only for Debug live
loading and has one root refresh hook. Your app identity and data must remain
unchanged.

If Apple's trusted developer connection is reachable, Swift Sim can install and
launch through Xcode. If a matching integrated Debug app is already installed,
a remote signed update can wait for that app and request the normal iOS install
prompt there. For a first install or fallback, the agent returns **Open in Swift
Sim to Install**. Open that handoff and confirm Install/Download when requested.
An installer handoff is not completion; wait for the matching status/launch proof.

Keep the Mac awake and online. Install links can work without Tailscale; private
remote commands and hot reload require the paired private route. Same Wi-Fi is
not required for that private connection, but Tailscale alone does not grant
Apple's native developer-install connection.

After this bootstrap, ask for a small reversible body edit and return to the
Debug app. A matching applied/refresh receipt confirms hot reload. The agent
then delivers each completed logical change automatically in this chat. Normal
warm edits do not repeat setup or install the app again.

## Update An Existing App

Ask the same agent for the change and say that you want to test it on the phone.
It selects the supported hot-reload or signed-build path. It must preserve the
bundle identity, signing team and app data; uninstalling first is not an update.

Follow the returned state:

- `hot-reloaded`: the matching native refresh is confirmed; test in the app.
- `queued`: the edit is waiting or preparing; return to the Debug app when ready.
- `installed`: native installation is verified; follow the separate launch result.
- `install-queued`: return to the matching Debug app so the waiting handoff can run.
- `install-prompt-requested`: confirm the iOS prompt and reopen the app after installation.
- `install-unconfirmed`: reconcile the existing request before trying again.
- `install-link-ready`: open **Open in Swift Sim to Install** and confirm installation.

**Create new install link** republishes an existing signed build. **New build** compiles the current Mac working tree, including uncommitted changes,
after confirmation. Neither operation pulls Git changes or switches branches.

## Pair The iPhone With The Mac

Pairing enables **New build**, install verification, and Simulator diagnostics.

Before you start, install Tailscale on the Mac and iPhone. Sign in to the same Tailnet. The devices do not need the same Wi-Fi network.

In the empty iPhone library, tap **Connect your Mac**, then **Set up with agent**. Share the prepared request with the local coding agent. You can also open **Mac connection** from the connection card.

For the QR flow, first check the private route:

```sh
swift-sim setup-status
```

Continue only when the report contains `ok: true`. Then run:

```sh
swift-sim pair --qr
```

In the companion, open **Mac connection > Scan code**. Scan the displayed code.

The invitation is valid for five minutes by default. It can be used one time. Use `--ttl-minutes 1` through `--ttl-minutes 15` to select another invitation window.

If camera access is unavailable, run `swift-sim pair`. Open its universal link or paste its custom-scheme link into **Open or Paste Pairing Link**.

Opening a pairing link is not proof of success. The companion verifies the helper before it saves the Mac.

A USB cable is not used for Swift Sim pairing. Xcode can still require a cable when it registers a new development device for the first time.

## Build from your iPhone

Complete one successful device build and pair the Mac first. Then open the app in Swift Sim and tap **New build** beside Build history. Older Companions call it **Build Current Code**.

The paired Mac builds the working tree at its saved path. The build includes uncommitted changes. Swift Sim does not pull, commit, edit, or switch branches.

The helper compares the current bundle identifier and signing team with the trusted prior build. It stops if either value changed.

**Create new install link** does not build the project. It republishes a saved IPA.

## Optional Live Simulator Preview

Use this feature only when you want to control the Mac Simulator from the iPhone.

1. Connect the Mac and iPhone to the same Tailnet.
2. Run on the Mac:

   ```sh
   tailscale serve 47217
   swift-sim setup-status
   ```

3. Continue only when `setup-status` reports `ok: true`.
4. Ask the local coding agent:

   ```text
   Open a live Simulator preview in Swift Sim
   ```

Do not use Tailscale Funnel. Simulator controls must remain private to the Tailnet.

## Optional Remote iPhone Hot Reload

Remote hot reload updates compatible function implementations in a running Debug app. It is separate from Simulator preview.

Same Wi-Fi is not required. The Mac and iPhone must be connected to the same private Tailnet.

Complete this setup one time:

1. Run `swift-sim setup`.
2. Ask the coding agent to enable Swift Sim live edits.
3. Review the project change. It adds the `SwiftSimLive` package and one `.swiftSimLive()` modifier at the root SwiftUI view.
4. Connect Tailscale on the Mac and iPhone.
5. Start the live session:

   ```sh
   swift-sim live-start \
     --project "/absolute/App.xcodeproj/project.pbxproj"
   ```

6. Create the first live-enabled build:

   ```sh
   swift-sim build-device \
     --project "/absolute/App.xcodeproj" \
     --scheme "App" \
     --configuration Debug \
     --allow-provisioning-updates
   ```

7. Install the signed Debug build over the existing app. Cold-launch it and
   confirm it stays running. Check `live-status` for the intended app/session
   connection and the development signing/compiler prerequisites.
8. Make one reversible body-only edit, such as a temporary noninteractive
   label, and send it once through `swift-sim deliver-change`. Acceptance
   requires the label to appear without another installation, a correlated
   applied result, refresh acknowledgement, and a revision newer than the
   pre-edit revision. Restore the edit and verify that delivery too.

This is first-time bootstrap. Adding the package/root integration or changing
compiler/linker settings requires a new signed Debug installation. A setup
report, signed build, or connected engine alone does not prove hot reload.
The matching asynchronous SDK reconnects on foreground execution; the app need not stay open while edits are requested. See [asynchronous delivery availability](ASYNC_HOT_RELOAD.md).

Apple device-management reachability and private-network reachability are
separate. Xcode uses a trusted USB or wireless device connection for device
registration and exact installed-version verification. The live patch channel
uses the private Tailnet. Success in either lane does not establish the other.

The agent runs `swift-sim deliver-change` once after each completed logical edit. Compatible edits queue on the Mac for the private live lane. Device absence or uncertain proof does not trigger a signed build. Structural, mixed and non-Swift edits need a signed build; `--live-only` reports that requirement without starting one.

Normal warm edits do not repeat setup, doctor, live-status, or installation.
For a typed readiness failure, follow the specific recovery action in
[Troubleshooting](TROUBLESHOOTING.md#the-mac-helper-is-unavailable). A transient
health failure does not require restarting the agent. A live-enabled Debug
build rejected for linker incompatibility must be corrected before install;
see [linker recovery](TROUBLESHOOTING.md#live-enabled-debug-build-has-a-linker-compatibility-failure).

Do not publish port 8887 through Funnel, Cloudflare Quick Tunnel, public DNS, router forwarding, or a public firewall rule.

Do not add live loading to Release, TestFlight, or App Store configurations.

## Swift Package Manager Version Pin

The published Swift Sim 0.6.5 package pins the fork's exact `0.5.8` tag, matching its
verified engine archive and source revision in the compatibility contract.
Apps can use the published stable exact version:

```swift
.package(
    url: "https://github.com/Miguelosaurus/Swift-Sim.git",
    exact: "0.6.5"
)
```

Older Swift Sim releases that depend on an unversioned engine revision may
require pinning Swift Sim itself to the immutable commit from that release.
Do not substitute an unrelated upstream InjectionNext tag: it may lack Swift
Sim's control protocol. `npm run check:engine-publication` verifies the matching
public fork tag, source revision and binary archive before publication.

## Update Swift Sim

Run:

```sh
swift-sim update
```

The command upgrades Homebrew and refreshes each detected agent integration. It does not change an agent session that is already running.

After an update changes packaged agent instructions or the version contract,
reload the integration or start a new agent session to load the new workflow.
Read-only diagnostics and same-version helper recovery do not require a new
agent session. Setup's readiness fields describe prerequisites; a proven
phone edit remains a separate acceptance step.

## Next

- [Troubleshooting](TROUBLESHOOTING.md)
- [Agent Workflows](AGENT_WORKFLOWS.md)
- [Security](SECURITY.md)
- [Documentation Guide](README.md)

Optional [activity notifications](NOTIFICATIONS.md) add an inbox and per-Mac
alerts. The inbox needs no Apple push key. Background alerts for the public
Companion are a separate beta limitation; see [availability](NOTIFICATIONS.md#public-beta-availability).
A locally configured sender is an advanced owner-built Companion setup. Inspect it with
`swift-sim notifications status`.


### Matching components and safe engine updates

The package includes one compatibility contract for the CLI/helper, agent
integrations, Debug SDK and pinned hot-reload engine. `swift-sim setup` checks
the engine archive checksum, app signature and identity before replacement.
A failed or interrupted update restores the previous app and its exact
manifest. At most one previous copy remains if cleanup is temporarily blocked;
the next explicit setup finishes cleanup. There is no updater timer.

`swift-sim doctor --json` separates local component compatibility from phone
proof. An installed executable alone does not make hot reload ready. Explicit
local candidates remain explicit; setup never silently downgrades them. The
phone's matching SDK is checked when its Debug app connects, and a successful
replacement still requires the native applied/refresh receipt.
