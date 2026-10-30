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

For private iPhone pairing, run `swift-sim setup-status` and require `ok: true`
before `swift-sim pair` or the interactive `swift-sim pair --qr` flow. See the
[pairing reference](pairing.md) for QR TTLs, camera fallback, and link-handling
rules.

There is no background updater. `swift-sim update` refreshes the installed
release and integrations; use `swift-sim setup` for a source checkout. Reload
the integration or start a new agent session after packaged instructions or
the version contract change. A helper restart with the same integration does
not itself require a new agent session.

Follow the typed delivery error before choosing setup or update. Timeout,
connection refusal, HTTP failure, invalid health data, and a helper identity,
version, or protocol mismatch have different recovery actions. A failed
health request does not establish that a package or project integration is
missing. After read-only diagnosis or same-version helper recovery, continue
the existing session; do not repeat delivery blindly or retry a partial apply.

`deviceInstalls.ready` describes build prerequisites; `remoteHotReload.ready`
describes optional local engine/network prerequisites. Neither proves that
an app cold-launches or that a patch compiled, applied, refreshed, and advanced
the runtime revision. Complete [first-time live integration](live-project-integration.md)
before the warm loop. Never run doctor or setup before every warm edit. The
helper stays bound to localhost; never publish port 8887.


Optional alerts are configured with `swift-sim notifications configure --key-file
<private-local-p8> --key-id <APNs-key-id> --team-id <team-id> --topic
<companion-bundle-id>`. Use an Apple Push Notification service signing key, not an
App Store Connect API key. `notifications status` reports configuration without
credentials; `notifications disable` stops new sends. The signed Companion needs
the matching push entitlement/profile and explicit notification permission.
The inbox works without APNs; APNs acceptance alone does not prove display.
