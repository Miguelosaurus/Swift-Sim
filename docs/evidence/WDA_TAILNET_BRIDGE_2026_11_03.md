# WDA through an explicit Tailscale bridge — November 3, 2026

## Result

**Cellular runner installation, startup, input, and restart passed through an
Apple connection acquired on Wi-Fi. Fresh outer-connection startup on cellular
still failed.** No app or SDK changes were needed. This is a conditional physical
qualification, not unrestricted cellular availability or a shipped feature.

The user confirmed the initial shared network, then confirmed Wi-Fi off,
cellular active, Tailscale connected, and the phone unlocked. The same authenticated
bridge stayed at generation 1 through installation, both native test runs, and
runner removal. Stock WDA HTTP requests used the phone's Tailscale address.
Neither installation nor test startup depended on an Xcode destination lookup.

| Physical check | Observed result |
| --- | --- |
| New trusted component identity | Paired and independently verified over the Mac's existing trusted network lockdown connection |
| Wi-Fi-to-cellular handoff | Explicit Tailscale bridge remained active |
| Install signed temporary runner on cellular | Completed; installation readback succeeded |
| Start stock WDA on cellular | Native test started; HTTP status ready |
| Tap and type in Swift Sim | Search became exactly `Zenics`, independently read back |
| Navigate and scroll | Zenics App History opened; five build rows changed vertical position |
| Stop runner | WDA shutdown acknowledged; native test completed successfully |
| Restart runner on cellular | New native test/session started through the same bridge; typing, navigation, and scrolling passed again |
| Restore target app | Library search cleared, keyboard dismissed, full-frame PNG retained locally |
| Remove runner | Exact temporary bundle removed; absence verified by InstallationProxy |
| Stop and freshly reacquire outer bridge on cellular | Failed with `remote_pairing_cold`; documented listener refused a new connection |

Both native test results reported one passed selected method and no test error.
Input assertions used separate source reads rather than treating HTTP acceptance
as evidence of a changed screen. No Zenics product data was edited.

## Pairing and tooling

The initial device-initiated pairing UI route was not qualified: the phone showed
only its existing paired-computers list. Both temporary advertisements and their
listener were stopped. No pairing code was requested in chat or printed to logs.

The successful bootstrap reused an already trusted **Network** lockdown session;
no USB cable or additional phone pairing screen was needed. It registered a
distinct component host identity, preserving native Xcode trust. The stock
pymobiledevice3 pair-setup completed, followed by an independent pair-verify.
The resulting private record remains owner-only for reuse.

The isolated test environment pins pymobiledevice3 **11.12.4** and srptools
**1.0.1**. With srptools 2.0.0, this pymobiledevice3 version passed hexadecimal
bytes to an API that now interprets bytes as raw proof; authentication verification
failed before a record was created. Pinning the compatible dependency fixed that
local API mismatch. A local compatibility check accepted a valid proof and
rejected an invalid proof; no authentication check was removed or bypassed.

The stock host-initiated record omits fields required by the Go bridge importer.
Qualification glue persisted the actual host identifier and identity metadata
sent by the stock authenticated pair-setup, alongside its existing keys. It did
not fabricate identity fields or extract Apple's native pairing keys. This stock
version uses fixed host discovery metadata in that flow; the adapter is private
qualification glue, not a production pairing design.

The previously built task-local iOS OTA **1.3.1** executable was used unchanged:
source `d50141ad7af63acf74f92f967f17e942488c666b`, pinned go-ios source
`3ebc297691a9e364772aef027744ebc0c49421a5`, upstream downstream patch, and
Go 1.26.5. Its affected dependency tests, module tests, race checks, and vet had
passed. The existing signed WDA **16.17.8** runner was reused. All 629 provider
package files again matched the original npm archive; no provider fork was made.

## Foreground interruption and action scope

After the first successful input checks, the phone changed foreground apps
during cleanup. A scroll-up and Back request were sent before the subsequent
target text-field lookup failed. No further UI action was sent to that other app;
the session and runner were closed. The incidental diagnostic snapshot was
deleted locally. Do not describe the first cleanup as uninterrupted or infer the
cause of the foreground change from this evidence.

The restart harness pinned the session's target and independently checked the
actual foreground app through WDA's **non-session** active-app endpoint before
each scoped request. A later check refused to dispatch a scroll when the target
was not confirmed. The phone was subsequently observed back in Swift Sim; a
bounded read-only settling check allowed the remaining navigation, scroll, and
restoration to finish. Uncertain actions were not blindly replayed.

These checks and actions are separate HTTP requests, not an atomic exclusive
device lock. Future integration must preserve target-app scope, stop on user
interruption, and require explicit phone availability. A generic stock WDA
session follows the foreground app by default; it is not an adequate scope
boundary by itself.

## Practical boundary and cleanup

A previously established Apple bridge supports real cellular automation and
runner restart. Losing that outer bridge still requires a reachable Apple
listener to reconnect, which this phone did not expose on cellular. Initial
pairing is now solved without extra phone UI; that does not solve fresh cellular
acquisition after a Mac restart or connection loss. Another-Wi-Fi startup after
pairing was not separately tested here.

The temporary runner was removed before stopping the bridge. Both native test
clients, bridge processes, pairing listener, and native Bonjour advertisement
exited. WDA and the local forwarder refused new connections afterward. The
original Swift Sim helper and hot reload engine retained their process IDs,
and helper health passed. Notification and hot reload code was unchanged; those
phone workflows were not independently retested in this trial.

No LaunchAgent, persistent service, public relay, global Python package, Appium
installation, companion change, SDK change, or production automation command was
added. Private screenshots, raw app trees, dependency lock, source/binary hashes,
native results, and resource receipts remain in the ignored task directory.
There is no extra idle worker. A permanent warm bridge would be a separate
lifecycle/memory decision and has not been installed.

## Fresh-cellular follow-up

The user explicitly reaffirmed that warm continuity is insufficient: **fresh
startup while already on cellular remains mandatory**. The conditional result
above must not be treated as acceptance of a retained-bridge product.

Two additional physical conditions were checked without UI automation or app
changes:

- The user enabled the Wi-Fi radio, disconnected it through Control Center,
  and confirmed cellular data with Tailscale connected. The known RemotePairing
  listener refused new connections over both tailnet IPv4 and IPv6. A fresh
  bridge process using the saved trusted pairing returned
  `waiting_for_listener` / `remote_pairing_cold`, then exited cleanly.
- The user opened Zenics Debug while remaining on cellular with Wi-Fi
  disconnected. Both RemotePairing and lockdown refused new connections.
  Another bounded fresh bridge probe returned the same cold-listener failure
  and exited. Launching this development app did not wake the required service.

These checks distinguish a disabled Wi-Fi radio from an enabled but unassociated
radio on this phone. They do not independently identify the device daemon's
internal policy or prove that every possible Apple transport is unavailable.
No broad port scan, protocol change, authentication bypass, or identity reset
was attempted. Both probes and their forwarders were verified stopped.

Further primary-source review did not identify a working replacement:

- [RoamRun at `210260b`](https://github.com/mh-mobile/RoamRun/blob/210260b71bb5ddfcd34b61318b2ad4a2f66092ab/README.md#working-away-from-the-mac)
  requires associated Wi-Fi for initial acquisition. Its cellular option keeps
  an already-ready session; it does not provide fresh cellular startup. The
  README also excludes the phone's own hotspot from its initial-acquisition path.
- [Appium's preinstalled-WDA guide](https://github.com/appium/appium-xcuitest-driver/blob/master/docs/guides/run-preinstalled-wda.md#additional-requirement-for-real-devices-on-iostvos-17)
  avoids `xcodebuild` but still launches through RemoteXPC developer transport.
  It therefore does not remove the unreachable Apple entry point. Its documented
  `devicectl` launch fallback is disabled on iOS 27 for a separate runner issue.
- [Impactor issue 307](https://github.com/claration/impactor/issues/307)
  independently reports both entry points closed on cellular with iOS 27.0.1.
  That report supports the observed boundary; it is not proof on this phone.

No qualified Mac-only fresh-cellular path has been found under the current
constraints. Do not replace the user's requirement with a permanent warm
bridge, claim another VPN/client library fixes it, or add an unproven phone-side
bootstrap to the companion/SDK. A new candidate must explain how it obtains
an authenticated developer connection while those listeners are unavailable
and then pass fresh startup/recovery on the physical phone.

## References

- [Pinned iOS OTA source](https://github.com/zjz-connect/ios-ota/tree/d50141ad7af63acf74f92f967f17e942488c666b)
- [Original same-Wi-Fi WDA qualification](WDA_WIRELESS_2026_11_02.md)
- [Earlier discovery and cellular checks](WDA_CELLULAR_2026_11_03.md)
- [Implementation spike gates](../internal/plans/APP_CONTROL_SPIKE.md)
