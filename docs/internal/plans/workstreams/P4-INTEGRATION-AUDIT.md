# P4-INTEGRATION-AUDIT

Status: **READY**  
Class: **independent architecture / integration audit**  
Phase: **4**

## Exact audit product

Audit the serialized Phase-4 integration product at exactly:

`eaa44b0f74e3bbea2dadbfe0b03db44cdd8fba66`

This is PR #147 after the orchestrator's pre-audit whole-tree correction to the inherited `swift-sim pair` scope leak. Exact-head Verify #1084 / run `31799660233` passed full repository checks, clean Homebrew/service, workflow/shell validation, and iOS.

Do not substitute an earlier PR #147 head such as `82e0f998...`.

## Role

You are an independent auditor, not the integration implementation worker. Do not fix product code. Produce findings and exact orchestrator actions.

Read the full active architecture control plane, master plan Phase 4, invariants, ADR-0003, Wave 1 and Wave 2 audits/reviews/registry, P4-INTEGRATION contract, PR #147 handoff, and the actual integrated tree/diff/history.

## Required audit questions

### Whole-tree behavior and ancestry

- Verify every reviewed feeder head appears in the integration ancestry with the intended semantic ordering and no stale/sibling substitution.
- Review the whole affected product surface, not only PR #147's original changed-file list. The pre-audit review already found one inherited CLI defect outside that list; look adversarially for more.
- Confirm the corrected `swift-sim pair` path no longer references doctor-only `includeStorage`, and assess whether a behavior-level regression test is now required because the full gate previously failed to detect this live CLI defect.

### Shared SQLite history and authority

- Confirm v1-v7 migration names/statements/checksums/order were not rewritten and v8 is the only appended durable-session migration.
- Confirm every current production opener of shared `~/.swift-sim/state.sqlite` uses the complete v1-v8 Phase-4 list. Identify any hidden/indirect opener still using a shorter prefix.
- Confirm v7 -> v8 upgrade/reopen behavior and newer-version rejection semantics remain coherent.
- Confirm legacy JSON remains the production authority where PR #147 claims it does; no permanent dual write or implicit reader/writer cutover is allowed.
- Confirm no SQLite row can authorize process termination/runtime ownership.

### Durable session boundary

- Confirm `session_records` is exactly six durable columns: id, token, project, scheme, simulator_udid, created_at.
- Confirm mixed legacy records are projected through the frozen durable-session boundary before persistence/comparison.
- Confirm runtime/process fields cannot enter persisted rows through alternate integration paths.
- Confirm each durable field individually causes a shadow mismatch and runtime-only churn does not.
- Confirm locked session snapshot/import uses exact Darwin `/bin/ps -p <pid> -o lstart=` start-token identity; PID alone is insufficient.
- Confirm lock lifetime covers snapshot/backup/import/checkpoint ordering safely.
- Confirm staged session observation is fail-open only in the intended shadow sense and cannot silently affect product session authority.

### Device migration / upgrade / rollback

- Confirm #139 remains the provider vocabulary and #142 is only a consumer.
- Confirm compatibility reads remain legacy-authoritative at this stage.
- Confirm export/restart/idempotency/rollback-readability semantics survive combined integration.
- Identify any combined-tree path that can accidentally select SQLite before the explicit future cutover decision.

### Artifact maintenance

- Confirm #140 apply freshness checks remain intact in the combined tree and current authoritative state is re-read immediately before an executable action.
- Confirm the integration executor uses the proven contained `NodeArtifactStore` boundary and no raw recursive deletion path was introduced.
- Confirm historical cleanup is explicit operator action only; no startup/background cleanup and no automatic orphan/manual-review reclamation.
- Confirm #143's regression semantics are retained and root-package registration is now genuinely integration-owned.

### Diagnostics and Phase-4 gate completeness

The integrated tree contains the P4-DIAGNOSTICS support collector, which is path-free/read-only/redacted/mutation-disabled. However, the current normal `swift-sim doctor` composition visibly exposes the artifact audit section while the broader database/migration/shadow/compatibility support collector may not be composed into an operator-facing CLI/helper surface.

Independently decide whether the original Phase-4 requirements are satisfied:

- doctor checks for schema/migration/permissions/orphan artifacts;
- database corruption fails closed with actionable recovery guidance;
- redacted diagnostic/export support is actually reachable by an operator rather than existing only as unwired modules.

If incomplete, classify the severity relative to **cutover/Phase-4 completion**, identify the exact missing composition seams, and recommend the smallest bounded correction. Do not wire it yourself.

### Original Phase-4 scope completeness

Compare the actual integrated durable-domain inventory against the original Phase-4 master-plan/ADR-0003 target, not merely the workstream registry. Determine whether any required domain state, transactional mutation, import/shadow path, recovery behavior, or compatibility surface remains unimplemented or was accidentally classified away.

Distinguish:
- truly required before Phase-4 completion/cutover;
- intentionally filesystem/runtime state under ADR-0003;
- valid later-phase work;
- stale master-plan language already satisfied by another accepted domain.

### Evidence boundary

- Treat Verify #1084 as hosted repository/macOS CI evidence only.
- Identify the exact persistent-Mac proofs still required before any authority switch: migration of real state, corruption/busy/recovery, restart, rollback/readability, previous-release upgrade where not already sufficiently proven, permissions, and any device/Simulator evidence that is genuinely relevant.
- Do not claim those proofs passed from fixtures alone.

## Output

Create:

`docs/internal/reviews/ARCHITECTURE_PHASE4_INTEGRATION_AUDIT.md`

Use P0/P1/P2/P3 severity. Every finding must include exact files/symbols/evidence, why it matters, and an orchestrator action.

The report must end with explicit answers to:

1. Is exact integrated head `eaa44b0...` safe to proceed to persistent-Mac evidence collection?
2. Is it safe to proceed to an authority/cutover decision now, or are repository corrections still required first?
3. Which findings are hard blockers before cutover?
4. What is the minimal ordered correction/evidence sequence?
5. After corrections/evidence, what independent gate should occur immediately before an authority switch?

Do not edit production code, root package policy, global schema, canonical roadmap/registry/progress/current handoff, or PR #147.

Open a draft PR against `agent/arch-ws-P4-INTEGRATION-serialized-phase4`. Run docs/architecture/diff checks and obtain exact-head hosted Verify for the audit branch if practical. Do not merge.
