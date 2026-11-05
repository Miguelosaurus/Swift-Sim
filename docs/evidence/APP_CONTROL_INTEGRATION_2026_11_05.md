# Optional app-control integration — November 5, 2026

## Implemented boundary

`swift-sim app-control` now exposes the qualified iCTRL 1.98.16 runner through
one-shot, agent-independent commands. The adapter is dynamically imported only
for that command. No helper/engine startup, delivery, notification, companion,
or Debug SDK module imports or invokes it. No Node/Python dependency was added.

The unchanged 41,721-byte upstream Python client is pinned by source revision
and SHA-256, packaged with its Apache license, and checked before use. The
wrapper reuses its encrypted pairing/RPC protocol and provider-native actions.
An explicit tailnet address, pinned authenticated device identity, private
credential storage, local exclusive lease, fresh observation identifiers,
foreground checks and explicit shutdown bound the exposed surface. There is no
raw RPC passthrough, cloud endpoint, video UI, automatic install or new daemon.

The primary skill gained only a lazy reference, remains below its existing
1,200-word budget, and forbids invoking the optional tool during ordinary
delivery. The user guide records installation, task ownership, shutdown and
non-atomic foreground-check limits.

## Crash diagnosis and recovery

The user reported the trial app exiting at launch. A matching private device
crash report identified DYLD `Library missing`: XCTest could not be loaded from
the developer-image paths. Independent image-mounter inspection returned no
mounted image. No assumption of a new application-code crash was made.

The first restore lost its developer connection before upload. A separate
Cryptex path was investigated but did not install anything. With renewed user
confirmation that Swift Sim was foregrounded and the phone unlocked on the Mac's
Wi-Fi, the standard personalized-image mount succeeded using the existing local
Xcode 26.6 image and Apple's normal personalization. `/System/Developer` then
reported **518.33**, matching the previous working preparation. The user reopened
the existing trial and confirmed Server Ready. No app reinstall, signing change,
trust reset, full Xcode update or security-check bypass was used.

This is retained developer setup, not a solution to remounting after reboot on
cellular. That limitation remains in the public guide.

## Physical command qualification

The existing approved credential was adopted privately, without another pairing
prompt. All actions used the new CLI and the exact Swift Sim companion bundle.

On Wi-Fi, the source CLI:

- Opened a bounded session and read a native app tree.
- Tapped the observed unlabeled search-field frame, confirmed keyboard focus,
  typed `Zenics`, and read the exact value from a subsequent native observation.
- Found the observed Zenics button through an app-scoped native query/reference
  and observed App History after tapping it.
- Scrolled and independently observed **four build rows** change position.
- Refused a Back lookup while that control was scrolled out of view. After
  scrolling back, the newly observed native Back control worked. No blind repeat
  or automatic input retry was used.
- Cleared the search, observed other app rows return, dismissed the keyboard,
  then closed the session and verified the runner port refused connections.

For the fresh cellular check, that runner and local lease were fully stopped
first. The user's first reported ready start was unreachable over both tailnet
address families; no input was sent and it was not counted as a pass. The user
then confirmed a full runner relaunch and enabled remote access while remaining
on cellular.

The **compiled** CLI opened a new session over the private tailnet. Independent
authenticated configuration reported `pdp_ip0` and `utun4`, with no Wi-Fi
interface. The compiled commands focused the observed search field, typed
`Zenics`, read the exact native field value, cleared it, independently observed
other app rows and keyboard dismissal, and closed the session. Shutdown again
returned `runnerStopped: true` after connection refusal. No retained Mac Apple
bridge was used for this test. The phone was released for normal use afterward.

These results prove user-initiated fresh cellular startup with retained image
preparation and the compiled integration, not silent Mac launch, post-reboot
cellular preparation, or atomic target binding for every input. The screenshot
scope/fallback and storage protections have local tests; a new physical capture
was not requested in this qualification.

## Verification and lifecycle

- The full Node regression suite passed **1,349 tests**. An earlier run found
  only the primary-skill word-budget failure; the lazy reference was shortened
  and the final full run passed.
- The optional adapter's Python cases cover private state, endpoint validation,
  credentials, device/version mismatch, concurrent/expired leases, takeover,
  observation freshness, input ambiguity without retries, scoped capture,
  redirect refusal and verified shutdown. They also pass with the Mac's system
  Python 3.9. No additional Python installation is required on this prepared Mac.
- Real module-loading tests reject optional adapter imports from normal hot
  reload, change delivery and APNs modules. Optional help launches no worker;
  disabled status creates no optional state and performs no network request.
- Type checking, architecture inventory, documentation links, lint, formatting,
  compilation and package-content verification passed. The package verifier
  explicitly requires the worker, pinned client, provenance, license and guide.

Private crash reports, credentials and UI observations stayed local. Trial
artifacts are under ignored `.build/app-control-integration-20261105/`; they are
not part of the package or this evidence. No benchmark of steady runtime memory,
battery or interaction latency is claimed. Normal delivery has no new optional
module, process, timer, network probe or callback.
