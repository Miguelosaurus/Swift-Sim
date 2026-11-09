# Open-source and Companion polish review — November 8, 2026

This is a source and Simulator review of the unreleased 0.6.5 candidate.
No physical-phone query, install, notification or testing session was used.
The owner's installed helper, engine and plugin were left unchanged.

## Repository

- Expanded contributor guidance with the real source map, scoped test commands,
  managed-build/autoconnection guards and distinct proof requirements.
- Updated the existing PR checklist and issue templates for hot reload,
  recovery, optional testing and notification reports. Existing conduct and
  security-reporting channels remain unchanged; no new contribution agreement
  or account requirement was introduced.
- Added coordinated release gates and a third-party provenance index, preserving
  upstream licenses and immutable component pins.
- Corrected security documentation that described older hot-reload limitations.
- Included linked public contribution/release documents in the Mac package and
  ignored local signing/export artifacts. No tracked signing export or private
  environment file was found in the filename audit.
- Added isolated Swift SDK tests to CI; Companion CI explicitly suppresses the
  ordinary Xcode import hook. No dependency or runtime service was added.

## Visual direction and changes

The existing blue accent, soft canvas, app icons, rounded typography, navigation
and floating controls remain. Content cards use quieter standard material and a
consistent radius; decorative status symbols no longer create nested floating
glass. Glass remains on controls. Install actions use the same blue family;
green/red/orange retain status and destructive meanings.

Headings use the Dynamic Type ramp. Long app names wrap, accessibility-sized
library rows prioritize names, and history status moves beneath metadata at
accessibility sizes. Link entry scrolls when space is constrained and clears
an obsolete inline error after editing. Button minimum heights and close targets
were reconciled. The Simulator viewer follows system appearance, its options
sheet avoids a fixed-height constraint, and a missing side-button SF Symbol was
replaced with the supported power symbol.

Build confirmation is shorter, Forget Mac requires confirmation, connection
copy avoids promising verification from connectivity alone, activity timestamps
avoid second-by-second clutter, and fallback update details no longer repeat
the same queued message. Optional testing retains its approval/Stop semantics.
The app-level notice respects Reduce Motion.

The Appllama app-design checklist was applied to this existing native SwiftUI
app. Its screenshot library was unavailable. References were Apple's
[buttons](https://developer.apple.com/design/human-interface-guidelines/buttons),
[layout](https://developer.apple.com/design/human-interface-guidelines/layout)
and [materials](https://developer.apple.com/design/human-interface-guidelines/materials)
guidance, alongside actual before/after Simulator screenshots.

## Validation and limits

- Full Node 24 check: 1,664 source, 1,028 compiled and 3 hermetic tests passed,
  with type, lint, format, architecture, documentation and isolated package gates.
- Swift package: 38 tests passed with client autoconnection disabled.
- Companion: 62 tests passed after the layout/confirmation changes. The final
  one-symbol correction was rebuilt and inspected visually.
- A separate app identity and loopback-only fixtures supplied app/build/activity
  data. Library, history, install, activity, notifications, connection, testing,
  link-error, Simulator tools and keyboard surfaces were inspected. Light/dark,
  long-name and accessibility-sized layouts were exercised. Lower accessibility
  history rows could not be fully scrolled with the available automation; their
  layout compiled but is not claimed as fully visually qualified.
- A flow recording and sampled playback frames were reviewed. These are layout
  and interaction observations, not measured 60 fps or slow-device performance.
  No working remote Simulator stream or physical cellular behavior was qualified.
- A signed App Store export was refreshed locally. External upload, processing,
  review, distribution and fresh-user/physical smoke tests remain separate gates.
  The clean Homebrew installation gate remains CI evidence, not a local rerun.

Task-owned screenshots, recordings, hashes and reports are retained locally;
temporary servers, viewers, Simulators and disposable compiler outputs are
stopped or removed after the review. Prior release assets/tags are unchanged.
