# Architecture Consolidation Progress

This file is the compact execution ledger for the architecture program. It is not a substitute for pull-request descriptions or durable ADRs. Phase rows record the validated implementation commit, not the final PR head; the exact final PR head is recorded in the PR body and final handoff after the last metadata commit.

## Program status

| Phase | Scope | Status | PR | Base | Head | Key residual |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Baseline and guardrails | Draft PR | [#23](https://github.com/Miguelosaurus/Swift-Sim/pull/23) | 4dfa15f | 1cabd6b validated implementation | Existing architecture debt is baselined; runtime behavior unchanged |
| 1 | TypeScript and package foundation | Not started | — | — | — | — |
| 2 | Explicit infrastructure primitives | Not started | — | — | — | — |
| 3 | Helper and HTTP decomposition | Not started | — | — | — | — |
| 4 | Repository interfaces and SQLite migration | Not started | — | — | — | — |
| 5 | Preload removal | Not started | — | — | — | — |
| 6 | Live reload module split | Not started | — | — | — | — |
| 7 | SwiftSyntax analyzer | Not started | — | — | — | — |
| 8 | iOS companion feature architecture | Not started | — | — | — | — |
| 9 | Test, docs, and release consolidation | Not started | — | — | — | — |
| 10 | Product reliability proof | Not started | — | — | — | — |

## Mandatory architecture checkpoints

The checkpoint rules in `ARCHITECTURE_CONSOLIDATION_CHECKPOINT_PROTOCOL.md` are hard continuation gates. Passing CI or completing self-review does not satisfy them.

| Checkpoint | Trigger | Checkpoint PR/head | Review received | Required corrections complete | Miguel continuation approval | Authorized next phase | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Phase 2 complete; before Phase 2 merge or Phase 3 work | — | No | No | No | Phase 3 | Pending |
| 2 | Phase 5 complete; before Phase 5 merge or Phase 6 work | — | No | No | No | Phase 6 | Pending |
| 3 | Phase 8 complete; before Phase 8 merge or Phase 9 work | — | No | No | No | Phase 9 | Pending |

At each checkpoint, add beneath this table:

- the state-report path;
- the current-state review-prompt path;
- review date;
- concise reviewer decision;
- correction commits;
- explicit approval evidence;
- any re-review requirement.

Do not mark `Miguel continuation approval` as `Yes` based on implication, elapsed time, CI, the implementing agent's judgment, or another automated reviewer.

## Baseline metrics

Populate these in Phase 0 from generated repository inspection rather than memory.

| Metric | Baseline | Current | Target |
| --- | ---: | ---: | ---: |
| Production JavaScript files | 67 | 67 | 0 canonical JS files after migration, excluding intentional wrappers |
| Production TypeScript files | 0 | 0 | Canonical Node implementation |
| Production Swift files | 7 | 7 | Feature-organized |
| Preload/runtime patch modules | 30 | 30 | 0 |
| Built-in monkey-patch evidence modules | 10 | 10 | 0 |
| Source-text implementation tests | 28 | 28 | 0 |
| Direct `child_process` production importer files | 28 | 28 | Approved infrastructure only |
| Direct destructive filesystem importer files | 26 | 26 | Approved stores only |
| Largest Node production file | 2,821 (`mac-helper/src/liveReload.js`) | 2,821 | <= 800 lines or ADR |
| Largest Swift production file | 2,562 (`Companion/SwiftSimCompanion/SessionStore.swift`) | 2,562 | <= 800 lines or ADR |
| Writable JSON state-store candidates | 37 | 37 | 0 writable stores after migration window |
| Node minimum version | >=20 | >=20 | Supported pinned LTS |

### Phase 0 — Baseline and architectural guardrails

- Status: Draft PR; implementation and validation complete, unmerged
- Branch: `agent/architecture-consolidation-phase-0-guardrails`
- PR: [#23](https://github.com/Miguelosaurus/Swift-Sim/pull/23)
- Base SHA: `4dfa15ff76b5bd046f7ad02ee9f8d963d02d62cb`
- Validated implementation SHA: `1cabd6b` (the exact final PR head is intentionally not self-recorded here; it is published in the PR body and final handoff after this ledger update)
- Dates: 2026-08-04
- Checkpoint relationship: None; scheduled checkpoints remain unchanged and pending

#### Objective

Create a generated architecture inventory and monotonic fitness gate that records existing debt and prevents new preload/runtime-patch modules, direct process/filesystem access, source-text implementation tests, unapproved oversized files, and stale workflow badges. Capture the settled architecture decisions in ADRs and make the internal navigation durable.

#### Invariants touched

- Test integrity
- Maintainability gates
- Packaging and release
- HTTP and contract compatibility (documentation-only verification)

#### Mechanical changes

- Added `scripts/architecture/inventory.js` with deterministic `--json` inventory, Git-history-backed baseline verification, decrease-only caps, and structured ADR/time-bounded allowlists.
- Added `scripts/architecture/baseline-policy.json` with an immutable snapshot from `4dfa15ff76b5bd046f7ad02ee9f8d963d02d62cb`, current caps, and explicit empty exception lists.
- Added excluded fixture resources and regression tests in `test/architectureInventory.test.js` for every reviewed bypass, including the real architecture-test path.
- Extended Node risk analysis to `.ts`, `.mts`, and `.cts`; explicitly rejects `.tsx` in the Node production tree.
- Unified child-process and destructive-filesystem enforcement at one capability per production file, including fs-promises variants and imported aliases.
- Strengthened aliased built-in monkey-patch detection for arbitrary assignments, arrows, prototypes, `defineProperty`/`defineProperties`, `Reflect`, and `Object.assign`.
- Configured CI checkout with full history so the immutable baseline commit is available to the gate.
- Added ADR-0001 through ADR-0005 and an ADR index under `docs/internal/adr/`.
- Linked ADR navigation from `docs/internal/README.md`.
- Added `npm run check:architecture` to the authoritative `npm run check` path.
- Corrected the verified README workflow badge target from the absent `release.yml` to `.github/workflows/verify.yml`.
- Preserved all existing historical review records and the three mandatory checkpoint rows.

#### Behavioral changes

`None` expected. The workflow badge target is documentation metadata only; the helper, CLI, companion, storage, pairing, process, and live-reload behavior were not changed.

#### Old architecture removed

None. Phase 0 deliberately does not migrate TypeScript, decompose helpers, migrate storage, remove preloads, replace the analyzer, or refactor the companion.

#### Compatibility layer remaining

- The baseline policy explicitly permits current debt so this phase is behavior-preserving. Its path/count entries are generated from the current tree and may only decrease or be narrowed by later phase PRs.
- No runtime compatibility layer was added.

#### Metrics

| Metric | Before | After |
| --- | ---: | ---: |
| JavaScript production files | 67 | 67 |
| TypeScript production files | 0 | 0 |
| Swift production files | 7 | 7 |
| Preload/runtime patch modules | 30 | 30 |
| Built-in monkey-patch evidence modules | 10 | 10 |
| Source-text implementation tests | 28 | 28 |
| Direct process importer files | 28 | 28 |
| Direct destructive filesystem importer files | 26 | 26 |
| Writable JSON state-store candidates | 37 | 37 |
| Largest production file | 2,821 lines (`mac-helper/src/liveReload.js`) | 2,821 lines |

#### Validation

- Local architecture inventory: `node scripts/architecture/inventory.js --json` produced identical SHA-256 output on two runs after the final metadata update (record the final hash at handoff).
- Local architecture gate: `node scripts/architecture/inventory.js --check` passed.
- Focused architecture tests: `node --test test/architectureInventory.test.js` passed 16/16 using temporary fixture trees and the declared Git baseline.
- Full Node/release suite: the first parallel run passed 442/443 because an existing process-timeout fixture raced on `descendant.pid`; the sequential rerun passed 443/443 before the final baseline-Git regression was added. Re-run `npm run check` after this metadata update and record its final result at handoff.
- Workflow YAML: Ruby YAML parse verified 4 `.yml` files.
- Release shell syntax: `bash -n scripts/codex/build-device.sh scripts/codex/open-simulator-session.sh scripts/release/render-homebrew-formula.sh` passed.
- iOS Simulator: `xcodebuild test -project Companion/SwiftSimCompanion.xcodeproj -scheme SwiftSimCompanion -destination 'platform=iOS Simulator,id=FB2F4110-E68D-4D29-8665-D6070AC3BEC3' -configuration Debug -derivedDataPath .build/phase0-ios-validation -parallel-testing-enabled NO -test-timeouts-enabled YES -default-test-execution-time-allowance 30 -maximum-test-execution-time-allowance 60` passed 30/30 tests on iOS 26.5.
- GitHub Actions follow-up: the initial `verify` run exposed a self-match from `test/architectureInventory.test.js`; fixture text now lives under the excluded fixture directory, the whole-file exemption is removed, and the architecture path is explicitly regression-tested.
- Whitespace: `git diff --check` passed.
- CI, Homebrew clean-install, physical-device, and release-archive gates were not required or changed by this behavior-preserving guardrail phase; they remain external residuals.

#### Self-review findings

| Severity | Found | Fixed | Remaining |
| --- | ---: | ---: | ---: |
| P0 | 0 | 0 | 0 |
| P1 | 2 | 2 | 0 |
| P2 | 3 | 3 | 0 |
| P3 | 1 | 1 | 0 |

Self-review fixed the full review set: the original patch-evidence predicate was too broad, local preload imports were not initially included, the release-contract test expected the pre-gate `npm run check` string, the guard test self-matched, the policy baseline was editable authority, TypeScript was unscanned, fs-promises and aliases were missed, monkey-patch aliases bypassed detection, and metadata used ambiguous head terminology. The final diff review found no remaining P0/P1/P2 issue. It specifically checked baseline inflation, immutable baseline authority, cap reductions, removed-debt reintroduction, allowlist expiry/ADR validation, TypeScript extensions, one-capability enforcement, neutral filenames, fixture exclusion, Git-history availability in CI, and accidental runtime changes.

#### Migration and rollback

- Migration performed: None.
- Backup location/format: Not applicable.
- Rollback procedure: revert the Phase 0 PR; no user state or runtime data is touched.
- Irreversible changes: None.

#### Residual risks

- Existing preloads, direct infrastructure imports, writable JSON records, oversized files, and source-text tests remain intentionally capped for later phases; removed entries cannot be reintroduced without a new structured exception.
- The inventory uses a documented static scanner for ESM imports, TypeScript import-equals, and CommonJS `require` calls; dynamic imports and computed requires are not classified until a later AST-aware enforcement phase.
- `.tsx` is explicitly prohibited in the Node production tree rather than treated as a supported runtime source.
- No physical-device behavior gate is required because Phase 0 makes no product behavior change.

#### Next phase

After this draft PR is reviewed and merged, create a fresh Phase 1 branch from current `main` for the TypeScript/compiler/package foundation. Do not begin Phase 1 in this turn.

## Phase entry template

Copy this section for each completed phase.

### Phase N — Title

- Status: Not started | In progress | Draft PR | Merged | Blocked
- Branch:
- PR:
- Base SHA:
- Head SHA:
- Dates:
- Checkpoint relationship: None | Leads to Checkpoint 1 | Leads to Checkpoint 2 | Leads to Checkpoint 3 | Blocked pending checkpoint

#### Objective

Describe the responsibility moved or mechanism replaced.

#### Invariants touched

List exact invariant sections.

#### Mechanical changes

- files moved;
- modules split;
- names changed;
- generated configuration.

#### Behavioral changes

State `None` when behavior is intentionally unchanged. Otherwise describe each behavior change and its product impact.

#### Old architecture removed

List deleted paths, global hooks, stores, tests, or compatibility code.

#### Compatibility layer remaining

For each remaining layer:

- purpose;
- call sites;
- owner;
- removal phase/deadline.

#### Metrics

| Metric | Before | After |
| --- | ---: | ---: |
| JavaScript production files | | |
| TypeScript production files | | |
| Preloads | | |
| Source-text tests | | |
| Direct process imports | | |
| Largest touched file | | |

#### Validation

Record exact commands and result counts. Distinguish local, GitHub Actions, Simulator, physical device, Homebrew, and release-package validation.

#### Self-review findings

| Severity | Found | Fixed | Remaining |
| --- | ---: | ---: | ---: |
| P0 | | | |
| P1 | | | |
| P2 | | | |
| P3 | | | |

Summarize meaningful findings without creating a giant round ledger.

#### Migration and rollback

- migration performed;
- backup location/format;
- rollback command or procedure;
- rollback window;
- irreversible changes, if any.

#### Residual risks

List only real bounded residuals, their triggers, and why they are outside the phase.

#### Next phase

State the next smallest safe step and the dependency this phase resolved. When a checkpoint follows this phase, state only the checkpoint preparation and stop; do not recommend beginning the next implementation phase before authorization.

## Decision log index

Durable architecture decisions belong in ADR files. Add links here when created.

| ADR | Decision | Status |
| --- | --- | --- |
| [ADR-0001](../adr/ADR-0001-typescript-compile-to-dist.md) | TypeScript build and runtime model | Accepted |
| [ADR-0002](../adr/ADR-0002-explicit-infrastructure-ports.md) | Explicit process and filesystem infrastructure ports | Accepted |
| [ADR-0003](../adr/ADR-0003-sqlite-domain-state-filesystem-runtime.md) | SQLite domain state / filesystem runtime journal split | Accepted |
| [ADR-0004](../adr/ADR-0004-swift-analyzer-boundary.md) | SwiftSyntax analyzer boundary | Accepted |
| [ADR-0005](../adr/ADR-0005-companion-feature-architecture.md) | Companion feature-state architecture | Accepted |

## Final completion record

Complete this only after Phase 10.

- Final release:
- Final main SHA:
- Clean install evidence:
- Upgrade/migration evidence:
- Physical-device evidence:
- External beta evidence:
- Remaining published limitations:
- Deleted compatibility paths:
- Deferred future work:
