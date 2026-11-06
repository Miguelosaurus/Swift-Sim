# Measured Zenics hot reload latency

Measured on November 5, 2026 local time using the existing Zenics Debug 40
installation and the normal Mac helper. No simulator, app rebuild, phone SDK
change, animation change or product-source mutation was used.

## Results

| Measurement | Before | After |
| --- | ---: | ---: |
| Warm request-to-confirmed-refresh median | 4.271 s (5 samples) | 3.210 s (10 samples) |
| Enqueue to compilation median | 0.752 s | 0.285 s (repeat batch) |
| Prepared publication to application barrier median | 1.209 s | 0.479 s (repeat batch) |

Warm end-to-end improvement was **1.061 seconds, 24.8%**. This is a native
receipt-confirmation measurement, including a local status observer polling
every 100 ms; it is not an independent display-paint completion measurement.
Warm samples omit the initial delivery of each batch consistently. Raw initial
samples remain in the private evidence and are discussed below.

Separate on-demand command instrumentation compiled actual immutable JournalView
and ContentView snapshots with the captured iPhone compiler context. Warm complete
preparation took approximately 0.55–0.60 s; Swift compilation approximately
0.4–0.45 s. Signing/publication and device application were measured separately
through filesystem event observations of journal and artifact markers. These
temporary measurement observers are stopped after each batch.

The largest avoidable delay was waiting for the next one-second reconciliation
tick at multiple phases, rather than compilation itself. The change wakes the
existing worker on private journal publication, coalescing a busy period into at
most one follow-up turn. The same lock, scope, expiry, readiness, signed-artifact
and native receipt checks remain in the normal runtime. The one-second poll
remains a fallback. Notification reconciliation keeps its separate five-second
timer; no APNs/provider, phone SDK, engine or feedback-duration code changed.

## Phone proof and unavailable time

The test ran three title edit/restore pairs before the change and repeated the
same six deliveries twice afterward. All **18** requests received complete native
coverage, one Swift replacement, zero Objective-C replacements and preserved
refresh at revisions **7–24**, sharing one installed binary and phone process.
Every pair restored the original title. Source files remained byte-identical.

The first delivery of each optimized batch took about 23 seconds wall-clock.
This is retained, not presented as a fast sample. The repeat added diagnostic
observations only after eight seconds: there was no connected, foreground-ready
matching client through approximately 21 seconds, followed by a ready client at
22 seconds. The request stayed prepared and applied when the client returned;
it was neither rebuilt nor resubmitted. The first batch's engine connection log
is consistent with such a wait, but it did not include the direct readiness probe.
Unavailable-client time is separate from the warm foreground comparison.

All sources and the installed binary were unchanged throughout. There is no
claim of faster cold startup, transport recovery or APNs delivery from this
experiment. A notification scheduling test holds a live turn open, sends 1,000
wake hints and verifies notification callbacks still execute at their unchanged
schedule. Shutdown, scoped watching, reattachment and fallback tests also pass.

## Evidence ownership

Owner-only artifacts are under `.build/hot-reload-timing-20261105/`:
`baseline-offline/`, `baseline-phone/`, `optimized-phone/`, `optimized-repeat/`,
`comparison.json`, activation backups and gate logs. Raw snapshots, process
identities, receipts and local traces are not committed or uploaded. The existing
normal helper remains running for hot reload and notifications; the engine was
preserved. The product adds one scoped kernel subscription in that helper,
without an additional process, source watcher, faster timer or setup step.
