# P7 SwiftSyntax analyzer preparation report

Status: preparatory evidence only  
Workstream: `P7-ANALYZER-PREP`  
Dispatch base: `38eee4bfb1eabc2184d92aa3e52fee28b139cbf5`  
Production analyzer/routing changed: **no**

## Result

This workstream adds a versioned analyzer protocol fixture, a 69-case differential corpus, fail-closed boundary tooling, an isolated SwiftSyntax/SwiftParser package probe, and a reusable legacy-versus-candidate comparator.

| Classification | Cases |
| --- | ---: |
| Equivalent | 50 |
| Stricter | 15 |
| Potentially more permissive | 4 |
| Total differences | 19 |
| Total corpus cases | 69 |

All four potentially-more-permissive cases are explicitly disabled for production and require physical-device proof. No conclusion in this report authorizes those cases for hot reload.

## Current analyzer characterization

At the dispatch base, production classification is still implemented inside `mac-helper/src/liveReload.js`.

- `classifyEditSet` owns edit-set aggregation and fail-closed file-kind/lifecycle decisions.
- `classifySwiftSource` compares a handwritten declaration surface and returns `no-change`, `hot-reload`, or `rebuild-required`.
- comments plus ordinary/raw/extended/multiline strings are masked before structural scanning;
- Swift regex literals are rejected wholesale;
- explicit macro declarations and `@_dynamicReplacement` are unsupported;
- imports, compiler conditions, runtime availability, attributes, selected modifiers, stored properties, signatures, and declarations are compared textually.

That code is a useful compatibility oracle, but it is not a Swift parser. The corpus therefore targets both supported behavior and lexical blind spots.

## Corpus methodology

`test/fixtures/swift-analyzer/corpus.json` records each semantic case with the dispatch-base legacy route, intended syntax-aware prototype route, and proof gate. The compact tuple schema declares field names once so the 69 cases remain reviewable without duplicating JSON keys.

Coverage includes:

- ordinary, raw, extended, multiline, and interpolated strings;
- line and nested block comments;
- SwiftUI, functions, actors, extensions, generics, initializers, subscripts, async functions, and computed properties;
- plain/testable imports plus access-controlled and attributed import forms;
- declarations, signatures, stored state, property wrappers, access/static modifiers;
- conditional compilation, runtime availability, and `@available`;
- macro declarations, macro invocation syntax, and macro-style attributes;
- malformed/unterminated syntax;
- regex literals;
- non-Swift files, added/removed Swift files, mixed edit sets, and multi-file hot candidates.

The differential rule is deliberately simple:

1. same route -> `equivalent`;
2. legacy hot/no-change -> candidate rebuild -> `stricter`;
3. every other relaxation -> `potentially-more-permissive`.

The tooling rejects a potentially-more-permissive row unless `productionEnabled=false` and `physicalProofRequired=true`.

## Difference findings

### Stricter: 15

The intended syntax-aware model is more conservative for cases where the legacy scanner does not own enough grammar or cannot establish parse validity. Representative cases include:

- `public import`, `package import`, `@preconcurrency import`, and `@_exported import` target changes;
- `required`, `convenience`, and `override` modifiers;
- `weak` and `unowned` storage modifiers;
- `indirect` enum and `distributed` actor modifiers;
- `#Preview` macro invocation changes;
- missing closing braces, unterminated block comments, and unterminated strings.

This is acceptable under ADR-0004 because a replacement analyzer may be more conservative.

### Potentially more permissive: 4

The four rows are:

- `regex-bare-body`;
- `regex-extended-body`;
- `regex-character-class`;
- `regex-present-unrelated-body`.

The legacy classifier rebuilds whenever it detects a Swift regex literal. A real parser could determine that these examples only change implementation syntax, so a future syntax-aware implementation may produce a hot route. That is a route relaxation and therefore remains **disabled**. Each row requires the master-plan physical-device proof before production enablement, and failed valid proof attempts must remain in the evidence record.

## Protocol and degraded behavior

`test/fixtures/swift-analyzer/protocol.json` plus `scripts/analyzer-prep/protocol.mjs` define the preparation-stage process seam. Requests carry `protocolVersion`, `requestId`, and the complete edit set. Responses carry matching protocol/request identity, analyzer version, status, route, and reason code.

Preparation defaults are a 1500 ms process timeout and 1 MiB stdout bound. These are experiment defaults, not final production policy.

`test/fixtures/swift-analyzer/degraded.json` and behavioral tests cover analyzer unavailability, timeout, process failure, invalid JSON, protocol mismatch, invalid unsupported/hot combinations, missing reason code, request mismatch, and output overflow. Every one normalizes to `rebuild-required`.

The important policy is that the legacy analyzer is **not** modeled as an automatic permissive fallback. During the eventual rollback window it may be diagnostic-only; analyzer failure must still rebuild.

## Reusable comparator

Run the checked-in snapshot comparison:

```sh
node scripts/analyzer-prep/diff.mjs
node scripts/analyzer-prep/diff.mjs --json
```

A future candidate executable can use the same corpus:

```sh
node scripts/analyzer-prep/diff.mjs --candidate-command /absolute/path/to/analyzer
```

Candidate process failures are normalized through the fail-closed protocol helper before differential classification.

## SwiftSyntax packaging/runtime experiment

`tools/swift-analyzer-prep/SwiftSyntaxProbe` is an isolated SwiftPM package and is not referenced by production routing, the root package, release composition, or Homebrew.

The experiment pins `swift-syntax` `602.0.0`, matching the Swift 6.2 family used by the dispatch-time environment. `Probe.swift` uses `SwiftParser` and `SwiftSyntax` only to prove the parser/process/package seam; it does not authorize hot reload.

The feasibility environment reported:

- Swift 6.2.1 and `swiftc` 6.2.1 available;
- direct `import SwiftSyntax` / `import SwiftParser` unavailable;
- `xcrun` unavailable in this Linux environment;
- isolated SwiftPM manifest syntactically valid.

The key packaging conclusion is that “Swift is installed” is not a sufficient dependency contract. Phase 7 needs an explicit distribution decision. The preferred proof target is a prebuilt analyzer included with or installed alongside the supported package, with exact analyzer/protocol metadata, checksum verification, supported architecture/OS coverage, clean install/upgrade evidence, and no first-use source compilation. Root package/Homebrew/release edits are red-zone and were not made here.

## Proposed Phase 7 implementation packages

### P7-A — SwiftSyntax analyzer core

Own the production Swift analyzer source, syntax-tree declaration surface, parse diagnostics, unsupported syntax policy, deterministic protocol responses, and analyzer-unit corpus. It must not own Node routing or cutover authority.

### P7-B — Analyzer client and fail-closed boundary

After Phase 6 exposes the seam, own the `SwiftEditAnalyzer` client, timeout/output bounds, version/request validation, artifact compatibility/checksum verification, failure-to-rebuild mapping, and diagnostic-only legacy comparison hook.

### P7-C — Package and release integration

Own the pinned Swift/SwiftSyntax compatibility choice, analyzer build artifact, release/Homebrew inclusion, integrity metadata, and clean install/upgrade tests. This package requires orchestrator delegation for red-zone release files.

### P7-D — Differential corpus and acceptance evidence

Expand this corpus with captured real edit sets, run old/new analyzers on exact implementation heads, publish machine/human reports, retain failed evidence, and ensure zero ungated permissive drift.

### P7-E — Physical permissiveness proof

Own physical-device proof only for `legacy rebuild -> candidate hot` rows. The four regex cases belong here if the implementation seeks to enable them. Unproven rows remain rebuild-only.

### P7-F — Serialized cutover and rollback-window removal

After Phase 6 and P7-A through P7-E prerequisites, own production authority selection, diagnostic-only legacy flag, one-release rollback window, acceptance gates, and eventual handwritten-parser deletion. This remains orchestrator-controlled.

## Remaining production gates

1. Phase 6 must expose the analyzer boundary without behavior change.
2. A supported macOS/Xcode environment must build and execute the pinned SwiftSyntax analyzer.
3. Release/Homebrew clean-install and upgrade behavior must be proven.
4. Final timeout/output/checksum policy must be benchmarked and adopted.
5. Real edit sets must join the differential corpus.
6. Every newly permissive row remains disabled until physical-device proof and explicit review.
7. Exact SwiftSyntax/toolchain compatibility must match the supported Swift/Xcode release line.
8. The temporary diagnostic legacy path needs a concrete deletion condition.

## Invariant review

- Production source of truth/authority: unchanged.
- Live safety: uncertainty in the preparatory boundary fails closed.
- Potential permissiveness: four rows found, all disabled and physically gated.
- Durable state/migration: none.
- User data: synthetic fixtures only.
- Root packaging/release/compiler red zone: untouched.
- Production compatibility bridge: none added.

**Recommendation:** ready for orchestrator review as preparatory input; not sufficient for Phase 7 production cutover by itself.
