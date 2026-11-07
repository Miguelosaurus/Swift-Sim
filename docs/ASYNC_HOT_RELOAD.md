# Asynchronous iPhone Hot Reload

Compatible edits can be requested while the phone is offline, locked, using
another app, or while the Debug app is not running. The Mac stores immutable
intent and prepares a signed replacement without starting a full app build.
The matching Debug app reconnects and applies pending work when it returns to
foreground execution. The current screen does not select what can reload;
navigate to the changed screen later to see the result.

## Availability

This workflow requires the matching reconnect SDK, prepared-delivery engine,
and helper capability. The reviewed SDK is pinned in `Package.swift`. The
engine implementation is a qualified **local 0.5.6 candidate**, not a published
binary release. The public installer still defaults to engine 0.4.0. An older
engine/client/helper must report an explicit update requirement; reconnecting
alone cannot add a missing protocol capability.

Local candidate activation is an operator qualification step. It measures an
explicit archive checksum, preserves owner-only configuration, and verifies
the app signature before installation. No background updater or public
candidate download is implied. First bootstrap requires one new signed Debug
SDK installation; subsequent compatible edits do not reinstall the app.

## Preserve the current screen

Matching Debug builds automatically instrument eligible concrete SwiftUI view
bodies in a private compiler overlay. Your source files stay unchanged; there
are no per-screen annotations or serialized state snapshots. Compatible edits
to instrumented bodies redraw without resetting the root, preserving state held
by unchanged SwiftUI identities, such as drafts, counters, navigation and scroll.

Preservation covers bodies and instance functions on captured eligible concrete
SwiftUI views, including edits that use new patch-local private helpers. Other
callable edits retain the normal root reset. Generic/conditional view declarations,
extensions and source-context
macros keep their existing behavior. Changing a subtree's type or explicit ID
can reset that subtree under SwiftUI's normal identity rules. Manual Refresh
screen remains an intentional reset. Release builds exclude the hooks.

This requires one matching Debug update, engine protocol
`state_preserving_refresh_protocol: 1`, and native capability
`state-preserving-refresh-v1`. The exact signed patch, original instrumented ABI,
request and baseline select the strategy; a generic refresh cannot prove it.
There is no extra hot-reload round trip, idle scan, recording or automatic upload.
See the [Simulator qualification](evidence/STATE_PRESERVING_RELOAD_SIMULATOR_2026_11_01.md)
for the exercised state scenarios and
[basic physical-phone acceptance](evidence/STATE_PRESERVING_RELOAD_PHONE_2026_11_02.md)
for native preserved-refresh receipts, visible body updates and restoration on Zenics 40.

## Complete replacement coverage

The local engine advertises complete receipt protocol 3 and the Debug SDK
advertises `replacement-proof-v3`. This needs one matching signed Debug SDK
update. Each prepared request binds a bounded canonical coverage digest to its
immutable source and signed artifact. Swift replacements have exact counts;
Objective-C callbacks separately prove the exact class-owned selector, ABI,
changed implementation, generated alias and loaded patch image. A nonempty
dylib or matching total cannot hide a missing changed member.

Success requires matching request, patch/coverage digests, attempt, binary and
process, complete native evidence, refresh acknowledgement and increased root
revision. Private journals retain the bounded coverage receipt; compact user
status exposes no runtime addresses or source details. New aliases are unique
per generation, including restoration. Any unproven effect after loading stays
uncertain; it is never converted into a safe retry. Suspended tasks and escaped
closures retain their original generation. They are not migrated by refresh.

The [mixed Swift/UIKit phone qualification](evidence/CALLBACK_RECEIPTS_V3_PHONE_2026_10_30.md)
verified seven Swift replacements and one exact UIKit callback, followed by
restoration in the same installed Debug binary and process through normal delivery.
This is per-member replacement and refresh evidence; it does not claim every
application method was independently invoked or every lifecycle scenario passed.

## Request and status

For a specifically requested hot reload or acceptance test, use live-only mode:

```sh
swift-sim deliver-change \
  --live-only \
  --before "<previous.swift>" --after "<current.swift>" \
  --project "<App.xcodeproj>" --scheme "<App>" \
  --configuration Debug
```

`--live-only` never builds or installs an app. A structural edit reports that a
signed build is required. Without that option, structural edits may use one
ordinary signed build; compatible edits still queue and never rebuild merely
because the device is unavailable, compilation fails, or an acknowledgement is
uncertain.

Local constants, mutable variables and pattern bindings inside an existing
implementation belong to that body, rather than the object's stored layout.
Existing stored properties, signatures and nominal layouts retain rebuild fences.
The live compiler must represent every changed implementation in one complete
replacement. Whole supported async/throws bodies, generic members, accessors
and UIKit callbacks use compiler-backed syntax generation. Unrecognized forms
reject the whole patch before application with `QUEUED_MECHANISM_UNSUPPORTED`. That is a current
compiler-support limit, not a claim that all such changes are impossible.

Signed-build outcomes may include an optional `rebuildReason` explaining the
first rejected file/member and the number of additional rejected files. This is
an additive schema-2 field; older readers may ignore it. Live-only rejections
include the same explanation in `error.message`; verbose output contains bounded,
sanitized per-file reasons. The complete compiler additionally supports new
private/fileprivate functions, top-level internal/private functions and
structs/enums/typealiases, including new Swift files inside the captured project,
and ordinary imports available in the captured compiler/SDK context. Public
additions, new classes/actors/protocols, existing-type conformance additions,
macros and stored-layout changes retain their rebuild fences.

New stateless SwiftUI subviews can live in separate files and call shared
helpers. Shared names must not collide with original module declarations or
one another. The compiler checks exact original captured sources on demand;
unavailable originals produce a context failure rather than guessed authority.
With the matching `stateful-components-v1` Debug SDK, newly introduced concrete,
unnested views also support `@State`, `@Binding` and `@Environment` (including
SwiftUI-qualified names). The first type is pinned within the current app process;
later body and shared-helper edits reuse it, keeping SwiftUI-owned counters,
drafts and bindings. No user values are copied or stored by Swift Sim. Other
wrappers, generic/nested components, opaque helper return types and macros remain
outside this bounded surface.

The additional `added-state-slots-v1` SDK reserves one optional SwiftUI-owned
slot in the existing Debug refresh hook. After one bootstrap update, new `@State`
fields on eligible installed and pinned views can reload without another build.
Primitive values, optionals, arrays and dictionaries with pure literal defaults
are supported, up to 32 added fields per view; ordinary source and bindings work
without per-screen setup. The optional box stays empty until the first mutation.
There is no background worker, value upload, serialization or extra network request.
Type/default changes, removal and rename remain fenced, except explicit restoration
to the entire installed baseline. Restoration does not cancel older callbacks or
clear latent values before the SwiftUI view lifetime ends. Normal identity and
remount rules still apply. Custom object/effectful defaults require a build.

A pinned component's original stored fields, wrapper arguments, defaults and initializer
surface stay fixed. Incompatible edits reject before application and need a new Debug build in
this bounded workflow. A real app restart regenerates types from confirmed
source with normal fresh in-memory state; it does not migrate values or turn a
rejected layout edit into confirmed source. Existing installed-type layout
changes also need a signed build. Stored initialization cannot capture newly added patch-local
helpers/types, which would otherwise bind stale generations. Native original
slots are verified separately from actual replacements; older clients require
one Debug SDK update. Modules and signed images are kept privately on the Mac
only while the current process lineage needs them, under the existing quotas.

Every generation compiles these additions against the immutable installed source,
carrying its current per-file dependency declarations. A helper-only follow-up
therefore re-emits its original consumers, and restoration explicitly replaces
those consumers even when desired source again equals the installed baseline.
Shared helper-only edits compile the bounded cumulative desired cohort, re-emitting
existing consumers even when their accepted source did not change in that request.
The projected source hashes bind artifact identity; original accepted deltas stay
unchanged. This survives request history expiry and fresh-process recovery and
respects explicit revocation. New-file origins are empty and remain separate
from captured file authority. At least one installed callable must be replaced;
unreferenced new declarations alone cannot establish native replacement proof.
Private declarations keep separate source files and lexical scope. Previous
patch-local nominal values can remain alive with their own identities; restoring
method behavior does not unload their images or remove registered metadata.
This adds compiler work on demand on the Mac, with no new phone SDK, idle worker,
app-content upload or per-screen annotation.

Delivery envelope schema **2** adds `queued` as an incomplete outcome. Save its
opaque `delivery.requestId`. Status can be read without repeating delivery:

```sh
swift-sim live-delivery-status --request "<opaque-request-id>"
```

| State | Meaning |
| --- | --- |
| `queued` | Intent is durable; preparation has not completed. |
| `compiling` | An owned, bounded compiler worker is preparing the snapshot. |
| `waiting-for-device` | The prepared request awaits its matching client. |
| `waiting-for-foreground` | The client cannot currently execute/refresh safely. |
| `applying` | The application barrier was persisted and the native transaction was sent. |
| `applied` | Application was acknowledged; refresh proof remains outstanding. |
| `refreshed` / `hot-reloaded` | This request has a matching applied replacement, refresh acknowledgement and increased revision. |
| `uncertain` / `failed` | The effect cannot be confirmed. The same process requires a matching receipt; a verified fresh process can recover cumulative intent. |

Queued work is not "done". A ready build, connected engine, loaded library,
screenshot, or unrelated last-patch report is insufficient. Agents report the
queued state and let the helper continue; they do not repeatedly inject the
same edit or ask the user to keep a specific screen open.

If the user requests an edit from ChatGPT on the same iPhone, the target app is
naturally backgrounded. That is an ordinary wait, not evidence of broken
reconnection. Submission and preparation remain independent of foreground
execution. Return to the target app when ready and allow a few seconds for its
connection and root to become ready; no specific screen is required and no
fixed ten-second deadline is promised.

Pending schema-2 status adds `prepared`, `normalWaiting`, `guidanceCode` and
`requiredAppState`. `OPEN_TARGET_APP` is an informational handoff, while
`WAIT_FOR_APPLICATION` and `WAIT_FOR_REFRESH` describe operations already past
admission. Queued notifications and taps never establish successful application.

Pending status also includes bounded `delivery.readiness` diagnostics. Its
`code`, `heartbeatAgeMs`, `observationAgeMs`, and optional
`lastEngineReachableAgeMs` describe the delivery worker and its latest engine
check; they never establish application. A missing/stale worker heartbeat,
unreachable engine, missing compiler/signing context, outdated capability, or
mismatched build produces `normalWaiting: false` with `CHECK_MAC` or
`CHECK_MATCHING_BUILD` guidance. Do not tell the user to keep reopening the phone
for a Mac-side fault, submit the edit again, or start an automatic rebuild.
Check `swift-sim live-status` on the Mac and restore the required existing
component/context. A stopped and a crashed engine are both reported as
unavailable unless independently distinguished; heartbeat absence is not proof
of a particular crash cause.

The worker writes an owner-only metadata sidecar, separate from source intent,
at most once per ten-second heartbeat/check interval or immediately when a
readiness code changes. CLI status can therefore detect missing processing
after reboot or helper exit. A new intent gets a five-second initial check
grace period; heartbeat/engine checks older than thirty seconds are stale.
During an explicitly reported compilation phase (bounded to three minutes), a
fresh worker heartbeat reports `LIVE_PREPARING` while preserving the actual
older engine-observation age. This advisory phase does not extend a mutation
claim lease.
A missing or invalid qualified capture reports `LIVE_CAPTURE_UNAVAILABLE`,
including for a prepared patch: saved signed bytes cannot replace the build
authority needed to inspect and apply it. This differs from an available engine
reporting no compiler contexts; already-prepared work may bypass that compiler
limitation while retaining exact capture and receipt checks.
Disconnected/backgrounded phone waiting remains normal when the Mac is ready.
Historical matching native success remains success even if the helper later
stops. Diagnostics cannot grant a claim, retry an admitted mutation, restore a
capture, start an engine, or replace receipt proof.


## Recovery and compatibility

The helper owns queue processing after the requesting CLI exits. Mac sleep,
an unavailable engine, or a stopped helper pauses processing. The Mac must be
awake and the helper running to prepare/deliver. Its shutdown cancels and
drains its compiler worker. Intent survives restart in the private runtime
journal.

The existing helper watches only its private delivery journal for publication
hints. New intent and completed preparation wake a coalesced worker turn without
waiting for the next timer tick. The one-second fallback poll remains for missed
events and subscription recovery. All normal admission and receipt checks still
run; a filesystem event grants no mutation authority. Notification reconciliation
keeps its separate schedule. No source watcher, new process or phone runtime is
added. See [measured Zenics latency](evidence/HOT_RELOAD_LATENCY_2026_11_05.md).

App identity, both executable/debug-dylib UUIDs, process nonce, snapshot digest,
request/attempt identity and revision fence every application. A socket
reconnect retains the process's receipts; a new process gets a cumulative
replacement derived from the qualified original binary source baseline.
Replaced requests point to that cumulative request and expose its expiry.
An ambiguous old-process effect cannot survive into a verified fresh address
space. Once any old worker claim expires, the helper may recover the latest
cumulative source in the matching new process at revision zero. It retains the
old uncertainty as evidence; it never invents its missing receipt or retries it
in the same process. A different binary, nonzero unknown process, or live claim
blocks this recovery.

Pending requests expire within 24 hours. A cumulative cohort uses its earliest
accepted expiry, so it may shorten a later request's remaining lifetime; it
never silently extends accepted intent. Expired cohorts are not automatically
resurrected. The matching local 0.5.6 engine and `prepared-receipt-query-v1` SDK recover lost
confirmations over the existing connection after the same native process
reconnects. A lookup reads the exact original request/digest/attempt/baseline,
coverage, strategy and binary/process receipt; it cannot load an image or refresh
the app. No patch bytes are retransmitted. Reads remain possible after request
expiry. Up to 16 distinct connections per pending admission attempt and one query per connection
bound recovery; a pending native operation has at most 16 completion callbacks.
An absent or conflicting native entry remains fenced, never guessed successful
or automatically reapplied. Normal completed edits add no lookup round trip,
worker, timer, value upload or notification-cadence change. Older clients retain
ordinary delivery but require one Debug SDK update for this recovery protocol.

Confirmed desired source is stored separately in the same private
journal and remains bound to that exact Debug binary until explicitly revoked.
Its lifetime does not depend on the original pending request's expiry. A new
matching process receives a new bounded restoration request compiled from the
original binary baseline to the latest confirmed source plus unexpired pending
intent. Successful removals and returns to the binary baseline are retained,
so a temporary label cannot return from older history. The original baseline
index survives request garbage collection while durable state needs it.

To stop automatic restoration and revoke unclaimed queued work for a qualified
Debug binary, run:

```sh
swift-sim live-desired-revoke --project "<App.xcodeproj>" --scheme "<App>"
```

Use `--workspace` instead of `--project` where appropriate. Revocation does not
undo a library already loaded in the current app process; restart the app to
return to its installed baseline. A new explicit confirmed edit can establish
a new desired state. Active worker claims must finish or expire first.

The journal is bounded to 256 requests, 32 files per request, 1 MiB per source
file and 32 MiB total. Prepared artifacts use deterministic ownership and a
128 MiB quota; expiry cleanup only removes verified Swift Sim-owned outputs.
Unavailable storage fails cleanly without starting a full app build.

Offline preparation currently supports generated dynamic-replacement bundles.
An interposition-only edit that cannot be prepared returns a precise failure;
it does not silently become a signed build. Release, TestFlight and App Store
execution remain excluded, and the transport remains private to the Tailnet.

## iOS execution limits

This implementation waits for foreground/root readiness. It does not add
background modes, silent pushes, or persistent background execution. Apple's
[background sequence](https://developer.apple.com/documentation/uikit/about-the-background-execution-sequence)
allows the system to suspend apps. A
[finite background task](https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time)
can finish legitimate work already underway; it is not a promise that a later
remote edit wakes a suspended or terminated app. Network-path observation helps
reconnect when code runs; it does not grant execution time.

Best-effort background finishing is a separate future qualification. The root
readiness barrier prevents applying before the refresh observer is installed;
this candidate does not claim that it suppresses every stale startup frame.
There is no device-local patch cache: a relaunch while the Mac/helper or private
connection is unavailable runs the installed binary until automatic restoration
can complete on reconnect. Desired source survives on the Mac; memory-only
injection does not survive independently on an offline phone.

Physical acceptance still requires foreground on another screen, background /
return, network interruption / return, helper restart with the app open, and
termination / relaunch with queued work. Each scenario needs current-request
compile/apply/refresh/revision proof and the visible change plus its proven
removal. Local harnesses do not substitute for those phone observations.

See [Activity and notifications](NOTIFICATIONS.md) for the inbox, optional APNs
setup, explicit app-launch opt-in, Debug feedback and remote launch proof limits.
