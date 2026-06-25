# Security

Swift Sim V1 is designed for private, self-hosted access through Tailscale. It is not designed to expose a simulator helper directly to the public internet.

## Trust Boundary

The intended boundary is:

1. The helper listens only on Mac localhost.
2. Tailscale Serve exposes it to authenticated devices in the same Tailnet.
3. Pairing routes require an opaque pairing token.
4. Session routes require a separate opaque session token.
5. Device-build routes require a separate opaque build token.
6. The iPhone only receives simulator media, sends simulator controls, or installs signed IPA artifacts.

The user's project source remains on the Mac. Simulator build products remain on the Mac. Device-build `.ipa` artifacts are served temporarily by the helper so iOS can install them.

## Network Exposure

Default helper binding:

```text
127.0.0.1:47217
```

Recommended remote exposure:

```sh
tailscale serve 47217
```

Do not bind the helper to `0.0.0.0`, open the port on a router, use Tailscale Funnel, or place it behind a public reverse proxy unless you have independently reviewed and hardened the deployment.

The public companion build uses App Transport Security defaults and connects to the Mac helper through private Tailscale HTTPS. Plain HTTP helper URLs are intentionally unsupported in public builds.

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

Device-build install pages have an expiry timestamp and should be treated as temporary. The local IPA file remains on the Mac under `~/.swift-sim/device-builds/` until deleted.

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

## Universal Links

Universal links require an Associated Domains entitlement for the exact HTTPS hostname serving the AASA file.

A public companion build cannot be entitled for every user's private `*.ts.net` hostname. For per-user Tailnet hosts, the `swift-sim://` scheme is the reliable V1 deep link. This does not weaken the helper token check; it only changes how iOS opens the app.

## Dependency Boundary

V1 wraps the installed `serve-sim` package instead of copying its implementation. The adapter discovers supported CLI behavior and scopes lifecycle operations to one Simulator UDID.

Never run an unscoped `serve-sim --kill` from Swift Sim automation. It can terminate unrelated simulator mirrors.

## Recommended Operational Practices

- Keep macOS, Xcode, Node.js, Tailscale, and `serve-sim` current.
- Keep the Mac locked when unattended.
- Restrict Tailnet membership and remove lost devices promptly.
- Rotate pairing after a phone is replaced or a link is exposed.
- Stop old streams, and remove exposed session records as described above.
- Delete old device-build artifacts from `~/.swift-sim/device-builds/` when they are no longer needed.
- Review `~/.swift-sim/helper.log` before sharing it because logs may contain local metadata.
- Keep the repository free of personal signing IDs, device UDIDs, hostnames, and real tokens.

## Reporting A Security Issue

Use GitHub's [private vulnerability reporting](https://github.com/Miguelosaurus/Swift-Sim/security/advisories/new) for security-sensitive reports. Do not open a public issue containing a live pairing link, session link, Tailnet hostname, or helper log. Redact credentials and local machine details from all reports.
