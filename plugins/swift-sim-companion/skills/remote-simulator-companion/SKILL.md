---
name: remote-simulator-companion
description: Use when a Codex, Cursor, Claude Code, or OpenCode agent should deliver a Swift edit to a remote iPhone, test an iPhone app or inspect its Debug context, build or update a signed iOS app through Swift Sim, configure Swift Sim, or preview an iOS Simulator.
---

# Remote Simulator Companion

Swift Sim delivers local edits for the agent running on the Mac:

- **Phone edit loop:** deliver one completed logical change with
  `swift-sim deliver-change`.
- **Signed device build:** build and hand off a real `.ipa` when a change
  cannot be replaced safely or live proof is unavailable.
- **Simulator preview:** start or reuse a Mac-hosted Simulator only when the
  user asks for a preview.

Never ask users to choose hot reload versus a build.

Once the user wants to test this app on their phone, deliver each completed
logical change in this thread automatically; no repeated update request is
needed. Keep the app/project target in thread handoffs. “Code only,” “don't use
my phone,” or a target change suspends that preference. Unrelated chats invoke
zero Swift Sim commands. Never watch every save.


## Fast phone-edit contract

After each completed logical change, invoke once:

```sh
swift-sim deliver-change \
  --before "<previous.swift>" \
  --after "<current.swift>" \
  --project "<App.xcodeproj>" \
  --scheme "<App>" \
  --allow-provisioning-updates
```

Use `--workspace` for workspaces, matching `--before`/`--after` pairs for multiple
files, and preserve `--build-setting` arguments.
The command owns immutable snapshots, classification, cheap warm validation,
durable queueing and strict applied/refresh/revision proof. Use `--live-only` when rebuilds are explicitly forbidden or for hot reload
qualification; it never builds an app.

Never run `doctor`, `live-status`, screenshots, UI analysis, or a second
classification command before a normal warm delivery. No-change returns
without contacting the engine or builder. Compatible edits queue while the
app is absent or disconnected; temporary absence and unproven application do
not start a signed rebuild. Structural/mixed/non-Swift edits require a signed
build, unless `--live-only` forbids it. Compilation alone is insufficient.

Schema 2 adds incomplete `queued` delivery. Report its state; the helper applies
it when the matching app can run. Never claim done, require a specific screen,
or retry delivery. Read progress with `swift-sim live-delivery-status --request
<opaque-request-id>`.

For `hot-reloaded`, say:

```text
Hot reloaded successfully. Test it now on your iPhone in the running Debug app—no install needed.
```

For `install-link-ready`, say:

```text
This change needs a new signed build.
```

For `install-link-ready`, provide the returned link labeled **Open in Swift Sim to Install**. Do not expose paths, device identifiers, signing identities,
Tailnet names, ports, archives, or raw logs. Explain `needs-user-action` only
with its returned action; do not mention `no-change`. Use `--verbose-json` only
for an explicit diagnostic request.

## Safety and lane boundaries

Build delivery also returns `installed`, `install-queued`,
`install-prompt-requested`, or `install-unconfirmed`. Follow their message; read
[automatic phone delivery](references/automatic-delivery.md) for status and limits.

When a signed build includes `rebuildReason`, explain that bounded file/member
reason too. Distinguish existing storage/signature changes from current live
compiler support limits; unsupported does not mean universally impossible.

Remote replacement is Debug-only and private-Tailnet-only. Compatible intent
can be queued while the phone is locked, offline, on another app, or the Debug
process is terminated. Apply when the matching Debug process next reaches
foreground/root readiness; iOS suspension grants no background execution.
No particular screen is required. Never enable live loading
for Release, TestFlight, or App Store builds. Never expose live port 8887
through Funnel, Cloudflare, public DNS, router forwarding, or a public
firewall. Keep bundle identifier, signing team, entitlements, and app-data
identity for signed fallbacks; never uninstall first.

Implementation bodies, SwiftUI layout/modifier changes, computed helpers,
supported accessors, whole async/throwing bodies, and UIKit callbacks can be live.
The matching receipt-v3 SDK proves every Swift replacement and exact callback
class/selector/implementation mapping. Unsupported implementations reject the entire patch.
Private/internal helpers, patch-local structs/enums/typealiases, new Swift files
and captured-SDK imports can reload with complete consumers against the installed baseline.
Matching Debug SDKs support new State/Binding/Environment views and added `@State`
fields. See live integration for limits.
Other declarations, existing storage, signatures, macros, resources, packages,
build settings and signing rebuild. Partial application needs clean-session recovery.

Install handoff means **Install opened** until helper/device verification
proves **Installed**. Bearer links and tokens are secrets. Signed builds work
without Tailscale; live phone edits and Simulator preview require the private
Tailnet.

## First use, drift, and lazy references

For requested phone UI tests, read [optional app control](references/app-control.md)
and introduce **Test with Agent**. Keep testing opt-in; never invoke it for
ordinary coding, hot reload, delivery, or notifications.

For requested phone debugging, the agent can pull scoped app context directly
with `swift-sim app-context`, `--elements`, `--screenshot`, or `--report latest`. Do not ask the
user to upload a screenshot or copy a report ID when this access is available.
Read [developer-menu context](references/developer-menu.md) only for that task;
never fetch or inject it into ordinary chats or the normal warm delivery path.

Requests from the same iPhone background the target app. Submit once, report
`normalWaiting`/`guidanceCode`, and let the user return when ready. Reconnection
has no fixed deadline. Do not require a screen, ask for resubmission, restart
or rebuild, or repeatedly poll unchanged status. Notifications and taps do
not prove application; require the matching native receipt and revision.

`normalWaiting: false` with `CHECK_MAC` or `CHECK_MATCHING_BUILD` invokes
`swift-sim recover-delivery --request <id>` once. For a helper failure before
admission, use the exact `--project`/`--workspace` and `--scheme` instead.
Follow its single `nextAction`; keep the existing request and snapshots.
Read [agent-handled recovery](references/recovery.md) for repair limits and
pre-admission retry rules. Recovery never submits an edit or starts a build.



For first-time hot reload, follow [live project integration](references/live-project-integration.md)
through Debug install, cold launch, connection and a proven edit. Setup and
connection alone are insufficient. The SDK, prepared-delivery engine and helper
must match; older installations require explicit bootstrap/update. The reference
also covers state-preserving refresh and its limits.

Confirmed compatible edits are retained as desired source for that exact Debug
binary and automatically restored after relaunch on reconnect. Pending expiry
does not erase confirmed desired state. An offline relaunch runs the installed
baseline until the Mac/helper connection returns; there is no device-local patch
cache or promise of zero stale startup frames. Never claim restart acceptance
from source tests alone. See the live reference for explicit revocation.

If `deliver-change` reports a readiness failure, follow its typed recovery
action. A timeout, refused connection, or malformed response does not prove
missing setup or require a new agent session. Use `swift-sim setup` for a
missing helper/integration or `swift-sim update` for installed release drift.
Reload the integration or start a new agent session only after its packaged
instructions or version contract actually change. Do not silently update a running session.
`swift-sim doctor --json` is for setup, update, or explicit diagnostics—not
the normal warm edit loop.

Read only the branch-specific reference:

- [setup and updates](references/setup-and-updates.md) for installation,
  version drift, or helper readiness;
- [live project integration](references/live-project-integration.md) for
  `SwiftSimLive`, the Debug session, or live proof;
- [Xcode imports](references/xcode-builds.md) for ordinary Build/Run history;
- [signed device builds](references/signed-device-builds.md) for signing,
  install links, app identity, or New build;
- [pairing](references/pairing.md) for pairing, QR invitations, or session
  links;
- [Simulator preview](references/simulator-preview.md) only for a requested
  Simulator session; and
- [troubleshooting](references/troubleshooting.md) for the reported failure,
  plus [security boundaries](references/security-boundaries.md) for transport,
  token, privacy, or release questions.

Codex, Cursor, Claude Code, and OpenCode share these instructions.
