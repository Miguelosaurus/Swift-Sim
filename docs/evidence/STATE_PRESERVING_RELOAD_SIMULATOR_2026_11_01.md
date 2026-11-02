# State-preserving reload qualification

Qualified on a task-owned iOS 26.5 Simulator with the conservative simslim
profile; push, universal links and keychain requirements verified. This is
functional Simulator evidence, not physical-phone acceptance or a stock-device
performance measurement.

The real Xcode integrated driver compiled original app source through the
private overlay. The captured frontend map included that overlay and its
immutable manifest, wrapper, generated inputs and actual SDK-capability probe.
Original repository app source bytes stayed unchanged. Engine source:
`85ba8b7e6f2057b7249b87f5c45bb866d825ceaa`, signed local candidate 0.5.5.

## Real delivery

The fixture populated a root draft, counters, selection and NavigationStack,
then scrolled a detail screen. The normal complete-callable compiler generated
two body replacements; the ordinary prepared-delivery adapter signed and sent
them through the native engine/client. No fake refresh or direct test notification
was substituted for native delivery.

| Observation | Before | After |
| --- | --- | --- |
| Root draft | fixture unsaved draft | unchanged |
| Root count | 42 | 42 |
| Selection | 7 | 7 |
| Navigation path | `[1]` | `[1]` |
| Detail count | 17 | 17 |
| Toggle | enabled | enabled |
| Root/detail appearances | 1 / 1 | 1 / 1 |
| Scroll offset | 3639.3333333333335 | 3639.3333333333335 |

Both replaced bodies executed their new markers and the accessibility surface
contained the updated row text. The exact v3 native receipt acknowledged
`preserve-state-v1` at revision 1 with complete two-member coverage. Repeating
the same request returned the same receipt without a second refresh.

A separate helper-method replacement selected `remount`, acknowledged revision
2, and reset the root draft/count/navigation to their original values. This
proves that normal reset behavior remains available for other callable edits.

## Boundaries and checks

- SDK tests cover policy/baseline validation, one-use consumption, exact
  acknowledgement binding and unchanged native revision behavior.
- Native ledger/server tests cover capability negotiation, strategy conflicts,
  stale attempts, absent/wrong strategy receipts and the 32-way retry race.
- Helper tests cover old-SDK fallback, selected-module/Debug-only application,
  response files, untouched source, source/overlay corruption, cached ABI index,
  marker/strategy integrity and complete replacement coverage.
- Actual SwiftSyntax cases include single-line, trailing-comment, nested and
  conditional-member declarations. Generic/source-context bodies remain opaque.
- A real integrated-driver job-plan regression checks ABI descriptor emission.
  The private frontend preserves the toolchain's feature metadata in its expected
  relative location; its exact bytes enter capture/resume provenance.
- A Release SDK build exports no refresh wrapper, observer or native readiness
  call. Instrumentation is prepared only in the managed Debug build lane.

SwiftUI still owns subtree identity. Body edits that change a subtree's type or
explicit ID can reset its state normally. This does not migrate arbitrary UIKit
controllers, suspended tasks or destroyed state. No app-content upload, runtime
state serialization, idle scanner or extra delivery round trip is added.

One new signed Debug app is required before testing this on a physical phone.
