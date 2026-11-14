# Local developer-service probe — November 7, 2026

The subsequent [cellular capability qualification](DIRECT_INSTALL_LOCAL_SERVICE_CAPABILITIES_2026_11_07.md)
opened the native connection, received its complete advertised list on cellular,
and found no usable installer interface. This document records endpoint discovery
and the preceding crash recovery.

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
After the owner unlocked and left the phone awake, the ordinary Xcode retry
succeeded. Its developer-support metadata reported usable and compatible.

The frozen diagnostic was then reinstalled in 5.469 seconds with native
completion, matching inventory, and staging cleanup. A new testing request was
sent. The owner confirmed switching to cellular and returning to Swift Sim
without a crash. Its local approval record was still pending when checked; no
input session was opened or approval bypassed.

The explicitly requested read-only diagnostic could not be retrieved. A
configuration-only check and a bounded connection check found the runner's
configured remote port refusing connections. This does not establish whether
remote access was disabled or the process stopped. The owner was asked to check
the Server Ready notification's Enable Remote Access action before any relaunch.
The owner clarified that they had already pressed the notification action.
That action was not requested again as a recovery step.

The configured runner and installer use the same pinned host; the runner uses
its expected port. A connection-only native installer inspection on cellular
also returned `pairing_connection_refused` before authentication. Reading the
runner source shows that its callback can report ready for a local-only
listener, so return to Swift Sim alone does not prove remote availability.
This source finding does not establish the actual listener state in this trial.

With renewed owner availability on Wi-Fi, the exact expected daily log file
could not be copied because it was absent. A scoped listing of the runner's
log directory contained only November 3 and November 5 logs. The scoped crash
reader returned the same earlier launch-time report; no new report was
available from that read-only service. These observations leave the retry's
startup stage unknown. They do not prove another crash or a disabled setting.

The normal runner build 4 was restored again in 4.088 seconds, with native
completion, matching inventory and staging cleanup. Its canonical saved IPA and
installation metadata still match the frozen normal artifact. The temporary
diagnostic is no longer installed, and the phone was released for normal use.

## Revised diagnostic preparation

The next temporary probe removes the remote-listener prerequisite for collecting
its result. Test-server startup invokes the same one-shot read-only check; a
bounded local JSON receipt records bundle loading and the final result in the
testing app's cache. Loading alone does not request a service. A later scoped
file copy can read the result without enabling remote RPC or taking UI control.
The receipt contains only the already bounded probe fields, uses owner-only
permissions and first-unlock file protection on iPhone, and never contains an
endpoint, pairing key, IPA, address or arbitrary error text.

Nine local fixture cases pass, including load-only behavior, terminal persisted
result equality, file permissions and the size bound. The revised iPhone build
compiled. Both the diagnostic (internal build 5) and original normal-code restore
(internal build 6) were signed and checked offline before further phone use.
The normal product runner sources, SDK and helper code are unchanged.

## Physical local-endpoint result

After renewed owner availability, diagnostic build 5 installed on Wi-Fi in
7.051 seconds, with native completion, matching inventory and staging cleanup.
The owner then confirmed opening Swift Sim App Testing directly on cellular,
with Tailscale connected. No new testing notification, Remote Access action,
Mac input lease or RPC was used for this attempt. The owner was asked to leave
it open for fifteen seconds before returning to Wi-Fi for the readout.

A scoped file copy retrieved the new diagnostic's local JSON receipt. It records:

- An already initiated authorized XCTest session was present.
- The expected request selector was present and its callback ran.
- The returned object was an `NSXPCListenerEndpoint`; state was `endpoint_returned`.
- The endpoint was not opened or serialized. No installation was submitted and
  no installation capability was established.

The loaded local class names included `XCTRunnerDTServiceHubSession` and
`DTServiceHubClient`. This is physical endpoint-return evidence after an
owner-confirmed cellular launch. The receipt did not record a timestamp or active
network interface, and retrieval occurred after returning to Wi-Fi. Consequently
it does not independently establish the precise network state at callback time,
prove an off-Mac installation transport, or qualify fresh cellular installation.

Normal runner code was then restored as internal build 6 in 5.318 seconds, with
native completion, matching inventory and staging cleanup. The canonical normal
IPA and installation metadata were updated to that exact restore artifact. The
prepared restore was verified to contain no probe class. No diagnostic remains
installed, and the phone was released for normal use. Companion stays build 38;
Zenics was not updated.

## Capability gate after endpoint return

Static inspection of this Mac's installed XCTestCore shows
`XCTRunnerDTServiceHubSession` exposes `initWithConnection:` and `dtxConnection`.
The host Instruments framework's `DTServiceHubClient` methods create connections;
the inspected class does not expose an app-install method. The host framework is
not proof of the phone endpoint's full service surface. No private framework was
loaded or invoked on the Mac during this inspection.

The next useful gate is a bounded, read-only examination of the endpoint's
advertised services using the matching native client contract. Endpoint return
alone does not justify transferring an IPA, exposing a generic remote proxy,
calling unrelated process-control services, or adding a permanent runner. An
installation-capable interface must be established separately before an install
trial is designed.

## Proof boundary and resources

Fresh cellular installation remains unproven. Even a future successful endpoint
callback would prove only that endpoint return; installation authority, reliable
startup, transfer, completion, and post-reboot behavior remain separate gates.

Private crash data, signing inputs, frozen trial/restore packages, local fixture
sources and receipts remain under ignored
`.build/local-developer-service-probe-20261107/`. The read-only reader and build
workers exited. No new listener, simulator, watcher, or persistent worker was
created. The ordinary hot reload and notification runtimes were not changed.
