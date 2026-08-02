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

Use this lane only when the user requested iPhone delivery, remote hot reload,
or is continuing an explicit phone-testing loop. An ordinary coding task
invokes zero Swift Sim commands. After one logical change, invoke exactly once:

`sh
swift-sim deliver-change \
  --before "<previous.swift>" \
  --after "<current.swift>" \
  --project "<App.xcodeproj>" \
  --scheme "<App>" \
  --allow-provisioning-updates
`

Use `--workspace` for workspaces, repeat matching `--before`/`--after` pairs
for multi-file changes, and preserve repeated `--build-setting` arguments.
The command owns classification, cheap warm validation, bounded recovery,
strict applied/refresh/revision proof, and one existing signed-build fallback.

Never run `doctor`, `live-status`, screenshots, UI analysis, or a second
classification command before a normal warm delivery. No-change returns
without contacting the engine or builder. Structural, mixed, non-Swift, live
unavailable, or unproven edits become one signed build result. A compiled
patch or loaded dylib is not proof.

Terminal outcomes are `hot-reloaded`, `install-link-ready`, `no-change`,
`needs-user-action`, and `failed`. Say exactly:

`text
Hot reloaded successfully. Test it now on your iPhone in the running Debug app—no install needed.
`

For `install-link-ready`, say:

`text
This change needs a new signed build.
`

Then provide the returned universal link labeled **Open in Swift Sim to
Install**. Do not expose paths, device identifiers, signing identities,
Tailnet names, ports, archives, or raw logs. Explain `needs-user-action` only
with its returned action; do not mention `no-change`. Use `--verbose-json` only
for an explicit diagnostic request.

## Safety and lane boundaries

Remote replacement is Debug-only, private-Tailnet-only, and applies to the
regular signed app already running on the iPhone. Never enable live loading
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

If `deliver-change` reports a missing helper, integration, or protocol
mismatch, follow only the requested setup/update branch, then start a new
agent session. Use `swift-sim setup` for a source checkout or `swift-sim
update` for an installed release. Do not silently update a running session.
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
