# Activity, notifications and remote confirmation

Swift Sim keeps a durable activity inbox on the Mac. The Companion shows an
unread badge and lets each paired Mac configure queued-edit, build-ready,
attention, confirmed-reload and launch-confirmation alerts. Confirmed hot reloads are on by default; launch-confirmation alerts are
off by default. Notification permission is requested from an explicit user action;
foreground Companion updates go to the inbox without an additional OS banner.
The inbox initially shows the five newest items, followed by Notifications
settings. Older activity stays collapsed until you choose to expand it.

A ready build can therefore appear without transferring its install link through
chat. The phone fetches its install information through the authenticated helper.
Build and hot reload notifications include a safe app display name when available.
New builds read the compiled app's display name, with its bundle name and known
build name as fallbacks; the IPA filename is no longer preferred. This read
happens during packaging, not during idle notification polling.
For example: **Zenics updated** / **Your changes were applied successfully.
They're ready to try.**, and **Zenics — Ready to install** / **Your new version
is ready. Open Swift Sim to install it.** Technical diagnostics stay in the build
details. Copy changes update existing activity without sending old alerts again or
advancing its unread cursor. Opening or refreshing the inbox fetches current
wording. The Companion also suppresses presentation-only foreground banners.
Push payloads contain opaque event identifiers and bounded display text, not
install capabilities, pairing credentials or diagnostic logs. A notification tap
refreshes the current authenticated feed and checks the Mac installation identity
before resolving a target. Expired, removed or superseded requests do not offer a
stale app handoff. Initial history and enabling alerts do not replay old pushes.
Build and hot-reload notification taps open the target app's page in Swift Sim,
showing its current latest build and version history. They do not automatically
open an installer or launch the target app. Exact build identity takes precedence;
legacy live events without a build ID navigate only when their authenticated app
name matches exactly one app owned by the paired Mac. Ambiguous or unavailable
targets retain the activity details instead.

## Queued hot reload

You can submit an edit while using ChatGPT or another app on the same iPhone.
The matching Debug app needs to return to the foreground and report root readiness
before the Mac applies it. No particular screen is required. A prepared update
waiting for the app can produce: **Zenics — Ready to apply** / **Open Zenics
to apply your latest changes. No install needed.** There is no guaranteed countdown.

Known Mac-side engine or build-capture faults replace that instruction with
an app-named attention alert directing you to the Mac. A heartbeat or engine
fault never becomes a successful update or a prompt to reinstall automatically.
The activity item provides a clear return-to-app instruction. An app may opt in
to a direct Open App button by adding `SwiftSimLaunchURL` to its signed Info.plist.
It must use a declared custom URL scheme, with no credentials, query or fragment.
Swift Sim never guesses a callback from the first declared scheme. Presentation
is bound to the exact build's binary identity. Existing builds without this
explicit opt-in retain the Companion handoff.

Pending intent, patch compilation, APNs acceptance and notification taps are not
successful reloads. The confirmed state requires matching native application,
replacement and SwiftUI refresh receipts with an increased root revision.
The Debug SDK reveals soft teal edge light clockwise from the screen's top
center, then keeps independently moving teal, mint and cyan pools flowing around
a noise-deformed inner edge, with the final gap held open while pending. The light blooms inward
with a soft falloff rather than displaying a numeric percentage. Only an admitted
matching native applied-and-refreshed receipt closes that final gap. One shared
animation clock starts the glass wave on the exact frame the edge reaches the
top; host-app implicit animations cannot introduce a separate delay.

The sweep estimates its pace from recent successful receiving, applying and
refresh-waiting durations held in memory. It starts with a conservative estimate,
moves linearly through most of the perimeter, and adjusts speed smoothly at
native stage transitions. It never moves backward or races to a fixed 93% in
one second. If a reload overruns the estimate, travel eases below completion;
elapsed time cannot imply success. Confirmed refresh finishes the remaining arc
with a bounded, speed-aware transition and starts the wave at contact. The
forecast uses three moving averages, no polling or disk writes, and does not
delay patch execution, native receipts, or notifications.
The outline has a 1.4-second minimum sweep, including when refresh is confirmed
almost immediately. Short forecasts cannot accelerate it into a flash, and fast
confirmation spreads the remaining travel smoothly across that minimum rather
than pausing at the end. Only presentation waits; the native update applies
immediately. Slow reloads retain their adaptive pacing. Rendering uses a separate
visual clock: preparation does not consume the sweep, and a delayed render tick
advances it by at most 1/15 second instead of jumping across the screen. The
view dismisses on visual completion, with a ten-second success safety watchdog;
Reduce Motion uses a short static confirmation without starting the moving clock.

The finish uses a 2.1-second, distance-delayed displacement wave: content pushes
outward, pulls back into a trough, and settles before fading. Its 38-point
amplitude keeps the crest and trough visible. One monotonic clock drives the
closing outline and the wave's birth; there is no separate ripple-start timer.

The wave samples one temporary in-memory capture of the refreshed app. The
capture excludes the feedback overlay, is capped at two pixels per point and
four million pixels, and is released after the wave. It is never written to disk
or sent over the network. The native app stays live and receives touches under
the overlay. Content changing during the wave can briefly reflect the captured
frame; live video refraction is not claimed. Filtering the captured image avoids
UIKit/AppKit placeholders caused by filtering the host itself. A failure uses
static amber and an unconfirmed-update label,
without closing as a success or playing the success wave.

The effect does not intercept touches or add host view identity changes. It
exists only during feedback, supports Reduce Motion with a static outline and
status, respects Reduce Transparency, and is excluded from Release. A Metal
renderer draws the procedural glow and refractive wave. Reduced Transparency
uses a simple nonrefractive cue; systems without a usable Metal pipeline retain
the material/native-glass fallback.
The Metal view owns one temporary display loop with a preferred rate of 60 fps.
It advances the visual clock only when it can encode a frame, and draws the glow,
its reveal and the ripple from that same frame. SwiftUI supplies lifecycle and
geometry updates, not a separately animated per-frame mask. The leading edge
fades over 56 perimeter points behind the actual head; it never lights beyond
that head or bridges the waiting gap. The loop is paused during preparation,
inactive scenes and completion, and stopped on teardown. Native/material
fallbacks remain scoped to the presentation. No service or idle animation is
added. One background compilation caches the pipeline per Debug process, while
captures and drawable resources belong to the temporary presentation. Neither
shader compilation nor visual completion gates native receipts or notifications.
The renderer prepares transparently before the visible sweep starts. Readiness
requires a successful GPU pass and any already-required refreshed app capture.
Preparation uses transparent shader output on the full surface, with no separate
SwiftUI reveal mask. The previous temporary Canvas glow is not shown while Metal
prepares. This adds no prewarming or separate ripple timer. Native timings still
supply the pace forecast; only the visual clock controls outline contact and
the wave. Floating-point reveal values stay below one until the actual contact
frame so conversion to GPU precision cannot close the outline early.
Existing apps need one Debug rebuild against the updated SwiftSimLive package
for this effect. Rebuilding with an older pinned SDK retains its old feedback.
No automatic rebuild or installation is required just to receive inbox updates.

## Apple push setup

The activity inbox works without push credentials. Actual remote OS notifications
require an Apple Push Notification service (APNs) signing key, a push-enabled
Companion App ID/profile and a signed Companion installed on the phone.
An App Store Connect API key is not an APNs key.

Keep the APNs P-256 `.p8` file owner-private on the Mac (`chmod 600`) and configure:

```sh
swift-sim notifications configure \
  --key-file /absolute/private/path/AuthKey.p8 \
  --key-id <APNs-key-id> \
  --team-id <Apple-team-id> \
  --topic <Companion-bundle-id>
swift-sim notifications status
```

The topic must match the Companion bundle ID. The Xcode build setting
`SWIFT_SIM_APNS_ENVIRONMENT` selects development for Debug and production for
Release; its entitlement and API-environment mapping must match the installed
provisioning profile. Enable Notifications in the Companion for the paired Mac.
When push is enabled for an existing App ID, regenerate the signing profile
before the next signed update: older profiles do not contain its push
entitlement. For direct OTA builds without a signed-in Xcode account, install a
matching ad hoc profile and distribution identity, then pass explicit
`CODE_SIGN_STYLE=Manual`, `PROVISIONING_PROFILE_SPECIFIER` and
`CODE_SIGN_IDENTITY` build settings. Swift Sim preserves those selections during
archive and export.

Do not paste the key or device token into a chat. Configuration remains in the
Mac's private `~/.swift-sim/notifications` directory. Disable new sends with
`swift-sim notifications disable`.

The Mac sends directly to Apple's fixed TLS APNs endpoints. It must be awake and
have network access; the phone can receive Apple's alert on another network
without reaching the Mac. Fetching fresh private activity/build information and
applying hot reload still require a route to the Mac, normally Tailscale.
`swift-sim notifications status` separates provider configuration, registered
preferences, pending attempts and recent APNs acceptance. New outcomes include an
acceptance timestamp; older accepted events have no invented timestamp. The
updated Companion reports its notification permission, banner and Scheduled
Summary settings, plus its latest observed foreground receipt and notification
tap for this paired Mac. A tap is not installation proof. Missing callbacks do
not establish non-delivery: iOS does not run this app for every background alert.
Diagnostics updates preserve pending alert claims and registration history.

An APNs 200 means Apple accepted the alert, not that iOS displayed it. Permission,
Focus, connectivity and iOS scheduling can prevent or delay display. This
implementation has been qualified with a production APNs key and signed physical
Companion: Apple accepted build-ready alerts, and the user separately confirmed
receiving an alert. Each new build still needs its own installation verification.

## Installation and launch history

Apple device management can inspect a reachable device separately. It does not
universally discover installations on phones across networks. A qualified Debug
SDK client can instead confirm that the exact signed build ran through the
private live connection, including over Tailscale on different networks.

This observation checks bundle/version/build, both Mach UUIDs, signed-build
capture, current compiler registration and foreground/root readiness. The UI
reports **Installed & launched — last confirmed**, with timestamps. A cached
status, helper restart or same-process reconnect does not advance those
observations. It does not prove current reachability, continued installation,
uninstall detection, a particular Companion phone or Apple hardware attestation.
Release apps without the SDK still use the ordinary installation/inventory flow.

The helper stores only private process fingerprints for deduplication and exposes
safe source/timestamp fields publicly. The public device-build gateway has no
activity registration or feed routes. Pairing rotation, alert preference changes,
removed tokens, supersession and expiry fence unsent work again immediately
before APNs transmission. Already accepted alerts cannot be recalled; tapping
always resolves fresh state.
