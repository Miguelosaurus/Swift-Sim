# Architecture Consolidation Parallel Wave 1 Review

Status: **Orchestrator review complete**

Base control-plane head: `3d5795e4adf798ed284ce0cb676b2239a987143a` (tree-equivalent to frozen dispatch `38eee4bfb1eabc2184d92aa3e52fee28b139cbf5`; Verify #961 passed).

Independent audit: draft PR #132, head `cf7b1a2cf0d1823a4351f66a206522eedc8d3e58`, Verify #975 passed. Audit totals: P0 0, P1 3, P2 3, P3 0.

This review controls the second parallel wave. Individual worker claims do not override these dispositions.

## Wave 1 disposition

| Workstream | PR | Head | Hosted state | Orchestrator disposition |
| --- | ---: | --- | --- | --- |
| P4-ARTIFACT-EXECUTION | #136 | `6722125` | Docs-only Verify passed | **REEXECUTE**. Source implementation did not land. Apply-time freshness/revalidation from audit finding W1-P1-01 is mandatory. |
| P4-DEVICE-CUTOVER | #134 | `23d615a` | Verify #976 failed at strict types | **CORRECT**. Semantics are the provider vocabulary for upgrade evidence; fix typing without broadening scope, then rerun full Verify. |
| P4-SESSIONS-DOMAINS | #137 | `6ec3119` | Verify #979 failed at strict types | **REJECT CURRENT DESIGN / REDESIGN**. Whole-record session persistence crosses the durable/runtime boundary. Freeze durable projection first and preserve the exact legacy lock identity behavior. |
| P4-DIAGNOSTICS | #130 | `5313b17` | Verify #1007 passed | **VERIFIED FEEDER**. Product diagnostic fields/redaction are owned here; central composition remains integration-owned. |
| P4-UPGRADE-EVIDENCE | #131 | `b50f1ad` | Verify #1012 failed one source-text expectation | **CORRECT + DEFER ACCEPTANCE**. Remove unauthorized root-package ownership and consume, rather than redefine, accepted device-cutover semantics. |
| P5-PRELOAD-INVENTORY | #129 | `90046c6` | Verify #969 passed | **VERIFIED PREPARATORY FEEDER**. Six-package Phase 5 plan accepted for later eligibility. |
| P6-LIVE-DECOMP-PREP | #126 | `ce015a3` | Verify #962 passed | **VERIFIED PREPARATORY FEEDER**. Phase 6 seam/package map accepted for later eligibility. |
| P7-ANALYZER-PREP | #135 | `ef368e4` | Verify #1016 passed | **VERIFIED PREPARATORY FEEDER WITH DEPENDENCY NOTE**. Corpus/tooling/probe accepted; preparation protocol is experimental until Phase 6 freezes the canonical analyzer seam. |
| P8-COMPANION-PREP | #127 | `3254d18` | Verify #963 passed | **VERIFIED PREPARATORY FEEDER**. Feature-boundary/package map accepted for later eligibility. |
| P9-CONSOLIDATION-INVENTORY | #133 | `5814ddb` | Verify #971 passed | **VERIFIED PREPARATORY FEEDER**. Inventory is reference input for Phase 9; no cleanup authorized now. |
| P10-RELIABILITY-HARNESS | #128 | `ea376f9` | Verify #966 passed | **VERIFIED PREPARATORY FEEDER WITH DEPENDENCY NOTE**. Evidence envelope/harness accepted; Phase 4 diagnostics remain the provider of product diagnostic fields/redaction. |
| WAVE1-AUDIT | #132 | `cf7b1a2` | Verify #975 passed | **ACCEPTED REVIEW RECORD**. Findings below are binding on correction/integration work. |

No sibling worker PR is merged by this review.

## Binding audit decisions

### Artifact execution freshness

Any historical maintenance apply must re-read the current authoritative build state immediately before acting. A plan must be bound to the build identity plus a current revision/epoch-equivalent freshness fact, and apply must revalidate current lifecycle state, live-reload protection, canonical artifact root, and current retention eligibility. Drift fails closed. Orphan/manual-review entries are not executable. Historical maintenance remains explicit operator action only.

### Session durable/runtime boundary

The current session record is mixed. SQLite work may own only a durable domain projection. Transient stream/process/runtime ownership remains filesystem/runtime state. The next session work first defines and characterizes that projection and the join semantics; it does not reuse PR #137's full-record `record_json` design.

Legacy session snapshot/import locking must preserve the already-proven Darwin process-start identity semantics used elsewhere in Phase 4, including PID-reuse characterization. PID alone is insufficient.

### Provider/consumer ordering

- `P4-DEVICE-CUTOVER` provides the device-build migration-state/export/rollback fixture vocabulary and fault semantics. `P4-UPGRADE-EVIDENCE` is a black-box consumer of that accepted vocabulary.
- Phase 6 owns the eventual canonical analyzer seam. P7's protocol/corpus tooling is preparatory and noncanonical until that seam is integrated.
- `P4-DIAGNOSTICS` owns product support-field/redaction semantics. P10 reliability tooling treats accepted diagnostic output as opaque/versioned evidence input and does not define a competing product diagnostic schema.

## Second-wave sequence

The next parallel correction wave is intentionally small:

1. **P4-ARTIFACT-EXECUTION-R2** — re-execute the missing source implementation with apply-time freshness proof.
2. **P4-DEVICE-CUTOVER-FIX** — strict-type correction only on PR #134 semantics; obtain exact-head hosted green.
3. **P4-SESSION-BOUNDARY** — new foundation workstream that freezes the durable session projection, runtime join contract, legacy lock identity reuse, and characterization. No session SQLite repository yet.
4. **P4-UPGRADE-EVIDENCE-FIX** — make the harness repository-native without taking root package ownership; retain v0.6.1 evidence. Acceptance remains blocked on verified device-cutover provider semantics.

After `P4-SESSION-BOUNDARY` is verified, a separate session repository/import/shadow implementation workstream may start. After the four correction lanes are reviewed, the orchestrator will create the Phase 4 integration stack and compose shared schema/helper/CLI surfaces serially.

## Not yet authorized

- no SQLite authority activation;
- no legacy-state removal;
- no historical artifact apply against real user state;
- no canonical Phase 5 production work;
- no Phase 7 production analyzer routing;
- no Phase 8 coordinator cutover;
- no Phase 9 cleanup;
- no Phase 10 completion claim.
