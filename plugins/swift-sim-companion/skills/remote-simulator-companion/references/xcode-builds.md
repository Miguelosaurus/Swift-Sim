# Ordinary Xcode build integration

Use only when the user wants ordinary Xcode builds kept in Swift Sim history.
For an already registered project/scheme, enable once:

```sh
swift-sim integrate-xcode --project /absolute/App.xcodeproj --scheme App
```

The Debug device hook records signed identity and small metadata, not a duplicate
archive/IPA/DerivedData. It skips Swift Sim-owned builds, Release and simulators.
Remove with `--remove`. It creates no background watcher. Do not enable it across
unrelated projects or edit another active task's scheme.

Imported is not installed. Confirm exact device evidence; never claim hot reload
readiness from a metadata import. Existing Debug SDK receipts can confirm its
launch over the private connection. Read-only history has no installer button.

Only if a local IPA is actually needed, run `swift-sim export-xcode-build
--build-id ID --output /absolute/new.ipa`. This is an explicit caller-owned export,
not a published install link. Do not eagerly export every Xcode build.

Compiler qualification is explicit and experimental: `swift-sim
qualify-xcode-build --build-id ID --result-bundle /absolute/build.xcresult`.
It requires exact phone proof, unchanged pre-build sources, signed output,
qualified flags/linkage and transactional registration. Missing context means the
normal signed-build fallback; never bypass these checks.

History retires only disposable metadata (32 per app/team; 512 total). Installed,
pending, compiler-owned and artifact-backed entries are protected; capacity
fails closed. Never delete Xcode-owned outputs or protected Swift Sim work to
make an import fit. Existing compiler-cache cleanup remains separately scoped.
