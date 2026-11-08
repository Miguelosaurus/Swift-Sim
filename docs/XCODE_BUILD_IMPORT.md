# Ordinary Xcode builds

Swift Sim can record ordinary Xcode Debug builds in the existing app library.
Enable it once for an already registered project and scheme:

```sh
swift-sim integrate-xcode --project /absolute/App.xcodeproj --scheme App
```

The integration adds two scheme actions, using the app target's build settings.
It preserves unrelated actions, leaves signing and application source alone,
and skips simulator, Release and Swift Sim-managed builds. An absent helper or
failed import does not fail the Xcode build. No watcher or background process is
started. An existing shared or unambiguous user scheme is used; otherwise a
shared scheme is generated only for an exactly matching app target.

Remove the owned actions with the same command plus `--remove`. One original
scheme backup is kept privately per scheme; there is no backup per build.

## Identity and installation

After a successful signed device build, the post-action verifies the development
signature and profile, records the executable and Debug library UUIDs, and hashes
signed app inputs. The project, scheme, bundle and team must match an existing
Swift Sim registration. Repeating the same import reuses its entry. Changed
resources cannot silently reuse an already recorded binary identity.

An import is labeled **Built in Xcode**, with no installer button. It is not
installation proof. Xcode can reuse a version/build number for a new executable,
so Apple inventory with only those numbers cannot confirm an imported build.
Existing project aliases are matched by their actual project file; another
checkout stays a separate registration. An existing integrated Debug SDK can confirm the exact
running binary through the existing private connection; no extra phone polling
is added. Apps without that SDK remain unconfirmed by this remote path. This
prototype accepts thin arm64 development builds with a Debug library.

An import can also be requested explicitly:

```sh
swift-sim import-xcode-build --app /absolute/Debug-iphoneos/App.app \
  --project /absolute/App.xcodeproj --scheme App
```

## Storage

Import creates a small metadata record. It never copies the app, archive,
DerivedData or IPA, and never deletes Xcode-owned products. History groups by
the existing app identity. Disposable imported metadata is capped at 32 entries
per app/team and 512 total. Installed, requested, compiler-owned or artifact-backed
entries are protected; if protected entries fill the allowance, import stops
with a capacity message rather than deleting them or growing without a bound.

The pre-action overwrites one small private source witness per project/scheme.
It runs only during a full Xcode build, outside hot reload and notifications.

Create a downloadable file only when needed:

```sh
swift-sim export-xcode-build --build-id BUILD_ID --output /absolute/new-copy.ipa
```

This explicit local export rechecks the signed inputs, uses one temporary copy,
checks free space and size limits, and cleans its temporary directory on failure
or completion. It never overwrites an existing file. The output is caller-owned;
it is not silently cached, published, or given a Companion download link. If Xcode
has overwritten or removed the original product, export declines safely.

Swift Sim's existing completed-build retention separately bounds superseded
compiler workspaces and protects current installations and queued live work.
This integration does not run a historical cleanup or delete old user files.

## Compiler qualification

Recording a build never enables hot reload by itself. An explicit result bundle
from that same build can be qualified with:

```sh
swift-sim qualify-xcode-build --build-id BUILD_ID \
  --result-bundle /absolute/build.xcresult
```

Qualification requires the exact phone launch receipt, an unchanged pre-build
source witness, matching signed outputs, captured frontend commands with the
required dynamic/private-import flags, the app Debug library linked with
`-interposable`, linker compatibility, and a transactional engine registration.
It does not change project flags or manufacture missing compiler context.
Ordinary Xcode GUI builds do not automatically supply a result bundle; an
unqualified entry keeps the normal Swift Sim signed-build fallback. This compiler
path still needs physical qualification before it is treated as normal delivery.
