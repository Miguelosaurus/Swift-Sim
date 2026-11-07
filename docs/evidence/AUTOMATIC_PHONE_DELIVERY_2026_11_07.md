# Automatic phone delivery — 2026-11-07

The phone-testing preference belongs to the current thread and app. Its packaged
agent instructions deliver each completed logical change automatically, without
a save watcher or repeated user request. Code-only/no-phone instructions suspend
it. Other apps and conversations do not inherit it.

## One delivery operation

The existing `deliver-change` CLI retains the durable hot-reload path. A required
signed build now defaults to Debug and automatic installation, reusing a configured
private delivery origin when available. `--install link` retains explicit link-only
delivery. The signed fallback invokes the on-demand installation adapter once;
its saved build ID identifies the installation status. `deliver-build` delivers an
existing saved build without rebuilding. `build-delivery-status` reads progress
and can reconcile a previously uncertain native submission.

The native adapter uses Xcode's installed `devicectl`, Python standard library,
and the existing signed-IPA validation/extraction code. It selects a unique
reachable paired physical iPhone covered by the signed profile, or an explicit
native device selection. It does not infer installation reachability from Wi-Fi
names. Multiple eligible phones are not guessed. Explicit device selection does
not silently fall through to a different phone's Debug connection.

Signature, profile, app identity and same-team checks precede submission. A private
per-app lock and atomic fsynced journal fence the native request before contacting
the installer. Complete command acknowledgement plus scoped version/build
inventory establishes `installed`; launch is best effort and separate. Proven
inventory timestamps feed the existing build-history verification API.

If the native connection is unavailable before submission, the existing Debug SDK
foreground queue handles installation. An older/unavailable integration can retain
the normal link fallback. A lost or ambiguous native reply never switches to OTA
or repeats installation. Its local inputs remain protected, with another build
blocked while that staging ownership is uncertain. Inventory reconciliation can
prove a version was observed, without inventing a Complete receipt or authorizing
cleanup of potentially active inputs. History is bounded to 128 records per app;
expired terminal entries prune on use, with no cleanup daemon.

## Verification and qualification boundaries

- 112 compiled JavaScript tests passed. They exercise build-to-install composition, all returned states,
  hot-reload isolation, native/foreground route fencing, ambiguous replies,
  project/signature/expiry boundaries, explicit targets, historical status and
  normal verification publication. Compiled CLI/plugin/notification tests run
  alongside them.
- 20 Python fixtures passed. They exercise native command acknowledgement plus inventory,
  duplicate calls, process-state restoration after a lost reply, retained staging,
  concurrent locking, failed durable fences, multiple/unavailable devices,
  team/device mismatch, status isolation and receipt retention across builds.
- The existing Python preparation and endpoint-refresh fixtures remain passing.
- The foreground queue's cellular/locked qualification is recorded separately in
  [locked cellular installs](LOCKED_CELLULAR_INSTALL_2026_11_07.md). This is prior
  component evidence, not a fresh physical pass of the new combined CLI.
- The new Xcode adapter's physical Wi-Fi installation/launch check is deferred:
  the owner is away from home and has cellular only. Earlier native Wi-Fi successes used the separate
  Rust transport; they are not presented as proof of this new adapter.

There is no new phone SDK, testing runner, background process, source watcher,
notification poll, external package or cloud upload. Existing private capture and
status behavior remain separate from UI testing and screenshot collection.

## Resource isolation

Zenics Debug48 was prepared but a parallel task changed DataStore.swift during
that build. It was not installed or queued, and its delivery token was expired.
No Zenics source was restored or overwritten. The original installed Debug47
compiler map was recovered from its retained activity log and checked against
its exact previously acknowledged map digest, original capture, signed app
fingerprints and signature. A new native transactional registration receipt was
confirmed before republishing the original baseline capture. No phone edit,
installation, root refresh, or engine restart was used for that recovery.

Automatic fallback builds now also compare bounded project-input snapshots
before requesting installation. Parallel source changes hold delivery instead
of installing a mixed working tree. This guard runs only around full builds;
generated output is excluded and identical text rewrites are accepted. A held
automatic build is recorded as failed and its install token expires; it cannot
remain a usable mixed-source install link.

An unchanged-source Swift Sim Companion42 was then prepared for the isolated
native adapter test. Its unused delivery token was expired when Wi-Fi testing
was deferred. The cellular test awaits explicit selection of the newly committed
Zenics storage changes; those changes are outside this tooling task. Private records, signatures, source fingerprints, recovery
receipts and test output remain under ignored task-owned `.build` directories.
No active phone testing session or pending installation was created during prep.

The architecture check retains the same two pre-existing findings: read-only
`fs.open` in installRequest and fixture reads in liveEngineStop tests. Its policy
was not expanded or suppressed.
