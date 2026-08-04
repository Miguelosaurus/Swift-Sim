# Architecture Consolidation Mandatory Checkpoint Protocol

Status: mandatory execution control

This protocol amends the architecture consolidation master plan. It is not optional guidance. The executing agent must stop at all three checkpoints and may not merge the checkpoint phase, begin the next phase, or make preparatory production changes for the next phase until Miguel returns a written architecture-review response.

The purpose is to keep a long refactor aligned with the intended architecture rather than allowing locally reasonable implementation choices to accumulate into a new overgrown design.

## 1. Authority and stop rule

At each checkpoint, the executing agent must:

1. finish the checkpoint phase or final sub-PR;
2. run every required automated validation available;
3. perform its own bounded self-review and fix introduced P0/P1/P2 findings;
4. leave the checkpoint PR open and draft;
5. create and commit the required checkpoint state report and review prompt;
6. return the exact prompt to Miguel;
7. stop all implementation work;
8. wait for Miguel to return the architecture review from the reviewing ChatGPT conversation;
9. apply the review or explicitly resolve disagreements in the checkpoint PR;
10. receive explicit approval from Miguel before merging or beginning the next phase.

The executing agent must not substitute:

- its own additional review;
- another automated reviewer;
- passing CI;
- an assumption that no response means approval;
- a shortened summary that omits uncomfortable residuals.

If the checkpoint phase was split across several PRs, the checkpoint occurs on the final PR that makes the checkpoint claims true. Earlier mechanical sub-PRs may merge only when they do not cross the checkpoint's irreversible boundary.

## 2. Checkpoint schedule

### Checkpoint 1 — Typed foundation and explicit infrastructure

Trigger: Phase 2 is implementation-complete and validated, before the final Phase 2 PR is merged and before Phase 3 begins.

Review focus:

- TypeScript build/package design;
- canonical source versus compiled output;
- Node version decision;
- quality and scope of runtime validators;
- infrastructure interface boundaries;
- whether dependency injection is proportionate rather than framework-shaped;
- whether preloads truly delegate to explicit implementations;
- behavioral equivalence of process deadlines, group cleanup, ownership verification, lock reclamation, redaction, containment, and request-origin handling;
- whether abstractions are being designed around current monkey patches instead of the real domain.

Mandatory runtime prompt path:

```text
docs/internal/plans/checkpoints/NEXT_AGENT_PROMPT_CHECKPOINT_1_CURRENT_STATE.md
```

The agent must create this file from the tailored template in `checkpoints/CHECKPOINT_1_TEMPLATE.md` using actual branch, PR, SHA, metrics, test results, and unresolved questions.

### Checkpoint 2 — Domain-state migration and hidden-runtime removal

Trigger: Phase 5 is implementation-complete and validated, before the final Phase 5 PR is merged and before Phase 6 begins.

Review focus:

- SQLite schema and repository boundaries;
- legacy JSON import, backup, idempotency, shadow comparison, cutover, rollback, and corruption recovery;
- whether runtime journals and leases were correctly kept outside the database;
- whether SQLite is being misused as process-ownership proof;
- whether every previous preload guarantee now has a visible call-site owner;
- absence of built-in/prototype monkey patches and import-order safety behavior;
- packaged/raw entrypoint equivalence;
- lifecycle, capability, artifact-containment, and public/private route regressions;
- compatibility code that has no deletion condition;
- whether the migration increased operational complexity rather than reducing it.

Mandatory runtime prompt path:

```text
docs/internal/plans/checkpoints/NEXT_AGENT_PROMPT_CHECKPOINT_2_CURRENT_STATE.md
```

The agent must create this file from `checkpoints/CHECKPOINT_2_TEMPLATE.md` using the real migration state and exact residuals.

### Checkpoint 3 — Live architecture and companion decomposition

Trigger: Phase 8 is implementation-complete and validated, before the final Phase 8 PR is merged and before Phase 9 begins.

Review focus:

- separation of classification, Xcode discovery, engine lifecycle, patch compilation/loading, proof, recovery, and signed-build fallback;
- SwiftSyntax/SwiftParser analyzer protocol, packaging, versioning, timeouts, output bounds, unsupported behavior, and fail-closed routing;
- differential results versus the legacy analyzer and any newly permissive cases;
- physical-device evidence and failures retained in the evidence set;
- temporary legacy analyzer role and deletion criteria;
- iOS feature-model, API-client, repository, coordinator, actor-isolation, cancellation, and revision-fencing boundaries;
- whether `SessionStore` and `ContentView` were genuinely decomposed or merely redistributed into many coupled files;
- API contract duplication between Swift and TypeScript;
- remaining source-text tests, large files, review artifacts, package/versioning debt, and release blockers.

Mandatory runtime prompt path:

```text
docs/internal/plans/checkpoints/NEXT_AGENT_PROMPT_CHECKPOINT_3_CURRENT_STATE.md
```

The agent must create this file from `checkpoints/CHECKPOINT_3_TEMPLATE.md` with actual differential and companion metrics.

## 3. Required checkpoint state report

At every checkpoint, update `ARCHITECTURE_CONSOLIDATION_PROGRESS.md` and create:

```text
docs/internal/plans/checkpoints/CHECKPOINT_<N>_STATE.md
```

The state report must include:

- checkpoint number and trigger;
- repository, PR number/link, branch, base SHA, head SHA;
- all phase PRs merged since the prior checkpoint;
- changed production modules grouped by responsibility;
- architecture before/after diagram;
- current baseline metrics and deltas;
- exact remaining compatibility shims with deletion conditions;
- data migration state and rollback window;
- runtime/process-ownership state;
- public/private capability matrix changes;
- test commands and exact results;
- hardware/manual evidence and what remains unproven;
- self-review severity table;
- known regressions, flaky tests, deferred failures, and unexplained behavior;
- deviations from the master plan and why;
- decisions made by the executing agent that need architectural confirmation;
- at least three plausible risks the current implementation may have missed;
- recommended next step;
- explicit declaration that implementation has stopped.

Do not report only successful checks. Preserve failed valid attempts, migration mismatches, analyzer disagreements, flaky behavior, and external gates.

## 4. Required review prompt format

The runtime `NEXT_AGENT_PROMPT_CHECKPOINT_<N>_CURRENT_STATE.md` must be directly pasteable into Miguel's reviewing ChatGPT conversation. It must instruct the reviewer to use GitHub and inspect the actual repository/PR rather than trusting the report.

It must contain these sections:

1. **Review target** — repository, PR, branch, base/head, checkpoint.
2. **Required files to read** — master plan, invariants, execution guide, checkpoint protocol, state report, progress ledger, ADRs, and relevant implementation modules.
3. **What changed** — concise factual summary.
4. **Evidence** — exact validation and hardware results.
5. **Current metrics** — debt reduction and size/coupling indicators.
6. **Deviations and residuals** — complete list.
7. **Decisions/questions** — concrete choices requiring the architecture reviewer.
8. **Requested review output** — findings ranked P0/P1/P2/P3, architecture verdict, required corrections, approved/rejected decisions, and exact authorization for the next phase.
9. **Stop declaration** — the executing agent has stopped and will not continue until Miguel returns the review.

Questions must be concrete. Do not ask vague questions such as “Does this look good?” Prefer:

- “Should the SQLite cutover remain dual-read for one tagged release or move to read-only legacy fallback immediately after import?”
- “Does `ProcessSupervisor` own command execution too, or should `CommandRunner` remain a separate port?”
- “Is this analyzer disagreement safe to classify as live, or must it remain rebuild-only?”

When the agent has no unresolved decision, it must still ask the reviewer to search for architectural drift, accidental coupling, missing invariants, and premature deletion.

## 5. Approval response handling

When Miguel returns the architecture review, the executing agent must:

- record the review date and a concise decision log in the checkpoint state report;
- create a checklist mapping every P0/P1/P2 and required correction to a commit or explanation;
- fix all required corrections before requesting approval again;
- keep rejected decisions rejected unless new evidence is presented;
- update ADRs when the reviewer changes or clarifies a settled architecture choice;
- rerun affected validation;
- update the runtime checkpoint prompt if material state changed after fixes;
- stop again if a second review is requested.

P3 findings may remain only with explicit residual documentation and a concrete later phase or issue.

## 6. Merge and continuation authorization

The checkpoint PR may merge only after the progress ledger records:

```text
Checkpoint <N> review received: yes
Required corrections complete: yes
Miguel continuation approval: yes
Authorized next phase: Phase <X>
Approval evidence: <date and concise quoted/paraphrased instruction>
```

The next phase prompt must cite that authorization. Without it, the next phase is blocked.

## 7. Emergency stop conditions outside scheduled checkpoints

The executing agent must create an early checkpoint and stop before a scheduled gate if any of these occur:

- a nontrivial invariant cannot be preserved with the planned architecture;
- a migration requires irreversible deletion earlier than planned;
- a new native dependency materially changes release or Homebrew behavior;
- process ownership cannot be proven without reintroducing hidden global interception;
- the Swift analyzer is more permissive than the legacy classifier without physical proof;
- the companion refactor requires a user-visible redesign to remain maintainable;
- a phase exceeds two major architecture deviations;
- validation exposes a data-loss, authorization, process-kill, signing, or public-route regression;
- the agent believes the master plan's chosen architecture is no longer the best option.

An early checkpoint does not replace the next scheduled checkpoint unless Miguel explicitly says so.
