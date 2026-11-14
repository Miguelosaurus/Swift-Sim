# Release polish: November 9, 2026

This pass applies the approved original-glass app panel and prepares the next
beta locally. It does not publish a release or use the owner's iPhone.

## User-visible changes

- Keep the original blue glass material. Test and Install share a row at a
  40/60 split, with an eight-point gap and quieter Test styling. New build is a
  smaller action beside history and retains its confirmation.
- Use short explanations and clear next steps for connection, link, build,
  install, activity, notification, preview and testing problems. Technical
  details stay behind Details or Build log.
- Details → Copy details gathers available app/build/request identity and diagnostics
  on demand. It writes only to the clipboard; it never uploads or opens a chat.
  Known credential forms and links are removed before truncating the report.
- Keep uncertain approval, install and Stop outcomes uncertain. Reports tell
  agents to inspect the existing request before retrying. Error banners remain
  available until dismissed or replaced.
- Distinguish a failed build-status refresh from a queued build. Cached install
  information remains available; no additional refresh loop was added.
- Fix paired app-icon loading when a saved connection has a local identity
  fragment. Only that recognized fragment is removed from the transport URL;
  authorization still goes to the paired host, never the delivery host.
- Align action/card corners, improve large-text layout, and replace the
  nonfunctional console Clear control with Copy details.

## Current verification

- 71 Companion tests passed on the task-owned stock iOS Simulator, including
  credential/link redaction, bounded reports, truthful error copy, retained
  event identity and paired-icon authorization/fragment checks.
- 26 agent fast-path, component compatibility and setup-status tests passed.
  The primary skill stays within its existing size gate; report-handling
  guidance loads only from the troubleshooting reference when needed.
- Package checks passed an isolated install, setup/doctor, marketplace and skill
  discovery; Homebrew syntax and Node 24 entrypoints passed. This is fixture
  proof, not another developer's real phone setup. The destructive clean
  Homebrew-install gate remains skipped.
- Actual light/dark Simulator renders cover the app panel, library,
  notifications, connection, activity and testing, including failed/offline/
  installed builds, long names and accessibility text. These use a loopback-only
  helper fixture and a separate QA app identity. QA startup selectors are absent
  from product source. Native Simulator UI automation was unavailable in this
  session, so these renders do not prove tap-driven phone interactions.
- A fresh local App Store archive/IPA for 0.6.5 (15) passed signature and
  entitlement checks: production push, no debugger entitlement. It replaces
  the earlier local candidate for review; no upload occurred.

No runtime dependency, helper service, SDK logic, hot-reload path or push
sender/transport changed. The installed helper, plugin and engine remain
unchanged. No new background work was added.

## Remaining release gates

The gates in [the November 8 readiness record](RELEASE_READINESS_2026_11_08.md)
remain: authorized upload and Apple processing/review, an active external beta,
a real fresh-developer/phone smoke test, and coordinated public package/plugin/
Homebrew publication. The earlier App Store Connect availability check is dated;
recheck it before making current availability claims.

Public beta background alerts still need a separately authorized distribution-
safe sender design. This pass clarifies availability; it does not implement or
promise that service. Existing published releases and SDK pins stay unchanged.

## Presentation follow-up

The Install update action now includes a download icon. Error cards use light
red glass instead of orange. Copy details is inside the collapsed Details
section, so it does not look like a required recovery step. Agents check the
existing Mac logs first; manual copying is a fallback for missing phone-side
context. The alert offers Close as its normal action. User and agent guidance
now state that copying is optional.

The follow-up passed a fresh Simulator build, documentation and agent fast-path
checks. Eight affected light/dark/large-text screens were recaptured; unchanged
screens retain the earlier renders. A new signed local candidate includes this
follow-up. The existing report/privacy test results above remain the prior
logic qualification; no phone or public release action occurred.

## TestFlight submission checkpoint

The [November 9 submission receipt](TESTFLIGHT_0_6_5_2026_11_09.md) supersedes the
upload-pending state above: 0.6.5 (15) passed processing, is assigned to Public
Beta, and is waiting for Apple's external review. Public availability and the
fresh-developer phone test remain unproven. The Mac package/plugin/Homebrew
release remains unpublished by this task.
