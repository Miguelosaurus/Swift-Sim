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

## Qualification checkpoint

Implementation, native host execution and exact captured compilation passed.
The host exercised four source units and three loaded generations, fifteen
negative bundles, nominal coexistence, private boundaries and two ordinary
optimized artifacts without replacement symbols. Exact device compilation
passed all three variants with one replacement and preserved parent refresh.

After user availability confirmation, physical delivery/rendering/restoration
passed on Zenics 40 in the same process at revisions 4, 5 and 6. The helper-only
request contained one delta and recompiled the root and badge as its cumulative
cohort. Product files are unchanged, synthetic new source paths remain absent,
and no phone restoration obligation remains. See
[physical evidence](../../evidence/CROSSFILE_HOT_RELOAD_PHONE_2026_11_05.md).

Review found a nested nominal guard gap and a rejected-draft correction edge
case; both were fixed and qualified with focused tests. Pure source projection
was extracted to keep the queue within the repository's 800-line size gate.
The final follow-up review found no remaining blocker. All children completed
and were interrupted. No simulator or additional persistent service was created.

The first preactivation request failed before preparation because the operator
launched the test after an activation preflight failure. Its no-admission
evidence is preserved, rather than relabeled as a successful run. Subsequent
activation verified installed candidate provenance before the new qualification.

Final source regression passed 1,388 tests with zero failures. The compiled full
gate passed 805 tests and three hermetic runtime cases; after the extraction and
recovery corrections, 117 compiled queue/runtime/admission/artifact tests passed
serially. Type, lint, source syntax, architecture, documentation, formatting and
primary skill-size gates passed. The final helper includes the reviewed recovery
correction; its existing normal service remains healthy and the engine process
is unchanged. Package archive/install/Homebrew syntax checks use the separate
final log; destructive clean Homebrew installation remains disabled.
