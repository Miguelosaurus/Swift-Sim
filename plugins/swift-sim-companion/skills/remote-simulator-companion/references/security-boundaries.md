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
