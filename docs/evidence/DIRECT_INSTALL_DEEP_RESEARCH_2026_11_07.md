# Fresh cellular installs: deeper transport and authority review — 2026-11-07

**Latest result:** the [physical capability check](DIRECT_INSTALL_LOCAL_SERVICE_CAPABILITIES_2026_11_07.md)
completed on cellular and returned all 115 advertised Instruments capabilities.
It found no usable install interface. The normal runner was restored and no
cellular install was attempted. The sections below preserve the earlier research
and its candidate-selection reasoning.

**There is one concrete untested local-service lead, but no new install success.**
An authorized XCTest runner can request a local DTServiceHub connection. The
selector exists in current local Xcode framework strings and current Appium
headers. Whether that connection can expose installation, rather than only
Instruments services, is unknown. This needs a small capability probe before
building another transport or phone wake mechanism.

Subsequent [physical probe and restoration results](DIRECT_INSTALL_LOCAL_SERVICE_PROBE_2026_11_07.md)
record a returned local developer-service endpoint after an owner-confirmed
cellular launch, followed by normal-runner restoration. The endpoint was never
opened and installation capability remains unknown. Its local receipt was read
after returning to Wi-Fi and does not independently timestamp network state.
The research-only disposition below describes the earlier checkpoint.

Developer pairing can also coexist with an optional managed-install channel.
Treating those as mutually exclusive was too narrow. Management adds enrollment
and certificate setup, and documented prompts still constrain zero-interaction
behavior. No enrollment, app update, device connection or production code change
was performed during this research.

See the [controlled relay results](DIRECT_INSTALL_RELAY_CONTROL_2026_11_07.md)
for the actual physical proof. Its negative result applies to that loopback
route, not to every local IPC interface or possible implementation.

## Distinguish three independent problems

1. Reach an Apple installation service from the authorized developer context.
2. Run the initiating component when needed on cellular, including after reboot
   and an ordinary first unlock, without requiring a retained Mac bridge.
3. Obtain installation completion and the requested installed identity, while
   preserving app data and handling uncertainty without a second submission.

The existing prototype solves transfer/submission/receipt handling over its
qualified Wi-Fi transport. TCP acceptance, an app waking for a push, a connected
XPC endpoint or a successful UI action does not alone solve all three problems.

## New lead: the runner's local developer-service bridge

Appium's [current XCTest runner header](https://github.com/appium/WebDriverAgent/blob/master/PrivateHeaders/XCTest/XCTRunnerDaemonSession.h)
declares `XCTRunnerDaemonSession.requestDTServiceHubConnectionWithReply:`. The
header identifies iOS SDK 26.4. A read-only strings audit of this Mac's installed
iPhoneOS developer frameworks found both that selector and its daemon-request
counterpart in XCTestCore. No framework was loaded, modified or invoked.

This is different from the failed relay: it would ask an already authorized
developer/testing daemon for a local IPC endpoint rather than make an ordinary
phone-app TCP connection to the phone's own pairing service. The existing optional
testing runner is the candidate host; it adds no code to a target app's SDK.

There is **no demonstrated installation authority** here. The inspected
runner-to-daemon interfaces and selected framework strings did not reveal a
general installer method. DTServiceHub is used by Instruments, and its presence
must not be interpreted as unrestricted access to CoreDevice or InstallationProxy.
Absence of a few selector names also does not prove all broker interfaces absent.

The smallest useful next experiment is explicit and read-only:

- In an owner-approved testing session, check availability of that existing
  interface and request the local endpoint through its normal authorization.
- Determine whether the returned service has an installation-capable interface.
  Do not install, transfer an IPA or expose a generic remote IPC proxy during
  discovery. If it only provides instrumentation, reject this candidate.
- Only if installation capability is established, investigate its supported
  lifecycle and a separate on-demand startup mechanism. A foreground runner
  demonstration is not unattended post-reboot proof.

This is an unimplemented research candidate. No new runner build or server was
created. It does not justify a larger XCTest fork or always-running runner.

## Startup: alert extensions deserve separate evaluation

Apple's [notification-extension explanation](https://developer.apple.com/forums/thread/810022)
identifies Notification Service Extensions as independently triggered code with
memory, execution-time and access restrictions. Such an extension is a possible
short-lived entry point when the main app is not running. It does not inherit
XCTest authorization, grant installation privileges, guarantee another app can
be launched, or provide time for an arbitrary IPA download and installation.

If the local-service candidate passes its authority gate, a separate optional
install extension could be evaluated without injecting code into target apps or
adding idle work. Ordinary hot reload and notification payloads would bypass it.
Its permission/lifecycle, memory limit, completion handling and user Stop setting
must all remain real gates, not assumptions. No extension has been implemented.

An ordinary silent push is insufficient for a reliable-start claim: Apple's
[background-push documentation](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)
documents discretionary delivery, throttling and limited execution. Repeated
pushes or unrelated background modes are not a substitute for a qualified wake
mechanism. Developer-support availability after reboot is a separate prerequisite;
the new DDI cryptex tooling is not evidence of a persistent cellular installer.

## Existing automation does not already solve installation

Appium's [app-management implementation](https://github.com/appium/appium-xcuitest-driver/blob/master/lib/commands/app-management.ts)
delegates installation to the host-side real-device object, while app launch uses
the WDA route. A method named `mobile: installApp` therefore does not establish
that an on-phone WDA/XCTest runner installs apps locally. Importing Appium would
add components without proving a new cellular entry path.

The direct on-phone service capability above is a separate question. Existing
cellular app-control success cannot answer it by itself.

## Managed installation can retain developer pairing

An alternative architecture keeps Xcode build/signing and developer pairing,
with OS-managed app installation as an optional delivery channel. The phone's
management client would fetch an HTTPS manifest/IPA, so a public Xcode pairing
listener would not be the transport prerequisite. This does not require adding
an installer runtime to each development app.

Apple's [deployment guide](https://support.apple.com/guide/deployment/distribute-managed-apps-dep575bfed86/web)
describes silent managed-app updates and foreground-app prompts. Unsupervised
takeover of an existing app needs acceptance. The
[InstallApplication reference](https://developer.apple.com/documentation/devicemanagement/install-application-command)
also documents approval behavior; it cannot support a promise of no prompts in
every device/app state. A background/locked update is a distinct test from a
foreground update.

The [MDM payload](https://developer.apple.com/documentation/devicemanagement/mdm)
separates app management (AccessRights 4096) from erase, passcode and other
permissions. App management itself remains a broad app-management permission;
it is not an OS-enforced grant for exactly one bundle. A narrow implementation
allowlist would not change the scope displayed by the enrollment profile.

Outstanding gates include our exact development/ad-hoc IPA signing and live SDK
compatibility, initial app-management approval, foreground prompts, cellular
download policy, post-reboot behavior and exact installed-version verification.
Generic enterprise/App Store examples are not proof that our Debug artifact works.
No current source inspected establishes that entire matrix for Swift Sim.

There is real onboarding cost. Apple's [MDM certificate overview](https://developer.apple.com/help/account/certificates/certificates-overview)
describes a separate MDM certificate flow, not reuse of our ordinary app APNs key.
[NanoMDM](https://github.com/micromdm/nanomdm) provides a modular server but still
needs enrollment identity/SCEP, TLS and enrollment profiles. It is not a tiny
drop-in replacement for developer pairing. Nothing was installed or enrolled.

## Other apparent shortcuts

- **QUIC/UDP:** the current provider's
  [troubleshooting guide](https://github.com/doronz88/pymobiledevice3/blob/master/docs/guides/troubleshooting.md)
  documents removal of the old QUIC developer tunnel in iOS 18.2+. This is not a
  sound alternate transport for the modern device merely because old tutorials
  found a UDP port. No UDP scan was run.
- **Resumption/cached listener:** a TLS ticket or saved key does not recreate an
  unavailable listener after reboot. A local CoreDevice literal mentions a
  no-active-assertion tunnel grace period, but a string is not a documented
  persistence API. Neither establishes fresh post-reboot cellular acquisition.
- **Reverse pairing server:** inspected implementations still do initial pairing
  and close; a generic reverse WebSocket cannot supply the missing developer
  service behind it. This does not prove a new implementation impossible.

## Recommendation and disposition

Investigate the local-service capability first because it can reuse the existing
optional authorized runner and be rejected cheaply if it exposes no installer.
Keep any future wake/installation work outside ordinary helper startup, target
SDKs, hot reload and normal notifications. Treat managed installation as a
separately approved optional mode if its signing and interaction gates can pass.

This research used public documentation/source and static local framework reads.
No phone was contacted, no private key was read, no enrollment or certificate was
created, and no server, simulator or persistent worker was started. Source hashes
and the selector audit are retained in ignored
`.build/cellular-deep-research-20261107/`. There is no new runtime overhead and no
new physical-device success claim.
