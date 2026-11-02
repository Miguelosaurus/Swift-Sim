# Bounded compiler cache retention — 2026-11-02

Product implementation: `fea62e23916a6e1fd153085853d2f2b3695d5bdb`, based on
`2d7b5420fd0f3bcb7268a8c2eb34d0f1b31aaa82`. This is a Mac helper change;
no phone app, SDK, engine binary, storage selector, or public release was changed.

## Policy and boundaries

Normal completed-build reconciliation keeps two recent ready compiler workspaces
per app/signing identity, project/workspace, scheme, and configuration. Older
workspaces remain protected by current installation observations, the qualified
compiler manifest, effective confirmed restoration, pending or uncertain delivery,
install/renewal activity, pins, recorded workers, or open files. A verified undo
to the original binary releases its redundant compiler-cache pin without changing
the source journal or its proof. Protected work can exceed the normal allowance.

Only an eligible build's `DerivedData` is retired. Signed installers, icons,
capture metadata, app data, source intent, build history and link-renewal material
remain. Retired builds stop claiming compiler readiness; stale builder saves
cannot revive it. The historical artifact audit, whole-root cleanup jobs, migration
program and read-only diagnostic commands retain their existing boundaries.

Retirement is recorded through the selected authoritative store before an atomic
detach. Engine, queue and build-store ownership are rechecked before detachment;
storage migration/rollback pauses reclamation. Recursive deletion runs outside
the live-engine/queue locks. Recorded root/directory identities support retry
after a process interruption, deletion failure, or failed metadata publication.
There is no startup scan, cleanup daemon, or idle timer.

The operator command `swift-sim prune-build-caches` is a preview.
`swift-sim prune-build-caches --apply` performs fresh guarded reclamation.

## Validation

- All 1,345 source tests passed on Node 24.
- The compiled suite passed 789 tests, with additional hermetic/runtime checks.
- Syntax, architecture, documentation links, types, formatting and lint passed.
- Package content, isolated archive installation, compiled entrypoint equivalence
  and Homebrew formula/Node 24 checks passed. The destructive clean-Homebrew
  installation gate was not enabled.
- New behavioral coverage includes repeated-build growth bounds, independent
  app/configuration allowances, installer/history preservation, active references,
  installation history, pins, live queue locks, stale plans/writers, concurrent
  cleaners, inode/root replacement, symlinks, ENOSPC, interrupted detach/deletion,
  reopening, authority changes/rollback, and the SQLite backend.
- The initial full run encountered an existing subprocess-start deadline flake;
  that test passed in isolation and the final complete source run passed. A test
  fixture import error found during checks was corrected before the final runs.

## Installed Mac acceptance

After merging the implementation into main, the npm-linked primary package was
rebuilt from that exact implementation revision. Preflight found no active builds
or pending deliveries. The helper was gracefully replaced with the updated
runtime; the existing native engine remained running.

The read-only plan identified eight eligible Zenics compiler caches, totaling
14.235 GiB of directory allocation. Open-file observations found no use of those
paths. The supported apply command reclaimed seven; one operation deferred and
was successfully reclaimed by a fresh second invocation. A final preview had no
remaining eligible caches.

Measured available disk space increased from 3.943 GiB to 14.940 GiB, approximately
10.997 GiB during the observation window. Directory allocation and APFS free-space
changes are different measurements; this is not a promise of identical recovery
on another Mac.

Before/after verification established:

- All build-history IDs remained present.
- All eight retained IPA SHA-256 hashes and non-cache build metadata matched.
- All eight caches and their detached directories were absent, with durable
  `pruned` retirement markers and compiler readiness disabled for those versions.
- Current Zenics Debug 40 retained its compiler workspace and readiness.
- The qualified compiler manifest and delivery journal were byte-identical.
- All eight desired-source lanes remained, including two with effective changes
  requiring restoration; the older unresolved receipt remained untouched.
- The engine instance was unchanged and still reported 870 captured compilations.

This proves the installed Mac cleanup and preservation checks. It does not add a
new physical-phone hot-reload qualification or guarantee zero I/O contention
during deletion. No phone update, source edit, reinstall or test patch was made.
