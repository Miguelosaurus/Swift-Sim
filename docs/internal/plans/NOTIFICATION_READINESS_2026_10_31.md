# Notification and delivery readiness reconciliation — 2026-10-31

## Product changes

- App-focused notification titles and clear success, install, waiting and attention copy.
  Build names come from compiled app metadata rather than IPA filenames. Metadata
  reads happen during build packaging, with bounded safe fallbacks, not idle polling.
- Presentation-only history updates preserve cursor, accepted status and pending
  sends. Updated Companion also suppresses banners for unchanged semantic events.
- Build Current Code asks for confirmation, explains current/uncommitted Mac source,
  full signing work and separate iPhone installation approval.
- Exact-build notification taps resolve fresh authenticated Mac state. Stale rows
  cannot reopen a removed or expired build's previous install action.
- Notification diagnostics distinguish APNs acceptance from phone foreground receipt,
  notification tap and installation. Optional phone settings and scoped observations
  are bounded and validated; diagnostic updates preserve registration/send authority.
- Queued delivery reports missing/stale helper heartbeat, unavailable engine/capture,
  compiler/signing readiness, incompatible capability and mismatched build. Mac-side
  faults are actionable and cannot send misleading open-phone guidance. Ordinary
  disconnected/backgrounded phone waiting and native receipt requirements remain.
  Readiness metadata is owner-only, bounded, throttled and separate from source intent.

## Reviewed validation

The core change is commit `65b77ec367be3b2516c2fdbff94a749c11432973`, pushed directly
on main after review and corrections. Its full gate passed 1291 source tests, 741
compiled tests, two hermetic checks, type/lint/format/architecture/docs and package
installation checks. The destructive clean Homebrew install remains opt-in and was
not run; formula and compiled entrypoint checks passed.

All 46 Companion tests passed on the existing task-owned Activity Tests simulator.
The shared conservative simslim profile verified, including push, universal-links
and keychain-sync service checks. The first unsigned test runner lacked Keychain
entitlements; rerunning with normal local Simulator signing passed all tests. No
application security workaround was introduced. This is development validation,
not physical push-display or stock release performance proof. The simulator was
shut down after testing; no data was erased.

The display-name follow-up passed the full repository gate: 1296 source tests,
746 compiled tests and two hermetic checks, with package checks. It includes real
plist, malformed/unsafe metadata, selected archive product and resume/signing
coverage. The current Git checkpoint identifies its exact source.

## Actual Mac and device state

The updated compiled helper was activated healthy, with fresh persisted heartbeat.
The existing native engine stayed running and both qualified capture file hashes
remained unchanged. Codex plugin `0.6.1+codex.20261031.1` was installed; all twelve
packaged files matched. The original Zenics edit still resolves to its matching
native applied/refreshed proof and revision 1. The subsequent cache edit had its
own confirmed revision 2. These historical proofs do not claim phone state now.

The accidental old Zenics build `a9236f09-084f-40a3-abe1-7aeb28c8d80d` and only its
generated artifact root were removed after restoring original build-31 context and
checking references/open files. The new intentional Zenics build
`0a90edec-963d-4fc1-8e9e-1d46ace9edb6` is a different build 32 and was preserved.
Its catalog display name was reconciled to its qualified signed app's “Zenics”
metadata without changing app identity or source/capture.

Swift Sim Companion build 19 is ready, ID
`46bf3feb-f1f0-4391-a803-382cded615d4`. Its initial export request accidentally used
the default development method. The existing archive was re-exported using the
prior ad hoc method, without recompilation or a new build number. The exported
bundle/version/build, signing team, strict signature and production push entitlement
were verified before ordinary install delivery was published. Build 19 contains
the confirmation popup and notification diagnostics. Apple accepted its legitimate
“Swift Sim — Ready to install” alert at 2026-10-31T19:50:15.021Z. The user subsequently confirmed installation and that the notification arrived.
The new phone diagnostics reported authorized alerts, banners enabled and
Scheduled Summary disabled at 2026-10-31T19:54:36Z. This does not retrospectively
explain the earlier missing Zenics alert. Bearer links stay private.

The user also reported needing three Install taps and that the installed build
still offered Install Update. That follow-up is being addressed with exact
installed-state presentation and install-handoff checks; it is not yet claimed
resolved in this checkpoint.

## Remaining proof boundary and resources

The user reported no background system alert for the intentional Zenics build 32.
Its build-ready event was generated and APNs accepted it, with enabled build-ready
preferences and no outstanding job. Swift Sim was not foregrounded. Foreground
banner suppression therefore does not explain that incident. Its precise delivery
or presentation cause remains unproven; the updated phone diagnostics can narrow
it after installation. Missing app callbacks do not establish non-delivery.

The normal helper, native engine and temporary install delivery remain available
for hot reload, notifications and the active OTA handoff. No login item, global
watcher, simulator erase or unrelated chat/process cleanup was created. Task-owned
unit-test/build processes have finished and the reused simulator is shut down.

Further idle-memory reduction should be measured against the combined resident
processes. A small native resident control plane with short-lived bulky workers
has the largest plausible saving, but keeping delivery and notification paths warm
is essential to avoid cold-start delay. The compiler is already a short-lived
worker. A complete rewrite is not justified solely by an unmeasured memory saving;
prototype and benchmark the narrow resident split first.
