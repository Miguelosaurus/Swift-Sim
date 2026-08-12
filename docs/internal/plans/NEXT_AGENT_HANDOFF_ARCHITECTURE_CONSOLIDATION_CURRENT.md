# Architecture Consolidation — Current Handoff

## Current boundary

Phase 4 remains draft/unmerged and JSON remains the sole production authority. Do not begin Phase 5 and do not activate SQLite authority yet.

The hosted-green Phase 4U product boundary was `588aacc46cd9482fc963c3ada3da709b6bfa0d81` (PR #112). Real-Mac verification against that head found three actionable gaps without changing legacy JSON bytes or authoritative behavior:

1. Four of 212 real device-build records were historical v6 records missing fields now required by the strict SQLite contract: all four lacked `delivery`; two also lacked `signing.deviceInstallable`.
2. The existing `~/.swift-sim` directory remained `0755` even though durable files and new SQLite artifacts were private.
3. The destructive clean-Homebrew verification used `lsof` through PATH, while the verification PATH intentionally omitted macOS `/usr/sbin`.

The real JSON hashes remained byte-identical, the failed import published the exact backup before parsing, SQLite stayed schema-only, integrity was `ok`, revision fencing/fail-open behavior passed on disposable valid state, Simulator boot/shutdown passed, and physical-device connectivity remained environment-limited.

## Remediation stack

### Phase 4V — historical device-build compatibility

PR #114 upgrades only known absent historical fields before the unchanged strict SQLite validator:

- missing `delivery` is reconstructed from the legacy `remoteBaseUrl` semantics:
  - non-empty `remoteBaseUrl` → `custom` / `user-configured` / empty expiry
  - empty `remoteBaseUrl` → `quick-tunnel` / `cloudflare-quick-tunnel` / empty expiry
- missing `signing.deviceInstallable` → `false`
- explicit values are preserved
- malformed present fields and a wholly missing signing object still fail closed

The current Phase 4V exact-head verification trigger is `c629967876016f5501b9c44ee305bb4baafe95cd`.

### Phase 4W — private existing state root

PR #115 adds a symlink-safe directory-mode operation to the existing Node atomic filesystem owner and ensures the SQLite database parent is `0700` before the shadow runtime opens the database. This changes directory metadata only; file bytes are untouched. Failure still falls through the existing JSON-only startup boundary.

Current head: `3190e583c71c320c4c9c9cc4d25becacbd07ff67`.

### Phase 4X — restricted-PATH Homebrew verification

PR #116 preserves the existing `lsof` listener/PID proof but resolves `lsof` from PATH first and falls back to `/usr/sbin/lsof`. A dedicated macOS oracle reproduced a PATH without `/usr/sbin` and the full clean Homebrew package/service gate passed.

Current combined product head: `63ceccdc630fc6c6c9d4aba9e3cb397b95c503a6`.

## What must happen next

Run the focused real-Mac rerun in `NEXT_LOCAL_VERIFICATION_PHASE4X.md` on the exact combined product head. Do not fix failures during that run. Report evidence back first.

Only after the real 212-record import succeeds, the state root becomes `0700` without JSON hash changes, and the restricted-PATH Homebrew gate no longer fails at `lsof` may device-build authority/cutover work resume.

Even after that checkpoint, Phase 4 is not complete: device-build cutover/rollback/export, sessions and remaining transactional domains, doctor/export/corruption behavior, previous-release upgrade proof, and the final Phase 4 audit remain before Phase 5.
