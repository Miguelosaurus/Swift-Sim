# Signed device builds

Use this for build, signing, install-link, or Build Current Code detail:

`sh
swift-sim build-device \
  --project "<absolute-project-path>" \
  --scheme "<scheme>" \
  --allow-provisioning-updates
`

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
