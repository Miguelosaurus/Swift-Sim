# Optional runner lifetime and setup — November 5, 2026

## Phone lifetime qualification

A narrow modification of the pinned iCTRL source adds a ten-minute monotonic
timer, a pre-dispatch expiry guard and an independently advertised lifetime
capability. The encrypted protocol and input engine remain upstream. Expiry
uses `_exit` off the UI queue, without waiting for Mac traffic, UI work, log
locks or teardown handlers. Normal teardown cancels the timer. Connecting or
opening another start URL does not renew an active timer.

The modified test bundle compiled for a physical iPhone with the existing
Xcode installation. It was packaged into a copy of the existing trial runner
host, signed with the existing development profile, deeply verified and
installed over the same app identity. The original trial artifacts were
preserved. The build-only host was not installed. Pairing keys and the pinned
phone identity survived without another approval.

After installation, the user confirmed Wi-Fi off and Tailscale connected and
opened testing through Swift Sim. An authenticated observation reported:

- Distinct provider version `1.98.16-swiftsim.1` and lifetime capability.
- Maximum lifetime 600 seconds, with about 571 seconds remaining.
- Swift Sim already in front after the launch callback.

No further runner RPCs or stop commands were sent during the wait. A TCP
check **28.5 seconds after the reported deadline** received connection refusal.
This bounds the physical observation; it does not measure the exact exit
millisecond or exclude every possible earlier termination. The separate real
process test verifies the timer still exits with its main thread blocked and
that a second arm cannot replace the original expiry handler.

The authenticated network configuration listed both cellular/VPN interfaces
and `en0`. Consequently this run retains the user's cellular report but does
not claim independently proven cellular exclusivity. It qualifies the bounded
runner/launch behavior, not a new transport or post-reboot recovery path.

## Reproducible setup

`app-control setup` is a one-shot opt-in installer. It verifies the pinned
source archive, release template IPA and local build assets, applies the small
patch, builds only the testing bundle with Xcode, uses the upstream signer,
and verifies the resulting signature. Profiles must be unexpired development
profiles covering the exact phone, team and app; a matching existing keychain
identity signs the nested bundle and runner. No certificate, account, package
manager dependency, daemon or target-app code is introduced.

The setup command's build-only path downloaded, verified, compiled and signed
successfully on the Mac, including its final asset-preservation and build-stamp
path. Actual device/profile/keychain-identity matching also passed. The public
release template's executable text section
and linked libraries match the known trial host after signature removal on
disposable copies; the complete normalized files differ, so they are not
claimed byte-identical.

After the user reconnected the selected phone to the Mac's Wi-Fi, the installed
global CLI's complete setup command downloaded, built, signed and installed the
public-template variant successfully. The command returned `runner-installed`
with `launched: false`; it created no testing session. The private Mac profile
and credential files remained byte-identical. A subsequent connection attempt
was refused, confirming the runner remained stopped. Only the signed runner was
submitted for installation; the build-only host was not submitted.

Separate exact-bundle app-inventory queries timed out while enabling developer
services, so no inventory result is claimed. A fresh launch/authentication check
of this reproducibly installed build subsequently passed. Authentication reported
the bounded version and exact expected build-recipe fingerprint. Its authenticated
network configuration listed cellular and Tailscale interfaces with no Wi-Fi
interface, independently qualifying fresh cellular startup of the installed
variant. No session, UI capture, activation, taps or edits were sent. An explicit
stop was followed by connection refusal. The earlier unattended lifetime check
used the separately packaged candidate.

The optional client validates both version and the finite lifetime capability
before claiming phone shutdown support. It caps its local lease to the phone's
remaining lifetime and never sends a renew/configuration request. The stock
upstream runner remains usable with explicit shutdown and no automatic-stop
claim. Setup never launches the phone app; a saved installation receipt is
historical evidence and does not imply current connectivity.

## Limits

The full supported Node 24 regression run passed **1,353 tests**. Focused checks
after the final profile-selection refinement also passed, including certificate
matching, archive containment, session ownership, bounded-worker selection,
native expiry under a blocked main thread and ordinary-module import isolation.
Type/lint/architecture/docs and package-content checks passed. No normal helper
or engine restart was required.

Initial installation and missing Apple developer support still need a working
developer connection. Cellular-only developer-image recovery after reboot,
silent remote wake, and a new notification/phone-approval request protocol are
not provided by this change. The normal helper, hot reload engine, notification
delivery and Debug SDK do not import or invoke the new setup/runtime code.
