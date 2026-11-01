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
