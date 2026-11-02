# Developer menu and on-demand context qualification

Date: 2026-11-01 (local). Scope: Debug iPhone SDK, local agent tooling and private
engine. Physical-phone acceptance of this SDK update remains pending installation.

## Implemented behavior

- One scene-owned, on-demand UIKit sheet. Three-finger hold opens it; an optional
  accessible tools button can be dragged, snaps to either edge and stays inside
  the safe area. Position is session-only and normalized for rotation.
- Screenshot/report preview with optional note/image, fixed Save to Mac action,
  actual Mac save acknowledgement, cancellation and bounded timeout.
- Presentation-only SwiftUI refresh and session-only appearance override.
- `app-context` returns exact-app runtime context, requested screenshot artifacts,
  or the latest saved report. Saved reports remain readable after app termination.
- `app-tools` deliberately requests appearance or refresh, without showing the
  menu or requiring phone taps. Context reads never invoke these actions.
- Project/workspace inference reuses the current qualified capture and matches
  the Git workspace for nested native projects. Unrelated repositories fail
  before contacting the app. Explicit project/scheme selection remains available.
- Lazy agent reference: ordinary coding and the normal delivery path fetch no
  context, collect no logs and insert nothing into other chats.

The engine dependency is pinned to immutable revision
`cfaa71f663035b5ca557c1edee72c50531ae458a`. Its current main ancestry was merged
without rewriting validated commits. The verified local engine 0.5.3 archive
has SHA-256 `0b65c993337c192f991774a16766f3b2673b224d1b9da7dcf7431ffe759847a5`.
The existing helper remained running while the normal engine was updated;
862 original compiler registrations were restored. No queued edit was active
at engine replacement and no test patch was sent to a phone.

## Validation

- 28 SDK tests pass, including real shader regressions, root revision admission,
  report identity/expiry/cancellation, capture invalidation and launcher bounds.
- Thirteen new helper tests cover project/workspace selection, binary mismatch,
  read-only context, private bounded images, serialized cache retention, reports
  without foreground connection and explicit tool uncertainty. The broader
  compiled delivery/receipt/notification set passes 100 tests, including all
  thirteen new-module cases.
- Engine native report/tool/capture/reconnect/framing/prepared-v3 suites pass.
  The UI dispatch gate rechecks expiry, actual socket ownership, process,
  connection, revision, readiness, pending delivery and a single target scene.
  SDK rechecks these observations immediately before the UI action.
- Actual iOS Simulator app and macOS engine builds pass. Final Release SDK
  symbols exclude menu, report, capture, injection and feedback entry points.
- JavaScript syntax, architecture, types, formatting/lint, documentation links,
  package-content and isolated package-install checks pass at their recorded
  checkpoints; final packaging uses the same additive command/reference layout.
- Actual Simulator UI preserved SwiftUI and UIKit state while opening/closing,
  changing appearance and previewing reports. Manual refresh reset only the
  requested transient screen state. Twenty menu cycles and five capture cycles
  passed; dragging did not open the menu accidentally. Offline save never
  displayed Saved to Mac.
- Actual native wire checks returned context, applied/restored appearance,
  produced a bounded 948-by-2060 JPEG and acknowledged a presentation refresh.
  Native revision remained zero: no code replacement or success receipt was
  fabricated. These used a task-only binding for a real compiled test app,
  not the phone's production capture or a replacement compiler registration.
- Actual report Save to Mac was acknowledged in the app. After terminating that
  app, the agent retrieved the exact-build report/image in one request, with
  runtime explicitly `not-observed`. No copied report ID or user-written note
  was required. No report was injected into a chat automatically.

## Resource and performance boundaries

No new idle polling, display loop, socket, log collector, network interceptor,
server, LaunchAgent or telemetry was introduced. Capture is capped at two
megapixels and one MiB JPEG. UI previews decode a small thumbnail off main;
explicit sharing/saving retains the bounded original. Image cache publication
uses the existing process-identity lock manager. Native image transfer yields
to pending delivery and has a bounded write deadline; very slow connections
can fail capture rather than block proof traffic indefinitely.

Controlled Simulator cold comparison: baseline settled physical footprint
40.6M, candidate closed-menu footprint 41.6M. These are host `vmmap` observations,
not allocations and not physical iPhone measurements. A separate final UIKit
capture series measured 53.5M after the first capture, 53.9M after five and 53.2M
after ten. It showed a bounded first-use increase rather than continuing growth.
The proposed two-MiB post-use target was not met in Simulator. The SwiftUI
Form/NavigationStack presentation was replaced with small UIKit controls and
preview images were downsampled; remaining post-use footprint is recorded,
not presented as a proven framework-cache diagnosis. No process-wide allocator
or host-app cache manipulation was added. Device footprint, launch/reload timing
and notification coexistence remain physical-phone acceptance items.

Development UI tests used a task-owned conservative simslim device, with push,
universal-links and keychain checks passing. This does not replace stock-device
performance or accessibility acceptance. Real three-finger gesture behavior and
the new menu on Zenics still require phone review. No simulator was erased and
no app was uninstalled.

Private command receipts, screenshots, source hashes and process/resource notes
are retained in the task's generated qualification directory. Inactive task
build caches were removed only after open-file inspection; device-build
artifacts, live capture authority and unrelated work were preserved.
