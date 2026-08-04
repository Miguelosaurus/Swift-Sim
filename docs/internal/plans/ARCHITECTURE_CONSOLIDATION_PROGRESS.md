# Architecture Consolidation Progress

This file is the compact execution ledger for the architecture program. It is not a substitute for pull-request descriptions or durable ADRs. Phase rows record the validated implementation commit, not the final PR head; the exact final PR head is recorded in the PR body and final handoff after the last metadata commit.

## Program status

| Phase | Scope | Status | PR | Base | Head | Key residual |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Baseline and guardrails | Merged | [#23](https://github.com/Miguelosaurus/Swift-Sim/pull/23) | 4dfa15f | 6f356df merge commit | Existing architecture debt is baselined; runtime behavior unchanged |
| 1 | TypeScript and package foundation | Draft PR | [#24](https://github.com/Miguelosaurus/Swift-Sim/pull/24) | 6f356df | 9c19e54 validated implementation | Existing JavaScript remains canonical during the mixed-source transition; Phase 2 ports not started |
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
| Production TypeScript files | 0 | 8 | Canonical Node implementation |
| Production Swift files | 7 | 7 | Feature-organized |
| Preload/runtime patch modules | 30 | 30 | 0 |
| Built-in monkey-patch evidence modules | 10 | 10 | 0 |
| Source-text implementation tests | 28 | 28 | 0 |
| Direct `child_process` production importer files | 28 | 28 | Approved infrastructure only |
| Direct destructive filesystem importer files | 26 | 26 | Approved stores only |
| Largest Node production file | 2,821 (`mac-helper/src/liveReload.js`) | 2,821 | <= 800 lines or ADR |
| Largest Swift production file | 2,562 (`Companion/SwiftSimCompanion/SessionStore.swift`) | 2,562 | <= 800 lines or ADR |
| Writable JSON state-store candidates | 29 | 29 | 0 writable stores after migration window |
| Node minimum version | >=20 | 24.x | Supported pinned LTS |

### Phase 0 — Baseline and architectural guardrails

- Status: Merged
- Branch: `agent/architecture-consolidation-phase-0-guardrails`
- PR: [#23](https://github.com/Miguelosaurus/Swift-Sim/pull/23)
- Base SHA: `4dfa15ff76b5bd046f7ad02ee9f8d963d02d62cb`
- Merge commit SHA: `6f356df3c1e1e91499b3d05efe4308337cc7ff6b`
- Validated implementation SHA: `2a2239c1e49df83b8b75ddc42a363e73a11f0655` (the exact final PR head is intentionally not self-recorded here; it is published in the PR body and final handoff after this ledger update)
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
- Made Git-history comparison event-safe: pull requests use `pull_request.base.sha`, pushes use `before`, both are validated against the checked HEAD, local fallback remains deterministic, and a self-resolving merge-base falls back to its parent.
- Added neutral-filename regressions for CommonJS member extraction and direct `require` assignment, `defineProperty`/`defineProperties`, `Reflect.defineProperty`, and `Object.assign` mutations.
- Made local preload/runtime import evidence respect static type-only imports while retaining runtime static and dynamic imports.
- Extended Node risk analysis to `.ts`, `.mts`, and `.cts`; explicitly rejects `.tsx` in the Node production tree.
- Normalized `node:child_process` and `child_process` across JavaScript and TypeScript ESM, CommonJS, side-effect, and TypeScript import-equals forms into one importer capability.
- Replaced cross-statement import regexes with a statement-aware lexical scanner that masks comments, strings, and template text while preserving executable template expressions; static imports and requires no longer span unrelated statements.
- Ignored `typeOnly` bindings during destructive filesystem analysis while retaining runtime promises and write evidence.
- Made exclusions path-aware so declared production roots remain production inside `fixtures`, `build`, and similar segments while actual generated/test fixture roots remain excluded.
- Inventoried `.d.ts`, `.d.mts`, and `.d.cts` separately from runtime TypeScript and ignored declaration/type-only imports while preserving mixed runtime imports.
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
| Writable JSON state-store candidates | 29 | 29 |
| Largest production file | 2,821 lines (`mac-helper/src/liveReload.js`) | 2,821 lines |

#### Validation

- Local architecture inventory: `node scripts/architecture/inventory.js --json` produced identical SHA-256 output on two runs (`f5bef1075de9ff6531ca140af634b20d1f25951510013f6eb72c261ab8263f45`).
- Local architecture gate: `node scripts/architecture/inventory.js --check` passed.
- Focused architecture tests: `node --test --test-concurrency=1 test/architectureInventory.test.js` passed 28/28 using temporary fixture trees and event-shaped Git history metadata.
- Full Node/release suite: final `npm run check` passed 456/456 tests; syntax checked 165 JavaScript files; docs verified 54 Markdown files. An initial run exposed one timing-sensitive `descendant.pid` fixture race; its isolated test and the final standard run both passed.
- Workflow YAML: Ruby YAML parse verified 4 `.yml` files.
- Release shell syntax: `bash -n scripts/codex/build-device.sh scripts/codex/open-simulator-session.sh scripts/release/render-homebrew-formula.sh` passed.
- iOS Simulator: `xcodebuild test -project Companion/SwiftSimCompanion.xcodeproj -scheme SwiftSimCompanion -destination 'platform=iOS Simulator,id=FB2F4110-E68D-4D29-8665-D6070AC3BEC3' -configuration Debug -derivedDataPath .build/phase0-review-ios-validation -parallel-testing-enabled NO -test-timeouts-enabled YES -default-test-execution-time-allowance 30 -maximum-test-execution-time-allowance 60` passed 30/30 tests on iOS 26.5.
- GitHub Actions follow-up: the initial `verify` run exposed a self-match from `test/architectureInventory.test.js`; fixture text now lives under the excluded fixture directory, the whole-file exemption is removed, and the architecture path is explicitly regression-tested.
- Whitespace: `git diff --check` passed.
- Post-merge GitHub Verify: run `30920938939` on `main` at merge commit `6f356df3c1e1e91499b3d05efe4308337cc7ff6b` passed checkout, Node setup, `npm ci`, `npm run check`, YAML validation, release-shell validation, and iOS app tests.
- CI, Homebrew clean-install, physical-device, and release-archive gates were not required or changed by this behavior-preserving guardrail phase; they remain external residuals.

#### Self-review findings

| Severity | Found | Fixed | Remaining |
| --- | ---: | ---: | ---: |
| P0 | 0 | 0 | 0 |
| P1 | 7 | 7 | 0 |
| P2 | 6 | 6 | 0 |
| P3 | 1 | 1 | 0 |

Self-review fixed the full review set: the original patch-evidence predicate was too broad, local preload imports were not initially included, the release-contract test expected the pre-gate `npm run check` string, the guard test self-matched, the policy baseline was editable authority, TypeScript was unscanned, fs-promises and aliases were missed, monkey-patch aliases bypassed detection, metadata used ambiguous head terminology, unprefixed child-process forms bypassed detection, segment-wide exclusions hid production paths, declarations/type-only imports were treated as runtime, imports could span statements and lexical lookalikes could influence capability evidence, destructive analysis did not skip type-only bindings, GitHub event comparison could select the wrong history, CommonJS member extraction and direct require mutations were incomplete, and type-only local preload/runtime imports were misclassified. The final diff review found no remaining P0/P1/P2 issue. It specifically checked baseline inflation, immutable baseline authority, cap reductions, removed-debt reintroduction, allowlist expiry/ADR validation, event-shaped pull-request and push history, TypeScript extensions, declaration and type-only semantics, one-capability enforcement, normalized child-process forms, path-aware fixture/build exclusions, neutral filenames, comments/strings/templates, semicolonless and multiline imports, template expressions, fixture exclusion, Git-history availability in CI, direct CommonJS member/mutation forms, and accidental runtime changes.

#### Migration and rollback

- Migration performed: None.
- Backup location/format: Not applicable.
- Rollback procedure: revert the Phase 0 PR; no user state or runtime data is touched.
- Irreversible changes: None.

#### Residual risks

- Existing preloads, direct infrastructure imports, writable JSON records, oversized files, and source-text tests remain intentionally capped for later phases; removed entries cannot be reintroduced without a new structured exception.
- The inventory uses a documented statement-aware lexical scanner for ESM imports, TypeScript import-equals, and CommonJS `require` calls; comments, strings, and template text are ignored, executable template expressions are scanned, and dynamic imports/computed requires or computed CommonJS member chains are not classified until a later AST-aware enforcement phase. GitHub pull-request and push event metadata is preferred and validated; deterministic local Git fallback remains for local execution.
- `.tsx` is explicitly prohibited in the Node production tree rather than treated as a supported runtime source.
- No physical-device behavior gate is required because Phase 0 makes no product behavior change.

#### Next phase

Phase 0 is merged. Phase 1 is executed on the fresh branch recorded below; do not begin Phase 2 from this entry.

### Phase 1 — TypeScript and package foundation

- Status: Draft PR; implementation and validation complete, unmerged
- Branch: `agent/architecture-consolidation-phase-1-typescript-foundation`
- PR: [#24](https://github.com/Miguelosaurus/Swift-Sim/pull/24)
- Base SHA: `6f356df3c1e1e91499b3d05efe4308337cc7ff6b`
- Validated implementation SHA: `9c19e54394385c1715c6538a8ca616a11796e53b` (the exact final PR head is intentionally not self-recorded here; it is published in the PR body and final handoff after this ledger update)
- Dates: 2026-08-04
- Checkpoint relationship: None; Checkpoint 1 is scheduled only after Phase 2

#### Objective

Establish the Node 24, NodeNext TypeScript, emitted-JavaScript, and clean-package foundation required for incremental production migration without changing helper, CLI, pairing, process-ownership, live-reload, storage, or companion behavior.

#### Invariants touched

- Runtime and packaging compatibility
- Untrusted-boundary contracts
- Test integrity
- Maintainability and architecture ratchets

#### Mechanical changes

- Pinned Node.js 24.x in `package.json`, CI, Homebrew/release packaging, installation checks, and contributor documentation.
- Added exact TypeScript 5.9.3, `@types/node` 24.13.3, ESLint 9.39.1, `typescript-eslint` 8.46.2, and Prettier 3.7.0 pins with a Node ESM/NodeNext configuration.
- Added mixed JavaScript/TypeScript compilation with `allowJs`, `checkJs: false`, source maps, strict TypeScript, consistent casing, and the required control-flow/error options. `.tsx` remains excluded and prohibited in the Node production tree.
- Added ignored `dist/` output and shell build/verification scripts. Production package bins, `npm start`, Homebrew launchers, service startup, and contributor wrappers execute emitted JavaScript from `dist/`; no runtime TypeScript loader was added.
- Added runtime-validated typed contracts for command results, process identities, sessions/streams, pairing, app/device-build state, delivery outcomes, runtime leases/journals, and public/private projections. Validators consume `unknown` at the boundary.
- Added narrow flat ESLint and Prettier configuration scoped to the new contracts, TypeScript tests, and foundation configuration; existing JavaScript was not reformatted.
- Added package whitelist inspection, clean tarball installation, package entrypoint resolution, source/compiled CLI/helper equivalence, and release-archive assembly from the package whitelist.
- Updated release/development documentation and the existing source-runtime assertion for the expanded authoritative `npm run check` path.

#### Behavioral changes

`None` expected for helper, CLI, pairing, process ownership, persistence, live reload, storage, and companion behavior. The supported production execution boundary intentionally changes from source entrypoints to equivalent emitted `dist/` JavaScript, with source/compiled CLI and helper entrypoint output compared by validation.

#### Old architecture removed

None. Phase 1 does not port infrastructure, remove preloads, migrate storage, split the helper/live-reload/iOS architecture, or change product behavior.

#### Compatibility layer remaining

- Existing JavaScript remains the canonical production implementation while `allowJs: true` and the single `dist/` build enable bounded TypeScript migration.
- Source-tree entrypoints remain available for source/compiled equivalence tests; shipped package bins and release/Homebrew launchers resolve only to emitted `dist/` files.
- The new contracts are declaration/validation boundaries only in this phase. Existing modules do not consume them until later infrastructure and decomposition phases.

#### Metrics

| Metric | Before | After |
| --- | ---: | ---: |
| Production JavaScript files | 67 | 67 |
| Production TypeScript files | 0 | 8 |
| Preloads | 30 | 30 |
| Source-text tests | 28 | 28 |
| Direct child-process importer files | 28 | 28 |
| Direct destructive filesystem importer files | 26 | 26 |
| Largest touched production file | 2,821 (`mac-helper/src/liveReload.js`) | 2,821 (`mac-helper/src/liveReload.js`) |
| Supported Node line | >=20 | 24.x |
| Clean package files | Not established | 181 |

#### Validation

- Runtime/install baseline: Homebrew Node `v24.19.0`; npm `11.17.0`; `npm ci` passed with no vulnerabilities.
- Complete local gate: `npm run check` passed under Node 24. It syntax-checked 340 JavaScript files, passed architecture inventory for 82 production source files, verified 54 Markdown files, passed strict TypeScript typecheck, Prettier, ESLint, the source suite at 456/456, the compiled suite at 459/459, source/compiled CLI/helper equivalence, clean package archive installation, package entrypoint resolution, and Homebrew formula verification.
- TypeScript foundation: `npm run check:types`, `npm run build`, and compiled-tree execution passed; `dist/` is ignored and no generated output is committed.
- Package validation: `npm pack --dry-run --json` inspected 181 intended files; a clean archive install executed both the compiled CLI and package bin at version `0.6.1` and resolved `swift-sim/dist/mac-helper/bin/swift-sim-entry.js` through the installed package.
- Architecture inventory and ratchet: `node scripts/architecture/inventory.js --json` and `npm run check:architecture` passed. Counts remained 30 preloads, 28 child-process importers, 26 destructive filesystem importers, and 28 source-text tests; no policy cap increased.
- Helper/process ownership: the complete source and compiled suites passed the helper setup/start/restart, deadline, owned-worker, lock-ownership, lifecycle, and process-group tests; the sequential runner avoids the previously observed fixture race.
- Homebrew/release: `bash scripts/verify-homebrew-package.sh` passed Ruby formula syntax and Node 24 compiled-entrypoint checks. The complete release-shell syntax command also passed for all build, package, Homebrew, and release scripts.
- iOS companion: XcodeBuildMCP `test_sim` passed 30/30 tests on the configured iPhone 17 Pro simulator (`FB2F4110-E68D-4D29-8665-D6070AC3BEC3`).
- Whitespace: `git diff --cached --check` passed before the implementation commit.
- GitHub Verify: run `30924208119` passed at the pre-ledger-update head `bfbc50ecd52f4eb3a13d9575bc94ad55b83b64b4`, including checkout, Node 24 setup, `npm ci`, full `npm run check`, YAML validation, release-shell validation, and iOS app tests. The exact final PR head after this ledger update is recorded in the PR body and final handoff.

#### Self-review findings

| Severity | Found | Fixed | Remaining |
| --- | ---: | ---: | ---: |
| P0 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 |
| P2 | 2 | 2 | 0 |
| P3 | 1 | 1 | 0 |

The self-review found and fixed two bounded validation defects: the default parallel runner made one existing process-group fixture timing-sensitive in the compiled tree, and the package-content assertion incorrectly required a lockfile that npm intentionally omits from the packed root. It also corrected the initial command-result fixture to accept valid empty stderr. No introduced or exposed P0/P1/P2 issue remains; no product behavior or architecture cap was weakened.

#### Migration and rollback

- Migration performed: None; no user state, schema, pairing record, process journal, lease, artifact, or live session was changed.
- Backup location/format: Not applicable.
- Rollback procedure: revert the Phase 1 PR or run the previous source entrypoints from the prior release; no data migration is involved.
- Irreversible changes: None.

#### Residual risks

- Existing JavaScript remains canonical and the direct infrastructure/preload/oversized-file/source-text-test debt remains intentionally unchanged for later phases.
- The package archive contains emitted runtime JavaScript and deliberate source maps; source maps reference source paths that are not shipped, and no runtime loader is required.
- Local source entrypoints remain for equivalence testing, while normal package/Homebrew execution resolves `dist/`. A contributor must build before using source-checkout wrappers or `npm link`.
- Homebrew clean installation was verified through the generated formula contract and the Node 24 clean npm archive install; a public tagged release upgrade remains a later release gate.

#### Next phase

After this draft PR is reviewed and merged, create a fresh Phase 2 branch for explicit `CommandRunner`, `ProcessSupervisor`, `LockManager`, `AtomicFileStore`, `ArtifactStore`, and request-policy infrastructure ports. Do not begin Phase 2 in this turn, and do not create Checkpoint 1 materials until Phase 2 is complete.

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
