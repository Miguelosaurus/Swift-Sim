# Cellular local-service capabilities — November 7, 2026

**The local connection works on cellular, but this experiment found no usable
app-install interface on it.** It returned a complete list of 115 Instruments
capabilities. None advertises installation. The related native interfaces
inspected below provide app listing, debug file transfer and preview operations;
they do not establish a replacement for the Apple installation service.

This closes the endpoint-discovery experiment with a bounded negative result
for direct installation. It is not proof that every undocumented service
operation is impossible. No cellular install was submitted or qualified, and
the connection was not added to Swift Sim's normal install path.

## From returned endpoint to native capability exchange

The [previous experiment](DIRECT_INSTALL_LOCAL_SERVICE_PROBE_2026_11_07.md)
proved endpoint return but did not open it or independently capture network state.
For this follow-up, static inspection of this Mac's installed XCTestCore
established the native client contract: XCTest converts the returned endpoint
into its local XPC connection, passes it to the Instruments client and resumes
the resulting DTX connection. Its capability getter provides the discovery list.
No framework was loaded or invoked on the Mac during this inspection.

The provider's [DTX connection implementation](https://github.com/doronz88/pymobiledevice3/blob/master/pymobiledevice3/dtx/connection.py)
independently describes capability exchange separately from opening service
channels. The temporary probe follows the native client contract only for that
exchange. It does not publish a general proxy, open a service channel, launch a
process, send UI input, transfer a file, or invoke installation.

The probe reuses an already initiated authorized XCTest session. One request,
a five-second terminal deadline, cancellation of the newly created connections,
bounded capability output and a local receipt limit its lifecycle. A late result
cannot overwrite the terminal result. Load-only initialization records a
breadcrumb without requesting a service. No pairing or security setting changes
are part of this experiment.

The local receipt adds timestamps and active interface names without recording
addresses. The cellular gate requires a cellular address and no Wi-Fi address
at both endpoint reply and completion. This is distinct from the later Wi-Fi
file copy used to read the result.

## Physical result

The optional diagnostic, internal runner build 7, installed on Wi-Fi in
**8.130 seconds**, with native completion, matching inventory and staging cleanup.
The native install client exited before the cellular phase. No remote-control
lease was opened.

The owner then turned Wi-Fi off, kept Tailscale connected and opened Swift Sim
App Testing directly from its phone icon. No Mac testing notification, Remote
Access action, input command or Mac-side developer request was used to run this
probe on cellular. The owner left it open for fifteen seconds before returning
to Wi-Fi for the readout.

The saved receipt confirms:

- The local endpoint returned and its native connection completed capability
  exchange in **257.999 ms** from probe start.
- All **115 capability names** fit within the bound; the list is complete.
- Cellular and VPN interfaces were present at callback and completion; no Wi-Fi
  address was present at either point.
- No installer-named capability was advertised. No installation was submitted
  and no installation capability was marked proven.
- Zero service channels were opened. Cleanup of the probe connection completed.

The [sanitized capability receipt](data/LOCAL_SERVICE_CAPABILITIES_2026_11_07.json)
contains the complete names and proof counters, without device identifiers,
addresses, credentials, app contents or private crash data. It qualifies local
developer-service discovery on this device and developer-support combination,
not post-reboot preparation, an unattended wake mechanism or cellular installation.

## Check the adjacent operations, not only their names

Static native interface inspection was used to avoid treating an installation
notification or a transfer method as an install command:

- **App listing:** `DTApplicationListingServiceRequests` provides installed-app
  lookup and update-token removal. The provider's
  [application-listing client](https://github.com/doronz88/pymobiledevice3/blob/master/pymobiledevice3/services/dvt/instruments/application_listing.py)
  likewise calls `installedApplicationsMatching:registerUpdateToken:`. The
  native `applicationInstalled:` method is an incoming notification, not an
  instruction to install a package.
- **File transfer:** the inspected authorized protocol transfers files or data
  into an existing app's debug inbox/container, or opens a transferred document.
  Uploading a file into an app container does not install its executable.
- **Assets and previews:** the inspected interfaces register resource manifests,
  connect to a preview host and forward preview messages. No app-install
  operation was established. No preview process was launched in this experiment.

Those native interface reads came from installed local framework metadata;
host and phone implementations must not be assumed identical in every detail.
The physical capability list is the phone evidence. A complete advertised list
and these interface reads support rejecting this candidate as a currently
usable installer; they are not exhaustive proof against all private APIs.

The provider's [installation client](https://github.com/doronz88/pymobiledevice3/blob/master/pymobiledevice3/services/installation_proxy.py)
uses the separate installation-proxy service, with explicit package staging,
submission and completion. This experiment did not expose that service through
the local Instruments connection. The previously observed cellular refusal of
the ordinary developer connection remains unresolved.

## Verification, restoration and product boundary

Seventeen Mac fixture cases passed: normal and empty capability responses,
installer-like naming without claiming authority, truncation, invalid types and
names, missing native client, client exception, cancellation of a blocked getter,
missing session/selector, endpoint denial/exception/timeout, ignored late reply,
wrong endpoint type and load-only behavior. They verify one-shot request counts,
connection cancellation, zero service-channel calls, local receipt equality,
permissions and output bounds. Fixtures disable real XPC connections and do not
qualify the phone ABI; the physical exchange above supplies that bounded proof.
The actual iPhone diagnostic compiled and both trial and restore signatures and
profiles were checked before installation.

The original normal runner code was restored as internal build 8 in
**6.596 seconds**, again with completion, matching inventory and staging cleanup.
The canonical signed IPA and installation metadata match that exact artifact;
the normal restore was verified to contain no probe class. The testing port
refused connections afterward and no input lease remained. The phone was released
for normal use. Companion remains normal build 38 and Zenics was not updated.

All diagnostic source, signed packages and private receipts remain under ignored
`.build/local-service-capabilities-20261107/`. A task-owned read-only developer
image mount used for static inspection was detached. Build/signing workers exited;
no server, simulator, watcher or persistent worker was added. The normal helper,
SDK, hot reload, notification and optional-runner sources were unchanged.
