# WDA cellular cold-start check — November 3, 2026

## Current result

**The awake-cellular retry failed before the runner could install or launch.**
The first attempt was confounded: after initially confirming the expected
state, the user clarified that the phone had been off and requested another
attempt. That first result alone is inconclusive. The user was away from home
and could not return to the Mac's Wi-Fi for a handoff test.

The fresh retry again obtained a tailnet ICMP response, but Apple's developer
connection remained unavailable. Direct Apple lockdown connections were refused
over both tailnet IPv4 and IPv6; the live CoreDevice query failed with error
1011; Xcode again exited 70 because it could not find the specified destination.
The host could not independently read the phone's lock state because that
developer connection was unavailable. No automatic UI action was dispatched.

This does not supersede the successful
[same-Wi-Fi qualification](WDA_WIRELESS_2026_11_02.md). It establishes that the
required cellular startup path is not qualified. No production automation
integration should be advertised as supporting this workflow.

## Observations

| Check | Result |
| --- | --- |
| Tailnet peer ping | Replied |
| Tailnet ICMP ping | Replied |
| Existing CoreDevice pairing | Still recorded as paired |
| CoreDevice transport/tunnel | No current transport; tunnel unavailable |
| Live device lock-state query | Failed with CoreDevice error 1011: device could not be located |
| Tailnet DNS name passed to CoreDevice | Did not resolve to a discovered developer device |
| Apple lockdown TCP endpoint over tailnet IPv4 | Connection refused |
| Same endpoint over tailnet IPv6 | Connection refused |
| Stock `xcodebuild test-without-building` | Exited 70: no destination matching the explicit paired device |

Both bounded Xcode attempts used the same prepared, signed stock WDA 16.17.8
configuration as the successful Wi-Fi test, with a 20-second destination
discovery limit. They failed before running the provider's test code;
it is not an observed WDA tap, typing, or scrolling failure.

CoreDevice's general device-details query returned saved metadata successfully
while reporting its tunnel unavailable. That metadata response is not evidence
of a live developer-service connection. The separate live query and Xcode
destination lookup did not succeed.

The earlier experiment had removed the task-owned runner app during cleanup.
This run therefore does not claim to have launched a preinstalled runner on
cellular. The observed discovery failure precedes installation or launch. The
prepared signed app and test configuration remain available on the Mac.

A check of the old WDA endpoint also returned connection refused. Because no
runner was running, that is an expected negative control, **not** evidence that
a running WDA HTTP server cannot be reached over Tailscale.

## Next isolation check

The proposed warm-runner handoff check was cancelled when the user clarified
they were away from home. No Wi-Fi restoration is pending and no local runner
was started. The lower-level Apple remote-device list also had no entries;
there was no hidden existing developer connection available to reuse.

A future controlled handoff could distinguish running WDA HTTP input from
Apple startup. It cannot turn these unsuccessful startup attempts into a pass.
Production acceptance still requires cold-start and restart while the phone is
already remote. An existing supported way to establish that Apple developer
connection over the tailnet must be qualified before shipping this feature;
no replacement launcher, custom driver, app modification, or public relay was
added in this test.

## Explicit RemotePairing research and bounded endpoint check

The stock discovery failure does not establish that developer traffic cannot
travel through Tailscale. It did not test an explicitly addressed, authenticated
modern RemotePairing tunnel. The lockdown endpoint above is a different service.

Two upstream implementations document a narrower available route:

- [iOS OTA](https://github.com/zjz-connect/ios-ota#current-network-boundary)
  reports acquiring an authenticated RemotePairing bridge while the phone is
  connected to any Wi-Fi, then retaining that session after a switch to 5G.
  Its README explicitly excludes cold startup on pure 5G and requires Wi-Fi
  again if the outer session is lost. It does not register a native Xcode run
  destination. Installation support alone therefore does not qualify WDA startup.
- [Omarchy Apple Dev](https://github.com/joshuaswarren/omarchy-apple-dev/blob/main/docs/OVER-TAILNET.md#what-was-measured-ios-2701-2026-10-10)
  reports install/launch over Tailscale from another subnet on iOS 27.0.1, but
  refused RemotePairing connections with Wi-Fi off and cellular active.

These are upstream reports, not reproduction on this phone. A bounded check
here tried only their documented candidate RemotePairing TCP port 49152 over
the selected phone's tailnet IPv4 and IPv6 addresses. Both connections were
refused. No protocol data, pairing operation, or UI action was sent. The port
can vary; this check is not exhaustive and does not prove all modern developer
endpoints unavailable. Private results are retained with the task evidence.

The next useful qualification is explicit trusted RemotePairing while the
phone is associated with any Wi-Fi, followed by a controlled cellular handoff
and separate runner restart test. A session surviving a handoff is distinct
from recovering after that session drops. Neither is currently proven here.
No upstream bridge, persistent daemon, pairing change, or source fork was
installed as part of this research.

## Resource and product state

The failed Xcode worker exited. No app-control action was sent, no task runner
was installed, and no project, companion, SDK, signing setting, or network policy
was changed. The existing Swift Sim helper passed its local delivery-health
check and was not restarted. The ordinary hot reload path was not exercised by
this test, so its phone connectivity is not inferred from these results.

Private command results and ownership records are retained under the ignored
task evidence directory. No evidence was uploaded or posted externally.

## Explicit-connection preparation checkpoint

The user requested continuing beyond the discovery diagnosis. The selected
phone was online in Tailscale during a further bounded availability check of
only the documented RemotePairing candidate range, TCP 49152–49167, over its
tailnet IPv4 and IPv6 addresses. Of 32 checks, 31 were refused and one timed
out; none connected. No application data, authentication attempt, or UI action
was sent. This is a range-limited observation, not proof that every possible
developer endpoint is unavailable. The user's current network state was asked
separately and was not inferred from Tailscale's online flag.

A task-local copy of MIT-licensed **iOS OTA 1.3.1** was downloaded at commit
`d50141ad7af63acf74f92f967f17e942488c666b`. Its reviewed build script fetched
the hash-pinned Go 1.26.5 toolchain and pinned go-ios source
`3ebc297691a9e364772aef027744ebc0c49421a5`, then applied the repository's
existing downstream patch. Toolchains, dependency caches, workspace, executable,
and logs remain under the ignored task directory; nothing was installed into
the user's PATH or login services. Compilation concurrency was limited to two.
The executable's version metadata and hashes are retained privately.

The upstream verification script passed: affected dependency package tests,
module tests, race checks, and vet. Physical-device tests were not enabled.
These results qualify local preparation only, not transport or input on this
phone. Source inspection confirms that `run-tests` uses the authenticated
explicit tunnel's native testmanagerd/appservice channels without looking up
an Xcode destination. Its stock test selector can address the existing
`UITestingUITests/testRunner` method; actual WDA execution through this bridge
remains untested. The earlier signed WDA app does not need a source change.

The required bridge identity is absent on this Mac. Existing Xcode trust is
not automatically imported by this bridge. Its documented device-initiated
bootstrap creates a separate trusted RemotePairing identity on the same LAN;
it requires complete host identity fields, including `host_alt_irk`, which
the simpler host-initiated pair-record recipe does not supply. Do not fabricate
those fields, extract native private keys, overwrite another pairing, or reset
trust to skip this step. Pairing was not attempted in this checkpoint.

The next private qualification plan records these details:

1. Bootstrap one separate trusted identity with the phone available locally;
   preserve the existing Xcode pairing and display pairing codes locally.
2. Use a short owner-only profile path: a Unix socket beside the profile would
   exceed macOS's path limit if placed under this long checkout path.
3. Acquire one foreground bridge while the phone is associated with Wi-Fi.
   Verify authenticated device identity and fresh developer-service discovery.
   A tunnel with installation services alone is insufficient.
4. Switch to cellular, install only the temporary signed runner, and launch
   its unchanged native test through the bridge. For WDA, use the runner as
   both app and runner identifier. Without the earlier Xcode environment
   overrides, WDA uses its default HTTP port 8100, not the old trial's 28100.
5. Observe native input and its results, shut down WDA, then restart it through
   the still-active bridge on cellular. Separately stop the outer bridge and
   test cellular cold recovery. Keep those acceptance claims distinct.
6. Remove only the temporary runner and close task-owned connections/workers.

No foreground bridge, pairing listener, test runner, persistent service, public
relay, or product integration was started. Build/test workers exited, and the
existing helper listener retained its original process. Both apps, the Debug
SDK, hot reload, and notification code remain unchanged. Warm handoff may be
useful, but a mandatory always-running bridge would be a new lifecycle and
memory tradeoff; it is not silently authorized as a production solution.
