# P4-UPGRADE-EVIDENCE

Status: **IMPLEMENTED — exact-head hosted evidence is recorded on the draft PR**  
Class: **implementation-ready**  
Phase: **4**

Goal: strengthen repeatable previous-release and package/service compatibility verification for the Phase 4 gate.

Primary ownership: test fixtures, verification harnesses, and documentation of checks that still require a persistent Mac or physical device.

Shared schema/composition and canonical control-plane documents remain orchestrator-owned.

Follow `ARCHITECTURE_CONSOLIDATION_AGENT_PROTOCOL.md`. Return exact base/head, draft PR, changed paths, verification evidence, deferred environment-specific checks, and integration requirements.

## Previous supported release selection

Repository release history, rather than tag memory, selects **v0.6.1** as the mandatory source release for this gate:

- release tag: `v0.6.1`
- release commit: `23d671bdb7c712d1680a06e8fec9e9e973038b8a`
- published release asset: `swift-sim-0.6.1.tar.gz`
- published asset SHA-256: `c8edc4c7efac93d161540d9b34ca762856875929351de2b7975e5923784307aa`
- publication time: `2026-08-02T20:22:59Z`

`v0.6.0` is present as a repository tag but is not a published GitHub release. `v0.5.0` is an older published release. In the absence of a documented multi-release support window, this lane treats the latest published non-prerelease (`v0.6.1`) as the required upgrade source and does not silently promote tag-only `v0.6.0` into a supported source.

The provenance fixture also records the exact `v0.6.1` blobs that define the relevant package/state contract: historical `package.json`, `pairingStore.js`, `deviceBuildStoreCore.js`, and the Homebrew formula template. Fixture values are synthetic; only their persisted shape and release provenance are historical.

## Automated evidence

All mutable state used by this lane lives under a disposable `mkdtemp` root. The fixture is copied into that root before current migration code is invoked, and the test explicitly proves the disposable `~/.swift-sim` path differs from the process user's real `~/.swift-sim` path.

The fixture-backed integration proof covers these transitions:

1. `v0.6.1 pairing.json + pairing-invites.json` -> current pairing SQLite import reports `applied` and preserves installation/invitation identity.
2. close/reopen the SQLite database -> replay reports `already-current`.
3. `v0.6.1 device-builds.json` (historical state version 5) -> current device-build SQLite import reports `applied` and preserves the build/application identity.
4. close/reopen the SQLite database -> replay reports `already-current`.
5. after both migrations/restarts, every legacy source file remains byte-for-byte unchanged. This is the authority-neutral rollback/readability expectation this lane can prove: a rollback-capable prior binary still has its original legacy source rather than an eagerly rewritten substitute.

The existing compiled pairing/device migration suites are part of the same evidence matrix and already inject the reproducible failure boundaries this lane must not fake: checkpoint-write interruption after domain commit, corrupted checkpoint persistence, busy legacy locks, invalid legacy data, backup failure, exact retry/checkpoint repair, and idempotent replay. Reusing those fault-injection suites keeps one implementation of migration failure semantics instead of creating parallel test-only migration logic.

The existing package gates cover the candidate side of the upgrade:

- `verify-package-content.sh`: publishable contents and source/internal-file exclusion;
- `verify-package-install.sh`: install the packed candidate into a disposable prefix and verify both compiled launchers/version;
- `verify-homebrew-package.sh` default mode: formula syntax, Node 24 dependency, and current compiled entrypoints without touching Homebrew state;
- release scripts `create-archive.sh` / `render-homebrew-formula.sh`: current release archive and formula generation used by the opt-in clean Homebrew proof.

### Focused commands

Run the release-specific state/restart test plus the existing reproducible interruption suites:

```bash
npm run build
node --test --test-concurrency=1 \
  test/capabilityBoundaryIntegration.test.js \
  dist/test/pairingLegacyImport.test.js \
  dist/test/deviceBuildLegacyImport.test.js
```

Run the disposable candidate package/archive/Homebrew-static gates:

```bash
bash scripts/verify-package-content.sh
bash scripts/verify-package-install.sh
bash scripts/verify-homebrew-package.sh
```

Run the repository-wide composed gate (it already contains the fixture-backed source test, compiled migration fault injection, and all three package gates):

```bash
npm run check
```

## Evidence classes that remain real-environment only

These checks are intentionally **not** represented as CI proof:

1. On the persistent supported Mac, install the real published `v0.6.1` Homebrew formula/service with representative disposable or backed-up legacy state, then upgrade that installed formula to the exact candidate archive and confirm launchd service restart/health across the package boundary.
2. Run the existing destructive clean-Homebrew gate on that Mac with `SWIFT_SIM_RUN_CLEAN_HOMEBREW=1`; it uses a temporary tap, temporary HOME, unique service port, and refuses to replace an existing `swift-sim` formula/service.
3. Validate the upgraded installed helper against the persistent Mac's actual Simulator/Xcode/runtime inventory; CI cannot substitute for that machine-specific environment.
4. Perform at least one real iPhone install/reconnect/launch flow from the upgraded helper when Phase 4 release acceptance requires physical-device evidence. Simulator or mocked HTTP evidence is not labeled as physical-device proof.
5. If rollback to the prior installed Homebrew package is part of the release drill, downgrade/reinstall `v0.6.1` on the persistent Mac and confirm it can still read the preserved legacy sources. CI proves those files were not rewritten; it does not prove Homebrew's real downgrade/service lifecycle.

## Scope boundary

This lane changes no global SQLite migration ordering, authority selector, startup composition, workflow, roadmap, registry, progress ledger, or production cutover state. It adds evidence around the existing migration/package seams only.
