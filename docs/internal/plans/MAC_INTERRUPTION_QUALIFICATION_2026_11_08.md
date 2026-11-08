# Real Mac interruption qualification

Normal product qualification outside the architecture-consolidation program.
Owner requested real Mac sleep/wake and restart recovery, preserving phone
state and preventing duplicate native application. No new SDK, notification
cadence, warm-delivery check, watcher or persistent service is authorized or
needed for the test. Do not infer physical proof from simulated time gaps.

## Test lane

Use the existing Zenics Debug 47 binary and exact captured ContentView original.
Temporary immutable body-only snapshots show a small badge containing the
existing selected tab. Keep Zenics running on the cellular phone throughout;
Mac restart must not be conflated with restarting the phone app, which naturally
resets ephemeral SwiftUI state. Never overwrite product source or unrelated
captures, dirty work, queued requests, native receipts or old releases.

Task resources and resumable one-shot commands are under
`.build/mac-interruption-20261108/`. `plan.json` records the restoration need,
scope, snapshots and captured binary/source hashes. Stable request IDs are
reserved before admission; an ambiguous reply never permits resubmission.
`qualification.mjs` has no automatic system sleep/restart, native UI control,
service installation or watcher. It validates product hashes on every action.

## Acceptance

1. Precompile baseline, sleep, restart and restoration snapshots. Establish a
   native-refreshed badge while Library is selected. Record native process
   identity hash, revision, existing helper/engine ownership and Mac boot time.
2. Prepare the next edit while phone connectivity is temporarily unavailable.
   Coordinate a real short Mac sleep and owner wake, preserving the same boot.
   Save actual power-management sleep/wake evidence. Reconnect on cellular;
   require the same request/snapshot/digest and one exact revision advance.
   Ask the owner to confirm Library remained selected. Recheck revision after
   settling; completion status alone is insufficient to count application.
3. Exercise a successful native handoff with its reply deliberately discarded,
   leaving the durable request uncertain. This task-owned test adapter sends
   once and exits. Coordinate a full Mac restart after saving all evidence and
   the exact resume command. User unlocks/signs in to the Mac and resumes this
   thread; do not create login hooks to auto-resume the test. Prove boot time
   changed. Restore only verified stopped product components through existing
   failure-only recovery. Read the surviving phone process's exact receipt;
   never resend an uncertain mutation. A blocked safe result is a finding to
   fix and retest, not permission to erase or bypass the fence.
4. Require the same phone process, selected tab and exact revision/receipt,
   with no second application after recovery. Restore the original body using
   one final immutable request and native refresh proof. Confirm visual cleanup,
   unchanged product hashes, no test worker left running, and released phone.

Readiness as of preparation: current source/main is 15d1741; local helper/plugin
0.6.3 and existing engine 0.5.7. No product code has changed for this test. The
earlier phone session was released; current availability must be established
before starting these edits. Physical sleep/restart proof is still pending.

## Preparation finding

Two new durable-queue regressions reproduce a complete Mac-side outage after
an uncertain native handoff, with the surviving phone receipt present or absent.
Both failed on the released recovery policy: only the helper restarted; the
uncertain terminal projection hid engine-readiness metadata, so the stopped
engine was never restored to query receipts. The failure-only policy now reads
the existing advisory readiness for uncertain records and restores the verified
stopped session for receipt reconciliation. It never clears the uncertainty,
submits a new intent, repeats application or infers completion from startup.
The missing-receipt case remains fenced; the present-receipt case reconciles
with one preparation/application and unchanged counter/draft. All 66 focused
recovery, restart-safety, durable-worker and lazy-loading tests passed; build,
types and architecture passed. No normal-delivery or notification code changed.
This is deterministic regression evidence, not physical sleep/restart proof.

All four temporary body snapshots compile with one replacement and
`preserve-state-v1`. Product source hashes still match the captured binary.
No phone request has been submitted by this qualification yet.

The full candidate check passed: 1,657 source tests, 1,024 compiled tests, three
hermetic runtime tests, source/compiled entrypoint equivalence, types, lint,
format, architecture, docs, installed-package checks and formula validation.
The destructive clean Homebrew service cycle was not repeated for this
failure-only change; its normal opt-in gate reports skipped. The previously
published 0.6.3 release verification also completed successfully. The running
product helper/engine and public release have not been replaced by this
candidate. Phone availability and the actual system-interruption steps remain
pending. No Mac sleep or restart is claimed.
