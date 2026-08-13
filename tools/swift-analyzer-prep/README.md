# Phase 7 analyzer preparation

This directory is preparatory only. Nothing here is imported by production routing.

The differential corpus lives in `test/fixtures/swift-analyzer/corpus.json`. Run `node scripts/analyzer-prep/diff.mjs` for the human report or add `--json` for machine-readable output. A future analyzer binary can be supplied with `--candidate-command` and is evaluated through the same bounded protocol.

The comparator uses the current `classifySwiftSource` and `classifyEditSet` exports only as the legacy oracle. Candidate unavailability, timeout, invalid output, incompatible protocol, or unsupported syntax is treated as `rebuild-required`.

Rows are classified as `equivalent`, `stricter`, or `potentially-more-permissive`. The last class is rejected unless the corpus row has `productionEnabled=false` and `physicalProofRequired=true`.

`SwiftSyntaxProbe` is an isolated SwiftPM experiment pinned to `swift-syntax` 602.0.0 for the Swift 6.2 family. It validates the parser/package seam only; it is not a production classifier. Run `node scripts/analyzer-prep/package-feasibility.mjs` to inspect the current machine. The experiment must not be wired into the root package, Homebrew formula, helper composition, or live routing by this workstream.

Future Phase 7 agents should reuse the corpus, protocol fixture, degraded-mode fixture, protocol helper, differential runner, and isolated parser probe. Production cutover remains serialized and subject to ADR-0004, the Phase 6 gate, clean-package proof, and physical-device proof for any newly permissive route.
