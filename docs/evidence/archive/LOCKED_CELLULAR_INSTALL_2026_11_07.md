# Locked cellular install queue — 2026-11-07

Scope: queue a signed update while the phone is locked/disconnected, then hand it
to the normal iOS installer when the owner unlocks and returns to the Debug app.
No App Testing, screen actions, extra daemon, or phone SDK changes.

## Implementation

The command-only module selects the installed binary from existing helper-owned
launch receipts when there is no matching connected client. It validates project,
scheme, signing team, bundle, exact executable/Debug UUIDs, compiler recovery,
receipt state and time. The latest unambiguous verified launch is selected; a
compiler capture for the new build is never an installed-app observation. The
existing native queue still demands the exact binary, foreground/root readiness,
capability and absence of pending hot reload before its durable one-shot handoff.

No new persisted store, timer, phone runtime, socket or background worker was
introduced. History and IPA hashing happen only for an explicit new install
request, never during notification or hot-reload startup. Status, cancellation
and repeated requests avoid the history scan and artifact hashing.

## Physical observations

- Built Zenics Debug47 with unchanged tracked product files and the existing
  Debug46 SDK. Reused the existing private Tailscale HTTPS delivery route.
- Manifest and the full 43,016,309-byte IPA were fetched from the Mac; identifiers
  and artifact digest matched the saved signed build. This validates transport
  from the Mac, separately from the owner's cellular installation result.
- Owner confirmed Wi-Fi off, cellular, Tailscale connected, phone locked and
  App Testing stopped. Engine reported no connected client.
- Submitted build `886a8c63-44e6-4f72-879e-ba650f3a9d75` while locked. The real
  authority-selected history supplied verified Debug46 despite the compilation
  capture now describing Debug47. Queue reported `waiting` on submission and
  again before the owner was asked to unlock.
- Owner unlocked and returned to Zenics, and confirmed the prompt appeared
  without a link/notification tap. They confirmed installation; download began.
- Native receipt became `prompt-requested`. Repeating the command returned the
  original receipt and original expiry rather than sending a second request.
- Owner confirmed installation finished and reopened Zenics. The connected app
  reported Debug47, active and root-ready, with both native UUIDs matching the
  compilation capture and saved artifact provenance. The normal helper stored
  `launch-confirmed` and its launch fingerprint. Full locked-queue → foreground
  prompt → cellular installation → exact running-build verification passed.
- Phone released after verification. No additional install requests or UI
  actions remain pending. Product files stayed unchanged throughout the build.

The user controls the device network/lock state; those conditions are owner-
confirmed, not inferred from a disconnected socket. Prompt acceptance is not an
installation receipt. Unlock without returning to an integrated app is outside
this workflow, as are silent cellular installation and automatic app relaunch.

## Checks

- 30 install-request tests: disconnected history, project/team/scheme and binary
  boundaries, ambiguity, duplicate and lost replies, expiry, artifact drift,
  real IPA hashing and symlink rejection, current-client precedence and lazy
  status/cancel behavior.
- 82 compiled tests passed across install requests, normal launch verification,
  plugin fast-path/CLI integrations and notifications.
- Native queue/intent suite passed: foreground/busy gating, durable restart,
  32 concurrent duplicates, lost reply, cancellation, expiry, old SDK and failed
  journal writes. Existing native code was unchanged.
- Types, lint, relative docs links and isolated packaged installation passed;
  package verification includes the foreground-install reference and runtime.
- Whole-source architecture check reports two inherited classifier findings:
  read-only `fs.open` in installRequest and fixture reads in liveEngineStop tests.
  Recomputed inventory against exact pre-change `191e051` has identical findings.
  The architecture policy was not widened or suppressed for this feature.

Private raw records, source fingerprints and test logs remain in the ignored
`.build/foreground-install-20261107/phone47/` directory. Bearer tokens, routing
names, signing identities and phone identifiers are intentionally omitted here.
