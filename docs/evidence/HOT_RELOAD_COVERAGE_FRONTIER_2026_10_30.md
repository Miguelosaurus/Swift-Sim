# Hot reload coverage frontier and state prototype — 2026-10-30

Status: isolated experimental research and native implementation at the qualified
`e783454` baseline. No stable routing relaxation, SDK repin, phone installation,
product-source edit or installed-service change is part of this workstream.
The native state mechanism below is **host-prototype-only**, not physical iOS
application/refresh proof. The current stable path remains the previously
qualified implementation in
[the local binding record](LOCAL_BINDING_CLASSIFIER_QUALIFICATION_2026_10_30.md).

## Actual four-file target

Read-only inventory uses the captured scheduling snapshots and the current
corresponding Zenics files. The current signed app already contains these
changes; replaying them would not be a new product improvement. Their bodies
are an end-to-end compiler target, not authority to modify approved gestures.

```sh
node scripts/experimental/hot-reload/native-state/inventory.mjs \
  '<captured-before-directory>' '<current-app-source-root>'
```

The inventory records source SHA-256 pairs, classifier version and complete
generation results without copying private source into this repository.

| File | Changed member bodies | Stable v2 result | Actual boundary |
| --- | --- | --- | --- |
| ThumbnailPipeline.swift | `image(for:capture:size:store:allowNetwork:)`, `prewarm(videos:anchor:viewport:columns:scale:store:)` | Implementation-only; no generated replacement | Multiline async declarations and complete callable representation; generator gap |
| ThumbnailDiskCache.swift | `getCachedImage(for:captureTime:size:scope:allowsLegacy:)`, `cacheImage(_:for:captureTime:size:scope:)` | Implementation-only; `QUEUED_MECHANISM_UNSUPPORTED` | Parameterized async callable plus continuation and closure bodies; generator gap |
| LibraryView.swift | `scrollViewWillBeginDragging(_:)`, `prewarmThumbnailNeighborhood(_:)` | Complete replacement source generated | Native compilation/application still required; nested Tasks are ordinary body content |
| DataStore.swift | `scheduleThumbnailWarmup()` | Complete replacement source generated | Native compilation/application still required; detached sorting and account-generation checks remain intact |

All four diffs preserve imports, stored properties, signatures and type layout.
None is inherently blocked by a structural Swift ABI or iOS signing change.
The synchronous generator successes do not prove that the entire coordinated
update can compile or apply. The two async failures cannot be ignored while
declaring the complete logical update successful.

## Coverage inventory and mechanism separation

| Edit class | Current exclusion layer | Candidate mechanism / actual constraint | Present support claim |
| --- | --- | --- | --- |
| Multiline/closure/defaulted parameter syntax and regex literals | Handwritten parser/classifier or member discovery | Compiler-backed syntax, exact callable ranges, whole-change coverage manifest | Existing conservative fallback; false rejection is not impossibility |
| General async/throws/rethrows, parameters/results, closures, groups and continuations | Replacement generator and concurrency entry-point representation | Native whole-callable dynamic replacements; preserve suspended old frames; separately test isolation and cancellation | Separate native async experiments; no blanket stable admission here |
| Additive private/fileprivate helpers, types and extensions | Declaration classifier; replacement packaging and symbol visibility | Coordinated patch module, versioned private symbols, redirected new call sites | Separate additive native experiments; no blanket stable admission here |
| Import of a module already present for the target | Import policy plus compiler/linker availability | Target-specific module availability and link closure validation | Implementation gap; importing is not installing an absent package |
| Existing callable signature changes, overloads or generic constraints | Existing ABI and already-compiled call sites | Preserve old ABI wrapper; route new patch callers to versioned implementation; update every interacting caller | Existing callers cannot magically acquire a new ABI; adapters require explicit representation |
| Existing stored layout, enum payloads, class ancestry or property-wrapper backing storage | Runtime object/value layout, metadata and state compatibility | Stable sidecar or versioned component with explicit migration and controlled recreation | Native state prototype below; no in-place object resizing claim |
| Protocol conformances and generic metadata changes | Witness tables, conformance lookup and metadata identity | Patch-local versioned types through a stable protocol; test old/new identity and generic callers | Bootstrap component conformance proven here; mutating existing conformance identity unproven |
| Initializers/deinitializers, accessors and callbacks | Generator completeness and dispatch eligibility; sometimes layout/lifetime | Exact compiler representation, native dispatch evidence, coordinated lifecycle policy | Supported stable forms stay as qualified; deeper cases require individual evidence |
| Macros, attributes, conditional compilation and availability changes | Compiler-generated declarations or changed target conditions | Compare expanded effective surface, compile for exact installed target, account for generated storage | Cannot assume source spelling alone proves equivalent structure |
| Resources, localization, themes and bounded configuration | Stable rebuild policy; immutable signed bundle | Explicit Debug resource resolver and staged external data | Bounded JSON resource transaction prototype below; no Bundle.main rewrite |
| Asset catalogs, storyboards or generated resource symbols | Bundle/compiler resource representation | A bootstrapped resolver/versioned component may serve alternate data where APIs support it | Requires specific loader/generator work, not globally impossible |
| New absent native dependency or unavailable SDK symbol | Compiler/linker/platform closure | Preinstalled compatible runtime/bootstrap may unlock some modules; absent linked code still needs a signed baseline | No absent dependency downloaded or installed here |
| Entitlements, capabilities, signing identity, provisioning, executable identity | iOS signing/platform authority | A new signed build with authorized configuration | Cannot be represented as an unsigned data/resource edit |
| Release/TestFlight/App Store active loading | Product/platform boundary | Compile the development mechanism out | Exclusion checked below; no Release injection enabled |

Swift library evolution concerns compatibility between separately built library
versions and their clients. It is not evidence that a concurrently loaded dylib
can resize an already allocated instance or transplant suspended async frames.
This distinction follows the model in
[Swift's library evolution documentation](https://www.swift.org/blog/library-evolution/).
Apple's
[App Review software requirements](https://developer.apple.com/app-store/review/guidelines/#software-requirements)
also keep development loading separate from the Release distribution boundary.

## Implemented native state/component experiment

Owned sources and executable harness:

- [Bootstrap.swift](../../scripts/experimental/hot-reload/native-state/Bootstrap.swift)
  defines a fixed bootstrap object, stable component protocol, state registry,
  immutable operation leases and exact account/object keys.
- [Component.swift](../../scripts/experimental/hot-reload/native-state/Component.swift)
  compiles into independent versioned dylibs. V2 adds private history and
  multiplier state; V3 changes behavior while migrating that state. V4 is a
  forward compensation with the original increment behavior and current schema.
- [Host.swift](../../scripts/experimental/hot-reload/native-state/Host.swift)
  actually loads those dylibs and exercises existing/new object identity,
  migrations, stale operations, account separation and fresh-process restore.
- [run.py](../../scripts/experimental/hot-reload/native-state/run.py) compiles,
  executes and checks both feature gates. It deletes temporary binaries and can
  retain bounded command/diagnostic receipts.

```sh
python3 scripts/experimental/hot-reload/native-state/run.py \
  --sdk-source '<local-InjectionNext-checkout>' \
  --receipt /tmp/swift-sim-state-frontier.json
```

This is substantive indirection: an existing fixed-layout object keeps its
identity and stable sidecar key while separately loaded concrete components
introduce richer private state. An operation captures its component, immutable
bytes, generation and record revision. Old code remains retained while in
flight; an operation cannot commit after another operation, component cutover,
resource revision or account sign-out has invalidated its lease. Migration
stages every record and changes code/state at one locked commit point. A failed
second migration leaves all original records and the previous component intact.
Reentrant migration mutation is rejected. One hundred concurrent increments
exercise the revision fence and preserve all updates.

The tested rollback is pre-commit abort or forward compensation, not unsafe
`dlclose` of images that still have live instances/closures. Dylibs remain loaded
for the process lifetime. Successful state restoration starts a fresh OS
process, loads compatible implementation versions, verifies the bootstrap's
binary/schema identifiers, then decodes persisted state. These fixture identifiers
are not an authenticated Mach-O identity or a native delivery receipt. This is explicitly
**state-restoring relaunch**, not proof of invisible process continuity, offline
patch persistence or zero baseline startup frames.

No arbitrary product class becomes resizable. Adopting this mechanism needs one
Debug bootstrap installation with the stable resolver/registry boundary and
explicit migration adapters for opted-in components. Future saved product
source can remain ordinary Swift: a compiler-backed Debug transformation could
emit patch-local versions and sidecar access, while the next Release compiles
the original source. That transformation is a next implementation experiment;
this prototype does not require manually deleting product changes before
Release and does not claim automatic arbitrary-source migration is done.

## Resource staging and Release exclusion

The prototype stages bounded JSON configuration under an explicit logical-name
allowlist outside the signed bundle. Path traversal, signing metadata names,
oversized values, malformed multi-entry updates and stale revisions reject
before commit. This does not make entitlements, native dependencies or
Info.plist configuration dynamically replaceable. The actual UI/resource
consumer must opt into the resolver in the signed Debug bootstrap.

Native qualification on Apple Swift 6.3.3, arm64 macOS26:

- 38 host checks, including six `dlopen` calls over four distinct component
  images across accepted/rejected upgrades, followed by five checks in a fresh
  child process.
- Both `DEBUG` and `SWIFT_SIM_EXPERIMENTAL_STATE` are required. Release,
  Debug-without-capability and Release-with-capability compile without registry,
  component-install or dynamic-loader symbols.
- Actual repository `SwiftSimLive` Release sources, two Swift files, compile
  with no active injection/loading/socket/feedback bridge symbols.
- Actual local SDK Release sources, 15 Swift and three Objective-C++ files,
  compile under `SWIFT_PACKAGE` with no `DEBUG`; native objects contain no
  external symbols and the Swift dylib has no active injection/loading/socket
  bridge symbols.

Those last checks inspect actual source-produced host binaries, not a textual
assertion that `#if DEBUG` exists. They are not a signed iOS archive inspection,
TestFlight installation or App Store review result. Temporary compile products
are removed; `/tmp/swift-sim-state-frontier-20261030.json` retains the bounded
commands and positive/negative evidence. No real account data is used.

## Remaining boundary and next experiment

The immediate useful target is the complete four-file scheduling update with
compiler-derived callable coverage and strict iPhone request/binary/process/
replacement/root-revision proof, then a separately proven immutable restoration.
The state prototype is an additional lane for structural coverage that the
existing installed ABI cannot transparently absorb. Its next concrete test is
a Debug-only SwiftUI/UIKit component adapter with canonical source mapped to
versioned patch-local types and an explicit state migration, followed by
physical proof of an existing view/controller identity policy and clean
recreation. It must not pretend recreated objects preserve identity.

Before graduating any of this, qualify suspended tasks, cancellation and
reentrancy across migration, partial external side effects, in-process atomic
activation/compensation and crash recovery. The current staged byte transaction
cannot undo arbitrary I/O performed by user migration code. This is a genuine
technical boundary requiring a pure migration contract or isolation, not a
reason to mark all structural experiments impossible.
