# Stateful component qualification, 2026-11-06

This expands new-component hot reload to concrete, unnested SwiftUI views with
State, Binding and Environment while leaving installed type layouts fixed.
SwiftUI owns all values. The Mac pins the first nominal type within the verified
process, retains bounded private module/image provenance, and replaces its
methods. There is no value serializer, phone registry, new background worker,
notification cadence change or animation timing change.

## Native behavior

The production generator and coverage inspector compiled three patch modules
against a real SwiftUI host and the product SwiftSimRefresh wrapper. A live
counter was changed to 7, a bound draft to `draft`, then the view body and a
separate shared helper were replaced. The counter advanced to 11 afterward,
the bound draft stayed intact, nominal identity remained equal, and onAppear
ran exactly once. Environment access compiled and ran in the same view.

Native receipt: `STATEFUL_NATIVE_PASS count=11 draft=draft appearances=1
sameType=true helper=20`. The wrapper used a minimal host-only observer; it did
not contact the engine or a phone. The offscreen AppKit host exited normally.

Additional generated modules introduced a second pinned type, removed the first
from desired source, then compiled a later generation using the surviving type.
The private module dependency remained available without directly importing a
removed component. Mac metadata retains the bounded transitive origin closure
until whole-baseline restoration or a fresh process. Queue tests cover expiry,
GC, source-free polling, revocation, new-process regeneration and capacity
reservation before native admission.

Negative native checks reject field/default/layout changes, loss of wrappers,
patch-local initializer captures (including wrapper arguments), generic views,
unsupported wrappers and cross-file access to private helpers. Unrecognized
original dynamic slots cannot masquerade as loaded replacements.

## Exact captured iPhone compiler

Immutable snapshots of Zenics Debug 40 were compiled using its actual captured
iPhone SDK, compiler flags, actor defaults and private module context. Introducing
a stateful view compiled with one real installed-body replacement plus known
original slots. A helper-only follow-up reused the same component module and
compiled two real replacements. Restoration compiled one real replacement.
All three selected preserved refresh. Product source files were unchanged and
no phone requests were made during this check.

The native receipt correction is committed on InjectionNext main as
`4fb06023ed70050c49a299bced16347772e486e9`, based on the previous pinned `85ba8b7`.
All 29 isolated SDK tests pass. Swift Sim Debug tests pass 32 tests; its Release
build passes. The root package pins the new immutable SDK revision.

## Ordinary-path latency

Six captured preparations before and six after, across root and journal body
edits, measured warm medians of 668 ms and 652 ms respectively (last four samples
of each run). This small sequential sample demonstrates no apparent preparation
regression; it does not establish a further end-to-end phone speedup. A separate
capability RPC measured about 0.5 ms warm, so the proposed reuse cache was removed.
The prior 4.27-to-3.21-second physical optimization remains the established result.

## Checks and proof boundary

The final source suite passed 1,466 tests. Compiled checks passed 886 plus the existing
hermetic and runtime gates. Type, formatting, lint, architecture/docs, package
contents, isolated package installation and Homebrew entrypoint checks passed.
The destructive clean Homebrew installation gate remains disabled.

Private sources, receipts and logs are under
`.build/stateful-components-20261106/`, including `host-dependency`,
`captured-first`, `ordinary-before`, `ordinary-after`, SDK and root build outputs.
The frozen SDK checkout remains untouched. No simulator or extra persistent
service was started.

## Physical iPhone acceptance

Zenics Debug 41 was installed and launched, with the root package at `08e2bdd`
and native SDK at `4fb0602`. Immutable snapshots added a parent with State
counter/draft fields and a separate concrete child with Binding fields and
Environment access. The user changed the counter to 1 and entered a draft word.
A helper-only update changed the heading to `State 2: 1`; the user confirmed the
word remained, then tapped Add one and confirmed the count advanced to 2.

The normal durable workflow proved all three stages at revisions 1, 2 and 3 in
the same binary and process. Real replacement counts were 1, 3 and 1; original
new-component slots were separately verified. The last stage restored the
installed source baseline and removed the test card. All product source hashes
remain unchanged. This combines exact native replacement/refresh receipts with
explicit user observation of retained nondefault values and continued input;
the accessibility context did not expose the new card's text reliably, so it is
not claimed as an independent automated reading of those values.

Two acceptance issues were handled openly:

- An initial request stopped at pre-admission validation because an older helper
  had created the patch container as 0755. The current code migrates only the
  owned, non-writable container to 0700 before private module publication. It
  continues rejecting linked, foreign or writable containers; two regression
  tests cover the migration and refusal. No code from that first request applied.
- A connection drop lost the follow-up acknowledgement although the phone showed
  preserved values. The request stayed fenced as uncertain. One logical engine
  recovery exposed an unrecorded older engine still holding the phone port; that
  verified process and an intermediate replacement were stopped. The sole
  replacement engine then recovered the native process-lifetime receipt for the
  exact same operation through the existing native deduplication path. Retransmitting
  that identity retrieved its cached result; no new edit or second native load
  occurred. Only after this receipt cleared uncertainty was restoration delivered.

This does not establish automatic recovery from every connection failure. The
state feature's native receipt requirement remains strict. The user observed
successful retention, and the later exact receipt confirmed all replacements;
a visible heading or notification alone was never treated as completion.

The existing helper and one correctly recorded engine remain for ordinary hot
reload and notifications. Codex plugin `0.6.1+codex.20261106.9` is installed. No
temporary test process or simulator remains. The previously protected foreign
uncertain request remains preserved. New pinned stored layouts remain fenced;
there is no arbitrary installed-state migration or persistence across real app
termination.

Final checks also keep the primary agent skill at its existing 1,197-word size;
details remain in the lazy integration reference. Architecture rules pass without
raising caps: file-mode changes go through the existing filesystem infrastructure
and tests read only controlled fixture bytes.
