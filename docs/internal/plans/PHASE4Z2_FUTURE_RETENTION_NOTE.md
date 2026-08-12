# Phase 4Z2 future-build retention wiring

Phase 4Z2 wires the Phase 4Z1 retention primitive only for builds that become terminal after this code is running.

- non-live ready builds preserve metadata plus their exported IPA/install payload while heavyweight Xcode intermediates are pruned after delivery is fully persisted;
- live-reload-ready builds also preserve per-build `DerivedData` because the captured patch-compiler context may contain `-I`/`-F` search paths into that tree; result bundles and scratch remain eligible for pruning;
- failed builds and interrupted-build recovery enqueue one deduplicated whole-root cleanup job with a 24-hour diagnostic grace period;
- failed cleanup scheduling or ready-build pruning is nonfatal to build/install state;
- the durable cleanup scheduler rejects any root that is not the canonical store-owned `device-builds/<build-id>` path;
- no startup scan, historical reconciliation, old-IPA eviction, SQLite authority change, or Phase 5 work is included.

The existing real-Mac 42.10 GiB artifact tree must remain untouched until a separate historical cleanup dry-run is reviewed locally. Superseded live-build `DerivedData` also remains a residual until the live-build ownership/supersession lifecycle is explicit; Phase 4Z2 does not guess that ownership.
