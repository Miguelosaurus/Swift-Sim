# Additive native hot-reload experiments — 2026-10-30

Status: **host-native prototype proven; production and physical-device admission remain disabled**.
Base: `e783454`. This isolated experiment does not change the stable classifier,
compiler, engine, SDK, transport, Release behavior, or any Zenics source.

## Runnable experiment

```sh
python3 scripts/experimental/hot-reload/native-additive/probe.py
```

The harness invokes the installed `xcrun swiftc` directly, builds one baseline
library, two versioned patch libraries with two Swift compilation units each,
and a third source-restoration library. A fresh native executable creates its
object before loading either patch. It then uses `dlopen` and checks actual
method results and escaped existential values. No simulator, phone, network,
Swift package resolution, or live helper is involved. Outputs default to a new
private temporary directory; `--output` accepts an empty directory and never
overwrites prior evidence. Each compiler invocation and the native execution
have timeouts. Libraries intentionally remain loaded until process exit.

Successful run: `/tmp/swift-sim-native-additive-reproducible-20261030/results.json`.
Compiler: Apple Swift 6.3.3 (`swiftlang-6.3.3.1.3`), arm64 macOS host.
The harness checks three emitted replacement definitions per patch (coalescing
`TI`/`TX` pairs) and **20 native runtime assertions**. No iOS root-refresh or
revision acknowledgement is invented by this host harness.

## Proven prototype coverage

| Edit/mechanism | Native observation | Remaining delivery work |
| --- | --- | --- |
| New private helper in an existing method's file | Existing object dispatches through replaced method to new helper | Typed extraction and changed-member coverage |
| New fileprivate generic struct | New `AddedValue<T: BinaryInteger>` is constructed and returned as an existing protocol existential | Keep patch-local metadata identity explicit |
| New private extension method on the new type | Method executes and agrees with the separate private helper | Preserve lexical scope in generated code |
| Existing private stored state | Replacement reads the original object's `seed` through exact private import | Match captured original source/module, keep layout unchanged |
| Existing fileprivate helper | Replaced method calls the installed helper correctly | Resolve original declarations instead of cloning them |
| New protocol with associated type and conformance on existing class | Existing object satisfies each patch-local protocol; associated-type result executes | Do not promise removal of registered conformances |
| Coordinated two-file compilation | Both source units link into one dylib and execute | Preserve original file boundaries; compile entire logical set together |
| Already available Foundation import | Replacement creates and reads `NSNumber` | Verify exact SDK, deployment target, linkage and artifact availability |
| Repeated versioned patch modules | Second patch updates all three methods on the same object | Unique per-request module identity and bounded lifetime policy |
| Old/new nominal value coexistence | Baseline, first-patch and second-patch existential values keep their respective behavior | Nominal identities differ; no automatic cast/migration promise |
| Original-source restoration | Third patch restores all three method results | Old patch metadata and conformances remain resident |

These results establish that additive helpers, types and imports are **not a
universal Swift runtime impossibility**. Today's production rebuild policy is
partly an implementation/admission limitation. They do not establish that
arbitrary additions are safe, or that copying an entire original type into a
new module preserves its identity.

The ordinary product sources remain the canonical source form. Generation-specific
module names and replacement function names are compiler output; they should
never require the developer to rename product declarations manually or remove
successful product edits before a Release build.

## Important compiler discovery: private scope

Two original files can each define a private helper with the same signature.
Compiling them separately preserves that scope. The current broad
`-Xfrontend -disable-access-control` option makes those definitions collide,
even when the files remain separate. Flattening the files into one generated
source also causes an invalid redeclaration.

This experiment instead uses baseline `-enable-private-imports` and exact
`@_private(sourceFile: "Baseline.swift") import AdditiveBaseline`, without
disabling all access control. Private baseline state/helper access succeeds,
and both private same-name helpers retain their intended behavior. This is a
concrete reason for a typed, per-file compiler representation rather than
extending the existing concatenate-everything implementation.

The initial failed run is retained at
`/tmp/swift-sim-native-additive-final-20261030/patch1.log`. The final harness
includes that compiler option as an expected-negative regression. An earlier
run at `/tmp/swift-sim-native-additive-expanded-20261030/` also retains a harness
diagnostic-wording mismatch: native execution passed all 15 checks then present,
but two negative expectations said “could not find function” while the actual
compiler said “could not be found.” The final expectations match the compiler.
Neither failed experiment was overwritten or relabeled as a successful run.

## Negative boundaries tested

- Adding actual stored instance properties in an extension is rejected by the
  compiler. This prototype never resizes the original `Probe` instance.
- An absent module import is rejected. Existing-SDK imports do not install a
  native dependency, change entitlements, or supply an unavailable framework.
- A changed replacement return type fails target matching.
- A replacement target lacking `dynamic` support is rejected. The existing
  Swift Sim Debug bootstrap already requests `-enable-implicit-dynamic` and
  `-enable-private-imports`; other binaries may need one new Debug installation.
- Redundant declarations of the same existing protocol conformance fail.
- A bundle containing one valid replacement and one nonexistent target fails
  compilation as a whole. The valid subset is never loaded.
- Flattened private scopes and disabled access control fail as described above.

## Identity, state, atomicity and rollback

Generation-specific module names give newly introduced nominal types/protocols
separate runtime identities. Both generations can coexist and keep their own
witness tables and generic metadata. That avoids claiming that an old object
has silently become a newly sized type. The test does not redefine the original
`Probe` nominal type.

Restoring original method source restores its behavior but **does not unload**
new code, remove registered conformances, invalidate escaped values, or reverse
arbitrary side effects. The native test proves the first patch's conformance
still works after method restoration. Retain dylibs for the process lifetime;
unloading while their values, closures, tasks or metadata remain reachable is
not a safe cleanup mechanism.

One compiler/link operation produces the complete logical patch before any
loading. That gives an all-or-nothing **pre-admission compilation** boundary,
not a general transactional rollback guarantee for runtime registration. A
crash or interrupted load still requires uncertain-state fencing. An automatic
production route must retain the existing exact request/digest/binary/process,
nonzero replacement, root refresh and increasing revision proof.

The [Swift library-evolution design](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0260-library-evolution.md)
concerns ABI-compatible library replacement and resilient layout across library
versions. It does not provide this experiment with an in-place migration of
already allocated objects. Broader stored-state changes require an explicit
sidecar/indirection/migration design or controlled recreation, with a distinct
claim from state-preserving method replacement.

## Next concrete integration experiment

Use the typed experimental generator to select all changed existing callable
bodies plus their additive declaration dependency closure. Preserve source-file
private scopes, emit each source unit into a unique patch module, and use exact
private imports. Compile the complete two-file bundle once. Fail on unresolved
references, duplicate identities or any unrepresented changed declaration.

Start physical qualification with immutable variants of an already installed
Debug target: add a private generic helper and available import, update two
existing methods that call it, load once under the strict native proof contract,
then independently restore the original methods. Verify old/new value behavior
and restoration; keep added conformances experimental because restoration cannot
remove them. This still needs exact iOS compiler/link/load proof and phone root
refresh/revision evidence. No installed engine, app or product source was changed
by the host experiment.
