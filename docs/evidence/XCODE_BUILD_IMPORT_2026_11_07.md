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

## Rollout follow-up

The full Node 24 source suite subsequently passed 1,571 tests; 44 selected
compiled tests passed. Five Python cases now also cover portable CLI discovery.

The Companion project now has one owned pre-action and post-action in a shared
scheme. It resolves the installed CLI from PATH and uses PROJECT_FILE_PATH, so
there is no developer home directory or Apple Silicon-only executable path in
the scheme. Zenics's unrelated dirty project was left untouched.

A genuinely signed, generic-iPhone Xcode build was exercised using a disposable
Companion source copy, an existing development signing identity/profile, and a
separate authority store. Only the fixture's app identifier and push entitlement
were adjusted to reuse that existing local development profile; there was no
provisioning change and the app was never installed. The post-action called the
production importer with that isolated store. Apple signature/profile inspection
kept the normal user keychain context; redirecting HOME itself would prevent
Apple's CMS tool from locating its default keychain.

The real post-action recorded a 2,542-byte metadata entry with a valid source
witness, empty artifact/IPA paths, unknown installation, and no compiler authority.
Repeating the import reused the same entry. Coarse Apple version-number evidence
was rejected, and compiler qualification stopped before engine access without an
exact launch receipt. The fixture was separate from the user's app history.

Both store backends now reject coarse inventory updates for imported binaries:
Xcode can reuse the same build number for a different executable. HTTP and CLI
verification also skip that inventory shortcut. Exact imported launch receipts
remain authoritative. Project aliases resolve to their actual file, while a
sibling checkout cannot borrow its registration; proof also rechecks the signed
project/scheme binding under the store transaction.

These are Mac-side signed-build results. The real ordinary-Xcode-to-phone run,
including its exact launch receipt, remains unqualified until a phone is available.
