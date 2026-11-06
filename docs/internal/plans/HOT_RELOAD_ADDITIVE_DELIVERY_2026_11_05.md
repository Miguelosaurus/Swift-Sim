# Bounded additive hot reload

User-authorized next hot-reload improvement: support ordinary private helper
and patch-local type additions, then preserve eligible SwiftUI state through
that path. This is outside architecture consolidation. Keep native receipt-v3,
binary/process identity, whole-change compilation, uncertain-state fences and
Release behavior unchanged. No new idle service or target-app recorder.

## Initial surface

- New private/fileprivate functions, including helpers on existing types.
- Top-level private/fileprivate structs, enums and typealiases, with no
  Objective-C additions, new existing-type conformances or stored layout edits.
- Ordinary imports available in the captured compiler/SDK context.
- Every pre-existing declaration stays present, in order, with unchanged
  signature/storage. Newly added declarations may change or disappear in later
  desired source; their already-loaded metadata is retained until process exit.

## Compiler and lifecycle integration

Reuse FullCallableGenerator and its versioned cache. Strip bounded additions
for the existing full-callable structural comparison, emit them in their
original per-file scope, and compile the whole bundle without global disabled
access control when additions are present. Preserve only captured eligible
SwiftUI bodies and safe private consumers on the same instrumented view;
retain root remount otherwise. Avoid widening arbitrary state migration.

Keep accepted intent snapshots and digests incremental. Project each file's
immutable installed baseline into compilation only, checking its SHA against
the exact binary capture. Re-emit current additions from installed source to
desired source. Also force original existing members changed by the incremental
intent, so returning to installed source really restores dispatch. Never treat
a helper from a previous patch as part of the installed module. Fresh-process
recovery keeps the existing cumulative desired-state path.

## Proof gates

1. Native host generator/compiler/runtime tests across additions, subsequent
   edits, repeated generations, restoration and private-name collisions.
2. Negative layout/signature/import/macro/conformance/partial-bundle tests.
3. Queue/adapter/compiler regression and preserved-state qualification.
4. Exact physical-phone compile, complete replacement and native refresh proof,
   followed by restoration using immutable snapshots. Phone availability must
   be confirmed before sending a visible qualification edit.
5. Review and full checks, then merge/push main without a PR and update installed
   helper/integration only after accounting for existing pending artifacts.

## Ownership and resources

Read-only review child `/root/additive_review` supplied baseline/proof guidance
and was interrupted after returning its findings. No phone action, simulator,
watcher or server has been started for this work. Initial free disk: 99 GiB.

## Pre-phone checkpoint (historical)

The full compiler now strips/emits bounded additions in separate source files,
uses verified installed baselines only in compilation projections, forces
restoration consumers and negotiates complete coverage. Ordinary implementation
edits retain the cheap classifier and original parser path. A compiler failure
does not become a signed-build fallback. Patch cache identity includes captured
compiler-context semantics, and old incomplete contexts reject additive admission.

The native host harness passed three loaded generations, helper-only follow-up,
same-name private scopes, nominal coexistence, restoration and seven negatives.
All three immutable JournalView variants compiled for the exact installed Zenics
40 iPhone capture with one replacement and preserve-state-v1. A final ContentView
tab-title variant also passed all three compilations with the original actor,
lexical and package flags restored. Product files were unchanged; no phone edit
has been submitted yet. The full final regression run passed 1,369 tests, zero
failures; type, lint, source, architecture, docs, format and skill-size gates pass.

Review found that original compiler capture omitted default actor isolation.
The retained build-40 activity log recovered the exact 98-command registered map
(matching its existing map digest). Its ten Zenics contexts used Swift 5 with
default MainActor isolation. The live metadata was enriched from that exact map
under the lifecycle lock, with private backups, without a new build, engine
registration or engine restart. New captures preserve joined/paired concurrency,
package and relevant lexical flags and publish compilerContextProtocol 2.

One expired uncertain request for an older binary remains preserved. The current
Zenics binary has no pending request or active claim. Do not delete the foreign
fence or its artifacts during deployment. Normal helper PID 54166 and engine
PID 86692 are still the existing processes; the helper feature code is not yet
activated. Phone availability was requested asynchronously and remains pending.
Source and proof files are under `.build/additive-delivery-20261105/`; retained
frontend command evidence and capture backups are private mode 0600.

Candidate implementation commit: `3e1fcfe`. Compiled checks passed 794 tests
plus three hermetic runtime cases; the new compiled additive routing cases also
passed. Package-content, isolated archive installation and Homebrew syntax gates
passed. The destructive clean Homebrew installation gate was not enabled.
The final independent code review found no concrete blocker. No phone patch has
been submitted and the new helper code is not activated or merged into main yet.

To finish after phone availability: activate the reviewed compiled candidate in
the primary checkout, after fresh active-build/session/current-binary pending
checks. Replace only the existing normal helper gracefully; preserve engine
PID/identity and the foreign uncertain fence. Then run the explicit phone
qualifier with `--phone-ready`, using
`.build/additive-delivery-20261105/captured-root-final/snapshots.json` and a fresh
output directory. It performs initial private function/type/SDK-import delivery,
helper-only follow-up and restoration through ordinary durable delivery. Verify
native complete coverage, preserved-refresh receipts, increasing revisions and
same binary/process. Retain any cleanup obligation if a request becomes uncertain.
Record physical evidence, merge/push main without a PR and update the Codex
plugin to `0.6.1+codex.20261105.6` only after qualification. No new app install
is expected: the existing Debug SDK/stateful ABI is unchanged.

## Completed phone qualification

After the user's availability confirmation, the reviewed helper was activated
without restarting the engine or rebuilding Zenics. All three immutable root
tab-title generations received complete native replacement and preserved-refresh
receipts on the same existing Zenics 40 binary/process, at revisions 1, 2 and 3.
The final generation restored the original source/title; product source hashes
are unchanged. No current-binary pending request, active claim, or restoration
obligation remains. The foreign uncertain fence is preserved.

The initial disconnected submission exposed a cached baseline-only process
recovery marker that stranded later intent. Commit `d3460ec` fixes this only
for new pre-apply intent and a verified revision-zero process, retaining existing
lease/effect fences and accepted expiry. The original request was resumed through
its replacement pointer, never resubmitted. The runner supports explicit resume
with retained snapshot checks. An independent read-only review found no blocker.

Final regression passed 1,370 tests; compiled checks passed 795 tests plus three
hermetic runtime cases; four compiled additive-routing cases passed. Type, lint,
source, architecture, docs and format gates passed. See
[physical evidence](../../evidence/ADDITIVE_HOT_RELOAD_PHONE_2026_11_05.md) for
proof boundaries and private artifact locations. The normal helper remains for
hot reload and notifications; no additional persistent service was created.
The prior resource PIDs and pending status above describe only the historical
pre-phone checkpoint, not the completed qualification.
Package contents, isolated archive installation, and Homebrew syntax/entrypoint
checks also passed for the final code. The destructive clean Homebrew install
gate remained disabled.
