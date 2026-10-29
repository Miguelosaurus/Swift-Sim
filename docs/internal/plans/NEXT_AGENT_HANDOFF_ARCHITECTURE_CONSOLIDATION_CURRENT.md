# Architecture Consolidation — Current Handoff

Status: **Phase 4 cutover R2 completion; real maintenance gated**

The current continuation is documented in [the 2026-10-29 reconciliation](P4_CUTOVER_RECONCILIATION_2026_10_29.md). This supersedes the old Phase 4Z5 handoff for current-work questions. Preserve older documents as history; do not restart their completed feeder assignments.

## Exact continuation boundary

- Prior cutover implementation: #152 at `3a1fb02c9ace97dfdd0637fc5ecb391e3570a77e`.
- R1 product #154: `24c8905c80a02dbacbf507e704142ee816e8aca1`.
- R1 independent audit #155: `3c33c838a1f174b336039d8f683728365d6fb26b`, four repository corrections required.
- Agent 24 completed preflight R2A in #156 at `fdd2b72dc1ecc9f93163ca60fcea809cef13c0a5`; Verify #1164 / run 31979347580 succeeded.
- Codex completed the remaining R2 corrections plus bounded independent-review fixes on `codex/swift-sim-p4-reconcile`, stacked directly on that exact #156 product. Read its draft PR for final immutable head and hosted Verify.
- The planned numbered Agent 25/26 web work is replaced by this Codex implementation/review. Codex subagents are unnumbered.

Read `AGENTS.md`, the master plan, invariants, batched/parallel amendments, registry and the reconciliation report before continuing. The registry's current overlay controls dispatch. The old wave tables describe historical feeder work.

## Current outcome

The parser, session concurrency/rollback recovery, test-integrity and maintenance preflight findings are corrected. Independent bounded code review is 0/0/0/2, subject to final exact-head verification. SQL v1-v9 and the six-column session boundary remain unchanged. Ordinary startup remains legacy-authoritative, cleanup-inert, and process ownership remains outside SQLite.

The two P3s are real-root migration/helper staging and actual installed-release Homebrew upgrade/service proof. Both require a separate maintenance window tied to the final audited candidate. Do not switch authority, modify the real installation/state, expire rollback, delete legacy/artifacts, merge the stack, or start Phase 5 from this handoff.

## Whole-program position

Phases 0–1 are merged. Phases 2–3 and Phase 4 remain in the retained draft stack. Phase 4 repository cutover corrections are at the verification boundary above; environment acceptance and authority activation remain unfinished. Future-phase preparatory feeders do not establish production integration. The user asked to finish this Phase 4 correction chunk, not the entire ten-phase program.
