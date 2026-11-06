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
callbacks, and qualified replacement can be live. Complete delivery also supports
new private/fileprivate helpers, top-level private structs/enums/typealiases and
imports available in the captured compiler/SDK context. Other additions, existing
stored state, signatures, macros, resources, packages, build settings,
Info.plist, capabilities, entitlements, signing, and mixed edits rebuild.
Implementation-local bindings do not change existing-instance storage. The live
compiler represents whole callable bodies, including supported async/throws,
generic, accessor and callback forms. Exact signature/isolation and all-member
coverage are required. An unsupported implementation rejects the entire patch; it cannot
be silently skipped while other members are reported applied.

Additions require concurrency-aware capture metadata (`compilerContextProtocol: 2`).
An older capture reports `LIVE_COMPILER_CONTEXT_UPDATE_REQUIRED`. Recover its
exact registered frontend map and refresh the metadata; never guess actor defaults
from current project settings or automatically rebuild merely to repair capture.
The installed binary and stateful ABI can remain unchanged.

Require current-request compile/load proof, `applied: true` where applicable,
nonzero replacements unless interposition is used, `refresh_acknowledged`, and
a revision greater than the prior revision. Screenshots are not proof. One
bounded recovery may restart a stale session; compile failures and partial
applications are never retried.


## State-preserving refresh

Matching Debug builds automatically add observation and body erasure through a
private compiler overlay, without editing repository app files or per-screen
annotations. Preservation selects eligible instrumented concrete SwiftUI view
bodies and instance functions on those same captured view owners. New patch-local
helpers can accompany those replacements. Other callables use the normal
root reset; manual Refresh screen also resets deliberately.

SwiftUI identity still applies: replacing a subtree's type/ID can discard that
subtree's state. Do not promise migration of arbitrary UIKit controllers or
unsupported generic/conditional declarations. One Debug SDK update is needed;
the helper verifies the installed overlay/ABI and negotiates
`state-preserving-refresh-v1`. Native receipts must acknowledge the exact
strategy, request, digest and baseline. No state serialization, background scan,
recording, new network round trip or automatic app-content upload is added.

New concrete, unnested views with `@State`, `@Binding` or `@Environment` use the
additional `stateful-components-v1` capability. Pinning their first nominal type
in the current verified app process preserves SwiftUI-owned values across body
and shared-helper edits. No per-screen setup or separate state store is needed.
Stored fields, defaults, wrapper arguments and initializer surface cannot change
within that pinned type; these edits stop before application and require a new
Debug build in this bounded workflow. A real app relaunch regenerates the type
from confirmed desired source with normal fresh in-memory state; rejected edits
are not confirmed source. Existing installed-type storage still needs a signed build. Generic/nested
components, other wrappers and opaque helper returns remain unsupported.

## Asynchronous edits

The reconnect SDK and prepared-delivery engine are a matching contract. The
current engine 0.5.5 is a qualified local candidate; public setup still defaults
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

## Complete mixed replacement receipts

The local 0.5.2 engine negotiates `replacement-proof-v3`. Its matching Debug SDK
requires one signed bootstrap update. Swift replacement totals remain honest;
Objective-C callbacks carry separate exact class/selector/ABI and loaded-image
implementation evidence. Every changed member must be covered, with the same
request, signed digest, claim attempt, binary/process, refresh ACK and increased
revision. Old receipt-v2 installations require an explicit update for this path.
Generated callback aliases are unique for each patch and restoration. Stored
layout and signatures keep their rebuild fences. Bounded private additions use
the same signed image, immutable source and complete replacement proof; restoring
behavior does not unload old patch metadata or invalidate escaped values.

## New views and cross-file helpers

The complete compiler accepts top-level internal/private functions,
structs/enums/typealiases and new `.swift` source units inside the captured
project. Stateless SwiftUI subviews can be extracted to a new file and call a
shared helper from another file. Existing layout/signatures, public additions,
classes/actors/protocols, global storage, macros/property wrappers and added
conformances on installed types retain their fences.

Deliver the completed logical change in one `--changes-manifest` operation.
Represent a new source with its absolute `path`, `status: "added"`, empty
`beforeSource`, and its `afterSource` (or `afterPath`). A removed patch-local
file uses `status: "removed"` and empty `afterSource`. This does not delete
product files. Removing an installed source still requires a build.

Initial additions must update an existing callable consumer. New declarations
alone do not satisfy native proof. Later helper-only edits automatically carry
their bounded cumulative consumers into compilation, without adding another
accepted request or altering its snapshots. Shared names are checked against
verified originals; `FULL_CALLABLE_ORIGINALS_UNAVAILABLE` needs exact source
context recovery, not a guessed baseline or automatic rebuild.

Eligible existing parents can preserve state. Introduced view types get a new
patch-module identity each generation; their own subtree state may reset. This
adds no phone SDK, setup step, idle worker or notification overhead. Keep all
normal receipt, foreground, uncertainty and restoration requirements.
