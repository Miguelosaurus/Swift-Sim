# P4-DEVICE-CUTOVER-FIX

Status: **READY**
Class: **implementation-ready correction**
Phase: **4**
Provider PR: **#134**
Provider head under review: `23d615a479e2ee61a5922110f31bdff2f836d70d`

## Goal

Correct the strict-TypeScript failures on PR #134 while preserving the reviewed migration-state/export/compatibility/rollback behavior and its non-integrated status.

## Scope

Fix only the static proof gaps reported by Verify #976 in:

- `deviceBuildMigrationExport.js`
- `deviceBuildMigrationState.js`

and tests only where needed to preserve/strengthen the existing semantics.

Do not redesign the fixture vocabulary during this correction. If a true semantic defect is discovered, stop that portion and report it rather than silently changing the provider contract.

## Provider role

This workstream is the Phase 4 provider for device-build migration-state/export/rollback fixture vocabulary and deterministic fault semantics. P4-UPGRADE-EVIDENCE consumes this vocabulary; it must not create a competing model.

## Boundaries

Do not change production routing, global schema/version, central helper/CLI composition, root package manifests, or canonical control documents.

## Verification

Run the focused provider tests, strict types, architecture/lint/format, full `npm run check`, and exact-head hosted Verify.

## Return

Report exact old/new head, exact diagnostics fixed, confirmation that behavior/scope did not broaden, full verification, and whether the provider semantics are ready for downstream consumption.
