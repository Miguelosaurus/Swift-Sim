# Pairing and session links

Use this reference only when the user asks to pair the iPhone with the Mac
helper, relink, scan a QR invitation, or open a Simulator session link.

## Pair the Mac helper

Pairing links teach the native iOS companion which Mac helper to trust.
Simulator session links open one opaque session. They are different credentials
and a valid session link does not prove the app is paired.

First require `swift-sim setup-status` to report `ok: true` with the intended
Tailscale hostname and private Serve URL. Then generate a verified link:

```sh
swift-sim pair
```

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

```sh
swift-sim pair --qr
```

The invitation lasts five minutes by default. `--ttl-minutes` accepts a value
from 1 through 15 and only applies with `--qr`. Scan the displayed code from
**Mac Connection → Scan Pairing QR**. Camera access may be approved in iOS
Settings, and **Open or Paste Pairing Link** remains the fallback when scanning
is unavailable.

The invitation is one-time. The app exchanges it for the existing durable
pairing credential and verifies the helper before saving the Mac. QR only
bootstraps pairing; both devices still need the same private Tailnet. Never
paste pairing tokens into issues, logs, docs, or screenshots.

If an invitation is expired or already used, generate a fresh one. A repeated
claim with the same client nonce is safe and idempotent; a different nonce does
not make a consumed invitation valid again.

## Session links

For a requested Simulator session, return only the opaque
`links.universalLink` labeled **Open Simulator in Companion App**. A
`swift-sim://session/...` fallback can be included when the host opens HTTPS
inside a browser. Do not expose local paths, ports, Simulator UDIDs, process
IDs, or unredacted tokens.
