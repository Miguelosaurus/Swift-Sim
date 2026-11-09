# Companion glass and hierarchy refinement — November 9, 2026

The owner rejected the quieter card materials in the November 8 review. This
pass restores the brighter tinted glass and floating controls. It supersedes
that review's material direction, while retaining its accessibility, repository
and contribution improvements.

## Changes

- Library rows group the app name, build and current status. Version numbers and
  history move to the app page rather than competing with its name.
- The app header contains identity. The latest-build card is the primary action;
  Test with agent has its own button. New build is a smaller action beside Build
  history, moving below the heading when larger text needs the space.
- Mac connection, testing and notification settings share the glass canvas and
  grouped surfaces. Current state and the next action come first. Setup and
  technical detail remain available in disclosures.
- Copy uses sentence case and concrete actions. Repeated explanations were cut;
  approval, destructive actions, uncertain results and data preservation remain
  explicit. Install-link expiry includes the day when it is not today.
- The shared surface helpers replace duplicate styling. No dependency, runtime
  service, timer, polling loop, SDK or helper behavior was added. Install,
  pairing, testing approval/Stop and notification preference callbacks remain.
- Public guides and plugin references use the current control labels, with the
  older Build Current Code name retained where useful for installed versions.

## References and review method

The Appllama app-design checklist and native Liquid Glass guidance were applied
to the existing SwiftUI app. The owner's material preference takes precedence
over a generic preference for quieter surfaces.

Developer layouts were compared using official screenshots from
[GitHub](https://apps.apple.com/us/app/github/id1477376905),
[TestFlight](https://apps.apple.com/us/app/testflight/id899247664) and
[Expo Go](https://apps.apple.com/us/app/expo-go/id982107779). These informed the
separation of identity, current build, actions and history; they were not copied
into the product. Expo's [development-build guide](https://docs.expo.dev/develop/development-builds/introduction/)
and Linear's [mobile redesign notes](https://linear.app/changelog/2025-10-16-mobile-app-redesign)
provided additional context.

Copy was reviewed with pstack's
[Unslop skill](https://github.com/backnotprop/pstack/blob/main/skills/unslop/SKILL.md).
Its instructions were saved only in the task's local review evidence, without
installing another global integration.

## Evidence and limits

- Companion: 62 tests passed with managed-build isolation. The final adaptive
  history-heading adjustment was rebuilt and inspected at accessibility text
  size after that run.
- Agent CLI/setup coverage: 14 tests passed on Node 24. Documentation links, component and
  isolated package-install checks passed; package verification was repeated on
  the supported Node 24 runtime. The destructive clean Homebrew install was not
  run locally.
- Actual stock iOS 26.5 Simulator renders were reviewed for the library, app page,
  install, setup, connection, testing, notification settings and build
  confirmation. Dark mode, accessibility text size and a long app name were
  checked. Lower offscreen history rows are not claimed as fully visually
  qualified through the available automation.
- The private gallery contains nine before/after pairs and four after-only
  states. A Terra xhigh subagent assembled it; browser filtering and full-size
  viewing were checked separately. The existing Tailnet route serves only its
  curated static files. The prior gallery remains on disk.
- Fixtures were loopback-only under a separate QA app identity. No physical
  phone, cellular install, remote-control session or live notification was used.
  There is no new performance or delivery qualification claim.
- A refreshed App Store-signed 0.6.5 (15) candidate was exported locally. No
  upload, public release, tag, Homebrew publication or installed helper/plugin
  update was performed. Existing immutable release assets remain unchanged.

Screenshots, private signing/export reports and source hashes remain in the
ignored local task evidence. Temporary build outputs and the task Simulator are
cleaned up after review. Only the explicitly requested private gallery server
remains running for the owner to inspect.

## Follow-up: integrated app overview

Owner feedback on the circled latest-build area prompted a narrower refinement.
The icon and name now share one glass panel with the version, build and status.
The large standalone build-number card is gone. Install and Test with agent are
separate buttons in the panel; tapping the surrounding panel does not install
anything. Installed builds show View build details. New build opens an explanation
of the current-code build, time cost and separate installation step, followed by
Build on Mac or Cancel. Its existing callback and in-flight guard remain.

The updated layout passed 62 Companion tests and was reviewed in the stock
Simulator in light/dark mode, with accessibility text and a long app name. The
install-page and testing-sheet entry points were exercised, and the build popup
was cancelled. No build was submitted. A short flow was recorded and sampled;
this is interaction/layout evidence, not a frame-rate measurement. The final
first-install label uses Install app rather than Install update.

The focused follow-up gallery was assembled by Terra xhigh. The existing private
Tailnet gallery route is reused. No phone was contacted, and no helper, SDK,
notification, hot-reload or optional testing behavior changed. This follow-up is
source and Simulator work; the earlier signed candidate does not contain it.
