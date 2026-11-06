# Stateful components and further bounded latency work

User request: improve hot reload further without bloat or notification slowdown,
and implement state support. Current main is `73137c2`; existing eligible installed
views already retain SwiftUI state across compatible body edits. No existing
stored-layout mutation or arbitrary state migration is implied.

The stated working scope is preserving values in existing/new components and
supporting new State/Binding/Environment-backed views. A clarification about also
changing installed state layouts is pending; continue this bounded scope while
independent compiler and latency work proceeds.

## Feasibility proof

A task-owned, offscreen AppKit/SwiftUI host compiled and loaded two real patch
modules. Keeping the first module's component type fixed and replacing its body
through a private import retained a live State counter from 7 to 11, kept the
same nominal identity, and ran onAppear only once. No state serialization, new
state registry, SDK mutation, installed app or phone action was used. The process
and offscreen window exited normally. Private receipt and sources are under
`.build/stateful-components-20261106/pin-probe/` (exec session 75254 completed).

## Implementation direction

- Pin newly introduced concrete stateful view types to their first module within
  the current verified app process. Emit a private Swift module alongside that
  signed image, then replace bodies/eligible functions rather than re-declaring
  the type. Reuse the existing SwiftSimRefresh observation and AnyView ABI.
- Store bounded origin metadata and layout digests on the Mac, not user state.
  Verify serialized-module/image hashes, private ownership, captured source,
  process identity and proof lineage. Retain referenced origins while needed;
  regenerate them from cumulative desired source in a fresh process.
- Existing storage and pinned layout changes remain fenced. Reject new-component
  stored initialization/type dependencies that would bind silently to an obsolete
  patch-local definition. Introduce wrappers only within qualified concrete views.
- Native receipt counting currently treats an original dynamic slot as a loaded
  replacement. Distinguish original Tx/TX slots from replacement TI/TX entries,
  qualify this with the SDK's native tests, and negotiate the new capability.
  This is a receipt fix, not a second phone state system. A matching Debug SDK
  update will be needed before physical acceptance of these declarations.

## Latency track

A short-lived opaque capability reuse was prototyped and its 57 adapter/runtime
tests passed. Direct measurement then found the allegedly expensive status RPC
took approximately 0.5 ms warm (eight samples, first 2.4 ms). That saving does not
justify a cache and extra rules. The prototype production/test edits were removed;
the private measurements remain in `status-rpc-timings.json`. Keep the current
durability, fresh checks, notification path and animation intact. Focus this
iteration on useful state behavior rather than a speculative tiny speed gain.

## Gates

Native host state/identity/redraw and private-scope tests; compiler and origin
lineage/retention/relaunch/negative tests; SDK original-slot/dead-strip proof tests;
Release exclusion; exact iPhone compilation; then physical values and redraw,
complete receipts and restoration after phone availability. Measure the ordinary
path separately, keep animation and notification cadence unchanged, and finish
with source/compiled/package gates and reviewed main commits without PRs.

No phone mutation has started. The normal helper/engine from the prior task remain
in place; temporary experiments are scoped under the directory above. No simulator
or additional persistent service has been started.

SDK candidate worktree: `.build/stateful-components-20261106/sdk`, branch
`codex/stateful-components-20261106` from pinned `85ba8b7`. The frozen checkout
remains untouched. Its exact submodules were initialized in this new worktree.
The first targeted SDK test run passed both original/dead-strip and new mixed
original-slot cases, but its default test client briefly auto-connected to the
existing engine. That process exited; no phone patch was sent. All subsequent
SDK tests must set `SWIFT_SIM_DISABLE_CLIENT_AUTOCONNECT=1`. An isolated rerun is
recorded separately. Submodule init session 13963 and first test session 1876
finished; the isolated test owns its current foreground exec session only.

## Implemented checkpoint

Production generation, original-slot coverage, process-scoped queue lineage,
signed artifact metadata, serialized-module retention and client capability
checks are implemented. Review fixed last-wrapper removal, wrapper-initializer
captures and transitive serialized-module retention. Normal idle polling carries
bounded metadata only, never user values or source. Existing timers are unchanged.

The SDK receipt correction passed all 29 tests and was published on its main at
`4fb06023ed70050c49a299bced16347772e486e9`; root Debug32 and Release pass. Production
native state retention, captured iPhone three-stage compilation, source1464,
compiled884 plus hermetic/runtime, type/lint/format/package gates passed. See
[evidence](../../evidence/STATEFUL_COMPONENTS_2026_11_06.md). Physical installation
and state retention remain the next acceptance gate, with no phone mutations yet.
