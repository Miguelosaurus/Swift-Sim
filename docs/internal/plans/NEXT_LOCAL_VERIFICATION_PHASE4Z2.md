# Phase 4Z2 focused local verification

Verification only. Do not edit, commit, push, merge, fix failures, switch SQLite authority, or delete/move/compress any existing historical artifact.

Use exact product head:

`19547d52881ed70288f270f98c2b48ba9f333238`

Read `NEXT_AGENT_HANDOFF_ARCHITECTURE_CONSOLIDATION_CURRENT.md` first.

## 1. Real 212-record shadow import

Back up and SHA-256 hash the real `~/.swift-sim/device-builds.json` before touching the shadow runtime. Re-run the device-build legacy import against the real state.

Required evidence:

- all 212 builds import successfully;
- expected SQLite build/app/cleanup row counts;
- import checkpoint exists and is internally consistent;
- schema version 7, WAL mode, foreign keys enabled, zero FK violations, `PRAGMA integrity_check = ok`;
- migration backup is byte-identical to the authoritative JSON;
- authoritative JSON hash is unchanged after the run;
- JSON remains the sole production read/write authority.

If any real record still fails validation, stop and report the exact missing/malformed fields. Do not repair the JSON.

## 2. Future-retention behavior in disposable roots only

Do not use the existing 42.10 GiB historical artifact tree for destructive tests.

Using isolated temporary state/artifact fixtures, prove:

- non-live ready build: metadata and IPA/export payload survive while `DerivedData`, archive, result bundle, and `ExportOptions.plist` are removed after ready delivery;
- live-reload-ready build (`liveReload.compilerReady: true`): IPA and `DerivedData` survive; result bundle/scratch/archive eligible under the policy are removed;
- retention failure is nonfatal to a successful ready build;
- failed build: one durable artifact-cleanup job is persisted about 24 hours in the future and the root is not deleted immediately;
- scheduling the same failed build again deduplicates the cleanup job;
- a cleanup root outside canonical `device-builds/<build-id>` is rejected;
- helper startup does not scan or delete pre-existing historical artifact directories.

## 3. Historical artifact cleanup dry-run — read only

Re-run/extend the previous disk audit without deleting anything.

For every current build record, classify:

- state (`ready`, `failed`, other);
- whether `liveReload.compilerReady === true`;
- artifact-root size;
- bytes in `DerivedData`, archive, result bundle, export/IPA, and other;
- whether it is the latest nonfailed build for its app identity.

Report aggregate bytes that would be reclaimable under the current safe policy:

- non-live ready: DerivedData + archive + result bundle + export-options scratch;
- failed: whole root after the diagnostic grace period;
- live-ready: archive/result/scratch only; **do not count DerivedData as currently reclaimable**;
- IPA/export payloads are not currently reclaimable under 4Z2.

Separately report the count and total bytes of live-ready DerivedData, and whether the existing live compilation/session metadata can unambiguously identify one current live build versus superseded live builds. Do not infer ownership if it is ambiguous.

## Report

Return exact SHA/worktree, commands, before/after JSON hashes, import/checkpoint/schema evidence, disposable retention results, and the read-only reclaimable-byte totals. Explicitly confirm that no legacy JSON bytes, production authority behavior, or existing historical artifact files were changed.
