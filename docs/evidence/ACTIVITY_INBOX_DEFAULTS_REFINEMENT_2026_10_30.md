# Activity inbox and alert defaults refinement — 2026-10-30

Physical feedback after the build 16 OTA update identified two changes: the
Notifications row was buried beneath the entire retained history, and applied
hot reload alerts should be enabled by default.

The inbox now shows the five newest events in a Recent section, followed by
Notifications settings. Older activity is a separate collapsed disclosure below
settings. Expanding history cannot push the settings row beneath that history.
Messages in inbox rows are limited to two lines; the existing detail actions
retain full content and authenticated target routing. Unread tracking, stored
history and explicit mark-read behavior are unchanged.

Applied hot reload alerts now default on in the Companion and Mac helper. Launch
confirmation remains default off. A one-time cache upgrade changes only the
complete original default preference profile; customized legacy settings are
preserved. The new cache defaults marker prevents later explicit opt-outs from
being reset by reconnects or subsequent launches. Enabling alerts still does not
replay historical events or infer application from queued/compiled state.

## Qualification

- Real Companion XCTest: **39/39 passed**, including persisted default migration
  and preservation of a later explicit opt-out across reconnect.
- Stock task-owned Simulator UI used 12 synthetic events with fake transport and
  no real pairing/APNs credentials. Verified exactly five visible recent events,
  Notifications before collapsed older history, all seven older events expanding
  in order, recollapse removing them, and Hot reload applied visibly on.
- UI fixture copied ActivityView/ActivityCenter byte-for-byte from production;
  only the temporary fixture app entry differed. Owned Simulator shut down and
  preserved after QA. Tested production Simulator product was preserved too.
- Notification/security/route suite: **35/35 passed**. Tests distinguish a revoked
  queued alert from a legitimate newly proven applied alert now enabled by
  default; delayed TLS/source/pairing/preference fences still reject stale work.
- Full Node/package gate passed: **1,143 source tests, 623 compiled tests and
  2 hermetic tests**, syntax/architecture/types/format/lint, package content,
  clean archive installation and Homebrew formula/entrypoint checks. The
  destructive clean Homebrew installation gate remains opt-in. Signed OTA
  qualification is recorded below after export and live fetch verification.

Local UI screenshots: `/tmp/swift-sim-inbox-qa-*.jpg`.
Test result: `/tmp/swift-sim-activity-inbox-refinement-tests-20261030.xcresult`.
Logs: `/tmp/swift-sim-activity-inbox-refinement-tests.log`,
`/tmp/swift-sim-activity-default-on-tests.log`, and
`/tmp/swift-sim-inbox-default-on-full-check.log`.

Additional authorized storage recovery removed only the obsolete iOS 27.0
system-symbol cache after checking that known physical devices use 27.0.1 and
26.6.1 and that no open files/process referenced that exact cache. Current 27.0.1
symbols and project products/archives were retained. No simulator or device data
was erased. This restored sufficient space for the next signed build.

## Build 17 delivery and foreground-expiry regression

The refinements were committed as `1f0fedc` and shipped as signed Release OTA
build 17 through the existing production identity/profile. Apple accepted its
build-ready APNs alert, and the user confirmed receiving a new-build alert and
successfully opening/installing an update. The authenticated production
registration now reports applied-hot-reload alerts enabled.

The user also reported an in-app expired-link banner on the first attempt,
followed by a successful retry. The current build link was valid. Activity
history showed an older Zenics build expiring during that foreground refresh.
The client classified terminal queued-history states as meaningful foreground
announcements, allowing that unrelated expiry to appear during the current
install handoff.

The follow-up fix excludes expired, superseded and unavailable history states
from foreground popups. It keeps those items in the inbox and preserves their
explicit detail/tap handling. Current-link expiry checks remain unchanged;
genuine actionable failures and new ready-build announcements still appear.

Regression qualification: **40/40 real Companion XCTest tests passed**, including
an asynchronous baseline/delta refresh test that keeps all three historical
terminal states silent and explicitly openable while still announcing a new
ready build and genuine failure. The task-owned stock Simulator was shut down.
Log: `/tmp/swift-sim-activity-terminal-banner-tests.log`.
Result: `/tmp/swift-sim-activity-terminal-banner-tests-20261030.xcresult`.
Architecture (239 production sources), documentation links and diff checks also
passed. No helper/runtime code changed after the passing full Node gate above.

## Build 18 signed delivery

The foreground-popup correction at `6ed85aa` was exported as Release OTA
**0.6.1 (18)** with the same production bundle, team, existing registered phone
and manual ad hoc profile. The user authorized temporarily quitting Comet;
quitting it normally restored enough disk space for the ordinary export storage
preflight. Browsing data, project archives and signed products were retained.

Verification of the exported IPA passed strict deep code-signature validation,
exact application identity, production push entitlement and routing, inclusion
of the registered phone, disabled debugger entitlement, and absence of APNs
private keys. The public manifest returned HTTP 200 with the exact bundle and
build 18; the complete public IPA returned HTTP 200 and matched the locally
verified IPA's SHA-256. Private receipts are under
`.build/ota-companion-20261030/build18-{export,delivery}-verification.json`.

The paired helper was absent during the initial export; it was restored from
the compiled current source as a detached process. Its health endpoint returned
HTTP 200, the existing engine process was preserved, and the durable activity
journal recorded Apple's acceptance of build 18's new-build alert (sequence
65). This establishes APNs acceptance, not notification display or installation.
Build 18 is ready for the user's installation; no physical installation of this
build is claimed here. The Codex checkout was fast-forwarded to the correction
and its compiled build passed.

## Production catalog visibility and app-specific alerts

The user subsequently reported that Swift Sim itself was missing from Apps and
received a signing-failure alert near the successful Companion update. Inspection
found that the catalog's internal-QA defaults matched both the production
Companion bundle and its project path. Production Companion builds now remain
visible; development and QA probes retain their internal defaults, and explicit
user archiving remains available.

The signing alert was a separate Larply build attempt, not Companion build 18.
Build alerts now prefix their title with a safe, bounded app display name when
available. Unsafe names retain generic text. Presentation changes preserve event
fingerprints, preventing this update from replaying unchanged historical alerts.

Focused catalog, activity, security and route regressions passed **84/84** both
from source and compiled output. Coverage includes production visibility,
development-probe hiding, explicit archive/unarchive, app-specific APNs titles,
unsafe-name rejection and unchanged-history non-replay. Source syntax,
architecture and documentation checks passed. Companion source did not change;
these corrections require only the Mac helper update. Build 18 remains signed
and ready; the current inventory check has not independently verified its
installation on the phone.
