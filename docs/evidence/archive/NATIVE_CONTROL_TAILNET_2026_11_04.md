# Helper-free native control over Tailscale — November 4, 2026

**November 6 follow-up:** [direct-install qualification](DIRECT_INSTALL_PHONE_QUALIFICATION_2026_11_06.md)
found that the advertised pairing port can differ from the earlier fixed probe
port and change after reboot. The new run verified the actual endpoint against
the pinned peer/device, completed three Wi-Fi/Tailscale installs, then still
observed fresh cellular refusals at the newly verified endpoint. Do not interpret
the old fixed-port probes alone as proof of a general cellular service policy.
The native HID/display and developer-image findings below remain separate from
installation-service qualification.

## Result

**Direct, mutually authenticated RemotePairing and service discovery passed over
Tailscale while the phone was on Wi-Fi. Fresh cellular acquisition failed before
authentication. Native touch and display remain unqualified.**

This experiment evaluates the helper-free iOS 27 device-control approach advertised
by Device MCP. It does not use, modify, or incorporate Device MCP's implementation.
An unchanged pinned MIT-licensed `idevice` provider supplies the protocol stack.
The earlier [phone-initiated cellular runner qualification](STANDALONE_CELLULAR_2026_11_03.md)
remains the successful cellular input path.

## Mac-side prototype

The task-local Rust probe uses an explicit phone address, a pinned peer identity,
RemotePairing pair-verify, the encrypted TCP tunnel, an in-process network stack,
and RSD. It creates no system network interface, persistent daemon, app library,
or target-app entitlement. Its supported operations are service discovery,
listing HID surfaces, and a single local screenshot; this run exercised discovery
only. No screenshot, UI hierarchy, or input was requested.

- Provider: `mh-mobile/idevice`, revision
  `89cdb2409643deabab99999286b4c4d091c7c068`, version 0.1.68, the revision pinned by
  RoamRun `210260b71bb5ddfcd34b61318b2ad4a2f66092ab`.
- Dependencies enable the native control/tunnel features, with default features
  disabled. No XCTest/WDA feature or video decoder is enabled by the probe.
- The optimized, stripped Mac executable is approximately 1.7 MB. This is a
  discovery prototype's size, not a finished control product or RAM measurement.
- Existing trusted network lockdown bootstrapped a separate trial identity.
  The peer's setup signature was checked, its public key retained privately,
  and the subsequent direct connection required mutual peer verification.
  No original pairing record was overwritten. No credentials were printed.
- A first bootstrap completed pairing but failed local record conversion because
  the installed Python provider lacks a field present in its newer source. Its
  private bootstrap file was preserved. A corrected bootstrap saved the verified
  identity before subsequent processing; the direct probe used that record.
  This trial provisioning glue is not a production pairing implementation.

Private source, binaries, pairing files, and result files are retained under the
ignored, task-owned `.build/native-control-20261104/`. Pairing files are private
and must never be included in a release, report, or tool output.

## Wi-Fi and developer-image findings

The user made the phone available on Wi-Fi with Tailscale connected. The fresh
probe connected to the phone's explicit tailnet address; no retained Mac bridge
or running phone helper was used. The successful checks took approximately
0.43 and 0.83 seconds, including discovery. These are individual observations,
not controlled latency benchmarks.

The raw RSD advertisement contained 76 services. Accessibility audit services
were present, but the native universal HID, display, and screenshot services were
absent. Checking the raw advertisement ruled out the probe's service parser
simply filtering those services out. Service advertisement is not functional
inspection or input proof.

Independent queries confirmed iOS 27.0.1 and an existing Personalized developer
image version **518.33** mounted at `/System/Developer`. The Mac selects Xcode
26.6. The upstream native-control research places `dtuhidd`, the native HID
daemon, in the newer Xcode 27 developer image, and explicitly notes its absence
from the 26.x image. The old mounted image is therefore a concrete prerequisite
gap, not evidence that this phone cannot support native control.

The native `devicectl` image-services query also failed with CoreDevice transport
error 4000; its result is not the source of the successful direct discovery.
No image was unmounted or replaced. A newer repository manifest, build
`27A5228h`, was obtained and matched against its pinned Git source blob. Image
downloads timed out before receiving data. The candidate image was neither
fully acquired, verified, nor mounted. No full Xcode update or system package
installation was attempted.

## Fresh cellular boundary

All Wi-Fi probe processes had exited. The user then confirmed Wi-Fi off,
cellular, unlocked, and Tailscale connected. New TCP connections to both known
Apple entry points were refused over **both tailnet IPv4 and IPv6**. The
standalone runner port was also closed. A new native probe process independently
failed at `remote_pairing_tcp`.

This is an acquisition failure on the current preparation, before pairing,
service discovery, display, or touch. It is not a native input failure. It does
not prove that replacing the developer image will change the cellular listener
policy, or that every future helper-free approach is impossible. A newer image
and complete native-control qualification remain separate gates.

## Lean integration decision

Do not ship a second backend that currently supplies no qualified native input.
Keep the standalone cellular runner as the proven optional experiment, outside
normal helper startup, hot reload, notifications, and the Debug SDK.

The useful ideas to carry forward are no target-app instrumentation, a small
agent-independent command interface, on-demand semantic inspection, observed
input results, and explicit session ownership. Continuous mirroring, a second
desktop UI, cloud forwarding, and another agent runtime are unnecessary for
that workflow.

Before replacing the runner with native control:

1. Prepare compatible newer developer-image assets, preserving a verified path
   back to the current image and avoiding a global Xcode replacement.
2. With renewed phone availability, mount through Apple's normal authorized
   developer-image mechanism and confirm real HID/display service availability.
3. Qualify scoped input and restoration, then stop completely and try fresh
   cellular acquisition again. A Wi-Fi-to-cellular retained session is insufficient.
4. Only after that gate passes, add a lazy optional integration. Preserve
   explicit app scope, takeover handling, local-only evidence, and shutdown.

The phone was released for ordinary use after the connection-only check. No
task-owned probe, tunnel, runner, or download remains running. The installed
standalone trial helper remains stopped. The normal Swift Sim helper health
check passed; no companion, Zenics, SDK, hot reload, or notification code changed.

## Sources

- [Device MCP device requirements and same-network Wi-Fi](https://devicemcp.ai/docs/devices/iphone-and-ipad)
- [Device MCP introduction](https://devicemcp.ai/blog/introducing-device-mcp)
- [Pinned native provider](https://github.com/mh-mobile/idevice/tree/89cdb2409643deabab99999286b4c4d091c7c068)
- [RoamRun native control and connection limits](https://github.com/mh-mobile/RoamRun/tree/210260b71bb5ddfcd34b61318b2ad4a2f66092ab#seeing-and-operating-the-device)
- [Native HID developer-image findings](https://github.com/ipbtools/ipb/blob/main/docs/protocol.md)
- [Standalone native-control prerequisites](https://github.com/ipbtools/ipb/blob/main/docs/standalone-distribution.md)
