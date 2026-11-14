# Full async callable replacement experiments — 2026-10-30

Status: isolated native prototype, not enabled in stable delivery. Base:
`e783454d461c35c140929c2038d4ccdfe06130c4`. Swift 6.3.3, arm64 macOS, Xcode
26.6. No phone, installed engine, SDK pin or product source was modified.

## Result

Whole async callable replacements work substantially beyond the stable
generator's expression-inlining subset. The standalone harness compiles the
baseline and two patch libraries, requires **18 replacement records per
generation**, loads both into one process, and passes **39 runtime checks**.
The checks passed in Swift 6 and Swift 5 language modes on this compiler.
This is executable behavior evidence, not just successful source generation.

| Edit/behavior | Native host result | Remaining boundary |
| --- | --- | --- |
| Async methods with parameters, return values and `throws` | Proven for fixture | Exact signature admission; iPhone qualification |
| `async rethrows` with throwing async closure parameter | Result and thrown error proven | Arbitrary user generic constraints remain exact |
| Typed `throws(ProbeError)` | Result and typed error proven | Same error type required |
| Nested async closures, task groups and checked continuations | Proven in full replacement body | Existing tasks are not migrated |
| Generic function, generic nominal instance, `where` clause, tuple result | Proven | Compiler accepts some constraint changes; semantic comparison required |
| Same-name overloads with distinct parameter types | Both replaced and invoked | Full type signature is required for unambiguous coverage |
| Async throwing computed getter | Proven | Stored layout remains fixed |
| Async subscript | Proven with distinct replacement label | Same-label declaration silently omits the replacement record |
| Async callback and `inout` parameter | Proven | No claim about every escaping/ownership combination |
| Existing actor and `@MainActor` private state | Proven across two reloads | Isolation must stay identical |
| Old/new object coexistence | Proven with unchanged layout | No instance resizing or metadata migration |
| Suspended old task and first-patch task | Finish in their original code generation | No frame migration; old dylibs must remain loaded |
| Actor reentrancy across reload | Old and new code share existing actor state | Patch installation does not make a whole async operation atomic |
| Captured bound method | New invocation resolves latest replacement | Different from an already executing frame |
| Escaped closures made by old generations | Keep original code and captured values | No automatic closure-context rewriting |
| Cancellation of old and new suspended tasks | Original generation's cancellation handler runs; cancellation throws | Cooperative cancellation is not forced quiescence |

The baseline was built with the existing Debug integration assumptions:
`-enable-private-imports -Xfrontend -enable-implicit-dynamic`. Patches use
`@_private(sourceFile:) import` and `-disable-access-control` to reference
unchanged private actor storage, as the current delivery compiler already does.
No additional runtime hook was necessary for the host proof. This does not by
itself prove that every installed iPhone binary has all required symbols or that
its signed loader will admit these exact artifacts.

## Two important failures

The first native run compiled an async subscript replacement with the original
argument label using the current private-import/access-control flags. It produced ordinary getter code but no dynamic replacement
record; the call returned baseline `9` instead of expected `109`. Other members
had changed, so accepting a merely nonempty patch would have been false success.
The next run retained this failure while completing the other checks.

The corrected declaration gives the replacement a distinct external label:

```swift
// Existing declaration:
public dynamic subscript(_ index: Int) -> Int { get async { index } }

// Replacement:
@_dynamicReplacement(for: subscript(_:))
private subscript(frontier index: Int) -> Int {
    get async { index + 100 }
}
```

The [upstream Swift compiler's dynamic-replacement tests](https://github.com/swiftlang/swift/blob/main/test/SILGen/dynamically_replaceable.swift)
also give replacement subscripts distinct labels. Our result is independently
checked against the installed compiler and runtime. The harness now recreates
the original zero-record failure without loading that image. An intermediate
attempt using an ordinary public import emitted a record; it is retained as
run `1793411299476703000`. The omission is therefore qualified to the real
private-import context, not claimed universal across compilation modes.

Seven additional changed-signature probes show that compiler compatibility is
not sufficient admission:

| Deliberate mismatch | Compiler result | Loaded? |
| --- | --- | --- |
| Parameter type changed | Rejected | No |
| Return type changed | Rejected | No |
| `async` removed | Rejected | No |
| `throws` removed | Rejected | No |
| Generic constraint narrowed from `BinaryInteger` to `FixedWidthInteger` | **Compiled** | No |
| Actor instance isolation removed | Rejected | No |
| `@MainActor` isolation removed using `nonisolated` | **Compiled** | No |

All seven remain inadmissible edits. A generator must compare complete generic
constraints, effects and isolation before compilation; neither dylib existence
nor replacement-record count establishes source compatibility.

## Concurrency and admission requirements

Reload changes future entry dispatch. It does not rewrite suspended frames,
already-created closures or their captures. In the fixture, a baseline task
suspended before patch 1 returns the baseline result after patch 2 is loaded;
a patch-1 task similarly returns patch-1 behavior. Their cancellation handlers
also retain their original generation. An old actor continuation can resume
against state changed by a new method. That is explicit mixed-generation
execution, not transactional migration.

Keep old images alive while any code/context can reference them. A future
epoch tracker could prove quiescence for cooperative code and retire images;
blind `dlclose`, cancelling all tasks without completion proof, or assuming one
root refresh drains old tasks would be unsound. A reload requiring consistent
whole-operation behavior needs a declared quiescence/state-migration barrier or
an explicitly fenced restart path. This experiment does not implement such a
barrier or claim atomic rollback after partial runtime activation.

Coverage must be proved for every changed member before application. The host
harness uses exact replacement-record totals plus individual runtime behavior
checks. Production should bind per-member coverage, exact source snapshot,
compiler context and native applied/refresh/revision proof to the same request.
Negative compiler probes are kept separate and never loaded.

## Reproduction and retained evidence

Run:

```sh
python3 scripts/experimental/hot-reload/native-async/run.py
python3 scripts/experimental/hot-reload/native-async/run.py --swift-version 5
```

The script writes immutable sources, source SHA-256 values, all commands,
compiler/runtime output and machine-readable results under ignored
`.build/async-frontier-<timestamp>/`. It runs only host binaries and neither
installs nor communicates with an iPhone. Successful host execution is not
reported as a device root-refresh acknowledgement.

Retained investigation runs include `1793410991147417000` (first subscript
failure), `1793411039114538000`
(continued diagnostics), `1793411066368863000` (corrected 13-member prototype),
`1793411248023084000` (39 checks, 18 records, Swift 6) and
`1793411264375632000` (same 39 checks and 18 records, Swift 5), and
`1793411386562004000` (final Swift 6 harness), and
`1793411410257697000` (final Swift 5 harness). The final harness
also recreates the zero-record subscript case and preserves all seven negative
compiler probes. Refer to the generated `report.json` for exact commands and
source hashes; generated binaries remain local evidence, not committed assets.

Next experiment: feed the exact captured Zenics async member bodies through the
full-callable generator, prove coordinated multi-file coverage, compile using
the real captured module context, then qualify a reversible immutable variant
with exact native request/applied/replacement/refresh/revision proof on the
phone. These host results justify pursuing that path; they do not substitute
for its device gate or enable it automatically.

## Objective-C callback follow-up

The complete captured edit exposed a different representation: Swift emits an
Objective-C category for the protocol-inferred
`Coordinator.scrollViewWillBeginDragging(_:)`. It has no Swift `TX` replacement
record. This is not an omitted implementation. Counting only `TX` records
therefore incorrectly rejects a complete mixed Swift/Objective-C bundle.

A second native harness defines an `NSObject` conforming to an `@objc` protocol,
then uses an ordinary complete `@_dynamicReplacement` declaration in two
separately compiled libraries. On `dlopen`, the compiler-generated categories
map the original selector to each new implementation. **38 native checks pass**
in Swift 6 mode: direct Swift calls under the qualified implicit-dynamic
baseline, protocol calls and Objective-C selector calls on the existing object
all change from baseline to generation 1 to generation 2. After each load, the
original selector's current IMP equals the exact generated selector's IMP;
the method type encoding matches as well. This is actual dispatch behavior,
not a category-count assertion. It does not prove behavior for an optimized,
non-dynamic baseline or every UIKit callback ABI.

The runner captures original IMPs before loading and exercises serialized
rollback from generation 2 to generation 1, restoration of the baseline,
forward compensation to generation 2, and final baseline restoration. Stale
expected IMP and mismatched ABI attempts reject before mutation. The class owns
the target selector; the code does not mutate an inherited superclass method.
Every swap checks the returned previous IMP and reads back the new IMP. Object
state remains accumulated: restoring dispatch does not silently undo state
changes already performed by a callback.

This is not a transaction across arbitrary threads. Objective-C has no
compare-and-swap operation for an unrelated concurrent swizzler. The prototype
serializes its own mutations on the main thread; an unexpected previous IMP
enters an uncertain-state failure. A production mixed bundle must coordinate
activation and rollback across all affected methods and Swift replacements,
and must not unload images still referenced by executing code. Loading a
category to inspect it is already a mutation, so inspection happens first.

### Artifact inspection before loading

`objc-callback/preflight.py` reads bounded Mach-O bytes without calling
`dlopen`. It resolves category class bindings, original/generated selector
pairs, Objective-C encodings and their shared implementation address. The
allowlist requires exact class symbols and selector pairs and rejects extra
methods, mismatched encodings or IMPs, initializer/non-lazy entries, malformed
metadata and unqualified formats. The prototype supports thin arm64 dylibs,
bounded relative method lists, classic pointer dyld-info streams and chained
64/64_OFFSET fixups. Other architectures, authenticated pointer formats and
unqualified fixup encodings reject. Apple documents the chained structures in
[dyld's fixup format header](https://github.com/apple-oss-distributions/dyld/blob/main/include/mach-o/fixup-chains.h).
The native run checks twelve negative preflight cases across its two artifacts.

This parser is an isolated prototype, not a hardened production Mach-O loader.
Encoding equality does not establish semantic parameter types: Objective-C
object types can share `@` encoding. Exact Swift signature/isolation comparison
and the captured compiler/binary identity remain required independently.

Both real iOS artifacts were inspected without loading and cross-checked
against `otool -ov`:

| Artifact | Changed members | Swift records | Exact category mapping | Compiled representation |
| --- | --- | --- | --- | --- |
| Historical captured four-file edit | 7 | 6 | 1 | 7 of 7 |
| First full qualification variant | 8 | 7 | 1 | 8 of 8 |

The category targets the captured module's exact private
`LibraryCollectionGridView.Coordinator` class symbol. The original selector
`scrollViewWillBeginDragging:` and generated selector
`__swiftSim_full_f2_470:` (historical) or `__swiftSim_full_f4_470:` (qualification)
share one implementation address and encoding `v24@0:8@16`. Artifact hashes
and exact names are stored in adjacent `.objc-inventory.json` files under
`.build/hot-reload-frontier/zenics-captured/` and the original full qualification
request directory. Both receipts explicitly record `loaded: false`.

The installed SDK counts Swift `TX`/`TI` records; its generic Objective-C
category-prefix count also misses this Swift-emitted `__CATEGORY_...` naming.
Consequently these artifact inventories **do not provide a physical native
category receipt**. The full mixed four-file edit remains gated pending an SDK
capability that verifies the exact target/generated-selector IMP mapping for
the request and couples it with refresh/revision proof. An Objective-C-only
patch cannot be reported as applied through the existing managed-patch rule
requiring nonzero Swift replacements. Do not invent a Swift record or treat
the separately qualified async-only phone subset as proof of this callback.

Reproduce with `python3 scripts/experimental/hot-reload/native-async/objc-callback/run.py`.
The initial observed category run is retained at
`.build/objc-frontier-1793411868205293000/`; the Swift 6 rollback/preflight run
is retained at `.build/objc-frontier-1793412269830766000/`. Later reruns retain
their own source snapshots and reports. No engine/SDK activation or iPhone
mutation occurred in this Objective-C experiment.
