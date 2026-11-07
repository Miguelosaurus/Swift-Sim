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
Type/default changes on an existing added field reject; removal/reintroduction
uses a distinct key when definition changes.

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

## Validation and delivery

Implementation and review are complete, including pinned components with bounded
original-state-name metadata. SDK capability945c67a is published and root-pinned.
One actual Zenics bootstrap SDK update is required before phone qualification;
no phone action has started this turn. Existing41 cannot use the new slot API.

All Swift tests use SWIFT_SIM_DISABLE_CLIENT_AUTOCONNECT=1. Full source1487,
compiled905 plus3 hermetic and runtime checks, root Swift38, native SDK29 and
Release builds pass. Type, lint, format, architecture/docs, package contents,
isolated installation and Homebrew entrypoints pass. Destructive clean Homebrew
installation remains disabled. Production installed/pinned native hosts pass;
prior stateful qualification also passes with the new runtime. Qualifiers are
self-contained repository scripts and temporary processes have exited.

Next: merge/push without PR, update normal helper/plugin, prepare one bootstrap
Debug build, exact captured iPhone compilation and physical qualification. Keep
notification cadence and animation unchanged. Never resubmit ambiguous effects.
Final acceptance must restore snapshots and preserve source hashes. No new
service or simulator is needed; normal helper/engine remain for daily use.

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
boxes nil and hosts exited. See evidence; this is not phone RAM. No phone action
or installed helper change has occurred this turn. Next full gates + bootstrap
SDK build and explicit phone availability/acceptance.

## Phone checkpoint

Main a6fb7d9 is pushed and installed helper/plugin updated. Zenics42 is ready and
user-installed. All four exact captured iPhone compiler variants pass. First
physical counter/draft addition is native-proven at revision1 over cellular,
with exact same-operation receipt recovery after a bounded engine restart.
Normal helper3766/session79044 and engine4127 remain. Old engine6939 exited.
Temporary hosts/build workers have finished; no simulator is running for this
task. Test card is intentionally awaiting manual values; restoration required.
Continue from phone/changes-2.json only after user changes counter/draft, then
changes-3.json helper follow-up and changes-4.json whole-baseline restore.
Private resource/receipt state is .build/additive-state-20261106/resources.json.
Do not resubmit changes-1 or clear the protected foreign uncertain request.
