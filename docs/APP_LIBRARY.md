# App library

Swift Sim groups builds by app. Each library row shows the app name, latest
build and install status. Version numbers and earlier builds are on the app's
page. Pull down to refresh app details and icons from your Mac.

The app page groups the icon, app name, latest version, build and status in one
panel. **Install update** and **Test with agent** are separate buttons inside it.
Installed or unavailable builds show a details button instead. **New build**
sits beside Build history and explains what will happen before you confirm
**Build on Mac**. Older Companions call this action **Build Current Code**.

The four previous builds are visible. Older builds are under **Older builds**.
Debug and Release labels stay in history. An install request does not prove
installation; Swift Sim waits for matching confirmation.

The Install update button opens the install page on one tap. A notification's
background refresh cannot pull you back after you choose a build or leave the
screen.

## Ordinary Xcode builds

[Optional Xcode integration](XCODE_BUILD_IMPORT.md) records signed Debug builds
without copying their products. Installation needs exact device confirmation;
compiler readiness is qualified separately. Disposable imported history is bounded.

## Build cache retention

Completed builds automatically retire superseded compiler workspaces. Swift Sim
keeps the two most recent ready workspaces for each app, project, scheme, and
configuration, plus older workspaces still referenced by current installations,
the live compiler capture, queued or uncertain edits, confirmed restoration,
active installs/renewals, workers, open files, or explicit retention pins.
Protected references can therefore exceed the normal two-workspace allowance.
An edit that was verifiably undone to the installed binary's original source
does not require a compiler workspace for restoration; its journal is retained.

Signed installers, icons, app data, build history, and saved hot-reload source
intent are retained. Older installers remain available; a version whose compiler
cache was retired no longer claims hot-reload compiler readiness. Install-link
renewal remains separate from compiling current code.

`swift-sim prune-build-caches` previews eligible existing compiler caches.
`swift-sim prune-build-caches --apply` revalidates and reclaims them. Planning
does not delete anything. Diagnostics, startup, and the historical artifact-audit
and migration paths never trigger this cleanup. Reclamation pauses during storage
migration/rollback or when live ownership cannot be verified.

Retirement is recorded before an atomic cache detach. Recursive removal happens
asynchronously outside the hot-reload locks; interrupted removal can resume on a
later completed build or explicit apply. No cleanup watcher or idle timer is added.

## Icons

During packaging, Swift Sim reads the compiled app's declared primary icon and
creates a small PNG thumbnail. This does not edit the signed app. Icon extraction
is optional: missing, unsupported or malformed assets keep the initials fallback
and never fail a signed build. Asset formats without a declared compiled PNG use
that fallback. Existing saved builds acquire an icon on their next build; a Mac
operator can also capture one from retained signed app artifacts without compiling.

The phone caches verified thumbnails for offline use. The memory cache holds at
most 24 compressed thumbnails; the disk cache holds at most 32. Downloads are
limited to 128 KiB and 256 pixels per side, checked against the advertised SHA-256
digest, and decoded as thumbnails. Credentials never follow redirects.

`GET /api/device-builds/:id/artifact/icon` returns only the digest-matched PNG for
that build. A current build capability permits the public delivery path; paired
Mac authorization also permits a private read after its install link expires.
The route does not expose paths, permit uploads, or mutate install/build state.
Icon bytes are separate from activity and build-list JSON. Extraction runs during
packaging, not on notification or hot reload polling turns.
