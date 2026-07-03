# Security

Swift Sim uses two deliberately separate network boundaries: private Tailscale access for simulator control, and a short-lived public gateway for signed iPhone build delivery.

## Trust Boundary

The intended boundary is:

1. The full helper listens only on Mac localhost.
2. Tailscale Serve exposes simulator and pairing routes to authenticated devices in the same Tailnet.
3. Pairing routes require an opaque pairing token.
4. Session routes require a separate opaque session token.
5. Device delivery starts a separate localhost gateway with a strict read-only route allowlist.
6. Cloudflare Quick Tunnel exposes only that temporary gateway.
7. Every build route except health requires a separate opaque build token and expires.
8. The iPhone only receives simulator media, sends simulator controls, or installs signed IPA artifacts.

The user's project source remains on the Mac. Simulator build products remain on the Mac. Device-build `.ipa` artifacts remain on the Mac and are streamed through Cloudflare's tunnel when iOS downloads them. Cloudflare processes that network transfer, but Swift Sim does not upload source code or persist the IPA in a Swift Sim cloud service.

## Network Exposure

Default helper binding:

```text
127.0.0.1:47217
```

Recommended simulator exposure:

```sh
tailscale serve 47217
```

Do not bind the full helper to `0.0.0.0`, open the port on a router, use Tailscale Funnel, or place simulator routes behind a public reverse proxy.

Default device-build exposure:

```text
127.0.0.1:<ephemeral> -> random-name.trycloudflare.com
```

The gateway accepts only `GET` requests for health and token-protected single-build status, logs, page, manifest, and IPA routes. It rejects pairing, session control, build creation, and build listing routes. The manager stops the gateway and tunnel after the build TTL. [Cloudflare documents Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) as temporary development/testing infrastructure and provides no uptime guarantee; a failed link should be regenerated rather than treated as durable hosting.

The public companion build uses App Transport Security defaults. Simulator sessions connect through private Tailscale HTTPS; device installs use temporary public HTTPS. Plain HTTP remote URLs are intentionally unsupported in public builds.

## Tokens

Pairing and sessions use different random tokens:

- pairing token: authorizes helper setup inspection, token rotation, and session creation
- session token: authorizes one session's status, media, logs, links, and controls
- device-build token: authorizes one build's status, logs, install manifest, and IPA download

Tokens appear in URLs because iOS deep links need to carry the session credential. Treat the entire link as a secret.

Do not put real links in:

- public issues
- pull requests
- screenshots shared publicly
- analytics
- shell history copied into reports
- documentation examples

Pairing tokens rotate when the app relinks through the helper's rotate route.

Session tokens do not currently expire automatically. They remain valid in the stored session record across helper restarts. Stopping a session ends its tracked stream, but V1 does not yet provide a per-session record-deletion route; do not describe Stop as complete token revocation.

Device-build install pages and their delivery tunnel have an expiry timestamp and should be treated as temporary. The local IPA file remains on the Mac under `~/.swift-sim/device-builds/` until deleted.

If a session or device-build link is exposed, stop the helper, remove the affected record from `~/.swift-sim/sessions.json` or `~/.swift-sim/device-builds.json`, delete the matching artifact directory if needed, then restart the helper and create a fresh link. Rotate pairing separately if the pairing link was exposed. Automatic cleanup and first-class revocation are future hardening work.

## Information Minimization

Public session responses do not return:

- absolute project paths
- Simulator UDIDs
- local ports or URLs
- process IDs
- raw `serve-sim` output
- CoreSimulator device-profile paths

The model-specific framebuffer mask is served through the same authenticated session token.

Public device-build responses do not return:

- archive paths
- IPA paths
- provisioning profile paths
- certificate/keychain details
- absolute source paths

Local state under `~/.swift-sim` contains more detail and must remain private to the Mac user account.

## Device Build Signing

Direct installs use the user's Apple development or ad-hoc signing. Swift Sim does not bypass iOS signing rules:

- only devices included by the provisioning profile can install
- changing bundle identifier installs a different app
- changing team ID or access-group entitlements can break access to existing keychain or app-group data
- Swift Sim does not uninstall first unless explicitly asked

This default update path is what preserves app data.

The Apple account configured in Xcode is only a signing identity. Swift Sim does not use Apple ID cookies, passwords, or Xcode account tokens to authenticate network delivery. The default Quick Tunnel requires no separate account.

## Universal Links

Universal links require an Associated Domains entitlement for the exact HTTPS hostname serving the AASA file.

A public companion build cannot be entitled for every private `*.ts.net` or random `*.trycloudflare.com` hostname. Device build links therefore open a normal HTTPS install page; the page can use `swift-sim://` to open build status in the companion. This does not weaken the build token check.

## Dependency Boundary

V1 wraps the installed `serve-sim` package instead of copying its implementation. The adapter discovers supported CLI behavior and scopes lifecycle operations to one Simulator UDID.

Never run an unscoped `serve-sim --kill` from Swift Sim automation. It can terminate unrelated simulator mirrors.

## Recommended Operational Practices

- Keep macOS, Xcode, Node.js, Tailscale, Wrangler/Cloudflared, and `serve-sim` current.
- Keep the Mac locked when unattended.
- Restrict Tailnet membership and remove lost devices promptly.
- Rotate pairing after a phone is replaced or a link is exposed.
- Stop old streams, and remove exposed session records as described above.
- Delete old device-build artifacts from `~/.swift-sim/device-builds/` when they are no longer needed.
- Stop an active public delivery tunnel with `node mac-helper/bin/swift-sim-helper.js device-delivery-stop` when a link should end early.
- Review `~/.swift-sim/helper.log` before sharing it because logs may contain local metadata.
- Keep the repository free of personal signing IDs, device UDIDs, hostnames, and real tokens.

## Reporting A Security Issue

Use GitHub's [private vulnerability reporting](https://github.com/Miguelosaurus/Swift-Sim/security/advisories/new) for security-sensitive reports. Do not open a public issue containing a live pairing link, session link, Tailnet hostname, or helper log. Redact credentials and local machine details from all reports.
