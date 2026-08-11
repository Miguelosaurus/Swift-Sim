# Architecture Consolidation — Current Agent Handoff

Date prepared: 2026-08-11

This is the canonical handoff for the next repository agent. It is intentionally operational: read the repository's master documents before changing code, then use this file to identify the exact current cut-off. It does not replace Git history, PR bodies, tests, ADRs, or the architecture plans.

## 1. Read first

Read these before any write, in this order:

1. `docs/internal/README.md`
2. `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md`
3. `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_INVARIANTS.md`
4. `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_EXECUTION_GUIDE.md`
5. `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_BATCHED_EXECUTION_AMENDMENT.md`
6. `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_CHECKPOINT_PROTOCOL.md`
7. `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PROGRESS.md`
8. `docs/internal/adr/ADR-0003-sqlite-domain-state-filesystem-runtime.md`
9. this handoff and `NEXT_AGENT_PROMPT_ARCHITECTURE_CONSOLIDATION_CURRENT.md`

If operating through the ChatGPT GitHub connector, also read and obey Miguel's publication rules at `https://pastebin.com/raw/rvyEUuAW`: preserve exact validated history, use exact ref guards and non-force fast-forwards, and publish multi-file changes atomically rather than as partially visible sequential writes.

## 2. Non-negotiable rules

- Do not merge any Phase 2+ architecture PR. They remain draft/unmerged until final Luna local/device verification and Miguel explicitly authorizes merge.
- Do not force-push, rebase away, squash away, or rewrite validated history just to make the stack look cleaner.
- Do not switch production domain authority to SQLite, execute destructive migration/rollback against user state, or remove compatibility preloads merely because supporting code exists.
- Do not begin Phase 5 until the complete Phase 4 gate is genuinely satisfied.
- Preserve public/private route contracts, fail-closed authorization, persisted projections, process-identity fencing, crash-recovery semantics, and filesystem/runtime authority boundaries.
- Hosted clean Homebrew and Simulator evidence is real, but it does not substitute for the persistent-local Mac, physical-device, network/signing, sleep/wake, and release-candidate evidence assigned to Luna/final validation.
- When the architecture guard exposes stale debt, shrink the mutable cap only; never rewrite the immutable baseline to make a candidate pass.
- Keep storage migration, process ownership, preload removal, and user-visible changes in separate bounded slices.

## 3. Phase 3 is complete at the implementation gate

Immutable final Phase 3 runtime/product head:

`07a8295f0221f1f2007cb1f01c99a5998f371f8a`

Product tree:

`c025296d0a458809809b948e16d47ffa6f8c82fd`

Final corrective PR: #93, `agent/architecture-consolidation-phase-3v-helper-presentation`.

Evidence:

- natural Verify #865 / run `31444358586`: full Node/package, architecture/types/format/lint, isolated clean Homebrew, YAML/shell, and iOS Simulator gates passed;
- exact-head closure audit `31444581201`: 88/88 focused Phase 3 contracts plus import-inert composition, atomic lifecycle authorization/recovery, complete route authorization matrix, public-delivery 404 isolation, raw route-authority audit, entrypoint-composition audit, architecture, strict types, and diff hygiene;
- `mac-helper/bin/swift-sim-helper.js` is 354 lines on the exact clean tree and is primarily composition/wiring.

Phase 3 remains draft/unmerged. Do not reopen it without a concrete regression.

## 4. Phase 4 ancestry and validated work

The historical pairing/SQLite tranche through E4 is already in the final Phase 3 ancestry. E4 final documentation head:

`b1fac0df3360fdc68ca76d910e467b8a1f4944d7`

is a direct ancestor of the final Phase 3 head. Do not replay, rebase, or re-port Phase 4A–E4.

Validated pairing foundation remains:

- #41 SQLite foundation;
- #44 pairing SQLite repositories;
- #45 pairing import/resume;
- #46 pairing shadow comparison;
- #47 pairing shadow observer;
- #48/#50/#49 pairing authority-state / locked legacy snapshot / authority selector;
- #52/#53 cutover preparation/coordinator;
- #54 pairing rollback export.

Those pieces remain non-authoritative in production.

### Device-build Phase 4 continuation

Phase 4F / PR #95 is hosted-green at final corrective head:

`bc55ccdf1af7f9f18c9757ffbefaef63944b7f70`

Natural corrective Verify #872 / run `31479976397` passed end to end. It adds the typed device-build SQLite shadow repository and migration v6 with atomic whole-snapshot replacement. `device-builds.json` remains production authority.

Phase 4G / PR #96 is hosted-green at:

`e8508440459d2f649432e4ce3c02ae84d1997b3a`

Verify #873 / run `31481810512` passed end to end. It adds the locked, read-only legacy device-build snapshot/backup/normalization boundary and explicitly defers production lock composition.

PR #97 is the docs-only F/G ledger at:

`026672a1667183e3b70eed5af5a0ebe69c8c6058`

Verify #874 / run `31482632870` passed end to end.

Phase 4H / PR #98 is the **last fully hosted-green product continuation known at handoff time**:

`6ba637f968e424538b719081d7564f1690251df0`

Product tree:

`d6c27ef13e221492d606ad53bc8fd91ab63d7b7f`

Verify #875 / run `31484093720` passed end to end. It adds the resumable device-build legacy-import coordinator/applier, keeps import/checkpoint work inside the source lock, and preserves JSON as the sole production authority. Production startup does not call this importer.

### Phase 4I is active and must be re-resolved before stacking

PR #99, `agent/architecture-consolidation-phase-4i-device-build-shadow-comparison`, was opened from exact Phase 4H.

At handoff preparation its initial implementation head was:

`954e5b98b040d290c60f509e1c5e82d92edbc999`

Verify #876 / run `31501261237` failed during `npm run check` only because Prettier rejected `test/deviceBuildShadowComparison.test.ts`. Before that failure, syntax, architecture, docs, and strict TypeScript had passed.

**Do not treat `954e5b98…` as validated.** Before any new Phase 4 branch or write:

1. resolve PR #99's live head;
2. inspect its latest Verify/jobs;
3. if PR #99 has advanced to a fully hosted-green corrective head, use that exact head as the product continuation base;
4. if it has not, coordinate with/fix the existing PR rather than creating a competing shadow-comparison implementation.

This handoff branch is documentation-only and intentionally does not race PR #99.

## 5. What remains in Phase 4

The Phase 4 gate is not met. Even if PR #99 becomes green, remaining work still includes:

- a best-effort device-build shadow observer at an existing authoritative JSON read seam, with SQLite/comparison/reporting failure fully contained and no decision authority;
- a production-compatible legacy device-build lock identity provider matching the existing `/bin/ps ... lstart` `startedAt` representation before live migration reads are allowed;
- staged device-build composition and shadow evidence before any authority switch;
- fenced single-writer authority cutover with an explicit read-only legacy rollback window; never permanent dual writable truth;
- session-domain normalized repositories, import/resume, shadow comparison/observation, and later authority work;
- any other transactional domain-state repositories identified by ADR-0003 and the live writable-state inventory;
- `swift-sim doctor` schema/migration/permission/integrity/orphan checks;
- redacted export/diagnostic support and actionable corruption recovery guidance;
- migration idempotency/interruption, repeat-import no-duplicate, transactional mutation, and rollback-readability evidence;
- clean Homebrew **upgrade from the previous tagged release**, not merely clean install;
- the final Phase 4 repository gate audit before Phase 5 begins.

Production SQLite authority, rollback, and Phase 5 preload removal remain unauthorized.

## 6. Recommended next-agent sequence

Start by reconciling live state, not by assuming this file's last SHA is still current:

1. resolve PR #99 and its latest head/Verify;
2. inspect `ARCHITECTURE_CONSOLIDATION_PROGRESS.md` on the latest validated ancestry and update it if PR #99 has been corrected after this handoff;
3. complete the device-build shadow-observation stage without changing production authority;
4. separately solve/prove exact legacy build-lock identity compatibility before wiring any live legacy migration read;
5. gather shadow evidence and only then design a bounded device-build production-composition/cutover slice;
6. inventory and plan the remaining session/other transactional domains under ADR-0003;
7. continue through bounded Phase 4 slices, keeping the progress ledger and this handoff current.

Do not jump directly from a green comparator to SQLite authority. The migration path is intentionally repository → locked source → resumable import → comparison → observer/shadow evidence → composition → authority cutover/rollback.

## 7. Tooling/publication lessons

- This ChatGPT GitHub harness may not have a usable local clone for canonical publication. Previous work used temporary GitHub Actions oracles for Node 24/full gates and moved product refs only after exact source/target guards.
- The history-aware architecture inventory rejects misleading push-event metadata such as `push.before == checked HEAD`. If a temporary workflow checks out a different exact product SHA, isolate/unset GitHub event metadata before invoking the architecture gate; do not weaken the guard.
- API/GITHUB_TOKEN-authored commits can yield `action_required` with no jobs. Same-tree natural verification commits are acceptable when needed; never call a run green unless jobs actually ran and completed successfully.
- Avoid incidental formatting of legacy files outside the formatter surface. Correct accidental churn with an ordinary child commit rather than rewriting validated history.

## 8. End-of-session discipline

Before handing off again:

- update both the top Program status table and detailed current phase section;
- record exact base/head, PR, Verify run, product tree when relevant, changed-file scope, rollback state, and residual gate;
- update this current handoff and the current next-agent prompt;
- keep temporary oracle/publisher branches out of product ancestry;
- leave draft/unmerged state and final Luna/Miguel authorization requirements explicit.
