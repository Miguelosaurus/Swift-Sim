# Companion OTA push update — 2026-10-30

The regular Swift Sim Companion was prepared as an in-place registered-device
OTA update: **0.6.1, build 16**, Release/ad hoc, with the existing production
application identity. This is the existing app, not a separate client.

## Signing recovery

The initial build stopped before compilation at the signed-build storage floor.
Authorized cleanup reclaimed inactive disposable caches and owned compiler
intermediates, preserving source, signed products/archives, simulator data, the
active Zenics build and live-delivery artifacts.

The first signing attempt then found no Xcode account and a cached provisioning
profile without Push Notifications. The App ID's push capability was already
enabled through the authorized APNs setup. A successor ad hoc profile was created
for the one existing registered iPhone and an existing valid distribution
identity whose private key was already in Keychain. No new device, certificate,
Xcode account or exported private signing identity was needed.

Commit `d4387f4` fixes export ignoring manual signing selections. Export now
retains the resolved signing style, exact app/profile mapping and certificate.
Incomplete manual selection fails rather than falling back to automatic signing.
The automatic signing flow remains available. Regression coverage includes
resolved-setting precedence, repeated CLI overrides, UUID selectors and XML
escaping. All changes were committed directly to main without a PR.

Qualification: **1,142 source tests, 622 compiled tests and 2 hermetic compiled
tests** passed, alongside syntax, architecture, types, formatting, lint, package
contents/install checks and Homebrew formula/entrypoint checks. The destructive
clean Homebrew installation gate remains opt-in. The focused builder/signing/
resume suite also passed **27/27** tests.

## Export and live delivery verification

The retry completed as build 16 through the supported Swift Sim build pipeline.
The exported IPA was extracted privately and verified with deep/strict codesign:

- Correct production bundle/version/build and existing application identifier.
- Production `aps-environment` in both signature and embedded profile.
- Companion's push endpoint selection also set to production.
- Registered iPhone included in the embedded profile.
- Debugger entitlement disabled; no APNs private key included in the IPA.
- Store reports ready, device-installable and same-bundle-update.

The public manifest and full IPA both returned HTTP 200, and the downloaded IPA's
SHA-256 matched the locally verified signed IPA. The bearer install capability is
kept outside Git and was shared only in the requesting private chat. Its initial
lifetime is two hours; it is not a permanent release URL.

The committed helper was refreshed through owned-process shutdown and normal
runtime reconciliation so later phone-triggered rebuilds also use the manual
export fix. Helper health returned compatible, the existing live engine process
was preserved, and the OTA manifest remained reachable after the refresh.

Local private receipts are under `.build/ota-companion-20261030/`:
`signing-receipt.json`, `export-verification.json`,
`delivery-verification.json` and `helper-activation.json`.
Qualification log: `/tmp/swift-sim-manual-signing-full-check.log`.

## Physical acceptance boundary

An install link being ready is not an installed-app observation. The user must
accept iOS's OTA install prompt, then open Swift Sim and explicitly allow
notifications from the bell → Notifications screen. This record establishes
signed/exported/reachable build 16, not physical installation or displayed push.
The APNs key is production-only and restricted to the Companion topic; it does
not authorize sandbox Companion builds. No TestFlight/App Store upload occurred
in this direct OTA delivery.
