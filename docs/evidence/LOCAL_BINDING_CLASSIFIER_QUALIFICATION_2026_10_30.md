# Local binding classifier qualification — 2026-10-30

Status: candidate implementation; physical application/refresh and baseline
restore are pending. The installed helper/CLI remain on reviewed main while this
candidate is held in the task checkout. No permissive cutover is authorized by
the compiler or host-native results alone.

## Reconciled agent feedback

The Zenics agent supplied a minimal method-local `let` reproduction and four
captured scheduling edits. The current declaration scanner collected local
bindings as though they were structural declarations. The candidate compares
bindings within existing callable/computed implementations as part of those
bodies. Nested nominal declarations and their stored members remain structural,
including multiline headers and escaped/Unicode identifiers.

Imports, additive helper/type declarations, stored state, signatures, attributes,
conditional compilation, resources, packages and signing keep rebuild fences.
Additive helpers/imports are current support limits, rather than a universal
claim about Swift runtime impossibility. The generator assumes existing
replacement targets and does not safely package arbitrary added declarations.

The notification request is already delivered separately: ready-build APNs taps
resolve authenticated current build details inside Companion, Apple accepted
real alerts, and the user confirmed receipt. Compact history, applied alerts on
by default, the historical-expiry popup correction, production Companion catalog
visibility and app-specific build alert titles are recorded in
[the activity refinement evidence](ACTIVITY_INBOX_DEFAULTS_REFINEMENT_2026_10_30.md).

## Complete replacement and explanations

The captured edits exposed a second limitation: an unsupported async method
could be omitted while supported methods produced a nonempty patch. The
candidate rejects an incomplete representation before compilation/application;
it never reports a supported subset as the complete logical update. The bounded
compiler worker preserves an explicit `QUEUED_MECHANISM_UNSUPPORTED` result.
Cached artifacts and previously prepared journal records without the current
coverage/snapshot stamp are revalidated before admission; a legacy partial
bundle cannot bypass the new completeness checks after an update.

| Captured file | Classification | Replacement source generation |
| --- | --- | --- |
| ThumbnailPipeline.swift | Implementation-only | Unsupported complete async form; fenced |
| ThumbnailDiskCache.swift | Implementation-only | Unsupported complete async form; fenced |
| LibraryView.swift | Implementation-only | Complete source generated |
| DataStore.swift | Implementation-only | Complete source generated |

Generation is not compiler, application or physical proof. These observations do
not establish that the entire historical four-file update can now be delivered
live. Its unsupported async forms still require a signed build.

Compact live-only failures identify the first safe filename/member/line, rule
category and additional rejected-file count. Successful signed-build handoffs
retain their existing message and add optional bounded `rebuildReason` text.
Schema 2 readers may ignore that additive field. Verbose diagnostics contain a
bounded sanitized per-file list. Raw source, private paths and credentials are
excluded from these explanations.

## Qualification evidence

- Semantic scope fixtures cover implementation locals, accessors, initializers,
  control-flow and closure bindings, true layout/signature changes, malformed
  delimiters, comment/string decoys, nested nominal types and escaped/Unicode
  identifiers. Independent review found two new permissive edge cases; both
  were corrected and captured in 22 additional negative regressions. Further
  checks cover bodyless protocol/external declarations, global/static-extension
  initializers and a 40-case nested-layout/callable/header matrix.
- The 69-case Phase-7 preparation corpus retains its original dispatch tuples.
  Classifier version 2 explicitly requalifies five stricter inline-modifier and
  incomplete-syntax expectations. The current differential is 54 equivalent,
  11 stricter and four still-disabled regex relaxations. This is a bounded
  correction to the current classifier, not a SwiftSyntax analyzer cutover or
  completion of the architecture-consolidation program.
- Real native XCTest compiled baseline and replacement dylibs, loaded them and
  observed six existing methods on a pre-created instance change from 1 to
  2–7. Exactly six dynamic replacement definitions were counted. Cases cover
  constant, mutable, guard, conditional, switch-case and closure-local bindings.
  No root-refresh acknowledgement was fabricated. Native test-only commit:
  `d6a3abf`; runtime SDK source and its pinned revision are unchanged.
- Source, architecture, documentation, type and lint checks passed. Broad Node
  and compiled results are retained in `/tmp/swift-sim-local-scopes-*.log`;
  final reviewed totals are recorded with the final qualification checkpoint.

### Final automated checkpoint

Full `npm run check` passed at implementation commit `4b1e6b9`: **1,231 source
tests, 634 compiled tests and two hermetic tests**, plus syntax, architecture,
documentation, types, formatting, lint, package contents, clean archive install,
source/compiled entrypoint equivalence and Homebrew formula/Node-24 checks.
The destructive clean Homebrew installation gate remains opt-in and was not run.
Another **126 compiled classifier/delivery tests** passed. Independent review
also ran 50 storage/layout probes with no permissive result after the fixes.
Logs: `/tmp/swift-sim-local-scopes-final-reviewed-gate.log` and
`/tmp/swift-sim-local-scopes-final-extra-compiled.log`.

The subsequent checkpoint only clarifies packaged guidance and records these
results. Candidate Codex integration `0.6.1+codex.20261030.2` is prepared but is
not installed; the production checkout remains on `3919e39` while the physical
gate below is pending. No new signed Companion build is required by this change.

## Physical boundary and retained failed attempt

A first qualification request entered the ordinary queue and was rejected by the
installed compiler's old declaration classifier before Swift compilation or
application. Its durable failed record was retained; it was not edited into a
success or blindly retried. The generic compile-failure wrapper obscured this
policy rejection; the candidate worker now preserves recognized typed causes.

The candidate was then exercised in a separate qualification queue using the
existing exact signed Debug capture and normal native identity/revision gates.
Its temporary ContentView edit contains the binding forms above and changes the
Library tab label to `Library ✓`. The patch compiled and was prepared, but is
waiting for the phone. The app's source file on disk remains byte-identical to
the original; immutable snapshots hold the temporary test.

Before enabling the candidate or updating its packaged instructions, require a
matching applied replacement, root refresh, increased revision and a separately
proven restoration of the original label. Preserve every valid failed physical
attempt. Neither an APNs receipt, generated source, compiled patch nor the native
host test closes this physical gate. Private queue/artifact receipts remain in
the ignored `.build/local-declaration-proof-20261030/` qualification directory.
