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

## Resource and product state

The failed Xcode worker exited. No app-control action was sent, no task runner
was installed, and no project, companion, SDK, signing setting, or network policy
was changed. The existing Swift Sim helper passed its local delivery-health
check and was not restarted. The ordinary hot reload path was not exercised by
this test, so its phone connectivity is not inferred from these results.

Private command results and ownership records are retained under the ignored
task evidence directory. No evidence was uploaded or posted externally.
