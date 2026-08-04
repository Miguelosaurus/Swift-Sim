# Checkpoint 2 Template — Domain State and Hidden Runtime Removal

Use this template only after Phase 5 is complete, fully validated, self-reviewed, and still unmerged.

Create `NEXT_AGENT_PROMPT_CHECKPOINT_2_CURRENT_STATE.md` beside this file. Replace every placeholder with current facts. Delete all instructional comments before presenting it to Miguel.

---

Use the GitHub plugin to perform an independent architecture, migration-safety, and lifecycle review of the actual Swift Sim repository and PR. Do not rely only on this summary.

## Review target

- Repository: `Miguelosaurus/Swift-Sim`
- Checkpoint: 2 — domain-state migration and hidden-runtime removal
- PR: `<number and URL>`
- Branch: `<branch>`
- Base SHA: `<sha>`
- Head SHA: `<sha>`
- State report: `docs/internal/plans/checkpoints/CHECKPOINT_2_STATE.md`

The implementation agent has stopped. Do not authorize Phase 6 until you have inspected the repository and returned a written decision.

## Required reading

Read these completely:

- the architecture master plan, invariants, execution guide, checkpoint protocol, and progress ledger;
- `docs/internal/plans/checkpoints/CHECKPOINT_2_STATE.md`;
- all persistence, migration, rollback, repository, process-journal, lock, composition-root, entrypoint, and compatibility-shim ADRs;
- SQLite schema/migrations and legacy import code;
- domain repository interfaces and implementations;
- process ownership journals and runtime lease stores;
- all former preload replacements and remaining compatibility files;
- packaged and raw entrypoints;
- public/private HTTP capability tests;
- upgrade, rollback, corruption, and interrupted-migration tests.

## What changed

<Concise factual Phase 3–5 summary, including cutover order and what was deleted.>

## Evidence

<Exact CI/local/package/Homebrew/migration/process tests, fault injection, old-version upgrade tests, and any hardware/manual evidence or missing gates.>

## Current metrics

<SQLite/JSON writable sources, migration versions, remaining preload or monkey-patch count, direct infrastructure call sites, compatibility shims, largest files, source-text tests, test counts, and deltas from Checkpoint 1.>

## Migration and rollback state

State explicitly:

- legacy versions tested;
- backup location and permissions;
- import idempotency proof;
- interrupted-import behavior;
- shadow comparison results and mismatches;
- authoritative writer/read source at this head;
- rollback window and exact rollback procedure;
- corruption and database-busy behavior;
- duplicate prevention;
- whether rollback has been executed in a real test rather than merely described.

## Deviations and residuals

<Every deviation, compatibility path, retained JSON write, hidden global behavior, unresolved ownership case, migration mismatch, operational caveat, and deletion deferred beyond Phase 5.>

## Decisions and questions

Ask concrete questions about actual implementation choices, including at minimum:

1. Is the domain/process-state split correct, or did domain records leak back into filesystem journals or process authority leak into SQLite?
2. Is there exactly one writable domain source of truth after cutover?
3. Is the legacy import and rollback window safe enough for a tagged release?
4. Did explicit infrastructure call sites preserve every old safety property without rebuilding a second hidden framework?
5. Are any compatibility shims permanent in practice because their deletion condition is vague or untested?
6. Are public gateway and paired/local capability boundaries unchanged under the new router/repository architecture?
7. Should any Phase 5 deletion be reversed until another release or hardware proof?

Add any state-specific questions.

## Requested output

Return:

- architecture and migration-safety verdicts;
- P0/P1/P2/P3 findings with exact files and reasoning;
- required corrections before merge;
- approved/rejected persistence and lifecycle decisions;
- any compatibility path that must remain temporarily;
- any path that should be deleted now;
- missing rollback, corruption, upgrade, authorization, or process-ownership evidence;
- whether Checkpoint 2 passes;
- one exact continuation decision:
  - `AUTHORIZED: merge the corrected Phase 5 PR and begin Phase 6`
  - `NOT AUTHORIZED: correct and resubmit Checkpoint 2`
  - `ROLLBACK REQUIRED: restore the prior durable path and replan`
  - `REPLAN REQUIRED: stop and revise the architecture program`

## Stop declaration

Implementation is stopped. The final Phase 5 PR remains draft and unmerged. No Phase 6 production work will begin until Miguel returns your review and explicit continuation approval.

---
