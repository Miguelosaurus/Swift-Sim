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
- Copy for agent gathers available app/build/request identity and diagnostics
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
  nonfunctional console Clear control with Copy for agent.

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
