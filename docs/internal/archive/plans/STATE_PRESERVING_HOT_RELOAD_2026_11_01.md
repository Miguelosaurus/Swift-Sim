# State-preserving hot reload

Authorized scope: prove and ship compatible SwiftUI body edits preserving live
state, without per-screen user annotations, app-content uploads, recording or
persistent state copies. Existing manual refresh remains an explicit reset.

Feasibility probes (task-owned offscreen macOS host, no production changes):
- Stable root identity alone: state survives, but replaced bodies remain cached.
- Calling root.body directly: redraws, but root @State is not mounted/preserved.
- Per-view observation of one shared pulse: real dynamic replacements redraw
  parent/child with draft and counters preserved, onAppear stays at one each.

Implementation direction:
1. Debug-only SwiftSimRefresh dynamic property, sharing the existing observer.
   Separate proof revision from the view's remount generation. Explicit native
   request metadata selects preservation; missing/unsupported metadata resets.
2. SwiftSyntax transform adds observation and AnyView body erasure in a private
   per-build VFS overlay. Repository app files remain unchanged. A frontend
   wrapper preserves Xcode's integrated driver, applies only to the selected app module when the SDK
   supports the new public Debug API. No source hooks in Release.
3. Immutable transform receipt, compiler flags and generated-source hashes enter
   compiler capture/resume provenance. Patch generation normalizes only bodies
   proven to have been instrumented. Other changes use the existing reset path.
4. Native strategy metadata/acknowledgement stays bound to the ordinary prepared
   delivery and exact baseline. No extra request/round trip on normal delivery.
5. Qualify real replacement + visual change + state retention on a task Simulator,
   then signed same-identity Zenics update. Keep existing receipt/restart/shader/
   notifications regressions and release exclusion. No public release or PR.

Initial supported preservation scope is concrete non-generic SwiftUI View.body
edits with compatible stored layout. Unsupported source forms must remain
uninstrumented or fail closed, with their ordinary reset behavior explicit.
Never interpret a no-op render or preserved old screen as a successful redraw.

The initial opt-in is body-only. SwiftUI still owns identity inside the body:
replacing a subtree's type or explicit ID may reset that subtree normally. No
promise of restoring destroyed state or preserving arbitrary UIKit controllers.
