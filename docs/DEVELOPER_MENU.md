# Developer tools and app context

In a Debug app with the updated SwiftSimLive integration, hold three fingers on the app for about a second to open the developer menu. An accessibility tools button is also available; you can enable it for the current session and drag it to either side. Release apps do not include the menu.

## Menu actions

- **Inspect screen** outlines exposed controls and text. Tap an outline or choose **Elements** for details; tap **Done** to return to the app. Inspection does not invoke app actions or freeze the screen. Rotation, backgrounding or hot reload closes it.
- **Share a problem** previews the app screen and Swift Sim diagnostics. Add an optional note and choose **Save to Mac**, or use **Share…** to export. A save is confirmed when the Mac acknowledges it. Screenshots and labels can contain app data; review them before sharing.
- **Refresh screen** recreates the registered SwiftUI screen with the code already loaded. It can reset temporary state; it does not install code or restart the app.
- **Appearance** temporarily selects App default, Light or Dark for the app window.
- **Text size** and **Layout direction** temporarily change Dynamic Type and left-to-right or right-to-left layout on iOS 17 or later. Choose App default to restore the app's behavior.

These tools do not change iPhone settings or saved app preferences. App-specific theme overrides can take precedence. The menu is not a continuous recorder or network inspector. Some protected or separately rendered content may not appear in a capture.

## Agent access

From the matching project directory, an agent can request context when needed:

```sh
swift-sim app-context
swift-sim app-context --screenshot
swift-sim app-context --elements
swift-sim app-context --report latest
```

The element list is a bounded, timestamped observation using accessibility and UIKit APIs. It can miss custom drawing or SwiftUI content; visibility does not guarantee a control can be tapped. Snapshot IDs are temporary. Text-entry values are omitted, but labels and some control values can contain app data. A screenshot and element list requested together are separate observations. Saved reports are historical and do not require a current phone connection.

For an explicit test, the agent can also use:

```sh
swift-sim app-tools --appearance dark
swift-sim app-tools --appearance app-default
swift-sim app-tools --text-size ax1
swift-sim app-tools --layout-direction rtl
swift-sim app-tools --refresh-screen
```

Request one action at a time and restore App default after testing. Text sizes are `app-default`, `xs`, `s`, `m`, `l`, `xl`, `xxl`, `xxxl`, and `ax1` through `ax5`; directions are `app-default`, `ltr`, and `rtl`. Text size and direction need iOS 17 and a compatible engine. If an action is unconfirmed, check its result before repeating it.

Pass `--project <App.xcodeproj>` or `--workspace <App.xcworkspace>` and optionally `--scheme <scheme>` from another directory. The current Debug build must match. These commands do not build, launch, navigate or update the app. During hot reload, capture waits for delivery. Ordinary edits do not automatically collect screenshots or reports.

## Retention and updates

The Mac keeps up to five private reports for 24 hours, up to ten MiB total. Agent images have separate five-image and one-MiB-per-image limits and expire after 24 hours. Export a report explicitly if you need it longer.

Existing Debug apps need an SDK update and build to gain the menu. Install over the existing app with the same identity to preserve data. The engine must support developer context; older engines report an update requirement. Pure UIKit apps without the SwiftUI root integration are outside this menu version. See [foreground installs](FOREGROUND_INSTALLS.md) for the optional install handoff.
