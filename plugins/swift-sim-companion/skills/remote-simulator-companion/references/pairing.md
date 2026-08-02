# Pairing and session links

Use this reference only when the user asks to pair the iPhone with the Mac
helper, relink, scan a QR invitation, or open a Simulator session link.

## Pair the Mac helper

Pairing links teach the native iOS companion which Mac helper to trust.
Simulator session links open one opaque session. They are different credentials
and a valid session link does not prove the app is paired.

First require `swift-sim setup-status` to report `ok: true` with the intended
Tailscale hostname and private Serve URL. Then generate a verified link:

`sh
swift-sim pair
`

Return `links.universalLink` labeled **Pair Swift Sim Companion**. Keep
`links.customScheme` as the fallback when universal links open Safari. The app
should show:

- gray: no Mac is paired;
- yellow: helper reachability is being checked;
- green: the paired helper is reachable;
- red: the paired helper is unreachable.

Do not claim pairing succeeded merely because a link opened. The app verifies
`/api/pairing/status` and the helper reports unreachable, expired/rejected
token, or helper failure precisely.

## QR invitations

For an interactive first-time handoff:

`sh
swift-sim pair --qr
`

The invitation is one-time and expires after five minutes. The user scans it
from **Mac Connection → Scan Pairing QR**. QR only bootstraps pairing; both
devices still need the same private Tailnet. Never paste pairing tokens into
issues, logs, docs, or screenshots.

## Session links

For a requested Simulator session, return only the opaque
`links.universalLink` labeled **Open Simulator in Companion App**. A
`swift-sim://session/...` fallback can be included when the host opens HTTPS
inside a browser. Do not expose local paths, ports, Simulator UDIDs, process
IDs, or unredacted tokens.
*** Add File: plugins/swift-sim-companion/skills/remote-simulator-companion/references/simulator-preview.md
# Simulator preview

Use this reference only when the user explicitly requests a live Simulator
preview, Simulator interaction, Simulator logs, or an agent-side preview.
This lane is separate from real-iPhone hot reload and signed device builds.

## Start or reuse one Simulator

1. Run `swift-sim setup-status` and require an `ok` private route.
2. Build and launch one exact Simulator UDID with the host's normal Xcode
   tools. In Codex, prefer XcodeBuildMCP.
3. Start or reuse Swift Sim for that same UDID:

`sh
swift-sim start-session \
  --project "<absolute-project-or-workspace-path>" \
  --scheme "<scheme>" \
  --simulator "<simulator-udid>" \
  --remote-base-url "<tailscale-serve-url>" \
  --transport auto
`

4. In Codex, verify the returned `codex.localPreviewUrl` in the in-app
   browser. Other hosts use their local screenshot/UI tools.
5. Return the companion link labeled **Open Simulator in Companion App**.

The helper keeps the full Simulator bound to localhost and exposes access only
through private Tailscale Serve. Do not expose a public tunnel or use an
unscoped `serve-sim --kill`.

## Transport expectations

`native-companion` is the preferred phone transport and proxies the native
AVCC stream. `serve-sim` is a fallback framebuffer path. If
`setup-status` reports `transport.activeForPhone: "serve-sim"`, describe it as
the fallback path; do not promise native latency, pinch, or complete gesture
fidelity. The helper resolves Xcode's model-specific framebuffer mask; do not
hardcode a phone border.

The iPhone companion views and controls the Mac Simulator. It does not execute
the project code. Do not use Simulator screenshots as proof that a real
iPhone hot patch was applied.
*** Add File: plugins/swift-sim-companion/skills/remote-simulator-companion/references/troubleshooting.md
# Troubleshooting

Read only the branch matching the reported failure. Return the smallest
actionable next step; do not dump this entire reference into an agent reply.

## CLI, helper, or integration missing

Install the signed release through Homebrew, then run:

`sh
brew install miguelosaurus/tap/swift-sim
swift-sim setup
`

If the project is a source checkout, use `swift-sim setup` from that checkout.
For a protocol mismatch, say **Update Swift Sim, then start a new agent
session.**

## Live edit did not appear

Do not take a screenshot or repeat deep inspection. `deliver-change` should
already have required applied/refresh/revision proof and one bounded recovery.
If it returns a signed-build result, open the fresh link. Check that the Debug
app is running, the private Tailnet is reachable, the device is unlocked, and
the app was signed by the same Apple team. A compile failure, missing
replacement, missing refresh acknowledgement, disconnect, timeout, or partial
application is not a live success.

## Live lane is not ready

Confirm the project links `SwiftSimLive`, the root uses
`.swiftSimLive()` exactly once, the installed app is the prepared Debug build,
and the matching development identity is available. Run
`swift-sim live-status` only during setup/diagnosis, then make a normal signed
build. Do not publish port 8887.

## Pairing or Tailnet

Run `swift-sim setup-status`. If the iPhone says **Pair a Mac**, require
`ok: true` and then run `swift-sim pair` or `swift-sim pair --qr`. If the Mac
is unreachable, verify Tailscale on both devices and the helper process. If a
pairing invitation expired or was used, generate a fresh one; do not
troubleshoot the Tailnet first. A backend conflict must be resolved before a
new link is generated.

## Device build or installation

Check the exact Xcode signing error, bundle identifier, team, registered
device, capabilities, and provisioning profile. For a delivery tunnel issue:

`sh
swift-sim device-delivery-status
swift-sim device-delivery-stop
`

Then rebuild. Device installs do not require Tailscale. If the app installs as
a second app, the bundle identifier changed. If login/keychain data is absent,
the signing team or access-group entitlements likely changed.

## Simulator stream

Check `transport.activeForPhone`. A `serve-sim` result is a fallback-quality
issue. On native transport, wait briefly for decoder reconnect before creating
a fresh session. Inspect `~/.swift-sim/helper.log` only when requested or
needed for diagnosis; never kill an unrelated Simulator session.
*** Add File: plugins/swift-sim-companion/skills/remote-simulator-companion/references/security-boundaries.md
# Security boundaries

This reference is for transport, token, privacy, or release questions. These
rules are invariant across every host integration.

- Live replacement is Debug-only and private-Tailnet-only. Release,
  TestFlight, and App Store builds never load the live client.
- Keep port 8887 behind the local helper and private Tailnet. Never expose it
  through Funnel, Cloudflare Quick Tunnel, public DNS, router forwarding, or a
  public firewall rule.
- Signed fallback builds preserve bundle identifier, team, entitlements, and
  app data unless the user explicitly requests a clean install.
- Device delivery uses a separate token-scoped, time-bounded gateway. It may
  track an install request and verify a connected device, but it does not
  expose project source, local paths, or private Xcode metadata.
- Pairing and session tokens are bearer secrets. Device-build links can
  download a signed IPA until revoked or expired. Never paste tokens into
  public issues, PRs, logs, docs, fixtures, snapshots, or benchmark artifacts.
- User-facing links contain only an opaque session/build identity and token.
  Do not reveal project paths, archive or IPA paths, device UDIDs, team IDs,
  local ports, Tailscale names, process IDs, signing paths, or raw logs.
- The iOS companion does not use a Swift Sim or Cloudflare account. It views
  and controls the Mac Simulator or opens the signed-build handoff; it does
  not execute project code.
- The helper and Simulator control channel stay bound to localhost and private
  Tailscale Serve. Stop only the session/UDID owned by this workflow.
- Install handoff is not installation proof. Report **Install opened** until
  trusted helper/device verification reports **Installed**.
- No background updater may rewrite a running agent's skill. Protocol drift
  requires an explicit update and a new agent session.
