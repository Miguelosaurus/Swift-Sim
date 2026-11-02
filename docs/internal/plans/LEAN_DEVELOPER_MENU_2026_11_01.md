# Lean Swift Sim developer menu

Date: 2026-11-01. Status: implemented; local qualification complete, phone acceptance pending.

See [implementation evidence](../../evidence/DEVELOPER_MENU_2026_11_01.md).

User refinement: agent access is on demand and project scoped. Reading context,
requesting a screenshot, retrieving the latest report and intentionally using
appearance/refresh must not require copied IDs, mandatory notes or manual phone
taps. The commands are lazy task tools, never automatically inserted into every
chat or the ordinary delivery loop. A report remains an optional human shortcut.

## Decision

Add one on-demand native developer sheet to apps already using `.swiftSimLive()`.
Its purpose is to help a developer reproduce, inspect and communicate a problem
without leaving the app. The proposed first version has three actions:

1. **Share a problem**: capture the current app screen and attach a small,
   allowlisted Swift Sim diagnostic snapshot for the developer/agent.
2. **Refresh screen**: recreate the registered SwiftUI root using the currently
   loaded code. This is not an app restart, new patch, or data reset.
3. **Appearance**: temporarily use the app's normal appearance, Light, or Dark.

Show app name/build and the last confirmed hot reload as compact context above
the actions. This is a product judgment informed by research and Miguel's actual
phone testing, not a measured ranking of Expo menu taps.

## Research: what developers use

The original State of React Native 2025 survey asks which debugging/profiling
features respondents use. Among 948 respondents to that question:

| Feature | Respondents reporting use |
| --- | ---: |
| Console API | 95.46% (905) |
| Network panel | 59.70% (566) |
| Element inspector | 57.38% (544) |
| Components panel | 51.58% (489) |
| Performance monitor | 37.97% (360) |
| Breakpoints | 37.34% (354) |
| Memory panel | 26.58% (252) |

Source: [State of React Native 2025, debugging and profiling](https://results.stateofreactnative.com/en-US/debugging-and-profiling/).
This is a self-selected React Native survey with multiple possible answers. It
measures reported adoption, not frequency of use, menu clicks, Swift developer
behavior, or screenshots/appearance preferences. No public Expo per-menu-action
usage dataset was found in this research. Do not call Reload or any other menu
item the proven most-used action.

Expo documents Reload, Fast Refresh, element inspection, performance monitoring,
desktop DevTools, copying the server link and returning to its launcher. Its own
guide says manual Reload is usually unnecessary because Fast Refresh is enabled
by default. Its standalone menu can be installed without the full launcher.

- [Expo debugging tools](https://docs.expo.dev/debugging/tools/)
- [Expo DevMenu](https://docs.expo.dev/versions/latest/sdk/dev-menu/)
- [React Native Fast Refresh](https://reactnative.dev/docs/fast-refresh)

The strongest demand signal is understanding failures. That supports a useful
diagnostic handoff ahead of a permanent performance display. It does not justify
reimplementing the console, network inspector or SwiftUI view debugger inside
every app. Share a problem is a deliberately narrower translation: it does not
replace arbitrary application logging or claim to capture every `print`.

Miguel's actual loop repeatedly involved screenshots/recordings, explaining what
was visible, confirming which change applied, and distinguishing first-run from
warm behavior. That is direct evidence for his workflow, not population data.
Appearance is included for its bounded implementation and repeated visual-test
utility; the survey does not establish its popularity. Refresh is a lightweight
secondary tool, not the primary reason to open the menu.

## Existing implementation and reuse

Inspected Swift Sim head: `9df7d3cd5c84d07b9af1530cf9cee0cf6b8c5a82`.
The package's engine dependency and inspected local checkout both resolve to
`64345974a2929fdc90219a50938c4c7a35f119af`.

- `Sources/SwiftSimLive/SwiftSimLive.swift` already has one Debug-only SwiftUI
  root modifier, native-revision observation, and reload feedback presentation.
  Its Release branch returns the original content.
- `DebugDeliveryFeedback.swift` already admits request/digest/sequence-bound
  native progress and verified terminal feedback. Reuse that state rather than
  creating a second delivery tracker.
- The pinned engine's `Sources/InjectionNext/InjectionNext.swift` already has
  `screenshotData()` and a screenshot command/response. That is a transport
  starting point, not a production-ready menu capture implementation: it chooses
  a global key/visible window, renders at default scale and returns PNG without
  the proposed explicit image bounds.
- The engine's `App/InjectionNext/ControlServer.swift` screenshot entry chooses
  `InjectionServer.currentClient`. A multi-app report must instead bind capture
  and response to the exact owning app/process/connection. Never use whichever
  client happens to be current.
- `InjectionClientExecutionState()` reports active/root-ready/revision. Those
  fields do not prove a live Mac transport connection. A connected badge must
  have actual connection evidence or be omitted; active is not connected.
- The reload renderer's private snapshot is a temporary GPU texture for its
  animation. Do not retain or export it as a report screenshot.

No engine restart, package resolution, phone capture, build or install was run
for this plan. Current APIs are source-inspected, not newly device-qualified.

## First-version interaction

### Open and dismiss

Default candidate: three-finger hold, approximately 0.7 seconds, in the owning
app window. Treat gesture recognition as a qualification item, not an assumption
of universal compatibility. Do not use global method swizzling or a motion
sensor listener. Avoid shake as the default, particularly for fitness apps.

Provide an accessible native launcher when assistive technology makes the
gesture unsuitable, plus an optional per-session visible launcher for users who
prefer one. No permanent floating button by default and no launch-time sheet.
Use a standard dismissible sheet with Dynamic Type, VoiceOver labels and system
Reduce Motion/Reduce Transparency behavior.

The recognizer must not cancel or delay ordinary host touches. Validate actual
scroll, pinch, drag, text selection, keyboard and modal interactions; gesture
settings alone are not proof. Respect an app's existing three-finger handling.
If that default cannot coexist reliably, use the explicit launcher instead.

### Share a problem

1. On tap, dismiss/hide only the menu and capture the owning foreground app
   window after its presentation transition completes. Preserve the underlying
   app's sheet/alert and current visible screen. Do not navigate to another view.
2. Show one preview with an optional short note. Explicitly identify the target
   paired Mac. Nothing is automatically uploaded on menu open or hot reload.
3. On Save to Mac, send one bounded artifact and typed metadata through an
   authenticated, identity-bound path. The connected agent can retrieve the
   resulting report by an opaque report ID through local tooling. Saving does
   not automatically post into an arbitrary Codex chat or invoke an AI service.
4. If the Mac is unavailable, offer explicit system sharing/export or cancel.
   There is no durable screenshot retry queue or new background upload worker.

Metadata: schema version, app name/version/build, SDK version, capture timestamp,
last admitted delivery phase/revision/error category and an opaque correlation
reference when available. Keep these observations distinct from proof that the
visible business behavior is correct. Pin metadata to the capture operation so
an overlapping reload cannot silently attach a later success to an earlier image.

Allowlist diagnostic fields; omit credentials, raw server URLs, source paths,
device identifiers, source code and arbitrary application logs. A screenshot
may itself show user data: show the actual preview and allow cancellation or
sharing diagnostics without the image. Do not claim screenshots can be made
secret-free automatically. Omit other scenes, system UI, permission dialogs and
protected content; report unsupported/blank captures honestly.

Proposed bounds: one operation in flight, at most 2 megapixels, compressed image
at most 1 MiB, metadata at most 16 KiB and a 10-second end-to-end timeout. Bound
both capture dimensions and encoded bytes, encode off the main thread, and keep
only the necessary foreground hierarchy draw on the main thread. If encoding
cannot satisfy the bound, return a clear error instead of sending an oversized
payload. Cancellation, backgrounding, disconnect and scene teardown release
buffers and reject late results.

Mac artifacts are private and bounded: at most five reports, ten MiB total and
24 hours of retention, with explicit export for longer retention. Reuse existing
cleanup scheduling or expire opportunistically; no new daemon. These limits
apply only to this report store, never to builds or unrelated task artifacts.
Receipt of the artifact must be acknowledged before showing Saved to Mac.

### Refresh screen

Subtitle: "Recreates the screen; may reset temporary screen state."
Dismiss the menu, then increment a separate presentation-only generation for
the registered SwiftUI root. It does not modify native root revision, manufacture
a replacement/refresh receipt, play a hot-reload success effect, resubmit a
delivery, fetch code, restart the process, or erase persistence. Host lifecycle
callbacks/tasks may run again, as with other remounts; do not promise side-effect
free replay or preservation of unsaved UI state.

Disable this action while a native application/refresh is in flight. It is
available only where the existing integration owns a refreshable SwiftUI root.
Mixed UIKit content inside that root is in scope. A pure UIKit root has no
universal safe reset operation; do not expose a misleading action there.

### Appearance

Choices: **App default / Light / Dark**. App default restores the host's original
behavior, including an app-specific theme; it does not blindly force system
appearance. Apply only to the owning scene/window; never change iPhone Settings,
app preferences or another window. Keep the override session-only and show a
small active-override indicator in the menu. Restore values on disable/teardown
without overwriting newer host-owned changes.

Use public UIKit/SwiftUI appearance APIs. An app's deliberate hard-coded colors
or more specific theme override may not respond; explain that boundary instead
of fighting host code. Validate UIKit presentations and SwiftUI together.

[Apple appearance API](https://developer.apple.com/documentation/uikit/uiview/overrideuserinterfacestyle).

## Scope kept out of the first version

- Full console UI, stdout/stderr interception, continuous application-log
  collection, OSLog enumeration, network interception or request replay.
- View-tree inspection, memory/FPS overlays, recording, touch-event replay,
  time/location simulation, fixture management or storage/reset controls.
- Fast Refresh pause/resume until pending-application and resume semantics have
  their own bounded design. Do not fake this by withholding root readiness or
  toggling execution-active state.
- Universal cross-app launching, an Expo Go-style arbitrary Swift app container,
  account/project switching or another launcher home screen.
- Per-app custom action APIs, app-specific URL schemes, new dependencies,
  third-party runtimes, telemetry or additional setup for already integrated
  SwiftUI/mixed apps.

Existing installed Debug apps need one SDK rebuild/update to gain the menu;
they cannot acquire new SDK types through an ordinary hot reload. No uninstall
or app-data reset. Pure UIKit-only attachment and macOS menu UX are separate
follow-ups, not an implied compatibility promise for this first iPhone version.

## Architecture and resource contract

- Keep entry point and new types inside `#if DEBUG` and iOS availability gates.
  Release must exclude menu, gestures, capture/export and diagnostics behavior.
- A small scene-owned coordinator attaches once through the existing modifier,
  outside the `.id(nativeRevision)` subtree. Opening/closing the menu or changing
  its local state must not recreate the app root. Only explicit Refresh can do so.
- Resolve the actual owning window from the attached view; do not scan for a
  global first key window. Use its presenter without replacing host sheets or
  alerts. Avoid duplicate installation when modifiers/root scenes are recreated.
- Build the sheet and image/export objects only on demand. Dismissal removes
  presentation references; capture completion/cancellation releases image buffers.
- Reuse native feedback and transport, with capability checks for any protocol
  addition. Older engines produce a bounded unsupported result rather than a
  false Connected/Saved state or automatic installation attempt.
- No additional polling, display link, network monitor, socket, timer-driven
  relative-time label, background sampling, launch service or persistent watcher.
  Compute relative timestamps when the menu opens/receives relevant events.
- Export cannot hold an injection/application lock or block the native receipt
  response path. Where the existing framed socket cannot prevent screenshot
  head-of-line blocking, delay/cancel report transfer during active delivery or
  constrain frame scheduling. Do not solve this with another permanent connection.

## Implementation sequence

1. Build the scene-scoped shell, gesture/accessibility entry, typed context,
   manual presentation generation and appearance override. Qualify host
   interaction and root identity before adding export.
2. Harden the existing capture path for exact scene/session selection and size
   bounds; implement the explicit preview and bounded report transfer/storage.
   Add the local agent retrieval command and documented result contract.
3. Verify performance, receipt isolation and Release exclusion. Only then update
   the pinned engine/SDK as required and prepare one same-identity Debug phone
   update for Zenics. Review the complete change and follow Miguel's direct-main,
   no-PR preference when implementation is later authorized.

Miguel subsequently authorized execution and agent-accessible tools. No separate
UI library or server was added. The implementation uses a small UIKit sheet to
avoid a second SwiftUI Form/navigation stack; device acceptance remains pending.

## Acceptance gates

Correctness:

- Opening, dismissing, appearance changes and report capture leave host state
  and native revision unchanged. Native deliveries retain exact receipt rules.
- Manual refresh cannot be mistaken for applied code, installed build or success
  notification. Duplicate gestures/actions create at most one presentation/task.
- Capture/report cancellation, timeout, late results, backgrounding, wrong app,
  changed process, wrong Mac, multiple scenes and absent/older engine are covered.
- Ordinary SwiftUI/UIKit gestures, keyboard input and existing modals work;
  VoiceOver, large text and reduced-motion paths remain usable.
- App default restores the original appearance, and a new process starts with
  the host's normal settings. No persistent data/settings are reset.

Performance (proposed gates, not measured results):

- Compare baseline and candidate on the same physical device/build settings.
  Record actual resident/physical footprint, CPU/wakeups and cold launch; do not
  substitute allocation counts or a slimmed Simulator for device measurements.
- Target no more than 1 MiB additional settled footprint before the first open.
  After 20 menu open/close cycles and five serial captures, transient images must
  be released and footprint must plateau; investigate a settled delta above
  2 MiB rather than rationalizing it as allocations. Record unavoidable system
  caching explicitly. These are targets to validate, not guarantees.
- Compare a bounded set of paired warm/cold hot reload trials. Investigate any
  repeatable median regression above 5%, new main-thread hitch, additional idle
  wakeup source or delay to native completion. Do not enlarge the SDK to make
  a developer-menu benchmark pass.
- Test capture while hot reload and notifications run, both on LAN and the
  existing private remote connection. A screenshot must yield to code delivery.
  Compare provider/helper notification dispatch timing; do not promise exact
  APNs arrival latency.
- Check final Release binaries/symbols for exclusion and report Debug linked
  size/launch deltas. No new dependency is permitted without revisiting scope.

Product acceptance:

- In Zenics, capture a visible problem and let the agent retrieve one accurate
  report without a manual screenshot upload. Also test explicit cancel/offline.
- Check appearance on the current screen without leaving the app. Refresh must
  have understandable reset behavior and never imply an app/process restart.
- Keep the actual hot-reload outline/ripple and native notification behavior
  unchanged. Preserve app identity, app data and the selected visual direction.

After a short user trial, ask which actions were useful and which went unused.
Do not add analytics solely to measure a menu. A feature that does not earn its
space should be removed before expanding the first version.
