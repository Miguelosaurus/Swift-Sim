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


## Live installation follow-up

The product code was fast-forwarded and pushed to main at bc055bb. The helper
was updated through the existing lifecycle to 0.6.2, without any active build
or live delivery, and the explicitly selected 0.5.7 engine was verified unchanged.
A pre-existing uncertain live receipt remains preserved. The installed Codex
plugin is 0.6.2+codex.20261107.1. The real catalog exceeded Node's default 1 MiB
capture limit and produced ENOBUFS despite including that installed plugin;
a bounded 4 MiB setup/diagnostic capture and >1 MiB catalog regression test fix
the misleading readiness report. No warm-delivery work is added.

The user approved publishing Swift Sim 0.6.2 and the matching Homebrew update.
Rebuild the final archive from the follow-up commit, update its exact checksum
in the prepared notes/formula, then publish once and verify public retrieval.
The signed Companion reports are retained under the task evidence directory;
nine generated build/extraction/mirror directories were removed after checking
for open files. The task simulator is shut down. Phone use remains deferred.


## Completion

Both approved publications are complete: Swift Sim v0.6.2 is frozen at source
17097053b3f058547ce7199705fff965ea407cd3, and Homebrew tap commit
8ffc3c40cd58bd5c190a5aba00a95a9776043e20 points to its verified archive checksum
`af8e8b21456e35b0a6690f155b7771da1a00f0c19adfb43cfb45174833e82fcc`.
The public engine 0.5.7 asset/tag and root release asset/tag were checked after
publication. A fresh external consumer resolves Swift Sim 0.6.2 and InjectionNext
0.5.7 at the intended revisions without a local mirror or unstable dependency.

The actual Mac setup now confirms helper 0.6.2, Codex plugin
0.6.2+codex.20261107.1, matching local components and private prerequisites. The
explicit engine 0.5.7 was verified unchanged. A real scoped delivery-status read
uses the existing paired feed successfully. No phone operation was submitted.

Companion 0.6.2 build 44 is signed and ready (about 2.5 MB), with unchanged app
identity and data preservation. The shared feed selects that newest build and
reports Ready to install. Its new status UI is not installed or physically
qualified yet; phone availability remains a separate prerequisite. Keep the
existing uncertain live receipt protected. Zenics source was not changed.

Eleven task-owned generated build/extraction/mirror directories were removed
after open-file checks; signed test reports and immutable release artifacts
were retained. The stock test simulator is shut down. The existing product
helper/engine remain running. Local checks passed; remote Verify was still
running at the final audit, and the clean Homebrew service cycle was not rerun
locally. Recovery UX and the broader interruption matrix remain separate work.


## Hosted verification follow-up

The release workflow passed its full `npm run check` step, then its unauthenticated
GitHub REST tag lookup returned a non-success response. The original checker did
not record the HTTP status, so a rate limit is only a possibility, not a proven
cause. The public Git ref, fresh SwiftPM consumer, signed archive and checksum
all verified independently. The publication checker now uses bounded
`git ls-remote` for the exact lightweight tag, matching SwiftPM's transport,
while keeping the public archive checksum/size gate. Eight focused tests cover
ref errors, mismatches, ambiguity and artifact failures. The gate also runs on
main pushes so the current validation can qualify the frozen release without
moving its immutable tag or changing the published archive. Runtime/package/SDK
code is unchanged by this verification-only follow-up.
