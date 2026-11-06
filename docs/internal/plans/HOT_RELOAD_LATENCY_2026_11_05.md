# Measured Zenics delivery latency

User request: measure real hot reload timings, optimize the largest bottleneck,
keep the implementation lean and do not slow notifications. This is outside
architecture consolidation. No phone SDK, engine, animation or APNs changes.

## Baseline

Task-only runner instrumentation measured three rounds each of captured
JournalView and ContentView compilation. Warm complete preparation was roughly
0.55–0.60 seconds; Swift compilation itself approximately 0.4–0.45 seconds.
Source files remained unchanged and no phone request was made by this probe.

With user-confirmed phone availability, six ordinary durable JournalView title
edit/restore deliveries took 5.474, 4.973, 4.418, 4.271, 3.921 and 3.938 seconds.
All had complete native coverage, preserved refresh and increasing revisions
7–12 in the existing Zenics 40 process. The title was restored after every pair.
Filesystem event observers recorded queue and artifact-marker publication;
they are temporary task processes, not product instrumentation.

The largest avoidable software delay was the 1-second helper scheduling cadence
both before compilation and after the signed patch was ready. Waiting between
prepared publication and application consumed approximately 0.97–1.42 seconds.
Compilation, signing and the intentional phone feedback animation remain intact.

## Targeted change

One nonpersistent kernel subscription watches only the private delivery journal
directory in the existing helper. Queue-publication hints request a coalesced
immediate turn; events while busy become at most one follow-up. The same normal
runtime rechecks locks, immutable intent, identity, expiry, readiness, artifact
coverage and native receipts. Events grant no application authority.

The existing 1-second poll remains as fallback and reattaches a missing/failed
subscription. The public device-build gateway never attaches it. Shutdown closes
the subscription and suppresses pending turns. No extra process, faster timer,
source watcher, global watcher, endpoint, telemetry or per-app setup is added.
Notification reconciliation retains its separate 5-second timer and async path.

Focused tests cover scoped events, reattachment, directory replacement, unsafe
roots, lifecycle cleanup and 1,000-event coalescing while notification callbacks
continue during a blocked live turn. Final qualification repeats the identical
six phone deliveries, then checks full regressions, compiled/package behavior,
normal helper health and restoration before merging/pushing main without a PR.

Task artifacts: `.build/hot-reload-timing-20261105/`; private logs and snapshots
are not committed. Initial disk headroom approximately 99 GiB. No simulator used.
