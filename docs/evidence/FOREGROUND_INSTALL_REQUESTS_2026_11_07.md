# Foreground Debug install handoff preparation

The owner rejected requiring an automation session merely to press iOS's normal
installation buttons. This opt-in implementation instead sends a narrow
same-app install intent over the existing Debug connection and calls
`UIApplication.open` on the owning foreground scene. Apple owns confirmation.
No test runner, UI automation, extra network listener, or app-content upload is
part of this path. No physical phone action has been taken for this preparation.

The Mac uses the authoritative saved signed-build record and immutable binary
selector. A build-ID request contains the target version/build, IPA digest,
HTTPS manifest capability and expiry. The request accepts only the normal
Swift Sim manifest route and an install of the same bundle. Arbitrary schemes
and unrelated app URLs are not exposed as an agent command. The digest binds the
Mac's frozen intent; it is not a claim that iOS verified or installed those bytes.

The existing Mac engine owns an event-driven, bounded, private journal. Client
identity/foreground events and completed hot reloads wake pending work. There is
no periodic poller. No queue is allocated in ordinary engine startup without a
saved journal, and no artifact hashing/import of the command module occurs in
normal helper, hot-reload or notification startup. Delivery expiry and queue
capacity are checked on explicit requests/events rather than by a timer.

Before dispatch, an atomic, synced journal records the handoff fence. A lost
reply or engine restart cannot authorize replay. The existing process-local
native developer-tool ledger independently prevents duplicate UI dispatch.
Request IDs cannot be reused with a changed intent. Unknown results remain
unknown; `UIApplication.open` success is projected only as `prompt-requested`.
There is no install-success mutation of the normal build store.

## Local evidence

- Eighteen helper tests cover exact artifact and project binding, old engine/SDK
  gating, expired/revoked/changed builds, credential-bearing URLs, no resend
  after uncertainty, offline identity binding, real streaming IPA hashing and
  symlink refusal. Output excludes private URLs/tokens.
- Native production queue/intent tests cover wrong binary/scene readiness,
  hot-reload priority, pending restart, locked/offline waiting, 32 concurrent
  drain attempts with one send, duplicate commands, process death after the
  durable fence, lost reply, cancellation, expiry, unsupported clients, symlinks
  and write failure before sending.
- Existing developer capture/tool tests and native prepared engine/reconnect
  contracts pass. SDK suite: 33 tests; root SwiftSimLive suite: 38 tests. Combined helper, app-context, notification
  and live-delivery regression selection: 100 tests.
- The actual Mac app and arm64 iPhone SDK compile. Actual Release SDK object
  inspection excludes the install capability, intent runtime and URL handoff.
- Root types, source/architecture/docs and lint checks pass. The compiled helper
  build succeeds. Detailed task-local logs are in
  `.build/foreground-install-20261107/`; they are not a phone receipt.

## Remaining physical proof

A one-time signed Debug update is necessary before the installed Zenics can
accept the new intent. Then prove a same-app next-build handoff on cellular,
manual iOS confirmation, actual installed build, retained app data, and locked
waiting followed by foreground delivery without duplicate prompts. Existing
runner-based OTA results do not count as this path's qualification. Automatic
replacement-app launch, stopped-app wake and unattended locked cellular native
installation remain unproven and unimplemented.

## Prepared checkpoint

The SDK source is committed on InjectionNext main as
`ba3c7166f6712d2cd962005a2a1200de4137590b`, and SwiftSimLive pins it immutably.
Local engine candidate 0.5.7 builds from that source, passes strict deep signature
verification, and replaces the prior task-owned engine through the normal
ownership/lifecycle path. The normal helper remains running; no additional
service, simulator, browser, polling worker or phone automation session is left.
The optional queue has not submitted a phone request during preparation.

Zenics Debug44 is now signed and ready through the normal build workflow, using
Swift-Sim commit4f2e442 and SDKba3c716. Only its package revision was changed;
checksums of the existing tracked mobile app files are unchanged. The owner has
been asked to install this bootstrap update and foreground Zenics on cellular
with App Testing stopped. No install intent has been enqueued for the phone.
Build/test workers have exited, and package-content verification passes. The
normal helper, engine and normal expiring build delivery remain for daily use.
