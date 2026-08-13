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

`test/upgrade-evidence/previousRelease.test.js` runs after `npm run build` and imports the compiled candidate from `dist/`. It verifies that current canonical parsers accept the pinned v0.6.1 pairing credential, invitation, and version-5 device-build state while preserving the expected identities.

`npm run check:upgrade` composes that release-specific compatibility proof with the existing compiled pairing and device-build legacy-import suites. Those suites exercise the production migration paths and cover first import, idempotent replay, restart-safe checkpoints, interruption after domain commit, checkpoint-only repair on retry, invalid or corrupted state, busy locks, backup failure, and preservation of legacy sources.

The focused command is `npm run check:upgrade`. It expands to `npm run build` followed by one Node test invocation over `test/upgrade-evidence/previousRelease.test.js`, `dist/test/pairingLegacyImport.test.js`, and `dist/test/deviceBuildLegacyImport.test.js` with test concurrency set to one.

Candidate packaging remains covered by `scripts/verify-package-content.sh`, `scripts/verify-package-install.sh`, and `scripts/verify-homebrew-package.sh`. Full composed verification is `npm run check`. Exact hosted results and the final head are recorded on draft PR #131.

## Real-environment evidence still required

CI does not substitute for an installed v0.6.1-to-candidate service upgrade on the persistent supported Mac, the opt-in clean Homebrew installation check there, validation against that Mac's real Xcode and Simulator inventory, an iPhone install/reconnect/launch check when required by the Phase 4 gate, or a prior-release reinstall/readability drill when the release process requires it.

## Scope boundary

This workstream changes no global SQLite migration ordering, authority selector, startup composition, workflow, roadmap, registry, progress ledger, or production cutover state.
