# Physical wireless app-control qualification — November 2, 2026

## Decision

**The wireless input gate failed. Do not ship the physical-device integration.**
The stock provider can open and inspect the app wirelessly, but the first tap
lost its transport response. This is functional observation evidence only;
typing, scrolling, reconnect acceptance, and an edit/test loop remain unqualified.
No custom driver or framework patch was attempted.

## Environment and authorization

- macOS 26.5.2, Xcode 26.6, Node 24.
- Physical iPhone 16 Pro running iOS 27.0.1, paired and unlocked with Developer
  Mode enabled. The exact device was selected explicitly.
- Stock, unmodified `agent-device` 0.21.36, the latest npm release at this check.
- Existing Swift Sim build 24 was the native target; Zenics build 40 was also
  confirmed installed. Neither app was rebuilt, updated, or uninstalled.
- The user explicitly made the phone available for this qualification.
- Mac `DevToolsSecurity` was initially disabled. The user separately approved
  enabling it, completed the macOS administrator prompt, and its enabled state
  was verified. That approved Mac developer permission remains enabled.

USB inventory reported no attached iPhone before or after the trial. CoreDevice
reported `transportType: localNetwork`, `tunnelState: connected`, and TCP both
before and after. This qualifies the connection as an Apple local-network
trial, not USB or a Tailscale/cross-network test.

## Sequence and observations

| Step | Result |
| --- | --- |
| Open the installed companion | Succeeded through CoreDevice |
| Initial screen read | Refused because Mac developer-tool access was disabled; no input dispatched |
| Retry after permission approval | A normal screen-read deadline expired during first runner startup; the provider canceled that request |
| Explicit `prepare ios-runner` via the public Node API | Succeeded with a signed, stock XCTest runner and a healthy response |
| Open with initial snapshot | Returned the Swift Sim app library with semantic buttons and its search field |
| Press the current search-field reference | Failed with `runner_reply_lost`, `socket hang up`, `status_probe_failed`, and `dispatched: unknown` |
| Fresh read after the failed press | Succeeded; search remained unfocused and no keyboard was present |
| Further input | Not attempted; no blind replay of an ambiguously dispatched action |
| Close and teardown | Session closed and runtime reported platform owners closed, with no runners handed off |

The provider's automatic tap recovery also reported a runner readiness preflight
failure before command send and a runner restart. This does not establish whether
the tap reached the phone. The fresh screen read did not show its intended effect.

The retained private runner log contains two
`AGENT_DEVICE_RUNNER_COMMAND_COMPLETED command=snapshot` records, zero tap accepted
or completed records, two `NECP_CLIENT_ACTION_ADD_FLOW` messages, and one
`Failed to create connection from listener` message. Absence of a log record is
supporting evidence, not a substitute for the provider's unknown-dispatch result.

Observed snapshot durations were about 7.3 and 10.4 seconds. This does not meet
any claimed fast-input or latency qualification; no such claim is made.

## Upstream status and stop boundary

[Callstack issue #4107](https://github.com/callstack/agent-device/issues/4107)
was still open at this check. Its reported signature is the same: Wi-Fi screen
reads succeed, input loses its transport response, and the runner rejects a
connection before a confirmed tap. Maintainer discussion points to the network
route, but the exact cause on this Mac is not proven.

The current published release remained 0.21.36. No stock transport-selection
setting resolving this failure was found in the evaluated package. No USB
fallback, Finder pairing changes, external input hardware, framework fork,
replacement driver, public runner exposure, or speculative tunnel was added.

Per the [bounded spike plan](../internal/plans/APP_CONTROL_SPIKE.md), stop this
implementation here. Requalify only when a stock upstream release or documented
configuration addresses wireless input. A future pass still needs observed
typing, scrolling, reconnect, one real Debug edit/test loop, and clean teardown.

## Cleanup and product state

Both task-owned provider host processes exited. No task-owned Xcode runner
process remained on the Mac. The temporary runner app installed specifically
for this evaluation was removed from the phone through CoreDevice. Existing
apps and app data were preserved. Zenics was opened again after cleanup.

The existing Swift Sim helper passed its local delivery-health check. Its
loopback listener and existing process remained running. That is a local
service check, not proof of the phone's separate Tailscale connection.

No automation code was added to the companion or Debug SDK, no provider was
installed globally or added as a Swift Sim runtime dependency, and no new
agent skill or production automation command was advertised. Private command
records, connection metadata, runner diagnostics, and teardown results remain
in the ignored task evidence directory; they were not uploaded or posted to
the upstream issue.
