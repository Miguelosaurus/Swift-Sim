# Swift Sim Architecture Consolidation — Next Chat Handoff

**Temporary internal handoff. Delete this file and its companion prompt before the final merge/documentation cleanup.**

Last reconciled: 2026-08-05 (Europe/Madrid)

## 1. First action in the new chat

Do not assume the SHAs in this document are still the branch tips.

This conversation was branched while another long-running turn continued writing to GitHub. Therefore the first action must be:

1. Read this file and `SWIFT_SIM_ARCHITECTURE_NEXT_CHAT_PROMPT.txt`.
2. Re-fetch PR #41, its base/head SHAs, changed files, latest commits, review threads, and workflow runs.
3. Search for newer architecture-consolidation PRs/branches created after PR #41.
4. Treat live GitHub state as authoritative if it differs from this handoff.
5. Do not write until the exact target branch tip has been re-read.

Repository: `Miguelosaurus/Swift-Sim`

Current stack tip at the time this handoff was prepared:

- Draft PR: https://github.com/Miguelosaurus/Swift-Sim/pull/41
- Branch: `agent/architecture-consolidation-phase-4a-sqlite-foundation`
- Base branch: `agent/architecture-consolidation-phase-3g-explicit-boundary-installation`
- Base SHA: `7367fa2574ff8fa88499be7c8b02ece72ff11ffa`
- Latest validated implementation candidate before the handoff commit: `f1805f9be2cb63366b7c2c7783498fc155050ae0`
- Candidate Verify run: `31023121899` — all repository, package, isolated Homebrew, and release gates passed; hosted iOS was still in progress when the handoff commit was prepared
- PR remains open, draft, and unmerged.

## 2. How this work started and why ChatGPT took over

Miguel originally used **Luna**, a local Codex agent with direct access to the Mac checkout, shell, Xcode, Simulator, Homebrew, and local service state.

Luna completed the early consolidation work:

- Phase 0 guardrails and architecture inventory.
- Phase 1 TypeScript/package foundation.
- Local Mac verification for those early phases.
- The original checkpoint/phase execution discipline.

Luna usage then ran out. Miguel explicitly instructed ChatGPT to take over as the repository implementation and architecture-review agent.

ChatGPT has since performed the architecture decisions, source edits, draft-PR stacking, GitHub Actions test loop, adversarial self-review, and checkpoint documentation through Phase 3 and into Phase 4.

**Do not invoke Luna, Codex, or another coding agent during this repository pass.** Miguel is preserving that usage for the final consolidated local verification. Repository review and implementation are this agent's responsibility.

## 3. Mandatory GitHub/harness instructions

Read and follow:

- https://pastebin.com/raw/rvyEUuAW
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_MASTER_PLAN.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_INVARIANTS.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_EXECUTION_GUIDE.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_BATCHED_EXECUTION_AMENDMENT.md`
- `docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PROGRESS.md`
- relevant ADRs and checkpoint files.

Harness-specific rules:

1. Use the GitHub connector as the source of truth.
2. Local `git`/`gh` may lack network or authentication in this harness. Do not assume a local clone is available.
3. Before each write, re-fetch the exact branch head. This is especially important because branched chats or an interrupted long-running turn may still have advanced the branch.
4. For a multi-file write, prefer one Git Database API commit:
   - obtain the exact branch commit and base tree;
   - create one blob per file;
   - create one tree based on that exact tree;
   - create one commit;
   - move the branch with `force=false`;
   - if the ref moved, stop, re-read, and rebuild the commit. Never overwrite concurrent work.
5. GitHub Actions is the compile/test loop. Inspect exact job logs rather than guessing.
6. Temporary diagnostic scripts or mutating formatting commands are allowed only as non-accepting diagnostics. Remove them and rerun the full normal authoritative workflow before claiming success.
7. Record both the validated implementation SHA and any later documentation-only final PR head.
8. Keep every Phase 2+ PR draft and unmerged.
9. Do not merge, retarget, delete rollback paths, or authorize final cutover without final Luna evidence and Miguel's explicit approval.
10. Fix a defect on the earliest phase branch that introduced it, then restack affected descendants.
11. Never claim local Mac, persistent service, Simulator, iPhone, network, accessibility, or external-user evidence that was not actually run.
12. Miguel should not be asked to run commands between phases.

## 4. Active execution model

Miguel authorized the **batched execution amendment** on 2026-08-04.

The repository agent should complete as much of the ten-phase program as can be implemented and verified through:

- repository inspection;
- source and test changes;
- GitHub Actions;
- hosted macOS checks;
- installed-package and isolated Homebrew tests available in CI;
- bounded adversarial self-review;
- checkpoint reports.

Local verification is **not** performed between phases.

At the end of remotely implementable work, create:

`docs/internal/plans/LUNA_FINAL_LOCAL_VERIFICATION_HANDOFF.md`

Luna will then run one consolidated program covering the real target Mac, persistent Homebrew service, local state, migration/rollback, Xcode, Simulator, physical iPhone, signing, Tailnet/network, visual/accessibility, and release-machine scenarios.

Deferred evidence must be called `deferred`, never implied to have passed.

Scheduled checkpoints after Phases 2, 5, and 8 remain mandatory architecture records. Under the amendment they do not require Miguel to relay a review between phases, provided:

- no unresolved P0/P1 remains;
- no emergency stop condition applies;
- repository-resolvable P2s are fixed;
- local-only P2s are explicitly assigned to the final Luna handoff;
- the stack remains draft and unmerged.

## 5. Repository and stack state

### Merged into `main`

- Phase 0: PR #23, merge commit `6f356df3c1e1e91499b3d05efe4308337cc7ff6b`
- Phase 1: PR #24, merge commit `820ff2e2863e06eab908da70229c7991fd85c65c`

`main` intentionally remains at the Phase 1 merge while later work is stacked.

### Phase 2 — explicit infrastructure primitives

Draft stack PRs #26–#33, all open and unmerged.

Checkpoint 1 is complete and hosted-green.

- Code implementation tip: `d44179868fee4b62af5376b3344a40aca0b917d2`
- Final corrected checkpoint/documentation head on PR #33: `f21e344ea18eb0a976630a4ce38cf52bf30a3f47`
- Ports/adapters include command execution, process supervision, atomic files, locks, runtime journals, artifacts, origin policy, clock/IDs, and redacting logging.
- Residuals deliberately carried:
  - weak delivery identities still use the existing start-time/command-fragment model;
  - new command/process abstractions were introduced before all production call-site migration;
  - final persistent-local/device evidence remains deferred.

Checkpoint files:

- `docs/internal/plans/checkpoints/CHECKPOINT_1_STATE.md`
- `docs/internal/plans/checkpoints/NEXT_AGENT_PROMPT_CHECKPOINT_1_CURRENT_STATE.md`

### Phase 3 — helper and HTTP decomposition

Phase 3 is complete as draft PRs #34–#40, all unmerged.

| Unit | PR | Exact validated head | Verify run |
| --- | ---: | --- | ---: |
| 3A CLI dispatch | #34 | `2127a7c8542b56ad5dee9cd1abafb1db531bcfcf` | `31001814691` |
| 3B command services | #35 | `e0bbbe637cf6bb7b826490b27873d09644bee241` | `31004442265` |
| 3C request context | #36 | `1af1d6d691e5192db663d7436f9051a3c6ef6751` | `31006319086` |
| 3D HTTP handlers | #37 | `0569a0661cc5e7f65df38f2a0f838bb68272a399` | `31008626500` |
| 3E delivery maintenance | #38 | `9ccb456f9415885c1c7cc8f58c5442c949bf5a1c` | `31015053290` |
| 3F HTTP runtime | #39 | `c8f04c54ab67e881a9dc0792f9da51f0a08081a5` | `31017596449` |
| 3G explicit boundary installation | #40 | `7367fa2574ff8fa88499be7c8b02ece72ff11ffa` | `31018888258` |

Phase 3 outcome:

- bounded CLI dispatch and command-specific composition;
- typed request context and authorization decisions;
- injected public/pairing HTTP handlers;
- delivery-maintenance coordinator;
- typed HTTP server/timer runtime;
- explicit boundary installation rather than import-triggered installation;
- helper entrypoint is primarily wiring;
- compatibility behavior, routes, response contracts, persisted formats, and lifecycle behavior were preserved.

Phase 3 residuals:

- JSON-backed repositories remain the production source of truth and are the Phase 4 target;
- the HTTP preload still performs the concrete built-in replacement until Phase 5 removes monkey patches;
- stateful CLI composition still relies on `PairingStore` as the accidental shared state-root creator;
- the compact progress ledger is stale and still says Phase 3/4 were not started. Correct it in a metadata-only change when doing so will not obscure the active implementation diff.

### Phase 4A — SQLite foundation, current work

PR #41 is stacked from Phase 3G.

Current six-file implementation scope:

- `docs/internal/adr/ADR-0003-sqlite-domain-state-filesystem-runtime.md`
- `mac-helper/src/contracts/repository.ts`
- `mac-helper/src/persistence/sqliteLegacyImportCheckpointRepository.js`
- `mac-helper/src/persistence/swiftSimSqliteDatabase.js`
- `package.json`
- `test/sqliteRepositoryFoundation.test.ts`

Implemented direction:

- synchronous `DatabaseSync` from built-in Node 24 `node:sqlite`;
- one isolated SQLite connection and migration owner;
- strict schema history with contiguous versions, immutable names, and SHA-256 migration checksums;
- WAL, foreign keys, busy timeout, synchronous durability, integrity checks, and open-time fail-closed health;
- transaction commit/rollback with nested and async transactions rejected;
- typed legacy-import checkpoint repository for idempotency and shadow-comparison evidence;
- tests for migration/reopen, durable upsert, rollback, failed migration rollback, schema drift, invalid records, and WAL refusal.

Phase 4A deliberately does **not**:

- switch any production reader or writer;
- create an opaque generic domain blob table;
- dual-write JSON and SQLite;
- migrate process ownership, locks, leases, journals, or artifacts into SQLite;
- create/delete legacy user state;
- create filesystem paths implicitly;
- remove the rollback reader.

Existing JSON stores remain authoritative.

Concurrency/review note:

- During reconciliation, a concurrent long-running turn temporarily created later commits that added open-time SQLite health refusal and a WAL-refusal test (`8e36d77a...` and `d581ac96...`), then reset the branch back to `f1805f9b...`.
- Those commits are not authoritative branch history at handoff time.
- Do not cherry-pick them blindly. Re-evaluate the underlying finding during the required PR #41 adversarial review: the database owner should fail closed if required WAL/foreign-key/integrity/schema health cannot be established.

Immediate first task in the new chat:

1. Re-fetch PR #41 and determine whether the original long-running turn advanced beyond `f1805f9be2cb63366b7c2c7783498fc155050ae0`.
2. Inspect the latest exact-head workflow and review all six files.
3. Remove any remaining diagnostic-only formatting command if live GitHub still contains one.
4. Finish every P0/P1/P2 exposed by the Phase 4A diff.
5. Rerun the complete normal Verify workflow on the exact code head.
6. Update PR #41 with exact validated implementation SHA, final head, workflow run, self-review, scope, non-goals, rollback, and residuals.
7. Keep it draft and unmerged.
8. Only then stack the next bounded Phase 4 subphase.

## 6. Phase 4 design decisions and safety limits

Phase 4 should be split into reviewable subphases. Do not jump directly from the foundation to an irreversible cutover.

Recommended sequence:

1. **4A foundation** — connection owner, migration fencing, health, typed repository contracts, import checkpoint evidence.
2. **4B typed domain schema/repositories** — model real existing records exactly; no generic blob table.
3. **4C legacy backup/import/resume** — validate and back up JSON, deterministic projections/hashes, idempotent transactional import, interruption recovery.
4. **4D shadow reads/comparison** — JSON remains authoritative; compare normalized projections and record durable mismatch evidence.
5. **4E staged write cutover** — one clearly selected writer, rollback window, legacy reader retained, no permanent dual-write architecture.
6. **4F doctor/export/recovery and cleanup reconciliation** — health diagnostics, redacted export, orphan-artifact reconciliation, busy/corruption/failed-migration tests.
7. Finish Phase 4 remote review and carry local migration/rollback evidence into the final Luna handoff.

Do not:

- delete or rewrite a user's legacy JSON during draft-stack work;
- migrate kernel/process authority into SQLite;
- make SQLite authorize termination;
- permanently dual-write;
- accept a migration that is non-contiguous, checksum-drifting, partially committed, or not resumable;
- continue if rollback cannot preserve old data;
- let corruption, unavailable WAL, disabled foreign keys, or failed integrity checks fall open;
- introduce a native SQLite addon without a new ADR and clean package/Homebrew proof.

## 7. Non-negotiable product and security invariants

Preserve all invariants in the plan. Especially:

- Mac source, signing credentials, paths, and build artifacts stay local.
- Full helper remains localhost-only by default.
- Temporary public gateway never gains pairing, app-library mutation, build creation, Simulator control, or live-patch capabilities.
- Hot reload remains Debug-only and private-Tailnet-only.
- Conservative signed rebuild is preferable to a false hot-safe classification.
- Install success requires exact device verification.
- Process termination requires exact verified ownership.
- Runtime process journals/leases/lock records remain outside SQLite.
- Existing route paths, authorization boundaries, public/private projections, persisted formats, and normal workflow remain compatible.
- Never weaken a test or fail-closed behavior merely to make CI green.

Stop the program and return a blocker if:

- data migration cannot be resumable and rollback-safe;
- a private capability becomes public;
- a process can be signaled without exact ownership;
- irreversible state deletion would be required before final Luna verification;
- the branch stack no longer has a clear rollback boundary;
- an unresolved P0/P1 remains;
- the approved architecture is no longer defensible based on repository evidence.

## 8. Review and validation discipline

For every subphase:

1. Keep scope bounded.
2. Add behavior tests at stable seams, not new source-text assertions.
3. Run architecture, types, formatting, lint, source tests, compiled tests, hermetic/package tests, isolated Homebrew, release/YAML/shell checks, and hosted iOS when applicable.
4. Inspect the actual diff independently after CI.
5. Fix all repository-resolvable P0/P1/P2 findings.
6. Record exact implementation SHA and workflow.
7. Leave the PR draft and unmerged.
8. Stack the next branch from the exact reviewed head.
9. Keep rollback/non-goal language explicit.
10. Do not ask Miguel for local verification between phases.

## 9. Final Luna and merge rules

After all remotely implementable phases:

- freeze every branch and head;
- create `docs/internal/plans/LUNA_FINAL_LOCAL_VERIFICATION_HANDOFF.md`;
- Luna performs the consolidated local verification;
- corrections go to the earliest owning branch and are propagated downstream;
- rerun affected GitHub workflows;
- obtain Miguel's explicit final merge authorization;
- merge sequentially in stack order;
- run post-merge release/compatibility smoke checks.

No later PR may merge before its predecessor.

## 10. Temporary handoff cleanup

These two handoff files are for chat continuity only:

- `docs/internal/handoffs/SWIFT_SIM_ARCHITECTURE_NEXT_CHAT_HANDOFF.md`
- `docs/internal/handoffs/SWIFT_SIM_ARCHITECTURE_NEXT_CHAT_PROMPT.txt`

They must be deleted before the final merge/documentation cleanup. Durable decisions belong in ADRs, checkpoint records, the progress ledger, and the final Luna handoff—not in chat handoff files.
