# P4-R1-INDEPENDENT-REVIEW

Status: **READY**  
Class: **independent correction audit**  
Phase: **4**

## Exact product under review

Audit exact corrected product head:

`bde5c1993112678430423ba32e7fb02b9bb5c9a1`

Source correction PR: #149.  
Parent integration audit: PR #148.  
Exact product Verify: #1106 / run `31820807687` — PASS.

This review decides only whether PR #148 findings P1 and P2 are closed at repository/product level. It is **not** the final Phase-4 cutover preflight and must not authorize an authority switch.

## Required review

Independently inspect the exact tree, PR #149 diff/history/tests, PR #148 findings, the original Phase-4 doctor/support requirements, ADR-0003, and the frozen Phase-4 invariants.

Verify at minimum:

1. The normal operator support surface actually exposes the accepted P4-DIAGNOSTICS model for database, migration/checkpoint, shadow, compatibility/authority, permissions, artifact/orphan and recovery evidence.
2. The support output remains `readOnly=true`, `redacted=true`, `mutationAllowed=false`, path-safe, and authority-preserving.
3. The real operator probe cannot trigger import/cutover, cleanup draining/execution, legacy deletion, process termination, permanent dual write, or normal runtime/store construction with maintenance side effects.
4. SQLite is opened read-only/query-only and the product distinguishes authoritative/domain mutation from normal WAL/SHM reader coordination. Main DB/domain/legacy state must not be mutated by diagnostics; coordination sidecars must remain private.
5. Private state-root/database permission failures are observable without weakening authority.
6. Valid staged schema v7 is reported as migration attention/transitioning rather than falsely as broken, while corrupt/current-incomplete/newer schemas still fail safely.
7. Existing legacy authority readability is actually observed without leaking raw contents or paths.
8. The actual `swift-sim pair` executable path has a behavior-level regression capable of catching the prior undeclared `includeStorage` failure class.
9. No schema version, v1-v7 migration identity, six-field session boundary, authority routing, rollback, process ownership, package policy or artifact-cleanup activation changed.
10. No hidden whole-tree regression was introduced by PR #149.

## Output

Create `docs/internal/reviews/ARCHITECTURE_PHASE4_R1_CORRECTION_AUDIT.md` with P0/P1/P2/P3 findings and exact evidence/actions.

Explicitly answer:
- Is PR #148 P1 closed?
- Is PR #148 P2 closed?
- Are any repository corrections still required before final persistent-Mac acceptance evidence / pre-cutover review?
- What evidence remains environment-only?

Do not edit production code or canonical control-plane state. Open a draft PR against `agent/arch-ws-P4-INTEGRATION-CORRECTIONS-R1-operator-diagnostics`. Do not merge.