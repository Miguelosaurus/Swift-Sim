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

There is no background updater. Run `swift-sim update` and start a new agent
session. A protocol mismatch says **Update Swift Sim, then start a new agent
session.** Never run doctor or setup before every warm edit. The helper stays
bound to localhost; never publish port 8887.
