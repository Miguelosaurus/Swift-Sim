---
name: remote-simulator-companion
description: Use when a Codex, Cursor, Claude Code, or OpenCode agent should deliver a Swift edit to a remote iPhone, build or update a signed iOS app through Swift Sim, configure Swift Sim, or preview an iOS Simulator.
---

# Remote Simulator Companion

Swift Sim is a local delivery capability for the coding agent already running
on the Mac:

- **Phone edit loop:** deliver one completed logical change with
  `swift-sim deliver-change`.
- **Signed device build:** build and hand off a real `.ipa` when a change
  cannot be replaced safely or live proof is unavailable.
- **Simulator preview:** start or reuse a Mac-hosted Simulator only when the
  user asks for a preview.

Do not create another coding agent, watch every save, stream a real iPhone, or
ask the user to choose between live reload and a build.

## Fast phone-edit contract

Use for requested iPhone delivery or hot reload. Ordinary coding invokes zero
Swift Sim commands. After one logical change, invoke exactly once:

```sh
swift-sim deliver-change \
  --before "<previous.swift>" \
  --after "<current.swift>" \
  --project "<App.xcodeproj>" \
  --scheme "<App>" \
  --allow-provisioning-updates
```

Use `--workspace` for workspaces, repeat matching `--before`/`--after` pairs
for multi-file changes, and preserve repeated `--build-setting` arguments.
The command owns immutable snapshots, classification, cheap warm validation,
durable queueing and strict applied/refresh/revision proof. For an explicit hot
reload request or acceptance test, add `--live-only`; it never builds an app.

Never run `doctor`, `live-status`, screenshots, UI analysis, or a second
classification command before a normal warm delivery. No-change returns
without contacting the engine or builder. Compatible edits queue while the
app is absent or disconnected; temporary absence and unproven application do
not start a signed rebuild. Structural/mixed/non-Swift edits require a signed
build, unless `--live-only` forbids it. A compiled patch or loaded dylib is not proof.

Schema 2 adds incomplete `queued` delivery. Report its state; the helper applies
it when the matching app can run. Never claim done, require a specific screen,
or retry delivery. Read progress with `swift-sim live-delivery-status --request
<opaque-request-id>`.

Terminal outcomes are `hot-reloaded`, `install-link-ready`, `no-change`,
`needs-user-action`, and `failed`. Say exactly:

```text
Hot reloaded successfully. Test it now on your iPhone in the running Debug app—no install needed.
```

For `install-link-ready`, say:

```text
This change needs a new signed build.
```

Then provide the returned universal link labeled **Open in Swift Sim to
Install**. Do not expose paths, device identifiers, signing identities,
Tailnet names, ports, archives, or raw logs. Explain `needs-user-action` only
with its returned action; do not mention `no-change`. Use `--verbose-json` only
for an explicit diagnostic request.

## Safety and lane boundaries

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
supported accessors, UIKit callbacks, and supported interposition can be live.
Imports, declarations, stored state, signatures, macros, resources, packages,
build settings, signing, and mixed edits require a build. Partial application
is not success and requires clean-session recovery.

Install handoff means **Install opened** until helper/device verification
proves **Installed**. Bearer links and tokens are secrets. Signed builds work
without Tailscale; live phone edits and Simulator preview require the private
Tailnet.

## First use, drift, and lazy references

Ordinary waiting is not a reconnect failure. Requesting a change from ChatGPT
on the same iPhone backgrounds the target app. Submit once, report its typed
`normalWaiting`/`guidanceCode`, and let the user return to the target app when
ready. Application can take a few seconds after foreground reconnection; never
promise a fixed ten-second deadline. Do not ask the user to keep the app open
while composing the request, select a screen, resend, restart, rebuild, or poll
unchanged status endlessly. A push notification or tap does not prove applied
or refreshed; use the matching request's native receipt and revision.

For first-time hot reload, follow [live project integration](references/live-project-integration.md)
through signed Debug install, cold launch, connection, and one proven edit.
Setup readiness and a connected engine do not prove a successful hot reload.
The asynchronous contract needs the matching SDK, prepared-delivery engine and
helper capability. Older installations require explicit bootstrap/update;
they must not silently queue work they cannot process. See the live reference
for current candidate availability and execution limits.

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
- [signed device builds](references/signed-device-builds.md) for signing,
  install links, app identity, or Build Current Code;
- [pairing](references/pairing.md) for pairing, QR invitations, or session
  links;
- [Simulator preview](references/simulator-preview.md) only for a requested
  Simulator session; and
- [troubleshooting](references/troubleshooting.md) for the reported failure,
  plus [security boundaries](references/security-boundaries.md) for transport,
  token, privacy, or release questions.

Codex, Cursor, Claude Code, and OpenCode use this same packaged skill and
references. Host-specific remote-control details remain in the references.

