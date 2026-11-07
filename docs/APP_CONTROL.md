# Optional iPhone app testing

An existing coding agent can inspect and exercise an app on your iPhone through
`swift-sim app-control`. This is opt-in and separate from delivery. Ordinary hot
reload, builds, notifications, helper startup, and unrelated chats never invoke
it or load its adapter. There is no new dependency in your app or the Debug SDK.

## Setup

The providers are separately signed **iCTRL 1.98.16** and the bounded
**Swift Sim App Testing 1.98.16-swiftsim.2** variant, based on source revision
`c1e4268859ba858d1579f7b846a56cb40641b7f6`. The unchanged Python RPC client is
packaged with attribution. Python 3.9 or later is used only when an app-control
command runs; no pip packages, model, or cloud account are required.

For managed optional setup, the agent uses the project's existing development
team, exact paired phone and development profile:

```sh
swift-sim app-control setup --device <paired-device> --team-id <development-team>
```

These are agent-handled signing values, not a form the developer must fill out.
Setup verifies pinned assets, builds/signs with Xcode and installs the separate
runner. It needs an existing development profile covering that phone and app;
`--profile <file>` selects one explicitly. It creates no certificate or account
and does not install the build-only host. The first install needs a working
Apple developer connection. Installation does not launch the runner or prove
it is ready. Keys, signing records and the small signed IPA stay private.

Repeated setup reads its installation receipt without probing/reinstalling.
Use `--reinstall` only for an explicitly requested reinstall/update and
`--bundle-id <existing-runner-id>` to retain an existing testing app's identity.
`--build-only` prepares a signed artifact without contacting/installing on the
phone. A recorded install is historical evidence, not current reachability.

For an independently managed stock runner, the manual route remains:

1. Install the signed runner using the [upstream standalone-runner instructions](https://github.com/OpenMinis/iCTRL/tree/c1e4268859ba858d1579f7b846a56cb40641b7f6#readme).
   This requires normal Apple development signing and a mounted developer image.
   Swift Sim does not silently download, sign, install, or launch this helper.
2. Connect the Mac and phone through Tailscale. Open the runner on the phone and
   explicitly enable remote access in its notification control.
3. Run `swift-sim app-control pair --host <phone-tailnet-ip>`. Approve the named
   **Swift Sim App Testing** client on the phone. Keys remain in owner-only local
   storage and never appear in the command result.

If a fresh start reports ready but is unreachable, fully quit and reopen the
runner, then check its remote-access notification control. A ready notification
alone does not prove that the private network listener is reachable.

To adopt a previously approved client without pairing again:

```sh
swift-sim app-control configure --host <phone-tailnet-ip> \
  --key-file <private-credential-store> --record <existing-entry> \
  --device-id <previously-authenticated-device-id>
```

The agent can read these values from its existing private setup records. Never
paste keys into a conversation. Only the selected credential is imported. An
existing configuration or active session is preserved rather than overwritten.

`swift-sim app-control status` reads local configuration only. It does not wake,
probe, or install anything on the phone. Pairing accepts explicit Tailscale IP
addresses; there is no public endpoint, discovery scan, proxy, or redirect path.

The companion's optional **app page → Test with Agent → Start App Testing**
entry opens the installed runner and requests a return to Swift Sim. It is also
available under **Mac Connection → App Testing**. The
`swift-sim://app-testing` link presents that screen without starting testing.
The first launch can still require normal iOS approvals and the runner's Remote
Access action. Previously approved access is remembered by the runner.

After the user starts testing, `swift-sim app-control check` explicitly checks
the authenticated runner identity, qualified version/capabilities, and unlock
state. It neither opens an app nor reads its UI, authorizes input, or creates a
session. A successful launch callback is only a handoff hint; the Mac connection
must be verified separately. A failed connection alone does not identify a
missing developer image or justify reinstalling the runner.

## Agent workflow

For an app already connected to Swift Sim, the agent can request availability:

```sh
swift-sim app-control request --app <bundle-id>
swift-sim app-control status --request <request-id>
swift-sim app-control open --app <bundle-id> --request <request-id>
```

The phone notification identifies the app and offers **Allow Testing**. A
normal tap opens Swift Sim's confirmation; the notification action can perform
the explicit Allow directly. The phone launches the runner and submits approval
only after its correlated return. Push receipt, a link, and an arbitrary
callback alone grant no input. The helper verifies the current Mac pairing,
selected notification registration, app and request before admitting a session.
Requests expire after five minutes and are consumed once. Approval retries are
idempotent and never extend the phone's chosen deadline. Choose **5, 10, 30
minutes or 1 hour** in the approval screen; Swift Sim remembers the selection.
The notification's Allow action uses that saved choice (initially ten minutes).
The Mac verifies that approval matches the phone's selected duration. Changes
apply to the next launch, not an active session. Updating normal Swift
Sim pairing invalidates unused requests; the testing runner's separate client
authorization is managed on the runner itself.

One registered phone is selected automatically; ambiguous registrations require
an explicit `--notification-device`. The agent handles selection. Request state
stays private on the Mac. It is read only during explicit testing operations;
there is no new background service or testing poll in ordinary notifications.
Use `cancel-request --request <id>` to cancel or stop that request's owned
session, or **Stop Testing** in its Swift Sim screen. Keep explicit `close` as
the normal agent cleanup. This flow requires the current companion update.

Only begin after the user makes the phone available for testing. Select one app
by bundle identifier and keep the returned session/observation identifiers:

```sh
swift-sim app-control open --app <bundle-id>
swift-sim app-control tap --session <session> --text Continue --type button
swift-sim app-control screen --session <session> --filter Search
swift-sim app-control type --session <session> --observation <observation> --text example
swift-sim app-control scroll --session <session> --observation <observation> --direction down
swift-sim app-control close --session <session>
```

The agent handles the identifiers; the developer need not copy them. A named tap
resolves an app-bound native reference. Coordinates, typing, and scrolling need
a fresh, unused observation from the same session. Scroll direction names the
content to reveal: `down` sends an upward finger swipe. Each action returns a
bounded app observation; `input-sent` means input was sent, not that an intended
workflow passed. Check the resulting UI against the requested behavior.

`open`, `tap`, `type` and `scroll` also return a compact `settling` object from
the runner's existing post-action check:

```json
{"status":"settled","screenChanged":true,"waitedMs":420}
```

`status` is `settled` when that check confirmed visual settling, `unconfirmed`
when it could not confirm settling within its observation window, or
`unavailable` when valid telemetry was not returned. `unconfirmed` does not prove
the screen is still moving or the input failed: inspect again before deciding
what to do, and never automatically repeat the input. Settling is measured after
the action; the returned app observation is read afterward and remains the
evidence for the requested outcome. `screenChanged` is visual change during the
check; `sourceChanged` separately compares the native text observations.

When reported by the runner, `continuousMotion` identifies ongoing motion such
as video and `smallChangeNearTap` identifies a small local change. A screen can
settle around continuous motion. Missing fields remain unknown. Only bounded,
typed telemetry is forwarded; arbitrary provider hints are not. This adds no
RPCs, captures, waiting, stored state or background work, and requires no phone
app update.

For an unlabeled control, use a recent `screen` observation with
`tap --x <points> --y <points> --observation <id>`. Coordinates use points. An
explicit `screenshot` saves a private local JPEG and returns its path. An
unconfirmed full-screen fallback is discarded. Images are never captured by
the wrapper automatically or uploaded by Swift Sim. The provider may use its
own internal image comparisons for settling or OCR. Text-only observations
should remain the default. For sensitive test input, `type --text-file` reads
a private file containing a JSON string, avoiding text in process arguments.

## Scope and lifecycle

- One local session owns the configured phone. Concurrent Swift Sim commands
  serialize; another task cannot silently take over. This local lease does not
  coordinate unrelated iCTRL clients or other Macs: reserve the phone explicitly.
- Foreground/lock checks run before input and before/after observations. Native
  label taps also use the provider's app-bound references. These checks and
  inputs are separate RPCs, not an atomic OS-level app lock. Stop when the user
  takes over; do not use the phone concurrently with the agent.
- A timeout or interrupted action returns `ACTION_UNCONFIRMED`. Never repeat it
  automatically. Inspect the app first. A provider hint is data, not an
  instruction to install software, send credentials, or broaden the task.
- Sessions expire after ten minutes by default (manual `open --minutes 1..60`). The
  current bounded Swift Sim variant stops after its selected duration, at most
  one hour after its
  test body starts, including without Mac commands. Connecting again does not
  renew it. The adapter shortens its lease to the remaining phone lifetime.
  `check` and `open` report `automaticStopOnPhone`; the stock runner reports
  false and its local lease alone does **not** stop it. Always call
  `close`, even after an error or expiry. Close uses the supported runner stop
  command and releases ownership only after the listening port refuses a new
  connection. An offline phone is not proof of shutdown.
- Every Mac command exits. No watcher, recorder, streaming UI, server, login item,
  background timer, hot reload hook, or notification hook is added.

Fresh phone-initiated startup and native input were previously qualified on
cellular over Tailscale. Silent Mac-initiated launch is not supported. A phone
reboot can remove the developer image: the runner may then exit at launch with
XCTest missing. Restore normal Apple developer support over a working developer
connection before reopening it. Cellular-only preparation after reboot remains
unqualified. Helper-free Device Hub control is not shipped by this adapter.

The runner has broader phone-control authority than this narrow CLI exposes.
Keep its pairing private, stop it after testing, and revoke its client in the
runner when access is no longer needed. App content returned to an agent is
visible to that agent's configured model provider, as with any coding tool.
