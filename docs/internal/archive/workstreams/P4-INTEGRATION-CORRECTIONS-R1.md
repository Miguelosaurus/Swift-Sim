# P4-INTEGRATION-CORRECTIONS-R1

Status: **READY**  
Class: **implementation / bounded integration correction**  
Phase: **4**

## Exact parent

Implement only against audited serialized Phase-4 product head:

`eaa44b0f74e3bbea2dadbfe0b03db44cdd8fba66`

Independent audit input:

- PR #148
- audit head `27902f55910ba06bb65bb7074c62553379f8f1d5`
- `docs/internal/reviews/ARCHITECTURE_PHASE4_INTEGRATION_AUDIT.md`
- audit Verify #1086 / run `31802966567` — PASS

Do not substitute the older `82e0f998...` integration candidate or implement from the audit-doc branch.

## Goal

Close the independent audit's two repository blockers before any Phase-4 authority/cutover decision:

1. P1 — make the existing Phase-4 database/migration/shadow/compatibility/recovery diagnostics operator-reachable through the normal product support surface.
2. P2 — add behavior-level regression coverage for the real `swift-sim pair` command path after the demonstrated full-gate miss.

This workstream does **not** switch authority, delete legacy state, expire rollback windows, add permanent dual writes, or begin Phase 5.

## P1 — operator-facing Phase-4 diagnostics

Reuse the accepted P4-DIAGNOSTICS model. `collectPhase4SupportDiagnostics` and its existing projections/recovery vocabulary remain the sole Phase-4 support-field semantics.

Compose the existing read-only/redacted/mutation-disabled support collector into the normal operator-facing CLI/support path, preferably `swift-sim doctor --json` plus the existing human doctor rendering where appropriate. A separate explicit support/export command is acceptable only if it is genuinely operator-reachable, documented, and does not create a competing schema.

The resulting operator surface must represent the original Phase-4 support requirements:

- shared SQLite/database health and latest-schema compatibility;
- migration/checkpoint health;
- shadow health;
- compatibility/authority health;
- private state-root/database permissions/ownership health;
- artifact/orphan audit health using the already accepted artifact diagnostic projection;
- corruption/busy/incompatible/permission failure classification;
- actionable authority-preserving recovery guidance;
- redacted/path-safe support evidence.

The diagnostic path must remain read-only:

- `readOnly: true`
- `redacted: true`
- `mutationAllowed: false`
- no cleanup execution
- no authority change
- no import/cutover side effect merely because doctor/support is invoked
- no legacy deletion
- no process termination

Do not instantiate a normal store or runtime if doing so can drain cleanup jobs or mutate state. Reuse caller-owned read-only probes or add the smallest bounded read-only probe/composer needed.

Preserve the existing artifact-audit safety property that `swift-sim doctor` does not trigger destructive maintenance.

## P1 behavior coverage

Add behavior-level CLI characterization, not module-only projection tests.

At minimum cover operator-facing output for:

- healthy/latest schema;
- corruption or unreadable database -> fail-closed diagnostic classification plus actionable recovery guidance, while legacy authority remains untouched;
- incompatible/newer schema;
- private-state permission problem;
- busy/unavailable database;
- artifact/orphan support information;
- redaction/path safety;
- proof that invoking the support path does not mutate JSON, SQLite, cleanup jobs, authority state, or artifacts in disposable fixtures.

Use deterministic disposable state. Do not mutate a real user's `~/.swift-sim` in repository tests.

## P2 — real `pair` command regression

Add a focused behavior-level regression that executes the actual packaged/CLI `pair` path in `mac-helper/bin/swift-sim.js` with controlled helper/network dependencies.

The test must be capable of detecting the previously observed defect class: an undeclared doctor-only variable or equivalent runtime-scope failure inside `pair()`.

It should prove the command reaches its normal setup-status/pair request behavior under a successful controlled setup, rather than only parsing source text.

Prefer the same entrypoint/package surface exercised by users where practical. Do not change pairing authority or protocol semantics merely to make the test easier.

## Authority and schema constraints

This correction must preserve the audited product posture:

- shared SQLite schema remains v1-v8; do not add v9 here;
- v1-v7 migration identity remains unchanged;
- `session_records` remains exactly the frozen six durable columns;
- production shared-state openers continue using the complete v1-v8 history;
- pairing/device-build/session legacy JSON/filesystem authority remains active;
- no SQLite reader cutover;
- no permanent dual write;
- no rollback-reader removal or rollback-window expiry;
- no SQLite-derived PID/process/termination authority;
- no automatic historical/orphan/manual-review artifact cleanup.

If operator diagnostics cannot be wired without violating one of those constraints, stop and report the conflict.

## Verification

Run focused tests after each meaningful correction, then the full exact-head gate:

- new operator-diagnostic CLI behavior tests;
- existing `phase4SupportDiagnostics` tests;
- existing doctor/artifact audit tests;
- new real `pair` behavior regression;
- existing CLI/setup/status/pair-adjacent tests;
- Phase-4 integration/schema/session/device/artifact regressions;
- architecture check;
- strict types;
- format/lint;
- full `npm run check`;
- exact-head hosted Verify including clean Homebrew/service, YAML/shell, and iOS.

Persistent real-Mac evidence is a separate parallel/post-correction gate. Do not claim it from repository fixtures.

## Deliverables

Open a draft PR against:

`agent/arch-ws-P4-INTEGRATION-serialized-phase4`

Return:

- exact final SHA;
- exact changed paths;
- how the existing P4 diagnostic collector is made operator-reachable;
- exact read-only/no-mutation proof;
- exact permissions/corruption/recovery behavior exposed;
- exact `pair` behavior regression and why it would fail on the prior stray `includeStorage` defect;
- full exact-head Verify result;
- explicit confirmation that authority/schema/rollback/artifact-cleanup constraints remain unchanged;
- remaining persistent-Mac evidence blockers.

Keep the PR draft and unmerged. Do not edit canonical roadmap/registry/progress/current handoff in this worker.