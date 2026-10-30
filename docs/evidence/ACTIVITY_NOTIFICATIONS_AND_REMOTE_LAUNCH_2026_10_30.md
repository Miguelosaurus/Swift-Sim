# Activity notifications and remote launch confirmation — 2026-10-30

Implementation and qualification for the activity inbox, optional APNs alerts,
foreground hot-reload handoff, Debug feedback and remote exact-build launch
history. Main integration uses no PR. Real APNs and new physical Companion
qualification remain external activation gates, not inferred from local tests.

## Implemented surfaces

- Owner-private bounded activity/outbox journal; injected lock/file ports, atomic
  writes, deduplication, per-device preferences, initial-history silence and
  bounded retry/expiry. Direct APNs HTTP/2 with ES256 signing, private key/config,
  sandbox/production mapping, fixed TLS endpoints and bounded response/deadline.
- Pairing/device/preference/provider-generation/source transitions rechecked after
  TLS connection immediately before transmission. Fresh source projection occurs
  independently of stalled push dispatch. No lock spans the network request.
  Replacing a token, disabling alerts, rotating pairing, superseding or expiring
  a request cancels not-yet-sent work. Already accepted alerts cannot be recalled.
- Private paired-Mac feed/registration routes; public gateway excludes them.
  Push carries opaque IDs and bounded display text; authenticated tap fetches
  current state and verifies Mac installation identity before resolving an action.
- Companion activity inbox/unread cursor/cache, five per-Mac preferences,
  permission/token lifecycle, foreground inbox updates, queued target-app
  instructions and historical installation/launch wording. Explicit signed
  `SwiftSimLaunchURL` is bound to exact project/scheme/bundle/version/build and
  both Mach UUIDs; no guessing OAuth URL schemes and no URL in APNs payloads.
- Typed normal waiting guidance: using chat on the same phone backgrounds the
  target app; returning to its foreground/root-ready Debug process enables apply.
  No required screen, fixed countdown, resend, rebuild or restart for ordinary
  waiting. No completed reload without its matching native refresh receipt.
- Native SDK commit `43966021a3782af65ecc9e594c7e7a7e3cbf409e`, pinned by root
  Package.swift/Package.resolved. Client-local lifecycle feedback plus a Debug-only
  root overlay. Request/digest/baseline/sequence fences, actual replacements,
  application acknowledgement and increased acknowledged refresh revision are
  required for Updated. Presentation does not produce proof or alter host state.
- Remote launch verifier checks the exact signed Debug capture, active/root-ready
  compatible SDK, both Mach UUIDs and current transactional compiler registration.
  Store rechecks under transaction. Same-process reconnect, cached status and
  helper restart never advance launch history. Public projection omits private
  fingerprints/nonces/UUIDs/paths. Apple inventory remains a distinct source.
- Helper reconciliation/shutdown and CLI notification setup wired; installed
  helper capability requirements include activity and remote launch confirmation.
  Codex plugin revision: `0.6.1+codex.20261030.1`.

## Qualification

- Companion unsigned Simulator build and all **37 XCTest tests** passed on an
  owned stock iOS 26.5 Simulator. Generated-only test signing override enabled
  Simulator Keychain identity; production vault unchanged. Inbox/preferences and
  denied-permission screenshots inspected. Simulator shut down and preserved.
- Native SDK **18 tests**, root SDK **5 tests**, native/root Release and iOS Debug
  compile qualification passed. Parent reran root tests after resolving the new
  immutable native revision: **5/5 passed**.
- Independent notification security review includes delayed TLS/admission
  revocation, fresh config after awaited guard, source transition without a
  manual refresh, expiry, removed-build dedup and secret redaction.
- Real isolated helper process smoke: authenticated private feed/registration/
  removal succeed; unauthenticated read rejects; public build-only gateway hides
  all three activity routes. **2/2 passed**.
- CLI setup tests now isolate HOME and external read probes rather than compete
  for the user's real engine lifecycle lock. Real notification CLI tests use a
  generated private P-256 fixture key; configure/status/disable and redaction pass.
- Full `npm run check` passed on Node 24.19.0: **1,137 source tests,
  617 compiled tests, 2 hermetic compiled tests**, syntax/types/format/lint,
  architecture (239 production sources), documentation links, archive contents,
  clean package installation, Homebrew formula syntax and compiled entrypoints.
  The destructive clean Homebrew installation gate remains intentionally opt-in.
  Final route authority-error regression plus helper smoke: **7/7 passed**;
  the regression is also included in the passing compiled suite.
- Warm-readiness unit tests inject the lifecycle lock port while retaining
  serialized status access; production defaults retain the owner-verified lock.
  SDK feedback subscribes before root readiness opens to avoid a first-event race.

Local logs: `/tmp/swift-sim-notifications-full-check-final.log`,
`/tmp/swift-sim-activity-root-sdk-final.log`,
`/tmp/swift-sim-notification-complete-tests.log`,
`/tmp/swift-sim-activity-helper-composition.log`.
Companion result: `/tmp/swift-sim-activity-companion-accepted-tests-20261030.xcresult`.
These local artifacts may be temporary; this tracked record preserves scope and
proof boundaries.

## Activation and physical limits

No Swift Sim APNs signing key was available. No real alert was sent or claimed
received/displayed. Actual push needs an APNs key, push-enabled App ID/profile,
matching signed Companion and explicit phone notification permission. See
[setup](../NOTIFICATIONS.md). The inbox needs no APNs key.

Exact-build launch history works through a private live connection across
networks over Tailscale. It is not current reachability, uninstall detection,
per-Companion-phone binding or Apple hardware attestation. Historical UI wording
is intentional. Release apps without the SDK retain ordinary inventory/install
behavior. The existing Debug app needs its next SDK-enabled signed build for the
new host overlay; this task does not rebuild/install Zenics or alter app data.
No engine binary replacement is required; local qualified engine 0.5.1 remains.

Separate Zenics evidence established build 28 installed and an existing queued
revision applied after returning to the app. Force-quit restoration remains an
unaccepted physical gate. The improvements here do not upgrade that proof.
