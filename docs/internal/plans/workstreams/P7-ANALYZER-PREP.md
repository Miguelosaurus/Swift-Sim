# P7-ANALYZER-PREP

Status: **PREP**  
Class: **preparatory**  
Phase: **7**

Goal: prepare the SwiftSyntax analyzer transition behind ADR-0004 without changing current production classification behavior.

Deliverables: analyzer protocol fixtures, differential corpus/tooling, SwiftSyntax packaging/runtime experiment, degraded-mode cases, and a report separating equivalent, stricter, and potentially more-permissive results.

Any potentially more-permissive production behavior remains gated by the master-plan physical-proof requirements.

Follow `ARCHITECTURE_CONSOLIDATION_AGENT_PROTOCOL.md` and return exact base/head, generated fixtures/tooling, findings, and proposed Phase 7 implementation packages.

## Worker result — 2026-08-13

Dispatch base: `38eee4bfb1eabc2184d92aa3e52fee28b139cbf5`  
Assigned branch: `agent/arch-ws-P7-ANALYZER-PREP-swiftsyntax-corpus`  
Production routing changed: **no**

Preparation artifacts:

- `docs/internal/analysis/P7_SWIFT_ANALYZER_PREP_REPORT.md`
- `test/fixtures/swift-analyzer/corpus.json`
- `test/fixtures/swift-analyzer/protocol.json`
- `test/fixtures/swift-analyzer/degraded.json`
- `scripts/analyzer-prep/protocol.mjs`
- `scripts/analyzer-prep/diff.mjs`
- `scripts/analyzer-prep/package-feasibility.mjs`
- `tools/swift-analyzer-prep/SwiftSyntaxProbe/`
- `test/swiftAnalyzerPrep.test.js`

Corpus result: 69 cases, 50 equivalent, 15 stricter, 4 potentially more permissive, 19 total differences. All four potentially-more-permissive rows are disabled in the corpus and require physical-device proof before any future production hot route.

Packaging finding: Swift 6.2.1 alone did not make `SwiftSyntax`/`SwiftParser` directly importable in the dispatch feasibility environment. The isolated SwiftPM experiment pins `swift-syntax` 602.0.0, while release/Homebrew integration and clean-macOS execution remain Phase 7 evidence. No root package/compiler/release red-zone file was edited.

Proposed production packages are recorded in the report as P7-A analyzer core, P7-B client/fail-closed boundary, P7-C package/release integration, P7-D differential acceptance, P7-E physical permissiveness proof, and P7-F serialized cutover/legacy rollback-window removal.
