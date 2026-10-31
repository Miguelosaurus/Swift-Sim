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
