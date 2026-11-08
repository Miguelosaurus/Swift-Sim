# App library

Swift Sim organizes signed builds by app. The home screen shows the app icon,
latest version and build number, and its current build/install status on separate
lines. Apps are ordered by their most recent build. Failed or running builds
remain visibly distinct from versions ready to install.
Pull down on the home screen to refresh saved app metadata and icons from the
paired Mac without opening individual app cards.

An app's page puts its latest build first, followed by Build Current Code and
recent history. The four previous builds are expanded; older builds stay available
under Older builds. Debug and Release labels are retained in history. Building
current code still requires confirmation, and an install request is not proof of
installation.
The full Latest Build card, including its padding, opens the install page on a
single tap. A notification's background refresh cannot return the user to app
history after they have already chosen a build or moved to another screen.

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
