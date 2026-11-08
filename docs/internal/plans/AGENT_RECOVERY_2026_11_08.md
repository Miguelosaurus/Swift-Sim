# Agent-handled recovery and interruption qualification

Normal product work outside the architecture-consolidation program. User
requested failure-only agent-handled recovery, with interruption tests, no
normal hot-reload/notification overhead, and minimal user input. No subagents
or extra background services. Phone is available after Mac preparation; ask
before foregrounding Zenics. No reinstall is planned.

## Implementation

One explicit `recover-delivery` command owns a bounded repair attempt. The
existing CLI entrypoint supplies its trusted lifecycle adapter; pure recovery
policy and source-free queue discovery own no process patching. The command
can restore a stopped owned helper, reconcile a mismatched owned helper, or
restart a stale idle worker. Claims, source snapshots and native receipts stay
in the existing delivery queue. A verified matching stopped engine can start
using its existing session/private route; running/unreachable engines cannot
be force-replaced. Busy builds/application defer repairs. Ambiguous targets,
compiler/signing drift and unknown application outcomes remain explicit.

No code was added to the target SDK, helper's normal polling path, APNs cadence
or normal delivery preflight. The command never submits, builds, installs,
clears receipts or executes a native patch. Existing worker and receipt
recovery continue the same request. Agent instructions load this workflow only
after a blocked delivery. Only proven pre-admission helper failures allow an
agent to retry the original edit command; unknown enqueue replies do not.

## Validation

- Durable queue tests: stopped helper, stale heartbeat, sleep-sized clock gap,
  foreground locking, network interruption, lost/unknown native receipts,
  target ambiguity, busy work and malformed engine ownership. Preserve counter
  and draft values; count application once per request.
- Real isolated helper process: start through the actual installed-shape CLI,
  repeat recovery with the same process, then stop and verify cleanup.
- Full source/compiled/package checks, and failure-only module loading gates.
- On the existing Zenics Debug 47 SDK, use immutable temporary snapshots for a
  counter/draft card, helper-only follow-ups, and restoration. Preserve dirty
  product files and unrelated pre-existing uncertain receipts. Qualify real
  helper restart and phone/network interruptions with exact native receipt and
  revision evidence. Simulated timing is not physical Mac sleep/wake proof.

Version candidate: CLI/helper/SDK metadata 0.6.3, agent plugin
0.6.3+codex.20261108.1; engine/SDK dependency remains the published 0.5.7 at
ba3c7166f6712d2cd962005a2a1200de4137590b. SDK code is unchanged; no phone rebuild
is needed. Existing 0.6.2 release/tag/archive remain immutable. Merge reviewed
work into main without PRs. Prepare any public release as a reviewable artifact
before its final publication approval.


## Qualification checkpoint

All Mac checks passed: 1,654 source tests, 1,022 compiled tests, three hermetic
runtime tests, entrypoint equivalence, package install, types/lint/format,
architecture and docs. A later focused 58-test pass includes notification
regressions, actual helper recovery, health diagnostics and lazy module loading.
Successful/no-change CLI paths never load the recovery modules. No architecture
allowlist or cap was widened; lifecycle composition stays in the trusted entry.

On owner-confirmed cellular/Tailscale, the existing Zenics Debug 47 SDK applied
one body-only temporary badge at revision 1 using preserve-state-v1. The helper
was then stopped, a second immutable patch sent exactly once, and its native
handoff reply deliberately discarded by a temporary test adapter. The queue
remained uncertain. `recover-delivery` started the helper and kept the same ID;
the normal worker recovered its exact native receipt at revision 2 from
baseline 1. No second injection command was issued. Product files remained
unchanged. Visual selected-tab confirmation and final restoration are pending.

A synthetic added-State preflight was rejected because two original module
sources differ from the installed build and are not retained as exact originals.
No current product file or captured baseline was overwritten to force that test.
The qualified body-only patch uses the app's existing selected-tab State, needs
no new declarations and compiles/restores against the installed binary. Screen
capture was unavailable, so selected-tab proof requires owner confirmation;
accessibility coverage alone does not establish that state.
