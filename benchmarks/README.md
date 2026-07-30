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
The scheme selects the matching workload; run the smoke lane once for each
scheme to cover all 24 smoke-marked cases.

```sh
npm run benchmark:device -- \
  --project benchmarks/fixtures/HotReloadBenchmarks.xcodeproj \
  --scheme CatalogApp \
  --device "<exact trusted iPhone name>" \
  --build-setting DEVELOPMENT_TEAM=<team supplied at run time> \
  --smoke
```

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
