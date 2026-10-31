# Teal Debug reload feedback — 2026-10-31

SDK implementation: `a13c413074c999304f2e79a65bb18fc519dce526`, pushed to main.
This replaces the existing Debug feedback banner without changing receipt or
root-refresh authority. No Companion OTA, helper restart, or Zenics build was
performed for this SDK change.

## Behavior

The outline begins at top center and travels clockwise through received,
applying and refresh-waiting stages. It leaves a gap while refresh is unconfirmed.
An admitted matching complete native receipt closes the outline, then sends one
refractive ring from the top across the content. The ring uses native Liquid
Glass on iOS/macOS 26 and a material fallback on earlier systems. It is not a
measured percentage. Failures use amber and never play the success ring.

The presentation is removed after terminal feedback; there is no idle animation,
new service, screen snapshot, or custom shader. Touches pass through. Reduce
Motion uses a static outline and status; Reduce Transparency avoids refraction.
VoiceOver receives a terminal announcement. Release preprocessing excludes the
feedback and animation types entirely.

## Evidence

- Seven Swift package tests passed, including native receipt admission, stale
  event rejection, host revision isolation, clockwise path geometry, incomplete
  loading outline, and hollow ripple geometry.
- Final tests used `SWIFT_SIM_DISABLE_CLIENT_AUTOCONNECT=1 swift test
  --scratch-path .build/root-sdk-qualification --disable-automatic-resolution`.
  An initial test invocation briefly autoconnected before that flag was added;
  it exited without applying a patch. Final isolated tests did not connect.
- The actual SDK built for iOS Simulator in a task-owned preview app. Synthetic
  feedback events demonstrated loading, completion, failure, light/dark modes,
  and the actual simulator Reduce Motion preference. Both a SwiftUI button and
  a UIKit switch responded during the effect and retained their values afterward.
- Final Release library symbol inspection excluded feedback, perimeter, wave,
  injection, dlopen, and socket entrypoints. Documentation/whitespace checks pass.
- Simulator `B3DDB516-8222-4DF4-A541-384DC4B5540B` used the conservative shared
  simslim profile; push, universal-links and keychain-sync checks passed. This is
  visual/development validation, not stock-device performance qualification.
- The preview app and recorder stopped. Original appearance/Reduce Motion were
  restored and verified; the task simulator was shut down. Native engine PID
  42553 and helper PID 48852 were preserved. Compilation registrations and engine
  capture-map hashes match the recorded baseline.

Private task ownership and screenshots are under `.build/teal-reload-feedback/`.
The exported MP4/GIF are synthetic effect previews, not evidence that a phone
patch applied. No physical-device execution of this effect has been claimed.

## Phone rollout

Existing target apps need one Debug rebuild against the SDK revision above;
their older installed SDK cannot acquire these new view/shape types through an
ordinary hot reload. Zenics currently pins an older SDK and its active dirty
checkout was only inspected, not edited or rebuilt. Update the SDK pin in its
own lane, retain its existing engine/signing/data identity, and qualify an actual
reload on the phone after installation. Updating the Release Companion alone
does not install this target-app effect.
