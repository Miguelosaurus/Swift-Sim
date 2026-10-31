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

## October 31 follow-up: compact compiler observations

Source commit `3e61458` removes two remaining sources of idle allocation:
`liveDeliveryAdapter.inspect` retains a compact compiler identity/binding view,
and launch verification uses a bounded projected capture reader. Each poll
rechecks private file metadata, permissions and ownership. Changes invalidate
that reader immediately. The launch projection also carries a full-file digest,
so changes outside projected fields still invalidate an in-flight observation.
Explicit delivery binding continues to read the complete authoritative capture;
store confirmation still performs its existing transaction checks.

Native status remains observed on every hot-reload turn. Neither hot-reload nor
notification intervals changed. No notification preference, APNs configuration,
SDK, phone install or native engine was changed. New regression tests exercise
native status freshness, permission changes, capture identity changes, detached
projections, non-projected drift and actual launch confirmation/rejection with
the cached reader.

The old helper was already stopped when this follow-up began. A fresh run of
previous code established the baseline against the same saved state. This is
important: the previous 244 MB observation was not a fixed idle floor. The fresh
baseline initially measured 254 MB, settled around 142 MB, and had a peak near
310 MB. A minute of baseline RSS observations ranged from 110.8–148.4 MiB.

Comparable 30-second allocation sampling estimated **427.8 MiB before and
208.6 MiB after**, about **51% less cumulative allocation**. The new helper's
footprint later settled to approximately **119 MB without forced collection**.
A final minute of RSS observations ranged from **159.0–189.6 MiB** and ended
with **140 MB physical footprint**. Since the fresh previous-code baseline
also settled near 142 MB, this run does **not** establish a large incremental
resident-memory reduction. The clear measured improvement is less recurring
allocation; the fall from the historical 244 MB snapshot also includes natural
collection, allocator behavior and OS accounting variation.

Its earlier startup/profiling peak still reached about 306 MB: this change is
not a universal memory ceiling, and startup/real work still uses more memory.
The reduction in recurring work is stronger evidence than comparing two
arbitrary RSS snapshots. Both old and new heap samples eventually contained
about 20–21 MiB of live objects; resident allocator/V8 pages explain much of
the difference from that live-heap count.

All **1,266 source tests, 669 compiled tests and two hermetic tests** passed,
including notification, hot-reload, reconnect and launch-confirmation coverage.
Full packaging, architecture, types, formatting and lint gates passed. Clean
Homebrew installation remained opt-in and was not run. The helper was replaced
only after confirming there were no active builds, simulator streams or live
claims. All six workflow files listed above remained byte-for-byte unchanged.
The installed CLI still read the original restoration receipt at revision 2.
No new physical phone patch or push notification was sent as a qualification.

Private raw profiles, RSS series, workflow hashes and rollout details are in
`.build/helper-memory-round2/` in the task checkout. The full check log is
`/tmp/swift-sim-round2-check.log`. Temporary loopback inspectors were closed.

## October 31: physical-footprint qualification

Source commit `d19e69d` targets actual retained memory in the legacy build
history store. The storage-planning hint now retains only its required fields,
not full build logs and provenance. Locked read operations share one private
state snapshot while its inode, nanosecond timestamps, owner and mode remain
unchanged. Mutations still invalidate that view and read fresh state under the
existing lock. Each read still evaluates capability and renewal deadlines;
clock-only expiry is not hidden by an unchanged file. The authority router and
SQLite backend are unchanged.

The returned rows remain detached copies. Tests cover external writers,
mutation freshness, per-call locking, detached results and renewal expiry with
no file change. This adds no poll delay, TTL cache, heap-size cap, forced GC,
periodic restart or extra persistent worker.

Forty history reads against identical private copies of the actual catalog,
followed by the same ten-second idle delay, produced identical result hashes.
Kernel physical footprint was **225.3 MiB before and 123.2 MiB after**. Median
read latency improved from **12.9 ms to 4.5 ms**, and p95 from **16.8 ms to
11.0 ms**. This isolated workload is separate from the whole-helper measurement.

The installed old helper's 24 kernel-footprint samples over about two minutes
had a **144.8 MiB median**, ranging from **144.6–145.0 MiB**. The replacement
helper was warmed without explicit collection and measured using the same
finite sampler. The observations below report physical footprint, rather than
allocation volume or the historical Activity Monitor snapshot.

The replacement's 24 samples had a **113.5 MiB median**, a **21.6% reduction**
from the old helper. The range was **91.4–252.2 MiB**: the high early reading
shows why one short cold-start snapshot is insufficient. A later point was
about 114 MB. Startup peak was about 266 MB. These are kernel-accounted
physical-footprint measurements, without forced collection or a smaller heap cap.

A second, settled one-minute window independently measured a **101.4 MiB
median** and **79.4–114.6 MiB range**. Thus the live-helper median reduction
was about **22% in the first window and 30% in the repeat window**, rather
than only a decrease in allocated bytes.

Full checks passed: **1,267 source tests, 719 compiled tests and two hermetic
tests**, plus architecture, types, lint, formatting, documentation and archive
installation checks. The latest 50 store tests, including clock-only cached
renewal expiry, passed separately and in the compiled gate. The destructive
Homebrew installation gate remained disabled. Physical phone application and
displayed push were not newly exercised by this helper-only change.

There were no active builds, simulator streams or live claims at helper
handoff. Pairing, build history, delivery journal, compiler manifest/map and
session descriptor remained byte-identical. No native engine or phone app was
replaced. The installed helper intentionally remains running for normal hot
reload and notifications; all benchmark children and finite samplers end after
measurement, and no login item or watcher was installed.

Private metrics, copied-catalog benchmarks, finite sampler and ownership notes
are in `.build/helper-memory-round3/` in the task checkout. Full check log:
`/tmp/swift-sim-memory-round3-check.log`. The cold-start peak can still exceed
steady idle memory, and larger real workloads can legitimately use more RAM.
