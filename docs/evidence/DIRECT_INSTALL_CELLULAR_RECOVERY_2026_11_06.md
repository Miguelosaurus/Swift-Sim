# Fresh cellular install recovery trial — 2026-11-06

**Fresh cellular installation is still unqualified.** A temporary companion-side
relay reached the phone's loopback pairing socket on cellular, but Apple's service
closed before replying to the initial public handshake. No cellular install was
submitted. Normal Swift Sim build 36 is restored, the diagnostic listener is
closed, and the owner confirmed that apps/history remain intact.

This follows the [direct-install phone qualification](DIRECT_INSTALL_PHONE_QUALIFICATION_2026_11_06.md).
The owner made the phone available and confirmed its network state for each
trial. The established developer pairing and Xcode signing identity were retained;
no device-management profile, supervision, trust reset or replacement VPN was used.

## Isolated candidate

The trial lived entirely in the ignored task directory. A copied companion
project produced diagnostic build 35; tracked companion sources were unchanged.
Its foreground-only listener expired after five minutes and stopped when the app
became inactive. It authenticated an ephemeral task token before connecting to
the loopback pairing endpoint. Only a token hash was embedded in the app; Apple
pairing/signing keys remained on the Mac. Streams were limited to two, with
bounded buffering and backpressure. There was no background assertion or SDK
change in Zenics or another target app.

A separate native client copy forwarded the existing trusted-pairing protocol
through that relay. Its diagnostic mode allowed only offline validation and
read-only inventory inspection; install/reconcile commands were rejected. It did
not replace the production optional installer or enter helper startup, hot
reload, APNs, notification delivery or ordinary signed-build dispatch.

## Physical observations

| Case | Result | Proof boundary |
| --- | --- | --- |
| Install diagnostic 35 over Wi-Fi/Tailscale | Installed in 5.509 s | Existing production installer: Complete, scoped inventory and owned staging cleanup |
| Fresh companion start on cellular, IPv4 loopback | TCP connected; initial Apple handshake failed in 181 ms | No authenticated pairing session, RSD, inventory or install |
| Fresh companion start on cellular, IPv6 loopback | TCP connected; initial Apple handshake failed in 188 ms | Same boundary; no install submission |
| Independent public handshake through relay | Peer closed before handshake response | No private pairing key was used; failure precedes key verification |
| Restore normal build 36 over Wi-Fi/Tailscale | Installed in 4.947 s | Complete, scoped inventory and staging cleanup; owner confirmed apps/history |

The owner fully quit the diagnostic app, disabled Wi-Fi, kept Tailscale connected,
and reopened it on cellular before the fresh checks. Relay observations included
loopback, cellular and VPN interface names, without a Wi-Fi interface. App Testing
was stopped; no retained Mac-side Apple bridge was used. Individual timings are
observations, not a comparative performance benchmark.

Additional localhost lockdown probes ended without a usable response. They do
not establish a precise denial reason: the diagnostic did not report Network
framework waiting states separately. Do not label those probes a confirmed
permission error or successful lockdown connection.

TCP acceptance alone is insufficient. These results do not establish the exact
iOS policy causing the public-handshake closure, nor prove that every possible
developer-pairing transport is impossible.

## Alternative-path review

The pinned `idevice` revision used by the prototype exposes a device-initiated
pairable-host responder. Its implementation performs initial SRP pair-setup,
explicitly rejects a pair-verify request, and returns pairing identity rather than
a reverse installation tunnel. The FFI drops the accepted socket after pairing.
Consequently, advertising that responder is not an implemented reverse install
path. This is a limit of the inspected implementation, not proof that Apple's
protocol cannot support another direction.

Sources inspected:

- [Pinned responder](https://github.com/mh-mobile/idevice/blob/89cdb2409643deabab99999286b4c4d091c7c068/idevice/src/remote_pairing/responder.rs)
  and [pairable-host FFI](https://github.com/mh-mobile/idevice/blob/89cdb2409643deabab99999286b4c4d091c7c068/ffi/src/pairable_host.rs).
- [iOS OTA's documented boundary](https://github.com/zjz-connect/ios-ota#current-network-boundary):
  retains a Wi-Fi-established session through cellular roaming; explicitly does
  not support a pure-cellular cold start. This is not acceptance for our goal.
- [LocalDevVPN cellular report](https://github.com/jkcoxson/LocalDevVPN/issues/31):
  reports loopback TCP acceptance despite VPN-route failure. That motivated this
  trial, but its routing observation did not predict a working full handshake.
- [SideStore cellular prerequisites](https://github.com/SideStore/SideStore/issues/1505):
  describe cellular-data toggle Shortcuts. This does not establish a transparent,
  fresh Tailscale install path and was not added to Swift Sim.

Keep ordinary developer pairing as the product requirement. The owner's response
favored the Xcode workflow; this investigation does not authorize device-management
enrollment or supervision. A new candidate must identify an actual authenticated
installer transport before requiring another phone trial. No speculative reverse
responder, warm-session daemon or cellular-toggle workflow was shipped.

### Follow-up review — 2026-11-07

The existing [standalone runner qualification](STANDALONE_CELLULAR_2026_11_03.md)
already distinguishes fresh cellular input from installer access: during its
successful input test, both known Apple entry points still refused fresh TCP.
The runner runs an independent XCTest input service and requires a phone start
action. Its success therefore supplies neither a demonstrated installer bridge
nor a silent wake mechanism. Do not start App Testing for normal installation or
add a relay to that runner merely on the assumption that automation authorization
enables InstallationProxy.

At this checkpoint there is no source-backed, implemented fresh-cellular
installer candidate ready for another device trial. The unresolved requirement
is acquisition of Apple's authenticated installation transport on cellular;
signing, bounded IPA transfer and installation already work on the qualified
Wi-Fi path. Preserve that distinction rather than extending setup, keeping a
bridge running indefinitely, or treating a phone-open action as zero interaction.

## Verification, restoration and resources

The isolated native candidate passed 20 Rust tests and strict Clippy, including
relay framing/raw-byte forwarding and explicit connection-failure handling. A
Mac-local fixture rejected the wrong token and forwarded one authorized echo
stream; its listener was stopped. These are local protocol checks, not cellular
installation proof.

Compiled-binary marker inspection found the trial marker in build 35 and absent
from restored build 36. After restoration, a single diagnostic-port check returned
connection refused. The owner was then told to use the phone normally and
confirmed apps/history were intact.

The unused normal-build delivery reference was released through the existing
generation/reference ownership API. All three owned delivery processes were
verified exited. Normal helper and hot-reload engine were preserved. No new
persistent service remains and there is no diagnostic overhead in build 36.
Normal hot reload and notifications were not modified; this run does not claim
a new performance measurement of those paths.

Private receipts, journals, diagnostic sources, test output, restoration proof,
resource disposition and source/artifact fingerprints are retained under ignored
`.build/cellular-install-recovery-20261106/`. Credentials, device identities,
Tailnet addresses, private pairing records and bearer URLs are excluded here.
