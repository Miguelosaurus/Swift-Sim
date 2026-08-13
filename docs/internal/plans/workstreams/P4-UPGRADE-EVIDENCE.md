# P4-UPGRADE-EVIDENCE

Status: **IMPLEMENTED — final hosted evidence belongs on draft PR #131**
Class: **implementation-ready**
Phase: **4**

Goal: make previous-release compatibility repeatable without changing production authority.

## Upgrade source

Repository history selects published release **v0.6.1** as the mandatory source. Its tag resolves to `23d671bdb7c712d1680a06e8fec9e9e973038b8a`; the published archive is `swift-sim-0.6.1.tar.gz` with SHA-256 `c8edc4c7efac93d161540d9b34ca762856875929351de2b7975e5923784307aa`, published on 2026-08-02.

`v0.6.0` is tag-only and `v0.5.0` is an older published release. No documented support window requires either as an additional upgrade source.

The fixture manifest pins the historical package, pairing-store, device-build-store, and Homebrew-template blobs. Fixture values are synthetic and preserve historical persisted shapes without containing user state.

## Automated evidence

`test/upgradeEvidence.test.ts` is a read-only compatibility proof. It verifies that current canonical parsers still accept the pinned v0.6.1 pairing credential, invitation, and version-5 device-build state while preserving their expected identities.

The focused upgrade gate composes that release-specific compatibility proof with the existing compiled pairing and device-build legacy-import suites. Those existing suites exercise the production migration paths and cover first import, idempotent replay, restart-safe checkpoints, interruption after domain commit, checkpoint-only repair on retry, corrupt checkpoints, busy locks, invalid legacy state, backup failure, and preservation of legacy sources.

The normal package gates continue to cover candidate package contents, a disposable package installation, and non-destructive Homebrew formula compatibility. Exact commands and hosted results are recorded on draft PR #131.

## Real-environment evidence still required

CI does not substitute for persistent-Mac installed-package upgrade and rollback, real Xcode and Simulator inventory validation, or physical-device install and reconnect evidence when the Phase 4 release gate requires it.

## Scope boundary

This workstream changes no global SQLite migration ordering, authority selector, startup composition, workflow, roadmap, registry, progress ledger, or production cutover state.
