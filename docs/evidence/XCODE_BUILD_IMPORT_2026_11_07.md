# Xcode build import qualification — 2026-11-07

## Scope

Mac-only prototype of ordinary Xcode Debug build import, exact launch
reconciliation, explicit local IPA export and guarded compiler qualification.
No phone actions, app installs, simulator startup, project-wide watcher, service
installation or historical artifact cleanup were performed for this qualification.

## Evidence

- The Node 24 source suite passed all 1,565 tests. The additional Python-suite
  wrapper and primary skill gate also passed after adding them to regular checks.
- Four Python tests cover strict metadata inspection, bad signatures/symlinks,
  idempotent hook install/repair/removal, preserved user actions, skipped managed/
  simulator/Release builds, export overwrite/source-drift rejection and temporary
  copy cleanup on failure.
- Forty-three selected compiled tests passed, including Xcode import, the Python
  suite, native launch reconciliation, compiler registration and HTML projection.
- Both legacy and SQLite stores passed import/deduplication, bounded disposable
  history, protected capacity, exact launch evidence and compiler-readiness gates.
- A task-owned copy of the real Companion project compiled successfully for a
  generic iPhone with signing disabled. Scheme actions ran exactly once before
  and after each build; the post-action observed the finished app. The final
  build used the runtime PROJECT_FILE_PATH, not a hard-coded project location.
- The actual retained signed Zenics Debug 47 passed development-profile/signature,
  executable/Debug-library identity and five signed-input hash checks without
  copying it. An explicit local export produced a valid 43,016,309-byte IPA with
  the correct Payload layout. The temporary export was removed immediately.
- Types, lint, formatting, syntax, relative documentation links, package contents
  and isolated package installation passed. Homebrew formula syntax passed;
  the separately opt-in clean Homebrew installation gate was not run.
- The primary skill remains below its existing 1,200-word limit. New instructions
  are in a lazily loaded reference. New commands do not start a helper or watcher.
- Five update/lifecycle tests also passed. An explicit update now restarts a
  healthy helper when a development update keeps the same release number;
  normal healthy setup remains unchanged. No active builds were present at
  activation.
- Architecture inventory has the identical two violations present at the starting
  commit: the read-only open import in installRequest.js, and the engine ownership
  fixture test's source-text classification. No policy/allowlist was widened.

## Limits

An unsigned Xcode compilation does not prove phone install or launch behavior.
The exact imported-launch reconciliation is exercised with trusted native fixture
receipts; ordinary Xcode-to-physical-phone acceptance remains outstanding.
No hook was installed into another active project's source tree for these tests.

Compiler qualification success is locally tested with injected registration and
linker boundaries. A result bundle, exact phone receipt, unchanged source witness,
required compiler/linker flags, matching signed output and transactional engine
registration remain mandatory in production. This path is experimental until
physical qualification; metadata import never grants hot reload readiness.

Imported records do not own Xcode products. Only disposable metadata is retired,
with protected-capacity refusal instead of unsafe deletion. Existing old installers
and compiler caches were not deleted by this change. Caller-requested exported
IPAs remain caller-owned rather than becoming a hidden automatic cache.
