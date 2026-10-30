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
through another proven delivery; the request itself can be made while the app is absent. Preserve app identity, data, and any existing
project-specific linker workaround. Later ordinary edits use `deliver-change`
without repeating setup or deep readiness checks.

Swift Sim checks live-enabled Debug binaries before packaging for the known
interposable-linker self-import defect. If it reports linker incompatibility,
do not install that build. Follow the targeted [troubleshooting](troubleshooting.md)
branch. Never force a different linker for every project or change Release.

Implementation bodies, SwiftUI layout/modifier changes, computed helpers,
generic/parameterized functions, accessors, actor/extension members, UIKit
callbacks, and supported interposition can be live. Imports, added helper/type declarations,
stored state, signatures, macros, resources, packages, build settings,
Info.plist, capabilities, entitlements, signing, and mixed edits rebuild.
Implementation-local bindings do not change existing-instance storage. The live
compiler still needs complete support for every changed member. An unsupported
async/unrecognized implementation rejects the entire prepared patch; it cannot
be silently skipped while other members are reported applied.

Require current-request compile/load proof, `applied: true` where applicable,
nonzero replacements unless interposition is used, `refresh_acknowledged`, and
a revision greater than the prior revision. Screenshots are not proof. One
bounded recovery may restart a stale session; compile failures and partial
applications are never retried.


## Asynchronous edits

The reconnect SDK and prepared-delivery engine are a matching contract. The
current engine 0.5.1 is a qualified local candidate; public setup still defaults
to 0.4.0. A reachable old engine, SDK, or helper must return an explicit update
requirement. Complete one Debug SDK bootstrap when the matching candidate is
activated; do not repeatedly rebuild because a device is temporarily absent.

For an explicit hot reload or acceptance test, pass `--live-only`. Compatible
edits become durable `queued` intent. The Mac helper compiles offline when its
engine/context/signing prerequisites are available, then applies when the
matching Debug app next reaches foreground/root readiness, from any screen.
The app need not stay open while changes are requested. Locked/offline/
terminated phones wait on the Mac; iOS is not forced to execute background code.

Use `live-delivery-status --request <opaque-request-id>` for progress, not a
second delivery attempt. `applied` without `refreshed` is incomplete. Fresh
processes may receive a cumulative replacement request with a conservative
expiry; report that current identity/expiry. Offline interposition-only
preparation is not supported by this candidate. Keep uncertain effects fenced
in their original process; only matching native receipts or proven
no-admission rejections resolve them there. Once a different matching process
is authenticated at revision zero and prior claims expire, cumulative recovery
can supersede the old uncertain operation while preserving its evidence.

Confirmed desired source outlives pending-request expiry and is automatically
restored after relaunch. The qualified original binary baseline, latest source,
and removals remain private on the Mac. A genuinely offline relaunch runs the
installed baseline until the helper/private connection returns. There is no
device-local patch cache or guaranteed suppression of stale startup frames.
Use `live-desired-revoke --project <project> --scheme <scheme>` (or
`--workspace`) only when the user wants to stop restoration for that Debug
binary. Revocation cannot unload a patch from the current process.
