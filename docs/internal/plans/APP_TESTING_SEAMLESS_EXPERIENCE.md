# Seamless optional iPhone testing

## Product contract

Ask the existing coding agent to test an app, allow a bounded session on the
phone, and let Swift Sim handle preparation, connection, and cleanup. Testing
remains opt-in. No testing library in target apps, new cloud service, continuous
capture, idle worker, delivery hook, or notification polling is introduced.

This is outside the architecture-consolidation program. The working optional
`app-control` backend and its identity/foreground/lease boundaries remain the
baseline; setup convenience must not weaken them.

## Execution order and proof gates

1. **Phone launch handoff.** Reuse the pinned runner's existing
   `ictrl://start?callback=…` route. Swift Sim provides an explicit App Testing
   entry point and correlates the return to a recent, one-use launch attempt.
   Links alone cannot grant input. Independently authenticate readiness from
   the Mac; a URL-open completion or runner callback does not prove reachability.
   Qualify a fully stopped runner starting through Swift Sim while already on
   cellular, returning to Swift Sim, and closing through the owned session.
2. **Recovery.** Distinguish confirmed facts from guesses. An authenticated
   locked-phone result has a specific unlock action; a closed connection has
   several possible causes. Do not infer missing developer support from it.
   Reuse normal Apple preparation when available. Cellular-only remount after
   reboot remains unqualified. The upstream on-device mounting route requires
   Wi-Fi and LocalDevVPN, so it is not the missing cellular solution.
3. **Managed optional setup.** Reuse the developer's existing signing identity
   and explicitly selected phone. Pin/verify runner assets, use upstream nested
   test-bundle signing, preserve existing app identity/data, and avoid duplicate
   installation. Keep testing authorization distinct from ordinary Swift Sim
   pairing. Never silently broaden an existing phone permission.
4. **Requested session.** Only after launch qualification, connect an explicit
   testing request to the existing notification infrastructure on demand. The
   phone displays the app and duration; Allow confirms that exact request.
   Expiry, cancellation, replacement of pairing, and user takeover invalidate
   it. The agent receives compact native observations and cleans up its lease.
5. **Phone-enforced shutdown.** A narrow provider change may add a bounded
   deadline and a visible Stop action. The deadline must stop the runner even
   if the Mac disconnects. A Mac timer or a backgrounded companion task cannot
   establish this guarantee. Test expiry without the Mac connection before
   presenting it as automatic release. Keep the upstream engine/protocol intact
   beyond the minimum lifecycle addition, with pinned attribution and tests.

## Current implementation checkpoint

The first gate has compiled companion candidates (builds 26 and 27), a Foundation-only
launch/receipt model, and an explicit `app-control check`. Native model tests
cover nested URL encoding, correlated returns across process restoration,
duplicate/foreign callbacks, invalid fields, and expiry. Adapter tests verify
that readiness uses only authenticated `device_info`, creates no session, and
does not activate/read/control an app. The user started testing through build
26; the Mac authenticated the runner, independently observed Swift Sim in front
and the correlated return message, and verified owned runner shutdown. No taps
or edits were sent. Network state was not independently measured in that run.
Build 27 moves discovery to a **Test with Agent** action on each app page after
the user reported that the connection-settings entry was too hard to find. The
user then confirmed a fresh launch while on cellular, with Wi-Fi off and
Tailscale connected. Authentication, the Zenics context, correlated return and
verified shutdown passed; network state in this run is user-confirmed rather
than independently measured. See the [handoff evidence](../../evidence/APP_TESTING_HANDOFF_2026_11_05.md).

The subsequent [lifetime/setup checkpoint](../../evidence/APP_TESTING_LIFETIME_2026_11_05.md)
adds the reproducible optional installer and phone-enforced lifetime. The source
build/sign path passed locally. The complete installed CLI subsequently
installed the public-template runner on the selected physical phone, preserved
the private Mac pairing files, and left the runner stopped. Its fresh runtime
check subsequently authenticated the exact installed build recipe on cellular
and Tailscale interfaces with no Wi-Fi interface, then verified shutdown without
app input. Independent app inventory timed out. The separately packaged
bounded runtime authenticated and was
found stopped after the deadline without Mac requests or a stop command. The
notification request/approval UI passed physical Wi-Fi approval, session
admission and user-driven Stop in build 30. Independent checks confirmed
request cancellation, removal of the local lease and runner connection refusal.
The contention refinement also passed local regression tests. Fresh cellular
runner startup is qualified separately; this approval UI was qualified on
Wi-Fi. Cellular-only reboot recovery remains unsupported. Explicit phone
startup and verified shutdown remain available.

## References

- [Current integration proof](../../evidence/APP_CONTROL_INTEGRATION_2026_11_05.md)
- [Request approval checkpoint](../../evidence/APP_TESTING_APPROVAL_2026_11_05.md)
- [Optional testing contract](../../APP_CONTROL.md)
- [Pinned upstream URL handler](https://github.com/OpenMinis/iCTRL/blob/c1e4268859ba858d1579f7b846a56cb40641b7f6/iCTRLUITests/iCTRLUITests.swift)
- [Upstream on-device mounting requirements](https://github.com/OpenMinis/iCTRL#option-3--the-ictrl-app)
