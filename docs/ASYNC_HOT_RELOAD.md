# iPhone hot reload

Hot reload lets you see compatible code changes in a running Debug app without reinstalling it. Ask your coding agent for a change after completing [setup](SETUP.md). The agent chooses hot reload or a signed build.

The phone can be locked, offline, in another app, or have the Debug app closed when you request an edit. The Mac queues compatible work. Return to the matching Debug app when ready; no particular screen needs to be open. iOS must allow the app to run in the foreground. The Mac must be awake and the helper running. A queued edit is not yet a completed reload.

The glow starts when the Mac begins compiling and acts as a progress bar. The updated screen appears behind a ripple. Swift Sim 0.6.8 uses engine and SDK 0.5.10, which reconnect quickly after unlock or network changes. An older engine or Debug app may need an update. Check [Companion availability](TESTFLIGHT.md#availability).

## What can reload

Supported edits include SwiftUI bodies and modifiers, function implementations, computed helpers, supported accessors, async and throwing bodies, UIKit callbacks, and eligible `static let` constants. New private helpers, certain new types and files, and supported new SwiftUI views and `@State` fields can also reload. Support depends on the captured build and the form of the edit; a rejected edit explains why it needs a build or cannot be prepared.

Existing stored layout, signatures, many declaration changes, resources, packages, build settings and signing changes need a signed build. A compatible edit does not trigger a build just because the phone is unavailable or its result is uncertain. `--live-only` never builds or installs. The [evidence index](evidence/README.md) describes tested cases, not every possible Swift edit.

Eligible concrete SwiftUI view bodies, instance functions and `static let` constants can refresh while keeping state tied to unchanged view identities, such as drafts and navigation. Other callable edits can reset the root. Changing a subtree's type or explicit ID can reset that subtree. Manual **Refresh screen** intentionally resets it. Release, TestFlight and App Store builds of your app exclude live loading.

## Request and status

For a manual live-only request:

```sh
swift-sim deliver-change \
  --live-only --after "<current.swift>" \
  --project "<App.xcodeproj>" --scheme "<App>" \
  --configuration Debug
```

Use `--workspace` for a workspace. The first edit to a file that was uncommitted at build time does not need `--before`; if Swift Sim cannot verify the earlier source, it asks for a matching `--before` snapshot. Repeat `--after` for multiple files.

For a queued request, check its returned ID without sending the edit again:

```sh
swift-sim live-delivery-status --request "<request-id>"
```

`queued`, `compiling`, `waiting-for-device`, `waiting-for-foreground`, `applying`, and `applied` are not yet a confirmed refresh. `refreshed` or `hot-reloaded` confirms the matching replacement and refresh. `failed` or `uncertain` needs attention; follow the returned guidance. A later failure of a queued edit appears as `previousFailure` on the agent's next delivery for that app and is explained in Companion. Do not repeatedly submit the same edit. See [troubleshooting](TROUBLESHOOTING.md#a-live-edit-did-not-appear).

## Recovery and compatibility

Pending requests expire within 24 hours; combined pending work can expire sooner. Confirmed changes are kept for the exact Debug binary and restored when it reconnects after a relaunch. If the app starts offline, it runs its installed code until the connection returns. There is no device-local patch cache.

To stop restoration and revoke unclaimed queued work:

```sh
swift-sim live-desired-revoke --project "<App.xcodeproj>" --scheme "<App>"
```

Use `--workspace` where appropriate. Restart the app to return to the installed code: revocation does not undo code already loaded in the current process. Active work must finish or expire first.

Hot reload uses a private Tailnet connection. Do not expose port 8887 through a public tunnel, DNS, router forwarding or firewall rule. If components or the connection need attention, follow the reported action and [troubleshooting](TROUBLESHOOTING.md#remote-hot-reload-is-unavailable).
