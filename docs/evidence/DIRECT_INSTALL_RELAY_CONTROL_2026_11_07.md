# Controlled phone relay and outbound-tunnel review — 2026-11-07

**The loopback relay fails on Wi-Fi as well as cellular. Fresh cellular installs
remain unsolved.** The direct Wi-Fi path answered before and after both relay
checks. Normal Swift Sim build 38 was restored, its diagnostic listener closed,
and the owner confirmed apps/history intact. The outbound-tunnel source review
found pairing-only implementations, not a ready reverse developer transport.

This completes the controlled relay comparison and source investigation proposed
in [next experiments](DIRECT_INSTALL_NEXT_EXPERIMENTS_2026_11_07.md). It follows
the [earlier cellular trial](DIRECT_INSTALL_CELLULAR_RECOVERY_2026_11_06.md).

## Isolated diagnostic and local checks

Temporary companion build 37 was compiled from a copy of the normal project.
Only its foreground diagnostic was added; tracked companion and target-app SDK
sources were unchanged. It retained the established bundle/signing identity,
held no Apple pairing keys, used an ephemeral token hash, allowed at most two
streams, stopped on inactivity and had a five-minute foreground lifetime.

The diagnostic distinguishes an outgoing Network-framework waiting state from
failure and from setup expiry. It reports IPv4 and IPv6 interface names without
addresses. This is diagnostic metadata, not an interpretation of why Apple
closed a connection. The wire framing and bounded/backpressured forwarding stayed
the same as the prior relay.

Mac-local checks passed: wrong-token rejection, fragmented authentication header,
authorized forwarding, an exact 262,153-byte binary round trip with fragmented
writes, and an unavailable target never reported as connected. A bound but
non-listening test socket reached the setup deadline rather than an immediate
refusal; the fixture accepts the actual typed outcome instead of assuming errno.
The fixture process exited and its listener was verified closed. Standalone
Swift typechecking, device archive/export, signature/profile preparation and
compiled-binary exclusion checks also passed.

## Physical Wi-Fi control

The owner confirmed the phone on the Mac's Wi-Fi, unlocked, with App Testing
stopped. A fresh production native inspection first completed pinned peer/RSD
identity checks and scoped inventory. Build 37 then installed directly over
Tailscale in 8.540 seconds, with Complete, exact installed version/build inventory
and owned staging cleanup. No link or phone UI automation was used.

The owner opened Swift Sim and left it foregrounded. Four sequential fresh
connections used the same known Apple endpoint and the same public handshake
envelope, including the pinned native provider's wire version. Public probes
stopped before private-key verification and never installed or paired anything.

| Case | Observed result | Time |
| --- | --- | --- |
| Direct Tailnet connection before relay checks | Valid first public Apple reply | 116 ms |
| Relay to IPv4 loopback | Loopback TCP connected; EOF before first public reply | 59 ms |
| Relay to IPv6 loopback | Loopback TCP connected; EOF before first public reply | 77 ms |
| Direct Tailnet connection afterward | Valid first public Apple reply | 58 ms |

Relay metadata included the Wi-Fi interface alongside loopback/VPN interfaces,
consistent with the owner's Wi-Fi report. These individual timings are not a
performance benchmark. Direct public replies do not alone prove authenticated
installer access; the successful native preflight, diagnostic installation and
restoration separately supply that proof on Wi-Fi.

The result rules out this loopback relay as a working Wi-Fi control. The earlier
cellular EOF was not by itself evidence of a cellular-specific restriction.
Repeating this same candidate on cellular would not resolve that failure, so no
additional cellular relay check was requested. This does not prove that every
on-device route or different Apple transport is impossible, or identify the exact
service policy behind the EOF.

## Phone-initiated transport review

The pinned native responder and both installed and current upstream Python code
were inspected. In the current source, `PairableHost.accept` calls only handshake
and SRP pair-setup. It explicitly rejects an existing-pairing verification request,
advertises no incoming-tunnel capability, and closes the accepted socket when
pairing completes. The CLI explains that device-side Settings browsing is
user-initiated and that a separate `remote start-tunnel` uses the resulting record.

Sources: [Python responder implementation](https://github.com/doronz88/pymobiledevice3/blob/master/pymobiledevice3/remote/tunnel_service.py),
[pair-host CLI](https://github.com/doronz88/pymobiledevice3/blob/master/pymobiledevice3/cli/remote.py),
and [pinned native responder](https://github.com/mh-mobile/idevice/blob/89cdb2409643deabab99999286b4c4d091c7c068/idevice/src/remote_pairing/responder.rs).
Downloaded source hashes and a bounded source-structure audit are retained with
the private trial artifacts. Current upstream is a moving branch; those hashes
identify the exact inspected copies.

No existing code inspected supplies the proposed zero-tap phone-originated
developer tunnel. An ordinary reverse socket would still require an authenticated
Apple service behind it. No new pairing identity, PIN exchange, management
profile, background assertion, VPN or speculative authentication server was
created. This is an implementation/source boundary, not proof that Apple's
protocol can never support another transport. A candidate for further work needs
both a demonstrated developer-service stream and an actual startup mechanism;
foreground-only success would not establish zero-extra-tap recovery after reboot.

## Restoration and catalog reconciliation

Normal build 38 was signed and frozen before the phone trial. Compiled-binary
inspection found the diagnostic marker in 37 and absent from 38. Restoring 38
through the production native installer took 4.662 seconds and returned Complete,
matching installed bundle/version/build inventory, and no pending staging cleanup.
The diagnostic port then refused a fresh TCP connection. The owner confirmed
apps/history intact and was released to use the phone normally.

The exact frozen build-38 IPA was subsequently registered through the existing
build-store APIs in the normal contained artifact root. Its copied digest matched
the artifact installed by the native command; no rebuild under the same version
was substituted. The catalog records native verified installation. No delivery
generation or live install link was published. The next-build allocator returns
39, avoiding reuse of the diagnostic/restoration version numbers. This was manual
reconciliation for this trial, not automatic direct-install product integration.

## Separate helper recovery

The normal builder initially failed on a build-state lock held by the existing
helper for approximately an hour, predating this diagnostic. Its health endpoint
timed out, and a brief process sample showed synchronous waits. There were no
active builds; saved preview entries had no listening processes. Normal build 38
was therefore prepared directly with Xcode before installing the diagnostic.

After phone restoration, the existing owned-helper lifecycle recovered the
helper. Its compatible health endpoint returned HTTP 200 in 12 ms, advertised
both notification and durable-live-delivery capabilities, and the build lock
was absent. The existing hot-reload engine kept its original process. No global
Apple daemon, simulator data, credential or service configuration was changed.
This is recovery evidence, not a new APNs display test or performance benchmark.

## Resource disposition

No diagnostic phone listener, test Mac relay, native install command, archive or
export worker needs to remain running. The ordinary helper and unchanged engine
remain for normal Swift Sim operation. No new login item or LaunchAgent was
created. The phone is no longer reserved.

Private sources, signatures, frozen IPAs, receipts, protocol observations, source
fingerprints and resource records remain under ignored
`.build/cellular-relay-control-20261107/`. Apple records, signing material, device
identities, Tailnet addresses and tokens are excluded from this evidence. Normal
helper, hot-reload and notification source code was not modified by the trial.
