# WDA cellular cold-start check — November 3, 2026

## Current result

**Stock remote cold-start failed before the runner could install or launch.**
The user confirmed the iPhone was unlocked, on cellular with Wi-Fi off, and
connected to Tailscale. The Mac's Tailscale client was running. The phone
answered tailnet discovery and ICMP pings, but Apple's developer connection
was unavailable and Xcode could not select it as a test destination.

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

The bounded Xcode attempt used the same prepared, signed stock WDA 16.17.8
configuration as the successful Wi-Fi test, with a 20-second destination
discovery limit. The failure happened before running the provider's test code;
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

The user was asked to restore Wi-Fi temporarily so a separate runner can be
started through the known-working local Apple connection. After that, switch
back to cellular and test the running WDA server specifically through the
phone's tailnet address. This would distinguish remote HTTP input from remote
Apple test-runner startup. It cannot turn this failed cold-start into a pass.

That warm-runner handoff check is pending the user's network change. No runner
was started while waiting. A production acceptance still requires cold-start
and restart while the phone is already remote, not just a warm handoff.

## Resource and product state

The failed Xcode worker exited. No app-control action was sent, no task runner
was installed, and no project, companion, SDK, signing setting, or network policy
was changed. The existing Swift Sim helper passed its local delivery-health
check and was not restarted. The ordinary hot reload path was not exercised by
this test, so its phone connectivity is not inferred from these results.

Private command results and ownership records are retained under the ignored
task evidence directory. No evidence was uploaded or posted externally.
