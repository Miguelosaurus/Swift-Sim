# Callback receipts v3 — restart handoff

Status: **paused at Miguel's request before any installed engine/helper or phone
bootstrap update**. Resume in this Codex chat. This is an incomplete feature
checkpoint, not normal-delivery activation or full Swift/UIKit phone acceptance.

## Verified stable checkpoint

Main and origin/main were `88053e7491bb782ff74b02082fc2c921bb18ad8d` at dispatch.
The preceding [frontier checkpoint](HOT_RELOAD_FRONTIER_CHECKPOINT_2026_10_30.md)
records six scoped phone replacements and a six-member restoration, same
binary/process, revisions 1 → 2, unchanged product source. All seven members of
the real four-file artifact have compiled representation: six Swift replacement
records and one exact Objective-C category mapping. Full mixed physical
acceptance remains unproven.

Primary checkout: `/Users/miguel/Documents/Swift-Sim`.
Working checkout: `/Users/miguel/.codex/worktrees/swift-sim-p4-reconcile/Swift-Sim`,
branch `codex/swift-sim-p4-live-requalification`.
Native SDK/engine checkout:
`/Users/miguel/.codex/worktrees/swift-sim-client-reconnect/InjectionNext`.
Its pre-work HEAD is test-only `d6a3abf`; production runtime pin remains
`43966021a3782af65ecc9e594c7e7a7e3cbf409e` in root Package.swift.

No SDK pin, Zenics integration metadata, app source, signing capability,
developer account, helper process, installed engine or phone app was changed in
this paused continuation. No OTA or native injection was attempted. The earlier
qualification is restored and its desired snapshots revoked.

## Current intended implementation

The user explicitly authorized finishing native callback receipts, full mixed
Swift/UIKit iPhone qualification and normal hot reload integration, using
subagents. Keep no-PR reviewed main integration as the final workflow; do not
merge this incomplete checkpoint into main yet.

The helper sends a v3 manifest:

```json
{"version":3,"swift_replacements":6,"objc_callbacks":[{"class_name":"_Tt...","selector":"scrollViewWillBeginDragging:","replacement_selector":"__swiftSim_full_gUNIQUE_f0_0:","type_encoding":"v24@0:8@16"}]}
```

Envelope key is `replacement_proof`; the canonical hash is `coverage_digest`.
Canonicalization uses recursively sorted object keys, no slash escaping and
callbacks in ASCII order of class/selector/replacement/encoding. Enforce exact
schema, ASCII strings, class length ≤1024, selectors ≤256, encoding ≤512,
≤256 callbacks, ≤512 represented replacements total and ≤12,288 canonical
bytes. Selector aliases cannot collide with any target or other alias on the
same class. Attempt IDs are nonempty strings of at most 128 UTF-8 bytes.

Native engine and SDK ledger identities must bind request, patch digest,
canonical coverage digest, process, baseline revision and claim attempt as
appropriate. Changed expectations must conflict even for cached receipts.
Engine advertises `prepared_replacement_proof_protocol: 3`; SDK advertises
`replacement-proof-v3`. Preserve legacy v2 behavior for legacy requests.

Native must capture an original selector owned by the exact class before
loading. After loading/refresh, require exact original/generated IMP equality,
matching ABI, changed original IMP and dladdr ownership by this loaded patch.
Reject unexpected patch-owned instance **and class/metaclass** methods. Category
registration happens during loading: post-load failure is uncertain, never a
fake no-effect rejection. Objective-C-only requests retain honest zero Swift
count and require their complete callback evidence.

Receipt fields: `replacement_proof_version`, `coverage_digest`,
`expected_swift_replacements`, honest `dynamic_replacements`,
`objc_replacements`, `represented_replacements`,
`complete_replacement_coverage`, `objc_callback_proofs`.
Each callback echoes its four expected fields and requires true
`verified`, `owns_selector`, `implementation_matches`, `encoding_matches`,
`implementation_in_patch`, `previous_implementation_changed`.
Outer proof still requires exact request/digest/binary/process/attempt,
native applied, refresh ACK and increased root revision.

## Helper work at pause

- New `mac-helper/src/replacementProof.js`: normalization, canonical digest and
  pure receipt verification. Focused adversarial tests **8/8 passed**.
- `test/callbackProofAdmission.test.js` is committed at `a1a3b89` and covers
  malformed scalars/attempts, canonical vector, wire bounds, aliases, exact
  callback set, ABI/image flags, honest Swift/Objective-C counts.
- Compiler worker owns `mac-helper/src/fullCallableCompiler.js`,
  `mac-helper/resources/FullCallableGenerator.swift` and
  `test/fullCallableCompiler.test.js`. Inspect its final checkpoint below before
  assuming tests are green. It uses an explicit NodeCommandRunner, per-file
  syntax-tree generation and bounded nm/demangle/otool coverage inspection.
- **Not wired**: liveReload.js, compiler worker entrypoint, liveDeliveryAdapter.js,
  normal queued artifact metadata/validation, package compiled test list, plugin
  instructions/version and final production packaging.

Final helper checkpoint: compiler/resource/tests committed as `29a1374`; pure
receipt test commit `a1a3b89`. Root reran both focused suites together:
**15 tests passed, zero failures**. Unique generation aliases and the shared
canonical normalizer are implemented. The final nonce generator compiled and
generated source successfully; full real-artifact compilation/inspection with
that final nonce version remains a resume gate. Source/digest/metadata cache
and negative unit tests passed. No normal runtime caller uses this module yet.

Compiler API: `createFullCallableCompiler({runner, cacheRoot, resourcePath?})`,
`generate({module, files:[{path,before,after}], generation})`,
`inspectCoverage({dylibPath,generation,moduleName})`. Confirm final API from code.
Use unique per-request generation names in all replacement selectors; restoring
with a reused generated alias would fail native preflight. Include resource and
toolchain fingerprints in compiler cache authority. Use the shared proof
normalizer/digest, exact module and owner matching, all-member coverage, bounded
processes and fail-closed metadata parsing. The tracked mac-helper resource is
copied into dist by the existing build script.

## Native work at pause

Native agent owns WIP in PreparedDelivery.swift, InjectionNext.swift, new
PreparedReplacementProof.swift, PreparedDeliveryEngine.swift, ControlServer.swift,
the app project source membership and native test runner. No engine was built,
staged, activated or pushed. Its final handoff/test state must be reconciled
before commit/pin/activation. New real v3 callback and negative tests are a
required unfinished gate even if legacy tests/typechecking pass.

Native final checkpoint is **uncommitted WIP**, main still `d6a3abf`. Read
`docs/REPLACEMENT_PROOF_V3_WIP_2026_10_30.md` in that checkout. All task-owned
compiler/test processes exited. Existing 17 SDK tests and the legacy prepared
engine harness passed after review hardening; logs are
`/tmp/swift-sim-native-v3-checkpoint-tests.log` and
`/tmp/swift-sim-native-v3-checkpoint-engine.log`. New v3 native callback/negative
tests are **not implemented**. A known remaining hardening item is independent
fresh binary/process identity comparison in native ledger finish, in addition
to the engine's mismatch rejection. No approval, commit/pin or activation is
implied by the legacy test passes.

Independent review flagged baseline-revision/cached identity binding, finish
attempt checking, metaclass inspection, matching cross-language grammar/count
types, unique aliases and full-envelope/request/receipt byte caps. Verify each
in implementation and tests; messages to workers were not acceptance evidence.

## Resume sequence

1. Reconcile both Git heads/status and worker checkpoint notes. Preserve native
   `.build-feedback/` and unrelated Zenics dirty files.
2. Complete native v3 positive/negative/ledger tests and generator repeated
   callback/restore tests; independently review both sides of the wire.
3. Wire full compiler preparation/coverage metadata and strict helper receipts.
   Keep structural/additive/import fences and legacy qualified behavior intact.
   Add callback/full compiler tests to the explicit compiled test gate.
4. Run relevant source/compiled/package/Release-exclusion checks before activation.
5. Commit/review SDK and pin immutable revision. Build and stage the matching
   local engine candidate, preserving the prior engine and private settings.
6. Produce one updated signed Zenics Debug bootstrap preserving identity/data.
   Before this pause all 52 captured app source hashes matched the installed
   baseline. Zenics is dirty; do not commit/discard its unrelated work. Only
   necessary integration revision metadata may change. User must accept OTA
   and return to the app when it is actually ready; do not ask prematurely.
7. Qualify the full immutable four-file variant plus visible root marker,
   complete per-member native receipts and separately proven restoration in
   the same current binary/process. Retain failures and revoke temporary desire.
8. Graduate normal delivery only after evidence; update installed helper/plugin
   deliberately, merge reviewed work to main, verify remote SHA, no PR.

## Storage and build preparation

Free disk was only about **1.8 GiB** at pause. Debug signed-build guard requires
at least 2 GiB; do not bypass it. Standing user cleanup permission covers only
disposable caches/generated outputs after active/open-file checks, preserving
signed products, live compiler outputs, app/simulator data and unrelated work.

The installed baseline's live compilation context points to
`~/.swift-sim/device-builds/be689450-a219-4ff3-bf5e-f5d4b25ccc35/DerivedData`
(roughly 2 GiB). It is protected live compiler input. An isolated APFS clone can
potentially seed a new build's DerivedData without mutating that baseline;
this was investigated but **not executed**. Existing engine build cache is the
native checkout's `.build-engine` (Debug app target). No cache deletion happened
in this continuation. Build/package/provisioning credentials stay private.

All subagents must be stopped at their final checkpoints before restarting
Codex. Do not create an automation or continue in the background while paused.
