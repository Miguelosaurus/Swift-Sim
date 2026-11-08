# Reproducible setup and shared delivery status

This is normal product work, outside the architecture-consolidation program.
User authorized setup reliability first and shared delivery status next. Keep
phone use deferred until availability is confirmed; no App Testing session.
No subagents or extra background services are needed.

## Verified starting state

- Main/helper are e13d29f; plugin is 0.6.1+codex.20261107.3.
- Existing working engine candidate is 0.5.7, source revision
  ba3c7166f6712d2cd962005a2a1200de4137590b, archive SHA-256
  514343a4cd03a0124e9b36f687396dfd955cf76e663552159a8897acce4349ef.
- That source commit already exists in the public engine fork. Public binary
  releases stop at 0.4.0. Neither 0.5.7 nor v0.5.7 SwiftPM tags exist.
- Fresh CLI setup still selects 0.4.0, while Package.swift pins the newer fork
  revision. Stable SwiftPM releases cannot transitively depend on revisions.
- Swift Sim build 43 is ready, not confirmed installed; do not rebuild it just
  to deliver it. Its Release installer is ~2.5 MB, with archives/DerivedData gone.
- Two existing architecture inventory violations remain unchanged; do not widen
  caps or allowlists for this work.

## Execution

1. Define one packaged compatibility contract for helper/CLI, agent integration,
   engine artifact/hash/source, SDK version/pin, and required protocol generation.
   Make setup/doctor reject an installed-but-incompatible stack without implying
   a physical phone or live replacement is proven. Keep warm edits unchanged.
2. Make engine install/update transactional: staged bounded download, checksum,
   signature and app metadata checks before stopping anything; safe swap/rollback;
   one temporary download/staging tree, no accumulated archives or updater timer.
   Preserve explicitly selected local candidates and never silently downgrade.
3. Exercise a clean install and interrupted update in an isolated state root.
   Test real verified extraction without starting/replacing the user's engine.
4. Prepare the immutable 0.5.7 engine binary release and SwiftPM tag at the same
   existing public source revision. Prepare the next Swift Sim release so all
   package/plugin/SDK/engine metadata match. Do not point production defaults at
   a missing asset. Any publication approval must be requested only after the
   signed artifact, release notes and verification are concrete and reviewable;
   continue independent status work while an asynchronous approval is pending.
5. Share one small delivery-status projection among existing agent responses,
   app page and notification copy: saved/waiting/open app/confirm install/applied/
   blocked/uncertain. Reuse existing journals, native receipts and refresh cycles;
   no new phone SDK, polling, screenshot upload or testing session.
6. Run source/compiled/package checks, preserve proof boundaries, merge without
   PRs as authorized once the corresponding release artifacts are available.
   Update the installed helper/plugin through existing lifecycle controls only
   when no active build is present. Keep phone qualification separate.

## Publication boundaries

New public immutable tags/releases must never rewrite existing releases. Fresh
setup cannot be called available until its pinned artifact and package tags can
actually be fetched. Prepare everything before asking for any necessary approval.
No enrollment, device management, Apple capabilities, signing-key changes, paid
services, or phone automation are part of this work.


## Release gate

Before tagging/publishing the matching Swift Sim release, run
`npm run check:engine-publication`. This checks the public engine SDK tag at the
contract source revision and streams/checksums the exact binary asset. Release
CI repeats the gate. A local-only engine fixture is not public fetch evidence.
Normal builds/tests stay offline with respect to this publication gate.


## Qualification checkpoint

The engine release and lightweight SDK tag were explicitly approved and
published at the specified public source commit. The publication gate now
passes against the public asset (exact SHA-256) and tag. A clean isolated engine
install fetched the public archive once, verified signature/metadata, then
repeated setup without another download or app replacement. The engine was
never launched. Public SwiftPM resolution and all 38 root SDK tests passed.

Source suite: 1,625 passed before the final added coverage. Compiled suite:
1,003 passed, plus three hermetic runtime tests and entrypoint equivalence.
Later focused component/recovery/status tests all passed (51), including a real
paired HTTP status read and no credential forwarding on redirects. Types,
lint, architecture inventory and docs passed. The Companion built for iPhone;
all 62 native tests passed on the task-owned stock simulator with normal
ad-hoc signing. Unsigned simulator tests cannot exercise Keychain entitlements;
the contributing example now uses ad-hoc signing. The simulator is shut down.
The cached one-app install-status read measured median 0.023 ms / p95 0.035 ms
across 1,000 reads. This excludes APNs/network latency and is not phone proof.

No phone actions, Debug SDK edits, polling timers or new persistent services
were introduced. The running 0.6.1 helper and explicitly selected 0.5.7 engine
were left unchanged while qualifying. Main has not been updated yet. Matching
Swift Sim 0.6.2 package/release preparation and installed integration updates
remain to finish; do not imply the new Companion UI is on the phone.
