# Local developer-service probe — November 7, 2026

The first phone attempt did not reach the diagnostic. The matching testing-runner
crash report records a launch-time DYLD failure loading
`@rpath/XCTest.framework/XCTest`, before application code ran. This is a missing
Apple developer-support prerequisite, not evidence for or against the proposed
local service's installation capability.

## Isolated experiment

The [research candidate](DIRECT_INSTALL_DEEP_RESEARCH_2026_11_07.md) was implemented
only in a temporary copy of the existing optional testing runner. Its first
authenticated `device_info` request would ask an already initiated XCTest session
for `requestDTServiceHubConnectionWithReply:`. It does not initiate a testing
session, connect or serialize the returned endpoint, upload an IPA, invoke an
installer, or provide a generic remote selector interface.

The result is bounded, requested once, and times out after three seconds. The
historical upstream callback declaration and current runner header informed its
typed callback. Eight local fixture cases passed: endpoint return, denial,
exception, absent session, absent selector, timeout, ignored late reply, and an
unexpected returned type. These fixtures do not qualify real iOS callback
compatibility, authorization, or installation capability. A generic device build
compiled successfully after correcting optional Swift string handling.

No diagnostic was added to the companion, target-app SDK, hot reload engine,
ordinary helper startup, notification handling, or published optional runner.

## Physical attempt and restoration

The temporary runner, internal build 3, installed over the existing Wi-Fi
transport in 10.775 seconds. The owner was asked to switch to cellular before
accepting the testing notification, then reported the app opened by that action
crashing. The request remained pending when checked and was cancelled. No
app-control input session was opened and no screen or input command was sent.

With renewed owner availability on Wi-Fi, the original normal runner code was
restored as internal build 4 in 3.812 seconds. The native installer reported
completion, verified installed identity, and confirmed staging cleanup. The
canonical signed runner and installation metadata were updated to that exact
normal artifact and their hashes match. These are optional-runner versions;
Swift Sim Companion remains normal build 38 and Zenics was not updated.

A separate read-only crash reader reused the existing authenticated pairing,
verified the device identity, and fetched only the matching runner report. It
did not delete logs, launch apps, install anything, or request UI access. The
report identifies `iCTRLUITests-Runner`, DYLD termination code 1, missing XCTest,
and explicitly says termination occurred at launch. Thus this attempt provides
no runtime result from the local-service probe.

An ordinary Xcode developer-support restoration was then attempted on Wi-Fi.
It returned `kAMDMobileImageMounterDeviceLocked`: the phone had locked. No trust
reset, security bypass, pairing replacement, or alternate image was attempted.
Restoration is waiting for the owner to unlock and leave the phone awake. The
normal runner is installed, but its launch readiness is not yet requalified.

## Proof boundary and resources

Fresh cellular installation remains unproven. Even a future successful endpoint
callback would prove only that endpoint return; installation authority, reliable
startup, transfer, completion, and post-reboot behavior remain separate gates.

Private crash data, signing inputs, frozen trial/restore packages, local fixture
sources and receipts remain under ignored
`.build/local-developer-service-probe-20261107/`. The read-only reader and build
workers exited. No new listener, simulator, watcher, or persistent worker was
created. The ordinary hot reload and notification runtimes were not changed.
