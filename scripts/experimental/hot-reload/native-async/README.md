# Native async replacement experiment

This opt-in host experiment compiles and loads real Swift dynamic replacements.
It is not imported by the helper, SDK, Companion or any release build.

```sh
python3 scripts/experimental/hot-reload/native-async/run.py
```

Requires macOS, Xcode and its `swiftc`/`nm`. Default language mode is Swift 6;
`--swift-version 5` exercises the same compiler in Swift 5 mode. The script
creates a new ignored `.build/async-frontier-<timestamp>/` directory containing
immutable source copies, command output, binaries and `report.json`. It never
connects to a phone, engine or helper. Compilation/runtime steps have a
120-second timeout. Successful runs retain all evidence rather than deleting
failed attempts.

The baseline includes eighteen dynamic members. Two complete patch generations
retain their full signatures and bodies; every generation must contain exactly
eighteen defined dynamic replacement records before the runner loads anything.
The runner checks observable results on existing objects and actors, including
suspended tasks, escaped closures and cancellation handlers created before each
reload. Images remain loaded because old continuations and closures still use
their code. `dlclose` is deliberately absent.

Seven changed-signature compiler probes and the same-label subscript omission
probe compile separately and are **never loaded**. Some invalid signature
changes compile: the experiment records why compiler success cannot replace
semantic admission. Exact observed compiler behavior is checked so another
toolchain requires explicit requalification.

See the [evidence and coverage matrix](../../../../docs/evidence/HOT_RELOAD_ASYNC_NATIVE_EXPERIMENTS_2026_10_30.md)
for the support boundary. Native host behavior is not a physical iPhone
application/root-refresh receipt.

The separate Objective-C callback experiment is:

```sh
python3 scripts/experimental/hot-reload/native-async/objc-callback/run.py
```

It verifies category-based replacement, exact selector/IMP mappings, serialized
rollback and forward compensation. Its bounded Mach-O reader validates
allowlisted category methods **before loading**. `preflight.py ARTIFACT --expect
EXPECTED.json` only inventories bytes; it never loads a library. Unsupported
architectures and pointer encodings reject. See the Objective-C appendix in the
same evidence document for the real four-file compilation results and remaining
device/SDK proof requirement.
