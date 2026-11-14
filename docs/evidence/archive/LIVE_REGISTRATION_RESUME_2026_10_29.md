# Preserved Debug build registration recovery — 2026-10-29

## Failure and proof boundary

The corrected Debug SDK bootstrap produced a signed build 28, but the helper
stopped before IPA packaging because frontend registration command 71 of 89
timed out. The command contained 114 Swift source arguments. The preserved
Xcode result reports a successful iOS build; no phone installation or new live
delivery followed that failure.

The old engine updated and compressed its growing compilation cache after each
command. The helper allowed only five seconds per synchronous registration.
Independent native testing also reproduced a closed-client `SIGPIPE` failure:
configuring socket suppression only when writing a late response was too late.
These establish concrete cache/transport defects; the original historical
socket response and every historical engine exit are not reconstructed.

## Registration contract

The new local engine candidate accepts one complete bounded compilation map,
with operation identity, map/provenance digests and expected engine nonce.
Parsing validates the entire map before publication. One owner-private atomic
aggregate snapshot persists all platforms together. Compiler-owner installation
does not trigger pending source injections. Partial registration is never
compiler readiness.

The helper waits within a bounded overall budget and queries the same pending
operation after an absent reply. A successful receipt must describe the current
activation of the exact map and engine generation. Historical A → B → A capture
receipts cannot approve the wrong active map; a terminal failed attempt permits
a new qualified activation. Source, app and project fingerprints are checked
again before atomic local manifest publication.

Both native and helper control transport bound I/O and handle partial messages.
The helper uses an absolute RPC deadline and a response-size limit, preserving
Unicode split across chunks. The native transport suppresses closed-peer
signals per send and completes partial writes within its deadline.

## Supported resume

```sh
swift-sim resume-device-build --build-id "<opaque-build-id>"
```

This uses the existing failed record and build number. Under the existing live
lifecycle lock, it validates current ownership/state, cancellation, contained
artifacts, strict app signature, exact bundle/version/build/team and Mach-O
identity, successful matching Xcode result and unchanged inputs. It then
registers the map, verifies a copied app, packages its IPA and uses ordinary
delivery publication. It does not run compilation, install an app or edit the
project. Deletion, changed identity, stale ownership, input drift and unknown
worker ownership stop recovery without replacing another operation's state.

Future builds retain a fingerprinted checkpoint before registration. Legacy
build 28 had no historical source-hash checkpoint. Its adoption therefore uses
the successful result plus conservative source/project/alias timestamps, then
records current fingerprints and rechecks them during recovery. This cannot
reconstruct absent original cryptographic source hashes. Source aliases must
resolve within qualified project/package roots; target and link identity and
timestamps are both checked.

Read-only independent inspection found 89 frontend commands, 856 distinct
Swift inputs and 13 legitimate dependency source aliases. The signed app,
stored identity, result, immutable SDK pins and input timestamps agree with
the preserved build. That is recovery eligibility, not phone acceptance.

Creating a live Debug install now targets generic iOS even when provisioning
updates are allowed. The flag no longer selects an unavailable paired phone.
Exact phone installation verification remains a separate connection/proof.

## Integration and acceptance

The Debug SDK remains pinned to native revision
`a3341b6a861dde031334813db49f7c7111108c4a`; this repair changes the Mac engine
and helper, so the preserved corrected-SDK app does not need recompilation.
The new engine is an explicitly qualified local 0.5.1 candidate. No public
binary release, engine downgrade, phone install or notification feature is
implied. Codex integration revision: `0.6.1+codex.20261029.4`.

Engine source revision: `6f153a9cd13c0f35193a1429b79ae6256d9439cc`, pushed to the
existing `codex/swift-sim-client-reconnect` branch. Qualified local archive
SHA256: `a3d7866cdbae8f074518b16b09a67766885df69ae69559517717a453e0e6d991`.
The full macOS engine build, deep ad-hoc signing and strict verification passed.
Its actual native registry, private aggregate snapshot and socket harness
passed large maps, pending idempotence, expiry, wrong binding, A → B → A,
failed/cancelled attempt recovery, atomic multi-platform publication, unsafe
cache paths, closed peers, backpressure and absolute I/O deadlines. The final
engine also reads compiler-map counts on their owner queue.

On Node 24.19.0, `npm run check` passed 1,076 source tests, 557 compiled tests
and two hermetic package tests, plus types, lint, formatting, documentation,
architecture, compiled runtime probes and clean archive installation.
Homebrew formula/entrypoint checks passed; the optional destructive clean
Homebrew installation gate was not run. The compiled gate includes the new
registration, preserved-build resume and independent safety regressions.

## Actual local activation and resume

Implementation commit `172ed09` was pushed to `main`; the primary checkout was
fast-forwarded and rebuilt. The archive above was explicitly staged and
canonical setup activated local engine 0.5.1. The helper is healthy and
advertises `transactional-compilation-registration-v1`. All tracked Simulator
streams were stopped before reconciliation. Codex plugin
`0.6.1+codex.20261029.4` is enabled; all 12 cached files match source.

The supported resume command completed for the preserved build 28. The same
build number now reports `ready`, `compilerReady: true`, recovery phase
`packaged`, and an existing IPA. Its manifest contains all 89 frontend commands
and 856 source baselines. A read-only query of the actual engine returned the
matching current committed receipt, with exact operation, map/provenance
digests and engine nonce. This was completion of registration and packaging;
no Xcode compilation, new build number, phone install or new live request was
performed by this recovery lane.

Private pre-activation evidence was retained. All original queued snapshot
digests and prior proof fields are unchanged. No old uncertainty was cleared
or presented as successful application. Zenics source, signing identity,
approved gestures and phone data were not edited.

The Zenics lane can now use ready build 28 in the ordinary install workflow;
another SDK compilation is unnecessary for this engine/helper repair. Phone
installation is still unverified. Restart/hot-reload acceptance still needs
that corrected app installed, then current-request application/refresh proof
and visible change/removal across the requested connection/restart cases.
