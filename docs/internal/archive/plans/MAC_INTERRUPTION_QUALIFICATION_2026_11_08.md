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

## Physical qualification before Mac reboot

The owner foregrounded Zenics on cellular/Tailscale, selected Library and
cleared the Mac for interruption. The baseline badge refreshed at revision 4
from 3. The first real trial disconnected the phone during a handoff; engine
metadata briefly retained the old connected client. The request became uncertain
and stayed fenced. Actual system sleep, maintenance dark wakes and keyboard wake
were recorded. The same phone process returned at revision 4 and the owner
confirmed Library remained selected, but no native receipt existed. Recovery
correctly did not replay the mutation; automatic edit recovery did not pass.
The current receipt protocol cannot prove non-admission from a missing ledger
entry. An owner-controlled clean phone relaunch safely rebased the desired edit
and preserved the original uncertainty as superseded evidence. This is an
explicit limitation, not a successful state-preserving recovery of that edit.

The second trial held a fully prepared request before handoff, with the owned
helper stopped and no injection command sent. The phone stayed on cellular with
Tailscale. Power logs show 53 seconds of real system sleep and a keyboard wake,
with the same Mac boot. Explicit recovery started the helper; its ordinary worker
resumed the same request, snapshot and prepared image. Its exact native receipt
advanced revision 1 to 2 with preserve-state-v1 in the same phone process. A later
distinct request advanced revision 2 to 3, so no duplicate of the sleep request
was observed. Final owner tab confirmation remains part of the reboot check.

The reboot test is staged with one successful native handoff, its reply
deliberately discarded, and the owned helper stopped. The queue remains uncertain
at baseline 2; a read-only query saved its exact applied/refreshed receipt at
revision 3 without reconciling the queue. No second injection command was sent.
The phone process must stay alive through the Mac reboot. The old boot time and
receipt/process hashes are saved under the task evidence directory. A full Mac
restart and post-boot recovery are still pending. Do not claim reboot acceptance
or erase the first trial's missing-receipt limitation.

## Actual Mac reboot result

The boot identity changed from October 31 to November 8, proving a full restart.
The helper and engine were absent. Recovery started the helper without replaying
the uncertain request, then refused stale descriptor fingerprints/session/version
metadata. Deep inspection verified the existing project, SDK and private route;
no rebuild, reinstall or network reconfiguration was needed.

The supported engine start then exposed a real stale-record bug: the ownership
boundary returns an empty numeric projection for a dead versioned engine record,
while stopLiveEngine treated every nonnumeric projection as unverifiable. The
fix retires only a parsed record with both kernel identity absence and ESRCH,
an absent/refused Unix listener, an unchanged reread, and a second absence check.
It never signals that PID. Malformed records, live/reused PIDs, permission errors,
active sockets and ambiguous probes retain all records. The regression uses a
real exited child and a real live Unix listener; 22 focused tests and architecture
passed before using the fixed CLI on the actual post-reboot stale record.

After guarded startup, the ordinary helper recovered the original uncertain
request's exact native receipt. Its process hash, request, image digest, attempt,
coverage and revision match the saved pre-reboot proof; revision stayed 3 across
settled rereads. Exactly one injection command was sent before reboot and none
were resent afterward. The owner confirmed “Restart · library” and Library
remained selected. The restoration request then refreshed the original body at
revision 4 from baseline 3 in the same phone process. The owner confirmed the
badge disappeared and Library stayed selected. The phone has been released;
no further phone actions are queued. Deep inspection republished a fully
validated descriptor for the current project/capture/engine session; readiness
and descriptor validation both pass.

This proves agent-handled recovery with setup revalidation, not a single-command
automatic success on the initially stale setup. The separate missing-receipt
network handoff from trial 1 remains fenced and is not claimed fixed. Changes
are confined to explicit recovery/stopped-engine lifecycle; no target SDK,
notification interval, watcher or normal hot-reload preflight was added.

## Completion

Full post-fix checks passed: 1,658 source tests, 1,025 compiled tests, three
hermetic runtime tests, entrypoint equivalence, types/lint/format, architecture,
docs, package installation and formula validation. The opt-in destructive clean
Homebrew service cycle was not repeated. Fixes were reviewed, fast-forwarded to
main and pushed at `3eb9107`, without a PR. Hosted verification starts normally
on that push; the local results above are the completed check evidence.

The primary checkout was rebuilt and its helper explicitly reloaded through the
existing setup lifecycle. One normal helper now runs from the primary dist;
the restored 0.5.7 engine stayed unchanged through that reload. Existing agent
integrations were refreshed without a new instruction/version contract. No new
public release/tag/archive was published or rewritten. Phone cleanup and
Library preservation are owner-confirmed. No test worker, watcher, relay,
scheduled wake or simulator remains. Temporary native preflight outputs were
removed; receipt, snapshot and power-event proof is retained under the task
directory. The one product helper and engine intentionally remain running.
