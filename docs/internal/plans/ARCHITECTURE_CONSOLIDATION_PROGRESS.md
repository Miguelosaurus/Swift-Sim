# Architecture Consolidation Progress

This file is the compact execution ledger for the architecture program. It is not a substitute for pull-request descriptions or durable ADRs.

## Program status

| Phase | Scope | Status | PR | Base | Head | Key residual |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Baseline and guardrails | Not started | — | — | — | — |
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
| Production JavaScript files | TBD | TBD | 0 canonical JS files after migration, excluding intentional wrappers |
| Production TypeScript files | TBD | TBD | Canonical Node implementation |
| Production Swift files | TBD | TBD | Feature-organized |
| Preload modules | TBD | TBD | 0 |
| Built-in monkey patches | TBD | TBD | 0 |
| Source-text implementation tests | TBD | TBD | 0 |
| Direct `child_process` production importers | TBD | TBD | Approved infrastructure only |
| Direct destructive filesystem production importers | TBD | TBD | Approved stores only |
| Largest Node production file | TBD | TBD | <= 800 lines or ADR |
| Largest Swift production file | TBD | TBD | <= 800 lines or ADR |
| Domain JSON stores | TBD | TBD | 0 writable stores after migration window |
| Node minimum version | TBD | TBD | Supported pinned LTS |

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
| TBD | TypeScript build and runtime model | Planned |
| TBD | Explicit process and filesystem infrastructure ports | Planned |
| TBD | SQLite domain state / filesystem runtime journal split | Planned |
| TBD | SwiftSyntax analyzer boundary | Planned |
| TBD | Companion feature-state architecture | Planned |

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