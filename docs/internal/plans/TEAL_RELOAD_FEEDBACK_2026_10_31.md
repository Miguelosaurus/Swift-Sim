# Teal Debug reload feedback — 2026-10-31

Current SDK implementation: `7355a1914f4ca275d224a258de1c9c7093582682`.
This replaces the existing Debug feedback banner without changing receipt or
root-refresh authority. No Companion OTA, helper restart, or Zenics build was
performed for this SDK change.

The initial `a13c413` visual design was rejected in user review as insufficiently
like the original Siri edge light. Its historical evidence is retained below;
the current treatment is described in the synchronized glass wave and adaptive
pacing sections.

## Initial behavior — superseded visually

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

## Siri-style refinement after visual review — V2 history

The V2 renderer replaced the progress-track appearance with a clockwise
entrance of soft light, then uneven flowing teal/mint/cyan pools with an inward
falloff. Its 30 fps timeline exists only inside the temporary feedback subtree,
and pauses for Reduce Motion, failure, inactive scenes and completion fade.
The glow is indeterminate while waiting; it does not pretend to measure native
progress. Only confirmed refresh plays the softened glass wave. Fast successes
finish the clockwise entrance before the wave. Terminal success dismissal allows
2.75 seconds for that sequence; it does not delay the native receipt or helper.

The original Apple reference was inspected directly:
[Apple's 2024 Siri design](https://www.apple.com/newsroom/2024/06/introducing-apple-intelligence-for-iphone-ipad-and-mac/).
The implementation uses public SwiftUI Canvas/Shape drawing and native glass for
the finish, with no copied host content or custom Metal resource.

Final validation: seven Swift package tests pass with client autoconnect disabled;
the actual SDK/preview app builds for iOS Simulator; Release symbol exclusion also
checks the new aura type. Light/dark synthetic previews exercise both SwiftUI and
UIKit controls during the glow and retain their values. Actual simulator Reduce
Motion and failure appearances were inspected. Original preferences were restored,
the preview/recorders stopped, and the task simulator shut down. Helper/engine PIDs
and recorded compilation capture hashes are unchanged. No phone execution claimed.

V2 local receipts/screenshots: `.build/teal-reload-feedback-v2/`. Exported
`swift-sim-siri-teal-v2-light.mp4` and `swift-sim-siri-teal-v2-dark.mp4` are synthetic
visual previews. Earlier previews represent the rejected design. The phone rollout
still requires the current SDK revision and one Debug rebuild in the app's lane.

## Synchronized glass wave — V3 renderer and timing history

The entrance holds its final gap open at 93% until an admitted native refresh
receipt. One deterministic clock then closes the gap and starts the wave on the
same frame that the reveal reaches 100%. Fast receipts still finish the clockwise
entrance; an arbitrarily long unconfirmed wait never completes it. The closed
perimeter mask has no blurred end cap that could visually bridge the gap early.
There is no separate sleep or inherited host animation sequencing the transition.

The finish is a broad, feathered native Liquid Glass lens growing from the top.
Its hard rim is masked away, leaving live text/content visibly refracted through
the wave. It uses a fixed-size viewport, does not filter the app's host layer,
and introduces no screenshot, custom Metal resource, or helper process. Earlier
systems use the material fallback; Reduce Transparency avoids refraction. The
temporary timeline permits 60 fps during the finish and 30 fps while waiting.
Normal completion dismisses through a request/sequence-fenced callback; the
success watchdog is 3.1 seconds. Neither path advances native refresh authority.

The original [Apple Siri motion clip](https://www.apple.com/newsroom/videos/videos-2024/autoplay/2024/apple-intelligence-siri-add-contact/large_2x.mp4)
was sampled and inspected, alongside Apple's [WWDC24 ripple example](https://developer.apple.com/videos/play/wwdc2024/10151/).
The host distortion shader approach was not used because Apple's
[distortionEffect documentation](https://developer.apple.com/documentation/swiftui/view/distortioneffect(_:maxsampleoffset:isenabled:))
documents placeholder limitations for UIKit/AppKit-backed views. The native glass
overlay preserves those live controls without changing their host rendering.

Validation: nine SDK tests pass, including exact before/contact/after timing,
fast confirmation, a 600-second unconfirmed wait, gap geometry, receipt admission,
stale-event rejection and revision isolation. The actual SDK/preview app builds
for iOS Simulator. Final Release symbol inspection excludes all feedback types,
including the choreography, reveal and lens. Documentation/whitespace checks pass.
Light/dark synthetic previews show a UIKit switch responding when tapped during
the wave, with its value retained afterward; a SwiftUI button also responds
during the glow. Actual simulator Reduce Motion and amber failure states were
inspected. These synthetic events do not prove a phone patch applied.

Receipts, screenshots and ownership: `.build/teal-reload-feedback-v3/`. Exported
`swift-sim-glass-wave-v3-light.mp4` and `swift-sim-glass-wave-v3-dark.mp4` show the
current effect. The preview app and recorder stopped, original light appearance
and Reduce Motion preference were restored, and the task simulator is shut down.
Helper PID 48852 and engine PID 42553 remain untouched; compilation capture hashes
still match baseline. Zenics remains unchanged in its active dirty lane. One
updated Debug SDK build and an actual phone reload are still required there.

## Community reference comparison — 2026-10-31

No universal community verdict on the best recreation was established. GitHub
recognition among the directly relevant native candidates inspected was:

| Reference | Stars / forks at live API inspection | Relevant technique |
| --- | --- | --- |
| [Siddhant Mehta's screen prototype](https://github.com/metasidd/Prototype-Siri-Screen-Animation) | 388 / 33 | Moving mesh gradient, deforming inner mask, real displacement ripple |
| [Jacob Amobin's glow](https://github.com/jacobamobin/AppleIntelligenceGlowEffect) | 330 / 24 | Animated angular gradient with layered blurred strokes |
| [Tornike Gomareli's Aurora](https://github.com/tornikegomareli/Aurora) | 170 / 10 | Procedural Metal glow with moving color anchors and noise-warped boundary |
| [IntelligenceGlow](https://github.com/Livsy90/IntelligenceGlow) | 143 / 6 | Animated angular gradient and layered blurs |

Pinned source inspections: Mehta `5195f8447c8c13ef88ebff67c3e2f0c4f941418e`,
Jacob `5f388f1c51322f62f2181693e125d955d9a45237`, Aurora
`a3f9296a1e7744529b69d8a9f9e360bf3c8c81bf`. Research receipts and source-only
downloads are under `.build/siri-reference-research/`; no dependency installed or
third-party implementation incorporated.

Mehta has the most recognition of this set, rather than a proven consensus on
fidelity. His [ripple shader](https://github.com/metasidd/Prototype-Siri-Screen-Animation/blob/5195f8447c8c13ef88ebff67c3e2f0c4f941418e/SiriAnimationPrototype/Ripples/RippleEffect.metal)
delays each pixel's motion by distance/speed, then displaces the sampled content
outward and inward with a sine wave under exponential decay. Brightening and
darkening follow the displacement. Its modifier explicitly credits Apple's
WWDC24 example; this is not evidence that the ripple is extracted Siri code.
The current Swift Sim finish instead grows a native glass lens and feathers its
visibility. That refracts live content but does not define alternating radial
displacement or a trailing trough, explaining the remaining difference in feel.

Both Mehta's wobbling mask and Aurora's noise-warped signed-distance field deform
the inner edge of the glow itself. Swift Sim currently moves four widened light
pools and a conic gradient along a fixed rounded perimeter. Its light changes
depth/intensity, but its inner boundary is more regular. Aurora additionally
blends eleven independently moving color anchors and couples brightness, edge
deformation and motion speed to a decaying burst. Swift Sim's repeating motion
has no coupled burst envelope. Aurora's author says this follows Apple's
`IntelligentLightFrag` in `SiriUICore`; that attribution was not independently
verified against Apple's binary. Aurora's traveling wash changes color/alpha;
it does not sample and warp the app's backdrop, so it alone cannot replace the
desired refractive completion wave.

A procedural glow shader on its own overlay would preserve UIKit content. A
direct port of Mehta's whole-content `layerEffect` is a separate question:
[Apple documents](https://developer.apple.com/documentation/swiftui/view/layereffect(_:maxsampleoffset:isenabled:))
that UIKit/AppKit-backed views may be missing from the filtered layer and appear
as placeholders. A future ripple change must qualify that boundary rather than
assuming this standalone prototype works across arbitrary developer apps.

## Adaptive pacing — V4

User review identified the fixed 1.05-second sprint to 93%, followed by a long
wait, as inconsistent. The new model begins with a four-second cold estimate and
keeps three stage-duration moving averages in memory. Only admitted successful
native runs teach them; failed runs and repeated stages do not. Each stage
transition updates projected remaining time, continuing from the existing
position and velocity through an analytical exponential speed adjustment.

Travel stays linear until the predicted receipt, reserving 15% for completion,
with a continuous soft boundary below 97% if work outlasts its forecast. Normal
runs do not enter an early slowdown at 80%. This is estimated presentation, not
measured native
percentage: unpredictable overruns can still slow near the end. An admitted
refresh receipt begins a bounded speed-aware completion from the current value;
the same clock still starts the wave on the exact contact frame. Rapid success
does not wait out the forecast. Per-frame computation is constant-size scalar
arithmetic; forecasting has no polling, disk writes, or idle work. Native patch,
receipt and notification execution do not wait for presentation.

Thirteen SDK tests pass, including stage-learning/failure rejection, observer
receipt admission, position/velocity continuity at retarget and confirmation,
steady early travel, a ten-minute overrun, monotonic completion, fast receipts,
and synchronized contact. The actual iOS Simulator preview builds. Release
symbol inspection also excludes the timing estimator. V4 changes pacing only;
it does not adopt the community glow/ripple renderer.

Final light/dark recordings use the updated SDK and synthetic native events,
with SwiftUI and UIKit taps during presentation retaining their values. They are
visual pacing previews, not physical-device reload evidence. Receipts and resource
ownership are under `.build/teal-reload-feedback-v4/`; exports are
`swift-sim-adaptive-sweep-v4-dark.mp4` and `swift-sim-adaptive-sweep-v4-light.mp4`.
The app/recorders stopped, original settings were restored, and the task simulator
was shut down. Helper/engine processes and live compilation registration hashes
are unchanged. Existing installed target apps still need one Debug SDK rebuild.
