# New SwiftUI views and shared helpers

Implement the user's next hot reload improvement outside architecture
consolidation. Keep the existing phone SDK, engine protocols, native complete
replacement receipts, notifications, and ordinary implementation fast path.
No new worker, watcher, recorder, app upload, or per-app setup.

## Bounded compiler surface

Admit new top-level internal/private structs, enums, typealiases and functions,
including in new Swift files inside the captured project. Preserve one generated
source unit per file and private-import boundaries. Existing layout, signatures,
classes, actors, protocols, global storage, macros/property wrappers and added
conformances on installed types remain fenced. At least one installed member
must be replaced; new declarations alone do not prove an effective update.

Shared declaration names are checked against exact original captured module
sources and one another. Retrieve originals from immutable snapshots or disk
bytes matching captured hashes. Missing originals produce a tooling/context
failure, never guessed source authority. Do this only on additive demand.

## Cumulative source projection

Accepted requests remain immutable deltas. Shared compilation includes earlier
desired/queued consumers, bounded by the accepted request sequence and normal
source-size limits. Re-emit consumers for a helper-only follow-up. Store a small
requiresCohort flag with confirmed desired state so expiry/history GC cannot
break that behavior. Preserve revocation and fresh-process recovery fences.
Bind all projected before/after/original source hashes into artifact identity.
Restoration replaces consumers and removes new declarations from desired source;
loaded images/metadata persist until process exit.

Existing eligible parent-view refresh can preserve state. Newly introduced view
types have generation-specific identities; their subtree state can reset. This
iteration starts with stateless views and helpers, not arbitrary state migration.

## Gates and resources

1. Queue/runtime tests: cumulative helper follow-up, pending predecessor,
   sequence isolation, restoration, durable history GC and revocation.
2. Native host: real compiled/loaded shared views and helpers, follow-up,
   old/new nominal coexistence, private scope, restoration, negative bundles,
   and ordinary optimized source without injection records.
3. Exact captured iPhone compilation; all source files remain unchanged.
4. After phone availability, ordinary durable delivery initial/follow-up/restore
   with matching complete native receipts in the same binary/process.
5. Review, repository and compiled/package gates; merge/push main without a PR
   and update installed helper/plugin after accounting for pending work.

Initial disk headroom approximately 100 GiB. No simulator or live phone action
has been started. Task-owned artifacts: `.build/crossfile-delivery-20261105/`.
Queue child owns only queue/runtime and their tests; host-qualification child
owns only its new standalone script. Completed children must be interrupted.
