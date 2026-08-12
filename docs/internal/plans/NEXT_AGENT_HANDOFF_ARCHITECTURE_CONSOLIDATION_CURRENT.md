# Architecture Consolidation — Current Handoff

## Current boundary

Phase 4 remains draft/unmerged. JSON remains the sole production authority. Do not begin Phase 5 and do not activate SQLite authority yet.

The current hosted-green product head is `19547d52881ed70288f270f98c2b48ba9f333238` on PR #120 (Phase 4Z2). Hosted Verify #931 / run `31600955162` passed end to end: full `npm run check`, isolated clean Homebrew/service, YAML, shell syntax, and iOS tests.

## Real-Mac evidence that drove the latest corrections

The first persistent-machine shadow verification against Phase 4U found four historical device-build records missing fields required by the strict SQLite contract, an existing state root at `0755`, and a restricted-PATH Homebrew verification failure at `lsof`. Phases 4V–4X corrected those issues while keeping JSON authoritative.

The focused Phase 4X rerun then showed:

- real state: 212 device-build records, 0 apps, 0 cleanup jobs;
- four missing `delivery` records were now reconstructed correctly;
- exactly two records still failed strict validation because `signing.style` was absent;
- state-root hardening passed (`0755` → `0700`) with all durable JSON hashes unchanged;
- revision fencing, SQLite-unavailable JSON fallback, restricted-PATH clean Homebrew, and full local `npm run check` passed;
- the running real helper was not restarted or modified.

The same run produced a read-only storage audit of `~/.swift-sim/device-builds`:

- total: 42.10 GiB across 213 directories / 212 referenced builds;
- `DerivedData`: 36.79 GiB;
- `.xcarchive`: 4.02 GiB;
- exported IPA/app payloads: 1.27 GiB;
- `.xcresult`: 13.03 MiB;
- ready builds: 175; failed builds: 37; active builds: 0;
- superseded ready output: 164 records / 33.71 GiB;
- failed-build output: 37 records / 5.03 GiB;
- no cleanup was performed.

## Latest remediation stack

### Phase 4Y — historical signing-style compatibility

PR #118, exact head `b38e8f0bcc1f4bce746183c101879c1239b285d8`.

Historical Swift-Sim initialized `signing.style` to `""` and later populated it from Xcode's `CODE_SIGN_STYLE`. The importer therefore reconstructs only an absent `signing.style` as `""` before the unchanged strict validator. Explicit values are preserved; present malformed values and a missing signing object remain fail-closed.

Hosted Verify #919 / run `31597416420`: passed end to end.

A real 212-record import rerun is still required; this is the last known historical schema omission.

### Phase 4Z1 — unwired artifact-retention primitive

PR #119, exact head `2fa0130315b18c50dcc5bfe0344dabafa4334bf3`.

Defines a containment-safe retention primitive and a 24-hour failed-build diagnostic grace period but performs no live or historical cleanup. Hosted Verify #924 / run `31598561759`: passed end to end.

Do not wire the generic 4Z1 ready-build policy by itself. Phase 4Z2 adds the required live-reload DerivedData exception.

### Phase 4Z2 — future terminal-build retention wiring

PR #120, exact head `19547d52881ed70288f270f98c2b48ba9f333238`.

- non-live ready builds retain metadata + exported IPA/install payload while per-build `DerivedData`, archive, result bundle, and export-options scratch are eligible for containment-checked pruning after delivery is persisted;
- live-reload-ready builds also retain `DerivedData` because captured patch-compiler `-I` / `-F` search paths may reference it;
- retention errors are nonfatal to build/install state;
- failed and interrupted builds enqueue one deduplicated whole-root cleanup job for 24 hours later;
- cleanup scheduling accepts only the canonical store-owned `device-builds/<build-id>` root;
- existing historical artifact trees are never scanned or deleted by this slice;
- old IPA eviction is not introduced.

Hosted Verify #931 / run `31600955162`: passed end to end.

## What must happen next

Run `NEXT_LOCAL_VERIFICATION_PHASE4Z2.md` on the exact product head `19547d52881ed70288f270f98c2b48ba9f333238`.

The local pass must remain non-destructive to the existing 42.10 GiB historical artifact tree. It should:

1. rerun the real 212-record shadow import and prove 212/212 import + checkpoint/schema/integrity while legacy JSON hashes remain unchanged;
2. prove 4Z2 future-retention behavior only in disposable fixture roots;
3. produce a read-only historical cleanup dry-run that classifies reclaimable bytes under the safe current policy, including the live-ready DerivedData exception.

Do not implement or activate historical cleanup until that dry-run is reported back and reviewed.

Even after this checkpoint, Phase 4 is incomplete: device-build cutover/rollback/export, historical artifact reconciliation/doctor support, sessions and remaining transactional domains, corruption/export diagnostics, previous-release upgrade proof, and the final Phase 4 audit remain before Phase 5.
