# Foreground cellular install qualification

The owner confirmed Zenics Debug44 installed, foregrounded on cellular with
Tailscale connected and App Testing stopped. The native SDK subsequently
reported exact build44, foreground/root readiness and `foreground-install-v1`.
No testing runner, screen-control command, link tap or automated confirmation was
used for the requests below. The owner's network statement is the cellular
condition; this test does not independently inspect the phone's interfaces.

## Connection correction

The initial preparation script had imported the low-level engine module without
the installed entrypoint's process-ownership boundary. It interpreted the durable
JSON ownership record as a nonnumeric PID and removed the record without stopping
the old engine. The old task-owned process retained the phone listener, while the
replacement owned the current command socket. This was a Mac upgrade error, not
a missing phone permission or pairing failure.

Both processes were identified against task records, executable paths, process
groups and kernel start identities before termination. The normal installed
entrypoint then started one owned engine; its durable record and phone listener
agree. Zenics reconnected automatically. The low-level stop function now rejects
unparsed/invalid ownership records and preserves the records/socket instead of
silently allowing replacement. A regression test covers that exact failure,
invalid records, refused stops and cleanup only after confirmed exit.

## Build45: prompt proven, installation failed

One normal `request-install` command targeted the authenticated build44 binary.
The request transitioned from waiting to prompt-requested. The owner saw iOS's
prompt directly over Zenics, confirmed it, then reported an installation error.
The later blue-dot observation was not treated as installation evidence: a fresh
native observation after reopening proved the app was still build44.

Build45's signature checks pass. Its provisioning profile, device set and
entitlements match the working build44. No app was uninstalled or data reset.
The public delivery manifest remained valid, unexpired and correctly scoped.
A Mac HTTP/2 fetch through its quick tunnel transferred about12.5MB in60seconds
(about209KB/s) before the diagnostic's timeout. A separate full fetch also timed
out. The existing private Tailscale HTTPS route served the complete42,996,017-byte
IPA to the Mac in0.59seconds with an exact digest match. This isolates a large
route-performance difference in the Mac checks; it does not establish the exact
iOS failure code or measure phone download speed.

The build45 handoff tombstone remains terminal. No replay, fence deletion, forced
verified flag or manual catalog mutation was used to retry it.

## Build46: private route retry

A new normal signed Debug46 build uses the already configured private Tailscale
HTTPS delivery route. No new proxy, listener, VPN or background service was added.
Its manifest names the correct bundle/build and its IPA URL stays on that route.
A full Mac fetch matches all42,990,866 local bytes. Tracked mobile app files and
project bytes remain unchanged across both qualification builds.

The owner again confirmed Zenics foregrounded on cellular. The engine observed
build44 active/root-ready. One normal CLI request for build46 reached
prompt-requested. The owner was asked to confirm iOS's prompt and reopen Zenics
after downloading. The owner confirmed completion and reopened Zenics. The
native connection reported build46, foreground/root readiness, and exact
executable/debug-dylib UUIDs matching both the immutable signed-build provenance
and current compiler capture. The ordinary helper stored `launch-confirmed`
with its launch fingerprint. No manual verification flag was written.

Repeating the same CLI request returned the original terminal handoff receipt,
without resubmitting a native action or prompting again. The owner confirmed
that usual app data/settings remained intact. The phone is released and no
further install actions are queued. Locked waiting and reboot recovery for this
new SDK handoff have local tests only; they were not physically requalified in
this session. The replacement app was opened by the user, not automatically.

## Additional guard and checks

An offline compilation capture for the just-built target no longer claims that
target is already installed/running. It asks for the actual installed app's
connection. Source regression selection:36 passing tests for install requests,
engine ownership, stopping and candidate selection; compiled build succeeds.
Private observations/artifact checks are retained under
`.build/foreground-install-20261107/phone` and `phone46`.
