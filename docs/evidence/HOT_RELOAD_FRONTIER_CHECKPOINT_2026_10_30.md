# Hot reload frontier checkpoint — 2026-10-30

Status: substantive isolated compiler/runtime experiments, including a scoped
physical iPhone application and restoration. Stable delivery remains on the
qualified classifier-v2 path. No Release loading, SDK repin, new phone install,
engine replacement, signing/account changes or Zenics product edits occurred.
The dispatch baseline was `e783454`; earlier work is preserved.

## Coverage delivered by this research

| Mechanism | Evidence | Current claim / bootstrap |
| --- | --- | --- |
| Whole-callable async, throws/rethrows/typed throws, parameters/results, closures, task groups, continuations, overloads, generic constraints, actors and accessors | [Async native experiments](HOT_RELOAD_ASYNC_NATIVE_EXPERIMENTS_2026_10_30.md): 39 runtime checks in Swift 5 and 6, 18 Swift replacement definitions per generation | Host prototype; existing implicit-dynamic/private-import Debug bootstrap suffices for tested forms |
| Compiler-backed generation of complete callable bodies from ordinary source | [Generate.swift](../../scripts/experimental/hot-reload/full-callable/Generate.swift), [verification](../../scripts/experimental/hot-reload/full-callable/verify.mjs): 21 native observations, seven definitions each in two generated patches | Experimental capability; six actual iPhone replacements and restoration proven below |
| Added private/fileprivate functions, helpers/types/extensions, generic/protocol dependencies and an available-module import | [Additive experiments and generator](HOT_RELOAD_ADDITIVE_NATIVE_EXPERIMENTS_2026_10_30.md): handwritten mechanism 20 native assertions; AST-generated two-file patches 10 native assertions, three existing methods plus eight additions per generation | Host prototype; preserve file boundaries, exact private imports and unique generation module identities |
| Richer structural state and externally staged resources | [State/component experiment](HOT_RELOAD_COVERAGE_FRONTIER_2026_10_30.md): 38 native checks and five fresh-process checks | One new opt-in Debug bootstrap is needed; explicit sidecars/versioned components and migration, not instance resizing |
| Objective-C-inferred UIKit callbacks | Separate native Objective-C dispatch experiment linked from the async record | Mixed Swift/Objective-C coverage needs a distinct pre-admission inventory and truthful native proof; Swift TX count alone is incomplete |

The experimental sources are not imported by production modules or listed in
the npm package. A package dry run contained 492 files and no experimental
sources or dylibs. Actual SwiftSimLive and SDK source-produced Release binaries
were checked for active injection/transport/feedback symbols in the state lane.
This is not a signed iOS Release archive or App Store acceptance claim.

Repository regression: all **1,231 source tests passed**, with zero failures,
skips or cancellations. Source syntax, architecture and documentation checks
also passed. The focused native/generator/fault harnesses above provide the new
mechanism evidence; the existing source suite establishes stable non-regression.
The full compiled/package/Homebrew installation gate was not rerun for these
excluded experiments. Package exclusion was checked by a fresh npm dry run.

## Exact four-file Zenics target

The captured scheduling edits preserve layout, imports and signatures. They are
already in the installed signed baseline and were never replayed as a new
product optimization. The experimental syntax-tree generator represents all
seven changed members, preserving their complete bodies, and compiles the four
source units together for arm64 iOS18 against the captured iPhoneOS26.5 context.

The resulting artifact contains six Swift TX definitions. Read-only Mach-O
inventory also verifies one exact Objective-C category mapping for the UIKit
delegate callback: the expected Coordinator class, original
`scrollViewWillBeginDragging:` selector, generated replacement selector, shared
implementation address and `v24@0:8@16` ABI encoding. Thus all seven members have
a compiler representation. The first physical experiment required eight Swift definitions for
seven methods plus the root marker, and correctly stopped before signing or
loading when only seven were found. Its assumption about a missing callback
was corrected by real native Objective-C dispatch experiments and no-load
inventory of both real iOS artifacts. The eight-member candidate contains
seven Swift definitions plus the exact one-category mapping. Neither the
initial successful compile nor a merely nonempty replacement set establishes
complete physical acceptance of all four files. That mixed-mechanism gate is
still explicit, not silently treated as success.

Private compile-only evidence is under
`.build/hot-reload-frontier/zenics-captured/`. The helper/compiler currently
qualified for ordinary use is unchanged. The experimental generator intentionally
rejects unsupported changed declarations rather than delegating them to an
incomplete successful subset.

## Physical async/internal acceptance — October 30, 20:58–21:00 Central

After Miguel made the existing Zenics Debug app available, a separately named
six-member qualification used immutable variants of the current Pipeline,
DiskCache and DataStore implementations plus a temporary root tab label. The
method changes only inserted harmless local-binding probes; they retained the
actual complex async bodies. LibraryView and its Objective-C callback were
excluded from this distinct experiment, not omitted from a purported full
four-file delivery. No saved product file was changed.

Before admission, all six changed members generated and compiled together and
each emitted a native Swift replacement definition. The artifact was published
owner-only into the engine's existing private prepared-artifact root, signed by
the existing engine and bound to the exact snapshot/request/digest. The normal
adapter required the current binary/process, applied evidence, refresh ACK and
an increasing root revision. The qualification additionally required the native
replacement count to equal six.

- Request `08508243-af47-43e8-8f3d-fd9a8dda3491`: **six native replacements,
  applied true, refresh acknowledged true, revision 1**.
- Independent restoration `aca11227-8390-42a0-ab7c-593db03024e5`: **six native
  replacements, applied true, refresh acknowledged true, revision 2**.
- Both reports identify the **same executable, debug dylib and process**.
  Source hashes remain unchanged. Desired snapshots were explicitly revoked.

The first restoration encountered an acceptance-harness scope lookup error
before dispatch. It was retained as an uncertain record rather than rewritten
as success. A distinct authenticated original-source compensation then proved
restoration; the failed operation was not blindly retried. Earlier pre-admission
failures, including the wrong prepared-artifact directory and an absent
foreground process, are also retained. None is represented as application.

Private receipts: `.build/hot-reload-frontier/physical-async-admission/` and
`physical-async-restoration/`; the former retains `recovery-resolution.json`
pointing to the successful restoration. The original failed result remains
intact. The original full-target failure is under `physical/`.

The maintainer-only [phone qualification tool](../../scripts/experimental/hot-reload/full-callable/qualify-phone.mjs)
uses separate queues and explicit capability/phone-readiness arguments. Its
cleanup obligation begins at mutation dispatch, regardless of acknowledgement.
Compensation uses a distinct request and an authenticated current revision in
the original binary/process. Persistence or desired-state revocation errors
must not block compensation; uncertain application is fenced and reconciled by
the same receipt. The tool is not the ordinary agent delivery contract.

This proves scoped real iPhone replacement/refresh/restoration for complex
async/internal bodies, without reinstalling. It does not prove every async ABI,
per-method invocation of each utility on the phone, offline/relaunch persistence,
quiescence of old tasks, additive iPhone loading or the mixed Objective-C gate.

## Admission and semantic safeguards

The full-callable generator uses the installed toolchain's SwiftParser and
SwiftSyntax libraries, not a broader regex signature pattern. It compares all
protected tokens, exact member signatures, generic constraints, isolation and
accessor shapes. All changed implementations must be represented. Independent
review covers 32 negative and 13 positive bundles, including mixed-file whole
rejection, plus eight fault cases against the actual qualification cleanup AST.
The faults cover uncertain application, failed restoration, missing client,
journal revocation failure, source-audit read failure and failed receipt writes;
compensation/obligations and worker shutdown remain explicit. Review found and
corrected accessor-shape omission, string-literal
corruption during global renaming, and dropped extension attributes.

Subscript replacements need a distinct generated external label; a same-label
private-import declaration can compile without a replacement record. Generated
function names are changed as syntax tokens, preserving user literals. Source
context expressions such as `#function`/`#line` and arbitrary expression macros
are rejected until their original context can be lowered correctly. Conditional
declarations stay opaque: changes inside them reject; unchanged directives do
not block unrelated members. Initializers/deinitializers, existing stored
observers/layout and local nominal metadata retain explicit fences.

The compiler alone is not an admission authority: it accepted narrowed generic
constraints and removed MainActor isolation in negative experiments. None of
those artifacts was loaded. Async experiments also prove that suspended frames
and escaped closures retain their original generation; actor state can be shared
with new code after reentrancy. Images stay resident. A root refresh does not
make an entire async operation atomic or migrate its suspended frames.

## Next graduation work

1. Bind per-member Swift and Objective-C coverage to the same immutable bundle;
   qualify the callback dispatch and compensation on iPhone with truthful native
   receipts. Do not invent Swift replacement counts for category methods.
2. Package/version the compiler-backed generator intentionally before ordinary
   routing uses it. Its current toolchain-host linkage is a local experiment,
   not a clean-machine packaging guarantee or Phase-7 analyzer cutover.
3. Feed additive source generation the immutable installed baseline and complete
   desired dependency closure each generation. Previous patch-only declarations
   cannot be imported from the signed module. Qualify iPhone metadata identity,
   coexistence and restoration separately; restoring functions cannot remove
   registered conformances or unload live metadata.
4. For deeper layout edits, implement a canonical-source-to-versioned-component
   transformation and a SwiftUI/UIKit recreation adapter with explicit state
   migration. Pure staged migration can abort; arbitrary I/O cannot be undone by
   the prototype's byte transaction. Relaunch restoration remains a distinct claim.

No prototype is automatically enabled merely because it has an experimental
flag. The current stable path remains qualified and the broader mechanisms are
reviewable, executable inputs for continued graduation.
