# Direct-install physical qualification — 2026-11-06

**Three link-free signed installations passed over Tailscale on Wi-Fi: unlocked,
locked, and after reboot plus one normal passcode unlock. Fresh cellular access
remains blocked.** This is not an anywhere/cellular-install success claim.

The owner explicitly made the phone available, confirmed each network/lock/boot
condition, and later confirmed that visible apps/history remained intact with no
installation approval prompts. All commands targeted the already paired phone;
no pairing record, trust relationship, developer image, phone runner, or target
app SDK was changed to perform the installs.

## Successful installs

The existing Swift Sim app was built through the existing Mac/Xcode builder with
its established bundle identifier, signing team, ad-hoc profile and entitlements.
Each case used a new unique build number and a separately frozen, signature-
checked IPA. No product source change or uninstall was used. Transfers went
directly through authenticated RemotePairing, its encrypted TCP/RSD tunnel, AFC
staging and InstallationProxy. No install link was opened or used as a fallback.

| Case | Before → after | End-to-end native command time | Proof |
| --- | --- | --- | --- |
| Unlocked, Wi-Fi/Tailscale | 31 → 32 | 10.719 s | Complete receipt, exact scoped bundle/version/build inventory, owned staging cleaned |
| Locked, Wi-Fi/Tailscale | 32 → 33 | 7.098 s | Owner locked phone before the command; Complete + scoped inventory; staging cleaned |
| Reboot, one normal passcode unlock, Wi-Fi/Tailscale | 33 → 34 | 9.154 s | New process and authenticated connection after reboot, Complete + inventory; staging cleaned |

These are individual observations, not a latency benchmark or installed binary-
hash measurement. Native inventory showed the prior build before submission and
the intended new build afterward. Private journals bind the peer/device, bundle,
artifact digest and before/after identity; all three reached `verified` with
`complete_receipt: true` and no outstanding staging cleanup. The owner confirmed
apps/history after build 32 and again after build 34, and confirmed zero install
approval taps for the later cases. No phone UI automation was used.

Swift Sim and App Testing remained closed after reboot until the fresh checks
and installation finished. No developer-image remount or re-pairing was required
for that post-unlock Wi-Fi installation.

## Endpoint changes are a real recovery requirement

The initial example pairing port was not the currently advertised endpoint.
Both known Tailnet addresses refused it even while the phone was on Wi-Fi.
On-demand local Bonjour discovery found the actual service port. A new connection
at the explicit phone's Tailnet address then passed pinned peer authentication,
exact RSD device-ID validation and InstallationProxy inventory lookup.

Reboot changed the pairing port again. The cached endpoint actively refused the
first post-unlock attempt **before any upload or submission**. The durable state
still held only the previous, verified build 33. Rediscovery followed by another
pinned-peer/device check found the current endpoint, and build 34 was submitted
once and verified. This was endpoint recovery from a pre-connection failure, not
a retry of an uncertain installation.

The optional [endpoint refresh command](../../mac-helper/optional/direct-install/refresh_endpoint.py)
now packages those steps into bounded, on-demand Mac work. It checks the cache
first, queries local Bonjour only after a connection failure, and updates the
private port only after native authentication/device verification succeeds. It
never uses discovered LAN addresses as install targets, never pairs or installs,
and adds no watcher, phone code, normal helper import, or dependency. Six local
fixtures cover successful verified caching, cached fast path, unverified
advertisements, concurrent config changes, authentication failure and explicit
execution authority. The wrapper itself was added after the physical steps;
no separate physical end-to-end wrapper pass is claimed.

## Cellular boundary

All checks used newly started native processes with no retained installer bridge
or running phone helper. The owner confirmed cellular with Wi-Fi fully off for
the initial checks. Tailscale ping succeeded, but both IPv4 and IPv6 refused the
known developer-service endpoints. Using the actual, Wi-Fi-verified pairing port
also failed, so a stale default port alone did not explain the cellular result.

With Wi-Fi enabled but disconnected, one attempt advanced through mutual pairing
authentication and listener creation but failed when connecting the resulting
TCP tunnel. A subsequent address failed before pairing. This transient partial
result is not RSD/installer access or an install pass. An on-demand unicast mDNS
query on cellular received no reply; that does not prove no other discovery
mechanism could exist.

After reboot, first unlock and successful Wi-Fi installation, the owner again
confirmed 5G/LTE, Wi-Fi enabled but disconnected, Tailscale connected, and no
Swift Sim/App Testing launch. Fresh connections to the newly verified endpoint
were actively refused on **both IPv4 and IPv6**, in 197 ms and 83 ms respectively.
No cellular installation request was submitted. The prototype now distinguishes
pairing/tunnel refusal and timeout without printing addresses or credentials.

This locates the observed failure before signing, upload or InstallationProxy;
it does not establish whether the refusing policy belongs to an iOS service,
VPN/interface handling, or another acquisition prerequisite. Changing signing
profiles or blindly rebuilding cannot repair a TCP refusal. A successful
standalone app-control server on cellular is a different endpoint and proof.

## Before first unlock after reboot

The owner rebooted and explicitly left the phone without its first passcode
unlock. Tailscale ping did not succeed, and the fresh native connection hit its
30-second setup deadline. No request was submitted. This is a reachability
boundary on this preparation, not proof that a reachable phone's installer
rejected the request. Fully unattended installation before first unlock remains
unqualified. After one ordinary local passcode unlock, endpoint refresh and the
Wi-Fi installation passed as recorded above.

## Local verification and resource disposition

The optimized native candidate passes 18 Rust tests and strict Clippy. Python
preparation plus endpoint-refresh fixtures pass 10 tests. Existing notification
and live-delivery paths were not modified; their 150-test baseline is recorded
in the [offline prototype evidence](DIRECT_INSTALL_PROTOTYPE_2026_11_06.md).

The existing build pipeline also prepared ordinary temporary link delivery
services. They were not the install transport. Task-owned unused delivery
references are released through the existing generation/reference ownership
API; signed builds, history, private receipts and the installed app are retained.
No direct-installer process, Bonjour browser, test server, runner or simulator
needs to remain running. The normal helper and hot-reload engine are preserved.

Private evidence is under the ignored `.build/direct-install-20261106/` directory:
the three result files, copied before/after journals, owner observations, network
case metadata and process/resource records. Pairing material, addresses, device
identities and delivery bearer URLs are not included here.

## Product decision

Keep this as an explicit optional prototype. The Wi-Fi capability is real, and
port caching alone is insufficient after reboot. The next requirement is a
qualified fresh cellular acquisition path and remote endpoint recovery; this
run does not provide either. Do not enable automatic default direct delivery or
advertise silent installation from anywhere based on the Wi-Fi results.
