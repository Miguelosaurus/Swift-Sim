# Setup and updates

Read this only for first-time setup, helper/integration drift, or diagnosis:

```sh
command -v swift-sim
swift-sim setup
swift-sim doctor --json
```

Setup refreshes the helper and installs bundled Codex, Cursor, Claude Code,
and OpenCode integrations. `deviceInstalls` is the real-iPhone lane and needs
no Tailscale; `remoteHotReload` is Debug-only and private-Tailnet; and
`simulatorPreview` is optional. Fix only the reported `needs-attention` item.

There is no background updater. Run `swift-sim update` and start a new agent
session. A protocol mismatch says **Update Swift Sim, then start a new agent
session.** Never run doctor or setup before every warm edit. The helper stays
bound to localhost; never publish port 8887.
*** Add File: plugins/swift-sim-companion/skills/remote-simulator-companion/references/live-project-integration.md
# Live project integration

Use this for one-time project setup or proof diagnosis. Add the Swift Sim
package, link `SwiftSimLive`, add `.swiftSimLive()` once to the root view, run
`swift-sim setup`, and connect Mac and iPhone through the private Tailnet.
Client and compiler/linker settings are Debug-only.

Establish with `swift-sim live-start`/`live-status`, then create the first
signed Debug build:

```sh
swift-sim build-device \
  --project "<absolute-project-path>" \
  --scheme "<scheme>" \
  --configuration Debug \
  --allow-provisioning-updates
```

Keep a trusted iPhone reachable for registration and approve a matching
development-key prompt with **Always Allow**. Install, launch, and leave the
app running; later edits use `deliver-change`.

Implementation bodies, SwiftUI layout/modifier changes, computed helpers,
generic/parameterized functions, accessors, actor/extension members, UIKit
callbacks, and supported interposition can be live. Imports, declarations,
stored state, signatures, macros, resources, packages, build settings,
Info.plist, capabilities, entitlements, signing, and mixed edits rebuild.

Require current-request compile/load proof, `applied: true` where applicable,
nonzero replacements unless interposition is used, `refresh_acknowledged`, and
a revision greater than the prior revision. Screenshots are not proof. One
bounded recovery may restart a stale session; compile failures and partial
applications are never retried.
*** Add File: plugins/swift-sim-companion/skills/remote-simulator-companion/references/signed-device-builds.md
# Signed device builds

Use this for build, signing, install-link, or Build Current Code detail:

```sh
swift-sim build-device \
  --project "<absolute-project-path>" \
  --scheme "<scheme>" \
  --allow-provisioning-updates
```

Use `--workspace` for workspaces and preserve repeated `--build-setting
KEY=VALUE` arguments. Only `state: ready` is installable. Return
`links.universalLink` labeled **Open in Swift Sim to Install**, with
`links.customScheme` as fallback. Never expose IPA/archive paths, UDIDs, team
IDs, ports, or raw logs.

Links expire after two hours by default. Say **Install opened** until trusted
verification proves **Installed**. Matching bundle ID, team, and compatible
entitlements preserve app data; never uninstall or pass `--replace-app-data`
without an explicit clean-install request.

Build Current Code compiles the current Mac working tree through the paired
helper without Git changes. Keep it separate from Create New Install Link,
which republishes an existing IPA. Verify with
`swift-sim verify-device-build --build-id "<opaque-build-id>"` and report its
`verified`, `different-version`, `not-installed`, or `unknown` state exactly.
*** Add File: plugins/swift-sim-companion/skills/remote-simulator-companion/references/simulator-preview.md
# Simulator preview

Use only for an explicitly requested live Simulator preview:

1. Run `swift-sim setup-status` and require an `ok` private route.
2. Build and launch one exact Simulator.
3. Start/reuse that UDID:

```sh
swift-sim start-session \
  --project "<absolute-project-or-workspace-path>" \
  --scheme "<scheme>" \
  --simulator "<simulator-udid>" \
  --remote-base-url "<tailscale-serve-url>" \
  --transport auto
```

In Codex verify `codex.localPreviewUrl` in the in-app browser; other hosts
use local preview tools. Return **Open Simulator in Companion App**. Keep
access private to Tailscale Serve and never use an unscoped `serve-sim --kill`.
`native-companion` is preferred; `serve-sim` is fallback quality. The
companion controls the Mac Simulator and does not execute project code.
*** Add File: plugins/swift-sim-companion/skills/remote-simulator-companion/references/troubleshooting.md
# Troubleshooting

Read only the matching branch:

- **Missing CLI/helper/integration:** install the signed Homebrew release and
  run `swift-sim setup`. For protocol mismatch say **Update Swift Sim, then
  start a new agent session.**
- **Live edit absent:** do not screenshot or repeat deep inspection. Confirm
  Debug app, private Tailnet, unlocked device, and same signing team; open the
  signed result from `deliver-change`.
- **Live not ready:** confirm `SwiftSimLive`, one root `.swiftSimLive()`,
  prepared Debug build, and matching development identity. Never publish 8887.
- **Pairing/Tailnet:** use `setup-status`, then `pair` or `pair --qr` for a
  fresh verified invitation. Resolve backend conflicts first.
- **Signing/delivery:** inspect exact Xcode error, bundle ID, team, device,
  capabilities, and profile. Use `device-delivery-status` and
  `device-delivery-stop` for stale delivery; device installs do not need
  Tailscale.
- **Simulator stream:** inspect `transport.activeForPhone` and create a fresh
  session only after native decoder reconnect has had a moment.
*** Add File: plugins/swift-sim-companion/skills/remote-simulator-companion/references/security-boundaries.md
# Security boundaries

- Live replacement is Debug-only and private-Tailnet-only. Release,
  TestFlight, and App Store builds never load the live client.
- Keep port 8887 behind the local helper and private Tailnet; never expose it
  through Funnel, Cloudflare Quick Tunnel, public DNS, router forwarding, or
  a public firewall rule.
- Signed fallbacks preserve bundle identity, team, entitlements, and data.
- Device delivery is a separate token-scoped, time-bounded gateway and must
  not expose source, local paths, or private Xcode metadata.
- Pairing, session, and device-build tokens are bearer secrets. Never put them
  in public issues, logs, docs, fixtures, snapshots, or benchmarks.
- User-facing links contain only opaque identities and tokens. Do not reveal
  paths, UDIDs, team IDs, ports, Tailnet names, process IDs, or raw logs.
- The companion does not execute project code. Helper and Simulator channels
  stay bound to localhost and private Tailscale Serve.
- **Install opened** is not **Installed** until trusted verification proves it.
- No background updater rewrites a running agent's skill; protocol drift
  requires an explicit update and a new agent session.

