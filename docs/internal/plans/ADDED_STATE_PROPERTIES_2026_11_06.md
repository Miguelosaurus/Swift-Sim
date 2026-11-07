# Added State properties without repeated builds

User requests new @State fields without a signed rebuild while retaining lean
Debug behavior. This is outside architecture consolidation. Baseline main ae1b47b,
Zenics Debug41; prior stateful component acceptance restored and no pending edits.

## Working design and proof

One bootstrap SDK update extends the existing SwiftSimRefresh DynamicProperty
with one optional SwiftUI State-backed slot. The property wrapper grows16 to32
bytes on the tested Mac ABI; this is not a physical-phone RAM measurement.
Its immutable storage box/dictionary is nil until the first new-field mutation.
No process-global value registry, serialization, timer, task, network round trip,
notification or animation change. SwiftUI owns location/lifetime per view.

Generated Debug patches lower new State declarations on eligible installed,
instrumented concrete View types to computed values/bindings using that slot.
The installed view layout remains fixed. Developer source stays ordinary @State;
no handwritten setup. Initial scope is primitive/optional/array/dictionary value
state with pure literal defaults; custom objects/effectful defaults and other
wrappers stay fenced. Existing fields/layouts cannot change.

Each field key binds owner/file/type/default. Every accessor supplies all active
keys for its view (max32). Compiled generation equals the durable request sequence
and is marker/context-bound. A newer setter prunes removed keys; a stale captured
binding cannot remove new fields or revive removed ones. Values never leave phone.
Type/default changes, removal and rename reject, except explicit whole-baseline
restoration. Reintroducing a different definition after restoration uses a new key.

Isolated native probe compiled a real installed SwiftUI view, then dynamic
computed-field/body patches. Two instances retained installed counters7/12,
new counters10/22 and distinct drafts, a Boolean added in the second patch,
and one child appearance each. The real product runtime (observer shim only)
also passed, including an old captured binding after adding the Boolean.
Private evidence under .build/additive-state-20261106/; hosts/windows exited.
Root runtime's6 focused Swift tests pass with autoconnect disabled.

## Ownership

- Parent: FullCallableGenerator.swift lowering/native generation qualification,
  plan/docs, SDK capability fork+pin, deployment/phone acceptance and final main.
- added_state_runtime: new AddedViewState.swift, existing Refresh wrapper,
  AddedViewStateTests.swift. Finished; interrupted. Immutable referenceStorage
  keeps wrapper32 bytes and allocates only on writes. Actual product proof log
  runtime-product-probe.log. root-build scratch now idle.
- added_state_queue: adapter/runtime/queue/snapshots/liveReload and one-line
  changeDelivery classification flag forwarding. No changes to notification
  cadence. Flag addedStateProtocol1/generation and required capability
  added-state-slots-v1. q cap789<800.
- added_state_contract_tests: fullCallableCompiler.js + compiler/artifact tests.

Generator contract: allowAddedState, stateGeneration; output addedStateProtocol1,
addedStateGeneration, addedStateOwners [{path,owner,fields:[{name,key,type}]}].
Runtime API: $refresh.value(_key,initial:), set(_key,value:generation:activeKeys:),
binding(_key,initial:generation:activeKeys:), activeKeys lazy closure.

## Validation and delivery (complete)

Implementation and review are complete, including pinned components with bounded
original-state-name metadata. SDK capability945c67a is published and root-pinned.
Zenics42 contains the bootstrap SDK, is user-installed, and has completed physical
qualification. Later supported State additions need no new signed build.

All Swift tests use SWIFT_SIM_DISABLE_CLIENT_AUTOCONNECT=1. Full source1487,
compiled905 plus3 hermetic and runtime checks, root Swift38, native SDK29 and
Release builds pass. Type, lint, format, architecture/docs, package contents,
isolated installation and Homebrew entrypoints pass. Destructive clean Homebrew
installation remains disabled. Production installed/pinned native hosts pass;
prior stateful qualification also passes with the new runtime. Qualifiers are
self-contained repository scripts and temporary processes have exited.

Implementation is merged/pushed without PR and the normal helper/plugin updated.
All four exact captured iPhone compiler stages and physical deliveries pass.
Notification cadence and animation remain unchanged. No new service or simulator
is needed; normal helper/engine remain for daily use. No ambiguous effect was
resubmitted under a new identity.

## Expanded implementation checkpoint

Installed and newly pinned components now both lower new fields. Optional bounded
stateNames metadata preserves the original pinned layout fence; missing legacy
names cannot grant this ability. Source-name checks respect owner/file scope,
so an unrelated nested enum State does not block the feature. Literal fallback
type aliases and custom prefix operators are fenced. Compiler type witnesses
check actual wrapper/value identity at code generation. Projected closure-name
shadowing rejects rather than redirecting a binding. Concrete computed helpers
on admitted owners preserve state; opaque helpers remain fenced.

Generation helpers share a single active-key function per owner instead of
repeating32-key arrays per field. Ordinary removal/rename/default/type drift
rejects; whole-baseline restoration is allowed with old-closure/view-lifetime
limits explicitly documented. Runtime defaults are autoclosures; six focused
Swift tests pass. SDK capability fork945c67a published, root immutable pin resolved;
all29 SDK tests pass. Original frozen SDK checkouts remain unchanged.

Production installed and pinned native hosts pass with complete replacement
proofs and restoration. Unused-feature actual Mac settled-footprint benchmark
adds0.80MiB across3000 cells (paired median0.89MiB), wrapper16->32 bytes; all optional
boxes nil and hosts exited. See evidence; this is not phone RAM. Full gates, installed helper/plugin update, bootstrap42 and physical acceptance
are complete as recorded below.

## Completed physical acceptance

Main a6fb7d9 delivered the implementation and bootstrap42; later commits record
acceptance. Four immutable snapshots added counter/draft directly to installed
ContentView, added a Boolean later, changed only a shared helper, and restored
the entire baseline. Native receipts prove revisions1/2/3/4, one replacement each,
in the same binary and process. No further build/install occurred during testing.

Scoped screenshots independently show counter4/draft Banana before and after the
second field addition, then counter5/draft Banana/flag on after the helper-only
edit. The user exercised both old and new bindings. A final revision4 screenshot
shows the original screen without the test card. Product source hashes are intact.
Ordinary descendant identity limits remain; removing the temporary overlay reset
the Journal date selection, and this feature does not promise subtree migration.

The first receipt was recovered from the exact same native ledger operation after
one bounded engine restart, without a new edit or second load. Normal helper3766
(session79044) and engine4127 remain. Old engine6939 exited. Native hosts/build
workers finished; completed agents were interrupted. No simulator or test server
remains. The protected foreign uncertain request was preserved. No restoration
or phone qualification remains pending. Private receipts/resources are under
.build/additive-state-20261106/; see docs/evidence for complete proof boundaries.
