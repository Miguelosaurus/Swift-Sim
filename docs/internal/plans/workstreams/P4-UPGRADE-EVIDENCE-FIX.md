# P4-UPGRADE-EVIDENCE-FIX

Status: **READY**
Class: **evidence correction**
Phase: **4**
Source PR: **#131**

## Goal

Retain the useful pinned v0.6.1 compatibility fixture/evidence from PR #131 while removing its ownership of the root package command graph and making the proof run through already-owned repository test surfaces.

## Required correction

- Preserve the verified historical release/tag/archive provenance and synthetic fixture data unless review finds it wrong.
- Do not edit `package.json`, lockfiles, root compiler policy, or authoritative workflows in this workstream.
- Move compatibility assertions into test surfaces that are already executed by the normal repository gates, preferably the existing compiled pairing/device-build legacy-import suites plus a normal top-level fixture/provenance test where useful.
- Do not add a second migration-state/fault model.
- Treat P4-DEVICE-CUTOVER / P4-DEVICE-CUTOVER-FIX as the provider of device-build migration-state/export/rollback fixture vocabulary. Upgrade evidence may invoke/consume accepted provider behavior but does not redefine it.
- Keep all state fixtures synthetic/disposable and separate hosted evidence from persistent-Mac/device checks.

Acceptance of this workstream remains conditional on the provider semantics becoming verified, even if this branch becomes independently hosted-green first.

## Verification

Run the normal full `npm run check` unchanged, plus any focused existing-suite commands needed to demonstrate the v0.6.1 fixture path, and obtain exact-head hosted Verify.

## Return

Report exact base/head, retained release provenance, changed paths, confirmation that root package/workflow files are untouched, how the fixture is exercised by existing gates, provider dependency, hosted verification, and deferred real-environment checks.
