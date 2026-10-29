# P7 SwiftSyntax analyzer preparation report

Status: preparatory evidence only  
Workstream: `P7-ANALYZER-PREP`  
Dispatch base: `38eee4bfb1eabc2184d92aa3e52fee28b139cbf5`  
Production analyzer/routing changed: **no**

## Result

This workstream adds a versioned analyzer protocol fixture, a 69-case differential corpus, fail-closed process-boundary tooling, an isolated SwiftSyntax/SwiftParser packaging experiment, and a reusable current-analyzer-versus-candidate comparator.

| Classification | Cases |
| --- | ---: |
| Equivalent | 49 |
| Stricter | 16 |
| Potentially more permissive | 4 |
| Total differences | 20 |
| Total corpus cases | 69 |

All four potentially-more-permissive cases are explicitly disabled with `productionEnabled=false` and `physicalProofRequired=true`. Nothing in this preparation authorizes them for production hot reload.

## Current analyzer characterization

At the dispatch base, production classification remains inside `mac-helper/src/liveReload.js`:

- `classifyEditSet` owns edit-set aggregation, non-Swift/lifecycle handling, and whole-set rebuild decisions.
- `classifySwiftSource` compares a handwritten declaration surface and returns `no-change`, `hot-reload`, or `rebuild-required`.
- comments and ordinary/raw/extended/multiline Swift strings are masked before structural scanning;
- any detected Swift regex literal is rejected conservatively;
- explicit macro declarations and `@_dynamicReplacement` are unsupported;
- imports, compiler conditions, runtime availability, attributes, selected modifiers, stored properties, signatures, and declarations are compared lexically/textually.

That implementation is the compatibility oracle for this workstream, but it is not a Swift grammar. The preparation therefore emphasizes both established behavior and lexical blind spots.

## Corpus methodology

`test/fixtures/swift-analyzer/corpus.json` is a small manifest containing the dispatch SHA, tuple field schema, methodology, and references to reviewable case files under `test/fixtures/swift-analyzer/parts/`. `scripts/analyzer-prep/diff.mjs` recursively loads those parts.

Each case records:

- source/edit-set input;
- the dispatch-base legacy route;
- the intended syntax-aware prototype route;
- whether physical proof is required;
- whether the candidate behavior is production-enabled;
- notes for exceptional cases.

Before classifying a candidate, the differential runner executes every corpus case through the public current analyzer and verifies the recorded legacy snapshot. Snapshot drift is aggregated and reported as an error rather than silently updating expectations.

Coverage includes ordinary/interpolated/raw/multiline strings; line and nested block comments; SwiftUI/function/actor/extension/generic bodies; initializers, subscripts, async functions and computed properties; plain, testable, access-controlled and attributed imports; stored state, declarations and signatures; property wrappers, attributes and modifiers; conditional compilation and availability; macro declaration/invocation syntax; malformed syntax; regex literals; non-Swift changes; added/removed Swift files; and mixed/multi-file edit sets.

Differential classification is intentionally mechanical:

1. same route -> `equivalent`;
2. legacy hot/no-change -> candidate rebuild -> `stricter`;
3. every other candidate route relaxation -> `potentially-more-permissive`.

The runner rejects any potentially-more-permissive case that is not both disabled and marked for physical proof.

## Difference findings

### Stricter: 16

The intended syntax-aware behavior is deliberately more conservative where the handwritten analyzer lacks enough grammar coverage or cannot prove syntactic validity. The stricter set covers:

- `public import`, `package import`, `@preconcurrency import`, and `@_exported import` target changes;
- nested inline `public` and `static` declaration modifier changes that the legacy line-anchored modifier capture misses;
- `required`, `override`, `weak`, `unowned`, `indirect`, and `distributed` modifier changes not fully represented by the current lexical surface;
- `#Preview` macro invocation changes;
- malformed source including missing braces, unterminated block comments, and unterminated strings.

`convenience init` is intentionally **not** in the stricter set: final dispatch-base verification showed that the existing analyzer already routes that case to rebuild, so it is equivalent in the corpus.

ADR-0004 allows the replacement analyzer to be more conservative. These rows therefore remain rebuild-safe instead of attempting to preserve lexical blind spots.

### Potentially more permissive: 4

The only route relaxations in the preparation snapshot are:

- `regex-bare-body`;
- `regex-extended-body`;
- `regex-character-class`;
- `regex-present-unrelated-body`.

The legacy classifier rebuilds whenever a Swift regex literal is present. A grammar-aware implementation could determine that these examples are implementation-only, but that would relax the established route. All four remain disabled and require the master-plan physical-device proof plus explicit review before production enablement. Failed valid proof attempts must remain part of the evidence record.

## Protocol and degraded behavior

`test/fixtures/swift-analyzer/protocol.json` and `scripts/analyzer-prep/protocol.mjs` define the reusable preparation-stage boundary. Requests carry a protocol version, request identity, and complete edit set. Responses carry matching identity, analyzer version, status, route, and reason code.

Preparation defaults are a 1500 ms process timeout and 1 MiB stdout bound. These are experiment values, not final production policy.

`test/fixtures/swift-analyzer/degraded.json` and `test/swiftAnalyzerProtocolBoundary.test.js` cover analyzer unavailability, timeout, process failure, malformed output, protocol mismatch, invalid unsupported/hot combinations, request mismatch, missing reason, and output overflow. Every degraded condition becomes `rebuild-required`.

The handwritten analyzer is not modeled as an automatic permissive fallback. During the eventual rollback window it may be diagnostic-only; analyzer failure must still fail closed to a signed rebuild.

## Reusable differential tooling

The checked-in snapshot comparator is reusable by the eventual implementation lanes:

```sh
node scripts/analyzer-prep/diff.mjs
node scripts/analyzer-prep/diff.mjs --json
```

A future executable can be compared through the same corpus and bounded protocol:

```sh
node scripts/analyzer-prep/diff.mjs --candidate-command /absolute/path/to/analyzer
```

Candidate unavailability, timeout, process failure, malformed output, or protocol incompatibility is normalized through the fail-closed boundary before differential classification.

## SwiftSyntax packaging/runtime feasibility

`tools/swift-analyzer-prep/SwiftSyntaxProbe` is an isolated SwiftPM experiment and is not referenced by production routing, the root package, release composition, or Homebrew.

The experiment pins `swift-syntax` `602.0.0`, matching the Swift 6.2 family used by the dispatch-time feasibility environment. `Probe.swift` imports `SwiftParser`/`SwiftSyntax` only to prove the parser/process/package seam; it is not a production classifier.

Observed feasibility constraints:

- Swift and `swiftc` 6.2.1 were available;
- direct `import SwiftSyntax` / `import SwiftParser` was unavailable;
- `xcrun` was unavailable in the Linux preparation environment;
- the isolated SwiftPM manifest was valid.

Therefore “Swift is installed” is not a sufficient dependency contract. Phase 7 needs an explicit distribution decision with pinned Swift/SwiftSyntax compatibility, analyzer/protocol metadata, integrity/checksum verification, supported OS/architecture evidence, clean install/upgrade proof, and no unexpected first-use SwiftSyntax source compilation. A prebuilt analyzer packaged with the supported release/Homebrew path is the strongest current proof target. Root release/Homebrew/compiler edits remain orchestrator/red-zone work and were intentionally not made here.

## Proposed Phase 7 implementation packages

### P7-A — SwiftSyntax analyzer core

Own syntax-tree classification, parse diagnostics, unsupported-syntax policy, deterministic protocol responses, and analyzer-unit corpus. Do not own Node routing or production authority.

### P7-B — Analyzer client and fail-closed boundary

After Phase 6 exposes the seam, own process invocation, timeout/output bounds, version/request validation, analyzer artifact compatibility/integrity verification, failure-to-rebuild mapping, and diagnostic legacy comparison.

### P7-C — Package and release integration

Own the pinned Swift/SwiftSyntax compatibility decision, analyzer build artifact, release/Homebrew inclusion, integrity metadata, and clean install/upgrade verification under orchestrator delegation for red-zone files.

### P7-D — Differential corpus and acceptance evidence

Expand this corpus with captured real edit sets, run old/new analyzers on exact implementation heads, publish machine/human reports, retain failed evidence, and enforce zero ungated permissive drift.

### P7-E — Physical permissiveness proof

Own physical-device proof only for legacy-rebuild/candidate-hot rows. The four regex cases belong here if an implementation seeks to enable them; otherwise they remain rebuild-only.

### P7-F — Serialized cutover and rollback-window removal

After Phase 6 and P7-A through P7-E prerequisites, own production authority selection, diagnostic-only legacy flag, one-release rollback window, acceptance gates, and eventual handwritten-parser deletion. This remains orchestrator-controlled.

## Remaining gates and invariant review

Phase 6 must expose the analyzer boundary without behavior change. A supported macOS/Xcode environment must build and execute the pinned analyzer. Release/Homebrew clean-install and upgrade behavior must be proven. Final timeout/output/integrity policy must be benchmarked. Real edit sets must join acceptance evidence. Every route relaxation must remain disabled until physical-device proof succeeds.

Production authority, durable state, user data, root packaging/release/compiler policy, and canonical control-plane files are unchanged. All corpus inputs are synthetic. Uncertainty at the preparatory analyzer boundary fails closed.

**Recommendation:** ready for orchestrator review as Phase 7 preparation, but not sufficient for production cutover by itself.
