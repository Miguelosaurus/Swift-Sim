# Developer tools and on-demand app context

Debug apps using the updated SwiftSimLive integration include a native developer
menu. Hold three fingers on the app for about a second to open it. A tools button
is available for accessibility or can be enabled for the current session.
Drag the tools button to move it; it snaps to either side within the safe area.
Its position is retained for the current session and adapts to rotation.
Release apps do not include the menu.

## Menu actions

- **Share a problem** captures the current app screen and a small Swift Sim
  diagnostic snapshot. Review the preview, optionally add a note, and choose
  **Save to Mac**. Notes are optional. The agent can retrieve the latest report
  without a copied ID. Saving is confirmed only after the Mac acknowledges it.
  **Share…** offers explicit export when the Mac is unavailable.
- **Refresh screen** recreates the registered SwiftUI screen using the code
  already loaded. Temporary screen state may reset. It does not restart the
  process, install code, or count as a hot reload.
- **Appearance** temporarily selects App default, Light or Dark for this app
  window. App default restores the app's own original theme behavior. No iPhone
Settings or saved app preferences are written by Swift Sim. App-specific theme
overrides may take precedence.

The menu shows the current Debug build and Swift Sim delivery context. It is not
a console, network inspector or continuous recorder. Captures contain only the
app's foreground window; some protected or independently rendered content may
not be available. A screenshot can contain app data; omit it or cancel after
previewing it.

## Agent access

From the matching app project's directory, read context directly:

```sh
swift-sim app-context
```

When diagnosing a visual problem, request the current screenshot:

```sh
swift-sim app-context --screenshot
```

When the user saved a report, retrieve it without asking them for an ID:

```sh
swift-sim app-context --report latest
```

The agent can also use these tools without opening the menu or asking for taps:

```sh
swift-sim app-tools --appearance dark
swift-sim app-tools --appearance app-default
swift-sim app-tools --refresh-screen
```

These are deliberate actions for the active task, never part of a read-only
context request. Exactly one tool can be requested at a time. Actions are bound
to the observed app process and connection, and require a native response. A
screen refresh reports `refresh-requested`, not a new code update or receipt.
Restore App default after a temporary appearance test. An unconfirmed operation
must not be blindly repeated.

Pass `--project <App.xcodeproj>` or `--workspace <App.xcworkspace>` and optionally
`--scheme <scheme>` when running elsewhere. The current qualified Debug capture
must match that project. Swift Sim refuses context from another app/build rather
than guessing which connected client to inspect. It does not build, restart,
launch, navigate, or update the app to satisfy a context request.

Successful JSON uses `outcome: context-ready`, a timestamp, app/build and current
runtime observations. Explicit captures/reports include a private local image
path for the agent's image viewer; image bytes are never printed as base64.
Saved reports do not require a current phone connection. They return
`runtime.state: not-observed` and `fromCurrentProcess: null`; live process state
was not inspected. Their capture time and diagnostics are historical context, not current behavior
or a new hot reload receipt.

Unavailability produces bounded guidance with `outcome: needs-user-action`.
During hot reload, capture yields to code delivery. Do not resubmit a delivery
or rebuild merely to fetch a screenshot.

Use these commands only when the active task needs app context. Ordinary coding
chats, menu opening and normal hot reload do not fetch or upload screenshots,
insert reports into chats, start a log collector, or call another AI service.

## Retention and updates

The Mac retains at most five private user reports for 24 hours, bounded to ten
MiB. Locally materialized agent images are separately limited to five one-MiB
images and expire after 24 hours; expired entries are removed on the next use.
Export explicitly if a report needs longer retention. No cleanup daemon is added.

Existing Debug apps need one normal SDK update/build to gain the menu. Keep the
same app identity and install over the existing app to preserve app data. The
engine must support `developer-context-v1`; an older engine returns an explicit
update requirement. Pure UIKit apps without the SwiftUI root integration are
outside this first menu version.
