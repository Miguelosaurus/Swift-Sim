# Idle helper memory reduction — October 30, 2026

The macOS helper's high idle memory use was caused primarily by allocation
churn in live-delivery polling. The fix is committed as `caf6839` and installed
in the primary checkout. The phone app and native engine were not updated or
restarted for this change.

## Diagnosis and measurement boundaries

The reported Activity Monitor observation was 903.8 MB for helper PID 17789.
That exact earlier observation was not reproduced as a simultaneous heap
measurement. Initial live inspection found about 472 MB physical footprint,
476 MiB RSS and a 1.3 GB peak footprint. Later footprint snapshots fluctuated
around 394–399 MB. These are real process-memory costs, but they are not a
count of live JavaScript objects.

V8 reported 84.8 MiB heap used in the first diagnostic sample, falling to
19.9 MiB after one explicit diagnostic collection. Its external-memory count
was about 4 MB. Native summaries also showed empty malloc regions and V8
pages remaining resident. The OS swapped/compressed accounting varied by
sample: `footprint --swapped` later reported about 9 MB, while the first
`vmmap` summary had about 24 MB in its SWAPPED column. Neither is JavaScript
heap usage, and those different-time readings must not be added together or
presented as exact disk-swap measurements.

A 5.5-second V8 allocation-sampling window, including objects subsequently
collected, estimated 2,921 MiB allocated. The dominant stacks were queue JSON
reads/parsing, snapshot hashing, full source cloning and no-op mutation
serialization. This is cumulative allocated volume, not simultaneous RAM.
The journal was about 12 MB and contained retained immutable source history.

Every one-second delivery turn repeatedly read and validated that history,
then serialized it twice during an unconditional expiry sweep. Confirmed
history also caused unnecessary claim attempts. Activity polling separately
cloned the same source history every five seconds. No active build was needed
to trigger this work. Raising or lowering V8's heap limit would not remove it.

## Implemented change

- `pollingSnapshot()` retains only a detached discovery view without source
  bodies, desired-source snapshots or original binary source baselines.
  Unchanged polls reuse it after checking the journal's private path, owner,
  mode, size, inode and timestamps. A changed or unstable file is revalidated;
  the snapshot does not authorize a mutation.
- Claims, receipt reconciliation and all journal mutations retain the original
  fresh locked read and full source/proof validation.
- Expiry sweeping runs at the next actual request/claim deadline. Confirmed
  history and unchanged disconnected prepared work do not enter no-op claim
  mutations. Foreground changes, lease expiry and new process identities are
  still checked by the existing one-second delivery loop.
- Activity notification discovery uses the same source-free view. Explicit
  delivery, status and compilation retain their full authoritative records.

The fix does not delete history, force periodic GC, set a smaller heap limit,
slow down device polling, change the SDK, or require another phone install.

## Controlled replay

Before/after child processes replayed 20 idle delivery turns against private
copies of the actual journal, with an engine-unavailable adapter and four
activity observations. Both copies remained byte-for-byte identical to the
original. No native delivery, build or notification was sent by the replay.

| Measurement | Previous code | Fixed code |
| --- | --- | --- |
| Full journal reads | 85 | 1 |
| Peak RSS | 1,163.6 MiB | 137.8 MiB |
| Peak heap used | 260.0 MiB | 60.7 MiB |
| Post-collection live heap | 4.1 MiB | 4.9 MiB |
| Total elapsed, including 200 ms deliberate yielding | 8,308 ms | 307 ms |

The replay isolates the hot-reload path; it is not the whole helper's expected
RSS. Both replay children collected once before measurement and after their
last turn. The low retained heap alongside the former high RSS reinforces the
allocation/allocator-retention diagnosis.

## Installed helper observation

After all checks passed, the exact old helper's process identity, user, command
and listener were checked before graceful shutdown. There were no active
builds or live claims. Four stored running simulator sessions were individually
confirmed to have stopped runtimes; no active stream was interrupted.

The replacement helper, PID 11394, serves the same loopback endpoint from the
primary compiled checkout. Its health returned HTTP 200. Native engine PID
36744 retained its exact start time and continued running unchanged.

Without forcing collection in the replacement helper:

- A comparable 5.5-second allocation sample estimated **59.9 MiB**, about 98%
  less allocated volume. Its natural end-of-window live heap was **20.8 MiB**.
- A later native summary reported **244 MB physical footprint**, a **316 MB
  peak**, and **zero swapped/compressed bytes** at that observation.
- Fifteen RSS samples spanning 56 seconds ranged from **266.4–318.2 MiB**.
  Process CPU time increased by 1.81 seconds over that window; the old helper
  had repeatedly shown about 80% CPU during idle polling. The window included
  normal activity/device housekeeping and diagnostic observation.

The kernel summaries, heap samples and RSS series were not taken at identical
instants; they should not be treated as interchangeable counters. This finite
idle observation does not claim a universal memory ceiling or leak proof under
every workload. Actual build and patch preparation can still need more memory.

Six private workflow files stayed byte-for-byte unchanged across installation:
the delivery journal, pairing, build history, compiler manifest, native compiler
map and session descriptor. The installed CLI still returned `hot-reloaded`
for the earlier restoration request at revision 2. No new phone patch or
reinstall was used to validate this helper-only change. Temporary loopback
inspectors were closed after measurement.

## Validation and retained evidence

`npm run check` passed **1,263 source tests, 666 compiled tests and two hermetic
tests**, plus architecture, types, formatting, lint, documentation, compiled
parity, clean archive installation and Homebrew formula/Node 24 checks. The
opt-in destructive clean Homebrew installation was not run.

Regression tests check source-free polling, no repeated idle reads, detached
return values, cache invalidation, unsafe permissions, source tampering, fresh
locked mutation reads, offline/foreground changes and fresh-process restoration.
Existing tests cover expiry, interrupted claims, uncertainty, reconnects,
notifications and receipt safety.

Private copies, replay script, before/after measurements, allocation profiles,
workflow hash checks, rollout audit and live samples are retained in the task
checkout's `.build/helper-memory-replay/`. The full check log is
`/tmp/swift-sim-memory-full-check.log`. Private source and runtime data are not
committed with this report.
