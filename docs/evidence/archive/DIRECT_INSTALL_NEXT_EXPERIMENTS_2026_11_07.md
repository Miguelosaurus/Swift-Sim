# Fresh cellular installation: next experiments — 2026-11-07

**Follow-up:** the [controlled relay and outbound-tunnel review](DIRECT_INSTALL_RELAY_CONTROL_2026_11_07.md)
has now completed. Both loopback routes failed on Wi-Fi while direct connections
answered. Normal build 38 was restored. Read the follow-up before repeating these
candidates; the preparation and first-check record below is historical.

**No new cellular installation success is claimed.** Keep ordinary developer
pairing, unchanged Xcode signing and an optional on-demand transport. Preparation
does not modify any target app, hot-reload engine, notification worker or normal
helper import. No device-management profile, replacement VPN or daemon was added.

The previous [cellular relay trial](DIRECT_INSTALL_CELLULAR_RECOVERY_2026_11_06.md)
failed before Apple's public pairing handshake. Normal Swift Sim build 36 was
restored. A successful fresh connection must precede any new install attempt;
retaining a Wi-Fi session does not satisfy the requirement.

## First candidate: existing lockdown pairing → CoreDeviceProxy

This is a distinct tunnel entry path. A trusted lockdown session starts
`com.apple.internal.devicecompute.CoreDeviceProxy`, then establishes CDTunnel
framing over its service stream without RemotePairing's `createListener` call.
Starting the service may still require a separate device service-port connection;
this is not a claim that all traffic uses one TCP socket.

The upstream [tunnel guide](https://github.com/doronz88/pymobiledevice3/blob/master/docs/guides/ios17-tunnels.md)
documents CoreDeviceProxy primarily over USB. Network access through the trusted
record is a testable hypothesis, not upstream proof of cold cellular support.
Earlier lockdown TCP refusals mean it may fail before the service can start.

An isolated probe is prepared under ignored
`.build/cellular-install-alternatives-20261107/`, using the already-installed
`pymobiledevice3` 11.12.4. No package installation or upgrade was needed.

- A Mac-local usbmuxd `ReadPairRecord` retrieved the existing classic record.
  This did not contact the phone, create pairing or change trust. Its task copy
  and configuration are private and outside Git. Offline validation succeeds.
- Inspection requires an execution flag, a literal private-Tailnet address and
  the expected device. It disables automatic pairing and checks observed device
  identity before starting CoreDeviceProxy. No pairing fallback is invoked.
- It checks the tunnel handshake only: no TUN interface, packet worker, app
  inventory, IPA transfer or install. A handshake success still needs RSD device
  identity, scoped inventory and a later Complete/inventory receipt for an install.
- A 12-second operation budget plus bounded stream closure limits the attempt.
  Output contains stages/booleans rather than addresses, keys, device identities
  or raw upstream errors. It leaves no listener or persistent process.
- Twelve local tests pass: execution gates, rejected pairing, wrong device,
  error redaction, malformed handshakes, deadlines, closure and offline record
  checks. Fake adapters do not prove TLS or physical service access. Offline
  imports separately verify the provider exposes the required APIs.

Before execution, obtain current phone availability and cellular/Tailscale
confirmation, with App Testing stopped and no retained Apple bridge. If lockdown
is unavailable, stop there without replacing pairing or invoking an install
fallback. Compare with a Wi-Fi control using the same implementation and record.

## Second experiment: controlled phone-side relay comparison

The previous relay's Mac echo fixture passed, but no real Apple protocol session
was qualified through that same phone relay on Wi-Fi. Its cellular failure alone
therefore does not prove a cellular-specific denial. First establish the Wi-Fi
control, then repeat after a fresh cellular launch with identical framing and
existing Apple keys remaining on the Mac.

A next temporary diagnostic should distinguish Network framework waiting,
refusal, TCP acceptance, first public reply and authenticated tunnel completion.
Alternate interface targets must be actual assigned phone addresses or advertised
endpoints, in a bounded list: no scan, spoofing, arbitrary proxy or trust change.
Interface selection is an unproven diagnostic hypothesis.

[SideInstaller notes](https://github.com/FrizzleM/SideInstaller/blob/main/NOTES.md)
describe own-address pairing resets and additional local tunnel failures.
The [LocalDevVPN report](https://github.com/jkcoxson/LocalDevVPN/issues/31)
distinguishes loopback acceptance from VPN-route failure. These motivate careful
controls, not an assumption that another address solves the full transport.

This is a design only; no new phone diagnostic was built or installed. Even a
foreground relay success leaves background acquisition and zero-extra-tap
operation unqualified. Discretionary push execution cannot be claimed as a
guaranteed wake mechanism.

## Paths not counted as solutions

- A reverse WebSocket moves bytes but cannot supply a missing Apple service.
  The inspected pairable-host responder performs initial pairing, not reverse
  installation. A genuine device-initiated developer tunnel remains research;
  there is no implemented candidate ready for a phone test.
- The [native remoted path](https://github.com/doronz88/pymobiledevice3/blob/master/docs/guides/network-stacks.md#native-remoted-tunnel-macos-only)
  is documented to compete with Apple's device connection. Do not stop global
  Apple daemons or attach a competing RSD client under the requirement to preserve
  existing workflows.
- [RoamRun](https://github.com/mh-mobile/RoamRun#working-away-from-the-mac) and
  [iOS OTA](https://github.com/zjz-connect/ios-ota#current-network-boundary)
  document Wi-Fi acquisition followed by cellular session retention. That is
  separate from a fresh cellular install, as are their OTA install-link paths.
- Cellular-toggle Shortcuts, a second VPN, enrollment/supervision and phone UI
  automation change setup or interaction requirements. None was added.

The first candidate has a locally tested probe; the second remains a diagnostic
design. No phone contact occurred during preparation, and no temporary server,
worker or simulator remains running. Physical results must be recorded separately.

## Subsequent connection-only cellular check

The owner then confirmed the phone available, unlocked, on cellular with
Tailscale connected. No screen actions, app launches, builds, installs, pairing
changes or temporary phone app were requested. Existing helper/engine processes
were preserved. An initial local process filter incorrectly counted idle
XcodeBuildMCP servers as builds and prevented execution; correcting the executable
match required no process termination or phone contact.

The fresh trusted-lockdown probe failed before authentication. Its first result
reported only the failed stage. A second explicit diagnostic connection, after
adding exception-type/errno projection without exposing error text, identified
`ConnectionRefusedError` / `ECONNREFUSED` in 247 ms. Both ended at the first
lockdown connection; neither reached CoreDeviceProxy or submitted an install.
There was no automatic connection retry or pairing fallback in the probe.

The fixed, standard untrusted-RSD endpoint documented for the USB NCM transport
was also checked over the exact cached phone's Tailnet IPv4 and IPv6 addresses.
Both refused TCP, in 187 ms and 1,052 ms. These were single-endpoint connectivity
checks, not a scan or RSD handshake. No cellular advertisement established that
this endpoint should be exported on the Tailnet interface. Consequently the
result does not exclude other advertised RSD endpoints or a device-initiated
transport; it only rejects this particular direct ingress hypothesis.

The CoreDeviceProxy path is now blocked at its ingress on the tested cellular
condition. The existing classic pairing record is available but cannot repair
an actively refused socket. A Wi-Fi control would qualify the full probe path,
not change that cellular refusal. The controlled relay comparison and genuine
device-initiated developer transport remain separate, unproven investigations.

Twelve local tests still pass after adding safe error classification. No
temporary worker/listener or install operation remains. The phone was released
for normal use. Private results and resource records remain in the ignored
alternative-experiment directory, with no credentials or device addresses here.
