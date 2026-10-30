# Activity, notifications and remote confirmation

Swift Sim keeps a durable activity inbox on the Mac. The Companion shows an
unread badge and lets each paired Mac configure queued-edit, build-ready,
attention, confirmed-reload and launch-confirmation alerts. The last two are off
by default. Notification permission is requested from an explicit user action;
foreground Companion updates go to the inbox without an additional OS banner.

A ready build can therefore appear without transferring its install link through
chat. The phone fetches its install information through the authenticated helper;
push payloads contain opaque event identifiers and bounded display text, not
install capabilities, pairing credentials or diagnostic logs. A notification tap
refreshes the current authenticated feed and checks the Mac installation identity
before resolving a target. Expired, removed or superseded requests do not offer a
stale app handoff. Initial history and enabling alerts do not replay old pushes.

## Queued hot reload

You can submit an edit while using ChatGPT or another app on the same iPhone.
The matching Debug app needs to return to the foreground and report root readiness
before the Mac applies it. No particular screen is required. A prepared update
waiting for the app can produce: **Hot reload queued — open the target app to
apply. This may take a few seconds.** There is no guaranteed countdown.

The activity item provides a clear return-to-app instruction. An app may opt in
to a direct Open App button by adding `SwiftSimLaunchURL` to its signed Info.plist.
It must use a declared custom URL scheme, with no credentials, query or fragment.
Swift Sim never guesses a callback from the first declared scheme. Presentation
is bound to the exact build's binary identity. Existing builds without this
explicit opt-in retain the Companion handoff.

Pending intent, patch compilation, APNs acceptance and notification taps are not
successful reloads. The confirmed state requires matching native application,
replacement and SwiftUI refresh receipts with an increased root revision.
The Debug SDK also shows an unobtrusive host-app indicator for actual received,
applying, refresh-waiting and confirmed events. It does not intercept touches,
change host view identity or ship live-loading feedback in Release. Existing apps
need their next SDK-enabled Debug build for that indicator; no automatic rebuild
or installation is required just to receive inbox updates.

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
An APNs 200 means Apple accepted the alert, not that iOS displayed it. Permission,
Focus, connectivity and iOS scheduling can prevent or delay display. This
implementation has not yet been qualified with a real APNs key and signed
physical Companion.

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
