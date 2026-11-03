# Phone-initiated cellular runner startup — November 3, 2026

## Result

**Fresh phone-initiated runner startup and native input passed on cellular,
without a retained Mac developer bridge.** The working candidate is the existing
standalone iCTRL runner, rather than another Mac RemotePairing client.

This proves a new runner process/session can start when the user opens the
installed test helper while already on cellular. It does **not** prove a Mac
can silently launch a stopped phone app, or that startup works after a phone
reboot before restoring the Developer Disk Image. Those are separate gates.

## Clean startup boundary

The initial launch was confounded: the user clarified that they switched to
cellular only after granting the first client approval. That initial ready
notification and pairing are not cellular-start evidence.

For the clean qualification:

1. The authenticated stock `config{stop_server:true}` command ended the first
   runner test. New connections to its API and both known Apple entry points
   were refused. No task-owned Mac Apple bridge or native test client was running.
2. The user remained on cellular, opened **Swift Sim Control Trial**, and reported
   the runner's ready notification. No host `xcodebuild`, testmanagerd client,
   CoreDevice launch, or RemotePairing acquisition was used to start it.
3. A new Mac client process completed authenticated `device_info` and `config`
   calls using its previously approved key. The phone reported only `pdp_ip0`
   and `utun8` as active IPv4 interfaces: cellular and VPN, with no `en0` Wi-Fi
   interface. This independently supports the user's cellular confirmation.
4. Native input passed through the direct Tailscale API. During input, the
   RemotePairing and lockdown entry points still refused new TCP connections.

This is independent of the earlier warm-bridge qualification. The phone's
already prepared developer image is retained setup, not an open Mac connection.

## Native input proof

The user explicitly made the phone available. The agent opened the existing
Swift Sim companion and scoped source reads to its bundle identifier.

- Tapped the observed search-field frame and typed `Zenics`; a separate native
  source read reported `TextField, value: 'Zenics'`.
- Found the Zenics row, tapped its app-bound reference, and independently
  observed App History.
- Sent an upward finger swipe and independently observed four build rows
  change vertical position. An earlier downward scroll at the top produced
  no displacement and was not counted as success.
- Returned to the library, cleared the query, and independently verified that
  the other app rows returned and the keyboard was no longer visible.

The empty search field has no label/value in this provider's snapshot, so its
documented name lookup did not match the placeholder. The test used the unique
field frame from the freshly observed target-app tree after explicitly activating
that app. No UI source from another app was needed. App-bound references protect
the row/Back taps; this trial is not proof of an atomic scope guard for every
coordinate, typing, or swipe operation.

## Provider and packaging

- Upstream: [OpenMinis/iCTRL](https://github.com/OpenMinis/iCTRL), Apache 2.0.
- Release: **v1.98.16**, source commit
  `c1e4268859ba858d1579f7b846a56cb40641b7f6`.
- Artifact: `iCTRLUITests-Runner.ipa`, 1,678,644 bytes, SHA-256
  `67450de1524837b137b1ba0175ed16c8850b951ef0127c7c765aa8f3c4702652`,
  verified against GitHub's release digest.
- Only the runner was installed. The iCTRL host app, local-VPN app, and its DDI
  mounting dependency were not installed; the developer image was already
  available from the earlier physical-device work.
- The app was re-signed using the exact existing development certificate and
  temporary-WDA provisioning identity. Bundle metadata and display name were
  adapted for the trial; provider source and protocol were not forked. Nested
  signatures and the final app signature were verified. Signed files total
  approximately 4.84 MB, distinct from the compressed download size.
- No new signing certificate, app registration, target-app entitlement, or
  provisioning asset was created. Neither Swift Sim nor Zenics was replaced.

The source uses Apple's normal XCTRunner startup and the mounted XCTest stack
on the phone. Its startup hooks handle the runner lifecycle/backgrounding; the
phone's normal automation authorization remains in place. No authentication or
platform check was removed to make this work.

## Access, lifecycle, and remaining work

Remote access was enabled through the runner's own notification control. The
user approved one named Mac client. The stock client's X25519 pairing and
authenticated encrypted JSON-RPC were used; private credentials are in an
owner-only task file and were never printed. Source trees and proof files stayed
on the Mac. No cloud relay, screenshot upload, model, or agent service was added.
Any agent harness can use the same standalone client/API.

The final supported shutdown was acknowledged. New connections to the runner
API, RemotePairing, and lockdown were refused afterward. No task-owned Mac
bridge, test runner client, watcher, or server remained. The existing helper
health check passed. The small trial app remains installed **and stopped** for
repeat testing; its saved authorization avoids repeating setup. No target-app
or SDK code, hot reload engine, notification service, or product CLI was changed.

The viable narrow product direction is an optional separately signed runner,
started from the phone, reached directly over the private tailnet. Preserve these
limits before integration:

- A user start action is required by the qualified flow. Silent Mac-initiated
  wake/launch of a stopped helper on cellular is unqualified.
- The Developer Disk Image must be available. Upstream requires remounting it
  after phone reboot; a cellular-only remount has not been qualified.
- Add no runner to ordinary hot reload or notification startup. Stop it when
  the explicit testing session ends.
- Retain target-app scope, interruption handling, explicit phone availability,
  key revocation, and provider-version pinning. A future wrapper must not invent
  a second agent, protocol, or persistent Mac bridge.

## References

- [Pinned standalone launch instructions](https://github.com/OpenMinis/iCTRL/blob/c1e4268859ba858d1579f7b846a56cb40641b7f6/README.md#step-3--launch-the-runner)
- [Pinned startup hook](https://github.com/OpenMinis/iCTRL/blob/c1e4268859ba858d1579f7b846a56cb40641b7f6/iCTRLUITests/EarlyURLHook.m)
- [Earlier conditional Mac-bridge results](WDA_TAILNET_BRIDGE_2026_11_03.md)
