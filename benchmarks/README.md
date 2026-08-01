# Swift Sim hot-reload benchmark

This is the internal, source-private benchmark described in
[`docs/HOT_RELOAD_BENCHMARK_PLAN.md`](../docs/HOT_RELOAD_BENCHMARK_PLAN.md).
It keeps classifier safety, physical-device reliability, and chronological
workflow acceleration on separate scoreboards. Curated corpus results are
scoped regression evidence; they are not an everyday SwiftUI coverage claim.

## Local commands

```sh
npm run benchmark:validate
npm run benchmark:static -- --output /tmp/swift-sim-static
npm run benchmark:validate:liquid-glass
npm run benchmark:static:liquid-glass
npm run benchmark:validate:native-surfaces
npm run benchmark:static:native-surfaces
npm run benchmark:validate:mechanisms
npm run benchmark:static:mechanisms -- --repeat 3
npm run benchmark:report -- --run /tmp/swift-sim-static
```

The static run validates and materializes the disposable fixture, invokes the
production typed edit-set classifier, repeats the corpus three times, fails on
the first dangerous false-live result, and asserts deterministic normalized
results. Reports and JSONL under `benchmarks/results/` are ignored by git.

## Device gate

The physical runner must be given an explicitly selected, trusted, unlocked
iPhone. It runs `swift-sim doctor`, creates a live-enabled Debug device build,
launches the fixture with `devicectl` console capture, waits for the baseline
marker, applies the seeded edit set, verifies the request/replacement/root
refresh/revision/oracle marker, and restores the baseline before continuing.
The scheme selects the matching workload. Use --lane hot-reload for a full
implementation-only device lane; use --smoke for the small marked probe. The
supplemental native-system-surface corpus is a separate CatalogApp lane.

```sh
npm run benchmark:device -- \
  --project benchmarks/fixtures/HotReloadBenchmarks.xcodeproj \
  --scheme CatalogApp \
  --device "<exact trusted iPhone name>" \
  --build-setting DEVELOPMENT_TEAM=<team supplied at run time> \
  --smoke
```

Full core hot-reload lanes are run independently per workload so a transport
restart cannot contaminate the next workload:

~~~sh
npm run benchmark:device -- \
  --corpus benchmarks/corpora/core/corpus.json \
  --project benchmarks/fixtures/HotReloadBenchmarks.xcodeproj \
  --scheme CatalogApp \
  --device "<exact trusted iPhone name>" \
  --build-setting DEVELOPMENT_TEAM=<team supplied at run time> \
  --lane hot-reload --iterations 1
~~~

Repeat the command with StateApp and ArchitectureApp. The Architecture
workload contains multi-file and generic/actor cases; if a console session
drops, preserve the failed record, rebuild the disposable baseline, and rerun
the affected case from a fresh live session.

The August 1, 2026 core evidence is summarized in
[`docs/CORE_HOT_RELOAD_PHYSICAL_RESULTS.md`](../docs/CORE_HOT_RELOAD_PHYSICAL_RESULTS.md).

Never use a Simulator or screenshot as device proof. Device output remains
local; exported records redact paths, identifiers, signing metadata, Tailnet
hosts, tokens, source, and patch contents. A locked or disconnected phone is a
failed hardware gate, not a successful fallback result.

## Fixture and corpus shape

The committed core corpus has 240 cases: 120 expected hot reload, 100 expected
rebuild, and 20 authoring-error/recovery cases. It includes all twelve hot
categories, 25 multi-file operations, and 24 smoke-marked hot cases. The three
fixture schemes are `CatalogApp`, `StateApp`, and `ArchitectureApp`; each links
the local `SwiftSimLive` package and applies the root modifier once.

The supplemental `liquid-glass-1` corpus keeps the fixed core corpus intact
while covering 27 current SwiftUI Liquid Glass and adjacent system-surface
edits plus seven structural rebuild controls. Its scope and evidence levels are
documented in
[`docs/LIQUID_GLASS_HOT_RELOAD.md`](../docs/LIQUID_GLASS_HOT_RELOAD.md).

The native-surfaces-1 corpus covers 24 native SwiftUI system-surface edits and
seven rebuild controls. Its API matrix and physical evidence are documented in
[`docs/NATIVE_SYSTEM_SURFACE_HOT_RELOAD.md`](../docs/NATIVE_SYSTEM_SURFACE_HOT_RELOAD.md).

The supplemental mechanism corpus covers fourteen generated replacement forms
that are easy to miss when testing only `View.body`: protocol defaults, actor
and extension members, `ViewModifier`, Observation, explicit accessors,
property wrappers, initializer/subscript body folds, generic and parameterized
helpers, async/throws interposition, and UIKit bridge callbacks. It also
contains three explicit build controls. The scope, physical evidence, and
recovery semantics are documented in
[`docs/HOT_RELOAD_MECHANISM_COVERAGE.md`](../docs/HOT_RELOAD_MECHANISM_COVERAGE.md).

Run its physical lane with the dedicated fixture:

```sh
npm run benchmark:device -- \
  --corpus benchmarks/corpora/mechanisms/corpus.json \
  --project benchmarks/fixtures/MechanismBenchmarks.xcodeproj \
  --scheme MechanismApp \
  --device "<exact trusted iPhone name>" \
  --build-setting DEVELOPMENT_TEAM=<team supplied at run time> \
  --lane hot-reload --iterations 1
```

The device runner persists diagnostic timeout records, restarts from a clean
live session, and retries recoverable transport failures once. Recovery records
are visible in `summary.json`; they are not silently counted as direct passes.
