# Cellular OTA installation through an active testing session

**Companion builds 40 and 41 installed on the owner's cellular phone without
the owner tapping an install link or either iOS install confirmation.** Build 41
also qualified a request queued while the phone was locked, followed by automatic
progress after the owner unlocked it. The existing optional runner initiated the
OTA flow and handled its UI; this is not native InstallationProxy over cellular.

After seeing the result, the owner rejected making a testing session a normal
installation prerequisite just to save an Install tap. Preserve the technical
proof, but do not integrate prompt auto-acceptance into ordinary delivery.

## Composition and scope

The [first-principles review](DIRECT_INSTALL_FIRST_PRINCIPLES_2026_11_07.md)
identified two already-working components: signed OTA delivery and owner-started
cellular testing. This trial composed them without another phone binary, SDK
change, device-management profile, pairing change or developer tunnel.

The isolated Mac controller uses the pinned qualified runner client and the
existing private Tailscale identity, exclusive phone lease and phone-enforced
deadline. Its commands are limited to a frozen Companion artifact, the resulting
native installation alerts, and reopening/observing that app. Normal app-control
permissions were not expanded. Generic alert acceptance is not exposed.

Each URL request, Install tap and cellular Download tap has its own persisted
submission fence before input. Uncertain replies do not automatically cause a
second request. The locked queue uses a short-lived command that releases the
operation lock between checks, allowing Stop; it is not a daemon or a normal
helper timer. It cannot restart a stopped runner.

## Physical results

The owner confirmed cellular with Tailscale and started testing on the phone.
These trials did not independently record phone network-interface addresses;
the explicit iOS cellular-download confirmation is additional observed evidence.
No Wi-Fi-established Apple developer bridge or native installer was used.

| Case | Observation | Outcome |
| --- | --- | --- |
| Initial session | Connected and activated Companion; foreground then became unconfirmed and runner subsequently refused connections | No install URL or approval submitted. Closed session and preserved attempt |
| Build 40 | Opened frozen OTA URL; observed and selected Install; observed and selected Download for cellular | Owner subsequently confirmed Build 40 Installed and apps/history intact |
| Build 41, initially locked | Authenticated running runner and confirmed locked state; queued exact artifact with no UI action; a separate check still returned waiting for unlock | No install submission while locked |
| Build 41, after unlock | Same persisted job opened the installer and selected both exact confirmations without user install taps | Reopened Companion and read native app UI: Version 0.6.1, Build 41, Installed |

For build 41, the helper's own saved installation status remained `unknown` at
the time of the UI verification. Companion's installed self-status compares its
actual running bundle/version/build through `SessionStore.isRunningAppBuild`.
Thus the new Installed label was not a success state manually written into the
server's catalog. This is app self-version evidence through the native UI, not
an InstallationProxy Complete receipt or device-side executable hash. The app
list and saved histories were visible. Zenics remained build 43 and was not edited.

Build 41's observed intervals were 55.218 seconds from locked queue creation to
URL submission, 13.006 seconds from that submission to the Install tap, 19.709
seconds to the cellular Download tap, and 66.072 seconds from the Download tap
to the verified app screen. These include owner waiting, command orchestration,
inspection and a deliberate background interval. They are not install latency
benchmarks or a justified estimate of the minimum product delay.

## UI details that the test exposed

The native install alert truncates long delivery hostnames even in accessibility
text. The first strict full-host comparison stopped correctly. After observing
the actual prompt, the isolated matcher accepted its exact app name and native
wording with either the full frozen host or a matching truncated prefix of at
least 24 characters. It still requires one alert with exactly Cancel and Install.
The original URL comes only from the prepared private build record. This bounded
trial rule is not a general trust or arbitrary web-prompt policy.

iOS then presented a separate `Download ... Using Cellular Data?` alert. The
controller handled it only after the installation-approval fence, for the exact
app, with exactly Later on Wi-Fi and Download. No cellular preference was changed.
Neither successful tap was counted as installation completion.

The first build was not confirmed during early foreground inspection. After
moving it out of the foreground, the phone locked and the owner later confirmed
the update. This does not prove the exact reason for that delay. For build 41,
the controller deliberately returned Home after confirmations, allowed the
update an interval, then reopened Companion and verified the new self-status.

Nineteen Mac fixture cases passed, including lock/unlock progression, expiry,
changed artifact binding, persisted fences after lost replies, failed writes,
missing/ambiguous/unrelated alerts, truncated host matching, and the separate
cellular confirmation. Fixtures do not substitute for the physical UI results.

## Product decision after the trial

The preferred incremental experience is **agent requests installation; iOS asks
the user to confirm**, with no trip into agent chat or Swift Sim to find a link.
The ideal remains normal build/install/launch behavior resembling nearby Xcode.
Starting App Testing solely to automate a confirmation is not the accepted product
tradeoff. The prototype used the runner to open the installer as well as to press
its buttons, so merely deleting the tap step does not remove that prerequisite.

A new candidate is a narrowly scoped installation request carried by the existing
foreground Debug app connection, with the Mac retaining pending work until that
app is active. The local SDK already receives bounded developer-tool requests;
it does not currently implement an install-request command. This would need its
own capability, artifact/app binding, foreground checks and once-only handling.
No additional socket, watcher, background mode or UI automation session should be
introduced. It must not use a hot-reload patch as a hidden command mechanism.

This candidate is not implemented or phone-qualified. It would apply only when
an appropriate connected app can execute the request. Unlocking alone does not
guarantee that an eligible app is foregrounded; it would not establish silent
startup after reboot or automatic relaunch after replacement. Ordinary signing
and the system's install/cellular confirmations remain in force.

## Restoration and resources

Companion is now normal build 41, using the same bundle/team and existing
production-push profile as the original normal build 38. Signed artifact
preparation passed before both installations. A Mac-side delivery check verified
that build 40's served package digest matched the frozen signed artifact; this
check was not treated as a phone completion receipt.

The runner itself stayed on normal internal build 8. Testing was explicitly
closed after each attempt; final close reported `runnerStopped: true` and the
local input lease was removed. The phone is released for normal use. Build,
signing and bounded waiting workers exited. Helper health returned HTTP 200 in
9.8 ms after the trial, a single health observation rather than a performance
or APNs-delivery benchmark.

All controller source, fixtures, frozen packages and private receipts are retained
under ignored `.build/ota-session-install-20261107/`; its resource record has no
active worker or phone reservation. Existing time-limited OTA delivery remains
available until its ordinary expiry. No normal hot-reload, notification, helper
startup, SDK or testing-runner code was changed by this trial. It is not enabled
as a normal delivery mode.
