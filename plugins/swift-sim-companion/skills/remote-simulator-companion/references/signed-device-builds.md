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

If a live-enabled Debug app already compiled and signed but compiler
registration failed, preserve its artifacts and use
`swift-sim resume-device-build --build-id <opaque-build-id>` with the matching
transactional-registration engine. Resume validates provenance, queries the
same registration operation, and finishes packaging without recompiling or
incrementing its build number. Never patch `compilerReady`/`ready` manually,
retry an ambiguous native application, or start another full build merely for
a pending compiler receipt. Changed or unsafe preserved inputs stop recovery.
The qualified local 0.5.1 engine supports this path; public setup still defaults
to 0.4.0. Install creation uses generic iOS, independently of phone proximity.



The Companion activity inbox can report a ready build even when its install link
was not transferred through chat. Optional APNs alerts require local setup and
notification permission. A push or tap never proves installation. Private SDK
observations can report **Installed & launched — last confirmed** for an exact
Debug binary across networks over Tailscale. This is historical evidence from a
live client, not per-Companion-phone attestation or current reachability; nearby
Apple device inventory remains a separate verification source.
