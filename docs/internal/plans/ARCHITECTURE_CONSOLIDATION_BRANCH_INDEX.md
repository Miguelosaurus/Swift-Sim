# Architecture Consolidation Branch Index

Status: **Canonical branch-selection guidance**

The repository contains many architecture refs from stacked PRs, corrections, publishers, oracles, and handoffs. Recency alone does not determine authority.

## Current refs

- Product boundary: `agent/architecture-consolidation-phase-4z5-doctor-artifact-audit`
  - hosted-green head: `0be8234583e9c989b1831c9bce5e042b19b3d46c`
- Program control plane: `agent/architecture-consolidation-program-orchestration`
  - contains the parallel roadmap, registry, protocol, current handoff, and workstream contracts

The orchestrator supplies an exact dispatch SHA for workers; do not use a moving branch tip implicitly.

## Confirmed ancestry families

The current product ancestry already includes:

- Phase 0 and Phase 1 foundations;
- Phase 2A–2H / Checkpoint 1 stack;
- Phase 3A–3V, including final Phase 3 gate `07a8295f0221f1f2007cb1f01c99a5998f371f8a`;
- Phase 4A–E4 pairing/SQLite precedent;
- the helper-state-growth correction;
- Phase 4F–4Z5 device-build continuation.

These are valid implementation history/precedent. A worker branches from them only when its assignment explicitly pins one.

## Reference-only families

Unless the registry explicitly names one, treat these as historical/reference material rather than worker bases:

- older current/local-verification handoff siblings;
- `agent/tmp-*` publisher/oracle/output/render/correction refs;
- intermediate `*-clean` / `*-output` refs superseded by later canonical children;
- review/confirmation/deep-review staging refs;
- closed/superseded experiments recorded in the progress ledger.

`agent/swift-sim-architecture-consolidation-plan` preserves original planning history. The canonical master plan plus current execution amendments control current work.

## Base-selection rule

1. read the workstream registry;
2. read the assigned workstream contract;
3. use the exact dispatch SHA supplied by the orchestrator;
4. confirm ancestry before editing;
5. stop and report any mismatch instead of guessing.
