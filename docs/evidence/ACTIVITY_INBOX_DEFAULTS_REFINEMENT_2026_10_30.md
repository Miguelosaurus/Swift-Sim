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
