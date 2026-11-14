# Added State properties: bounded Debug qualification

New @State fields are lowered to computed values/bindings backed by one optional
SwiftUI State slot inside the existing Debug refresh property. The running view's
stored layout is unchanged. One bootstrap SDK update installs that slot; later
supported State additions do not rebuild the app. There is no per-screen setup,
value serialization, process-wide value registry, new timer or network request.

The initial surface supports pure literal primitive values, optionals, arrays
and dictionaries, at most32 active added fields per view. Existing stored fields
stay native. New fields use typed definition keys; old bindings cannot prune a
newer written schema. Defaults are lazy for stored values. Removal/rename and
type/default changes remain fenced, except explicit whole-original-baseline
restoration. Restoration does not cancel old closures or clear latent added state
until its SwiftUI view lifetime ends; it is not state migration. Mixed UIKit/root
remounts retain the existing refresh policy, so normal SwiftUI identity rules
still apply. Custom object/effectful defaults and unsupported wrappers rebuild.

## Native behavior

Production generation and coverage qualification for two installed view instances
retained existing counters7/12, added counters10/22 and distinct drafts. A Boolean
introduced in a second patch retained its value across another edit. An older
captured binding updated its surviving counter without dropping the newer flag.
The original child appeared once during additions and body edits, proving that
no wrapper subtree was introduced. A concrete computed helper uses the added
counter and selects preserved refresh. Whole-baseline restoration retained the
installed root counter.

A separate production qualifier introduced a new pinned Card, set its original
State counter to8, added a Boolean through the same slot, changed its body, and
restored the source. It retained original counter8, flagtrue, type identity and
one Card appearance, with real replacement counts1/3/3/1. Original State layout
and initializer changes remained rejected. Tiny optional origin metadata stores
only original State field names, never values or copied declarations.

Negative checks cover wrapper/value-name shadowing, custom literal type aliases,
projected closure parameter shadowing, backing storage access, default drift,
nonliteral/object defaults and unsupported removals. Compiler type witnesses also
check source wrapper/value identity in the loaded type's scope before admission.
All changed callables retain exact v3 replacement coverage. No phone code has
been applied during this host qualification.

## Measured unused cost

The refresh wrapper grows16 to32 bytes on the tested Mac ABI. Its storage box
and dictionary remain nil until a new-field write. SwiftUI's own State location
has additional cost, measured rather than inferred from this struct size.

Six fresh offscreen AppKit/SwiftUI processes alternated baseline/candidate three
times. Each rendered exactly3000 cells, read the existing refresh value, and
never called the added-state API. At3/4/5 seconds every candidate slot was nil.
Settled physical-footprint medians were134.30MiB baseline versus135.09MiB candidate
(difference0.80MiB); paired deltas0.78–0.92MiB (median0.89MiB). RSS median difference
was0.84MiB. These include fixed process/framework costs, are not per-view allocation
measurements, and are not physical-iPhone RAM evidence. All hosts exited.

## SDK and validation checkpoint

Native capability `added-state-slots-v1` is committed on InjectionNext main at
`945c67afb4db8fa52722e994bdc89d665191abab`; all29 isolated native SDK tests passed.
The root package pins this immutable revision. Connected old clients get an
explicit SDK-update requirement; ordinary live edits remain unaffected.

Private sources and receipts are in `.build/additive-state-20261106/`, including
`host-witness`, `pinned-verified`, `runtime-product-probe`, `memory-probe`, and
focused compiler/queue/SDK logs. Source tests pass 1,487; compiled tests pass 905 plus 3 hermetic checks and the
runtime/entrypoint gates. Root Swift tests pass 38 and Release builds; native SDK
tests pass 29. Type, lint, format, architecture/docs, package contents, isolated
installation and Homebrew entrypoint checks pass. Destructive clean Homebrew
installation remains disabled. Both standalone native qualifiers and the prior
stateful-component host pass. Physical acceptance is complete as recorded below. Notifications and animation code are unchanged.

## Exact captured iPhone compiler

Zenics Debug42 built from main a6fb7d9 with the matching SDK945c67a. Four
immutable snapshot stages compiled using its captured iPhone SDK, private module
context and actor defaults: add counter/draft to installed ContentView; add a
Boolean later; change only a cross-file helper; restore the entire baseline.
Each stage proved one real body replacement and preserved refresh. Product
files stayed unchanged and no phone request was made by this compiler check.

The normal helper and Codex plugin0.6.1+codex.20261106.10 are updated. One engine
remains; no extra service or simulator was introduced. One
protected foreign uncertain request remains unchanged. Physical acceptance is
complete; its values and exact native receipts are recorded below.

## Physical checkpoint

The phone connected over cellular on Zenics42 with added-state-slots-v1. The
first snapshot introduced two new State fields directly on the installed
ContentView. Its exact native receipt proves one replacement, preserved refresh
and revision1 in the same process. The initial acknowledgement was lost during
connection churn. The operation remained uncertain; one bounded engine restart
let the normal reconciliation path retrieve that same process-lifetime ledger
receipt. No new operation or second native load was submitted. The old engine
exited and one replacement owns the live port.

The phone screenshots before the second addition show counter4 and draft Banana.
Adding a Boolean State field to the same installed ContentView retained both,
with the new toggle initially off. The user then enabled it and incremented the
counter. A helper-only edit changed the heading from Added state1 to Added state2;
a scoped screenshot at revision3 independently showed counter5, draft Banana,
and flag on. The original bindings continued to respond after field addition.

Whole-baseline restoration has an exact revision4 receipt, and a final scoped
screenshot confirms that the test card is gone. All four stages used the same
Zenics42 binary and process, with one real Swift replacement and complete v3
coverage each. No signed build or installation occurred between those stages.
The original product source files remain byte-identical; the only project change
is the reviewed Swift Sim package pin. Private screenshot metadata, native
receipts and the final summary are retained under phone/ in the evidence root.

This does not promise arbitrary descendant-state migration. Removing the temporary
overlay changed the modified subtree's SwiftUI identity and returned the Journal
date selection from Nov8 to Nov6. The added fields survived the supported additions
and helper edit; structural view identity changes retain ordinary SwiftUI rules.
No user model data was edited by the qualification snapshots.

The normal helper and one live engine remain for daily hot reload/notifications.
No temporary native host, build worker or simulator remains. Completed agents
have been interrupted. Notification cadence and animation are unchanged. Main
contains the implementation and acceptance documentation without an open PR.
