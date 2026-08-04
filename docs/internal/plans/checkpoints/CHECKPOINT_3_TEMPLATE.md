# Checkpoint 3 Template — Live Architecture and Companion Decomposition

Use this template only after Phase 8 is complete, fully validated, self-reviewed, and still unmerged.

Create `NEXT_AGENT_PROMPT_CHECKPOINT_3_CURRENT_STATE.md` beside this file. Replace every placeholder with current facts. Delete all instructional comments before presenting it to Miguel.

---

Use the GitHub plugin to perform an independent architecture, live-safety, package, and iOS maintainability review of the actual Swift Sim repository and PR. Do not rely only on this summary.

## Review target

- Repository: `Miguelosaurus/Swift-Sim`
- Checkpoint: 3 — live architecture and companion decomposition
- PR: `<number and URL>`
- Branch: `<branch>`
- Base SHA: `<sha>`
- Head SHA: `<sha>`
- State report: `docs/internal/plans/checkpoints/CHECKPOINT_3_STATE.md`

The implementation agent has stopped. Do not authorize Phase 9 until you have inspected the repository and returned a written decision.

## Required reading

Read these completely:

- the architecture master plan, invariants, execution guide, checkpoint protocol, and progress ledger;
- `docs/internal/plans/checkpoints/CHECKPOINT_3_STATE.md`;
- live-delivery, analyzer, engine, Xcode, patch, proof, recovery, fallback, API-contract, companion-feature, actor-isolation, package-versioning, and compatibility ADRs;
- the Swift analyzer executable/library and TypeScript client;
- differential corpus results and physical-device evidence, including failed valid attempts;
- the legacy analyzer compatibility path and deletion condition;
- feature models, helper API client, repositories, app coordinator, remaining `SessionStore`, and remaining large SwiftUI files;
- cancellation, revision-fencing, pairing replacement, app ownership, install-state, and accessibility tests.

## What changed

<Concise factual Phase 6–8 summary, including analyzer cutover and companion decomposition boundaries.>

## Evidence

<Exact CI/local/package/analyzer/differential/physical-device/iOS test results, performance deltas, failed attempts, and missing hardware or compatibility gates.>

## Current metrics

<Live module sizes, legacy-parser lines remaining, differential totals, newly permissive case count, rebuild-conservative changes, source-text-test count, largest Swift files, `SessionStore`/`ContentView` size, global URLSession usage, feature-model sizes, API contract duplication, test counts, and deltas from Checkpoint 2.>

## Analyzer state

State explicitly:

- protocol version and compatibility handling;
- packaging/install/update path;
- timeout and output bounds;
- parse/unsupported/malformed/version-mismatch behavior;
- differential corpus totals;
- every newly permissive result and its physical proof;
- false-live and false-success count;
- legacy analyzer runtime role and deletion date/condition;
- whether a clean machine must compile tooling unexpectedly;
- rollback procedure.

## Companion state

State explicitly:

- feature boundaries and ownership;
- navigation/coordinator ownership;
- networking and persistence injection;
- actor isolation and sendability decisions;
- cancellation and stale-response fencing;
- remaining compatibility coordinator responsibilities;
- remaining direct `URLSession.shared`, `UserDefaults`, Keychain, or filesystem use in feature logic;
- current accessibility/UI behavior evidence;
- any user-visible behavior change introduced accidentally or intentionally.

## Deviations and residuals

<Every plan deviation, analyzer disagreement, package caveat, legacy path, coupled feature model, duplicated contract, actor warning, flaky device result, source-text test, oversized file, and release blocker.>

## Decisions and questions

Ask concrete questions about actual implementation choices, including at minimum:

1. Is live delivery now separated by responsibility, or are the new modules still coupled through a large shared context/facade?
2. Is any newly permissive analyzer result inadequately proven and therefore required to revert to rebuild-only?
3. Is the analyzer protocol/package/version strategy stable enough for normal Homebrew and Swift package releases?
4. Should the legacy analyzer remain for the planned diagnostic release, be deleted earlier, or be retained longer?
5. Did the iOS refactor create genuine feature ownership, or did it distribute one god object across many mutually dependent models?
6. Are networking, persistence, navigation, and feature state boundaries testable without global services?
7. Are actor isolation, cancellation, and response-revision fences correct under rapid pairing/session/build switching?
8. What must be corrected before documentation/test/release consolidation begins?

Add any state-specific questions.

## Requested output

Return:

- architecture, live-safety, and iOS maintainability verdicts;
- P0/P1/P2/P3 findings with exact files and reasoning;
- required corrections before merge;
- every approved/rejected newly permissive analyzer case;
- package/versioning decisions;
- legacy-path deletion or extension decision;
- feature boundaries that must be corrected;
- missing physical-device, accessibility, actor-safety, or contract evidence;
- whether Checkpoint 3 passes;
- one exact continuation decision:
  - `AUTHORIZED: merge the corrected Phase 8 PR and begin Phase 9`
  - `NOT AUTHORIZED: correct and resubmit Checkpoint 3`
  - `LIVE CUTOVER REJECTED: restore conservative routing and replan`
  - `COMPANION STRUCTURE REJECTED: revise feature boundaries before continuing`
  - `REPLAN REQUIRED: stop and revise the architecture program`

## Stop declaration

Implementation is stopped. The final Phase 8 PR remains draft and unmerged. No Phase 9 production or cleanup work will begin until Miguel returns your review and explicit continuation approval.

---
