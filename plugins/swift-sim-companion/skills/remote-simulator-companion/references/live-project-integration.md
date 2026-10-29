# Live project integration

Use this for one-time project setup or live proof diagnosis. Add the Swift Sim
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

Keep a trusted iPhone reachable through Apple's device-management connection
for registration/install verification and approve a matching development-key
prompt with **Always Allow**. USB or Xcode's trusted wireless connection serves
this lane. A private Tailnet connection serves live patches; it does not prove
that Apple device management can reach the phone, or vice versa.

Install over the existing app, cold-launch it, and confirm that it stays
running and connects to the intended live session. A ready build, setup
report, or engine connection alone is not hot-reload acceptance. Use one
temporary body-only visible label change, deliver it once, and require the
current-request proof below without another installation. Restore the label
through another proven delivery. Preserve app identity, data, and any existing
project-specific linker workaround. Later ordinary edits use `deliver-change`
without repeating setup or deep readiness checks.

Swift Sim checks live-enabled Debug binaries before packaging for the known
interposable-linker self-import defect. If it reports linker incompatibility,
do not install that build. Follow the targeted [troubleshooting](troubleshooting.md)
branch. Never force a different linker for every project or change Release.

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

