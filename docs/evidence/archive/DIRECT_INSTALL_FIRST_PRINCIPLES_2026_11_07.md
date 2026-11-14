# Cellular installation: separate delivery, installation and startup

**Follow-up:** [physical cellular OTA qualification](OTA_CELLULAR_SESSION_INSTALL_2026_11_07.md)
installed builds 40 and 41, including a locked queue resumed after unlock. The
owner subsequently rejected requiring App Testing just to automate confirmation;
the accepted next product direction is agent-triggered installation with native
user confirmation. The preparation and research below are historical.

Research checkpoint, November 7, 2026. No phone contact, installation, enrollment,
runtime change or new background resource was part of this review.

## What must actually happen

A build-to-phone operation requires four independent things:

1. An eligible, signed artifact, bound to the intended app and device.
2. Delivery of its bytes to the phone.
3. An authorized iOS component accepting the installation request.
4. An execution opportunity for that component, followed by evidence of the
   requested installed build.

Tailscale addresses delivery/connectivity. It does not create an Apple service
listener or start a suspended phone app. Signing authorizes the artifact; it does
not give an arbitrary app installation privileges. A push delivery is neither
an install request nor a completion receipt.

The [native installation trial](DIRECT_INSTALL_PHONE_QUALIFICATION_2026_11_06.md)
already qualifies the installer on Wi-Fi, including a locked case and a reboot
followed by first unlock. The [latest cellular capability trial](DIRECT_INSTALL_LOCAL_SERVICE_CAPABILITIES_2026_11_07.md)
qualifies a different local Instruments connection, with no install operation.
Combining their success labels would not qualify a cellular installer.

## New composition candidate: automate the existing OTA flow

The existing OTA path already supplies a signed manifest/package installation
flow. The independent testing runner already supplies owner-started cellular UI
control. These could be composed: build normally, open the exact install URL on
the phone, handle the corresponding iOS installation confirmation, then verify
the newly launched build. The user would not need to find or tap a link per build.

This is **an unqualified candidate for an active development session**, not a
solution for a locked phone with App Testing stopped. It still uses a manifest
URL internally and visible system UI. It must not be marketed as a native,
link-free InstallationProxy transport or silently substituted into that prototype.

Concrete source findings:

- The pinned [runner source](https://github.com/OpenMinis/iCTRL/blob/c1e4268859ba858d1579f7b846a56cb40641b7f6/iCTRLUITests/ActionHandler.swift)
  implements `open_url`, bounded system-alert inspection and native element
  actions. No new phone framework is indicated just to attempt this composition.
  These primitives do not prove that this particular install alert is actionable.
- Apple documents [XCUISystem URL opening](https://developer.apple.com/documentation/xcuiautomation/xcuisystem/open(_:)).
  Opening an item is not an installation-complete signal.
- Our current `optional/app-control/control.py` intentionally restricts sessions
  to a non-system app, and checks foreground identity before actions. It exposes
  neither arbitrary URL opening nor a system-alert acceptance command. The new
  workflow needs explicit install scope; do not weaken the general testing scope.
- The runner's `list_apps` returns names/identifiers, and can fall back to launch
  history. It cannot verify an exact installed version. An install must use an
  existing authenticated build-specific launch receipt or another qualified
  version source, rather than app presence, an icon or a successful URL-open call.

The smallest useful phone test would use the current runner and one normal,
uniquely numbered Companion build, with a fresh owner-started cellular session.
It would open one artifact-bound OTA URL, inspect the expected system prompt and
stop if the prompt is absent, unrelated or ambiguous. Only a separately scoped
install action may select its exact button. Never auto-accept arbitrary alerts,
retry an uncertain submission, dismiss passcode prompts or change device settings.
Observe the resulting build identity and data retention, then stop the runner.
An initial read-only prompt check is sufficient to reject an inaccessible UI
before building a product coordinator.

If that passes, any implementation should be a one-shot optional Mac transaction
using the existing testing lease and deadline. It should add no target-app code,
normal-helper import, notification polling or idle worker. UI performance and
the existing runner's memory/battery cost remain real costs during the session;
absence of new SDK code does not make automation free.

## Unattended cellular installs need a different startup owner

When both Swift Sim and App Testing are stopped, neither can execute this UI
transaction. A reverse socket, a new transport or a larger runner does not remove
that prerequisite. An active-session success would leave locked and fresh
post-reboot startup unqualified.

Apple's documented alternative is its OS-owned management channel. The
[command protocol](https://developer.apple.com/documentation/devicemanagement/commands-and-queries)
uses a management push to have the device fetch commands and report results. It
does not require a foreground Swift Sim process. This can coexist with Xcode
signing and developer pairing; it would be a separate delivery authority.

Apple's [managed-app guide](https://support.apple.com/guide/deployment/distribute-managed-apps-dep575bfed86/web)
documents silent updates with foreground-app exceptions, initial approval on
unsupervised devices, and cellular-download controls for declarative management.
Those are reasons to evaluate it, not proof that our exact development-signed
Debug artifact, live-reload entitlements, foreground behavior and reboot matrix
work unchanged. Preserve the existing data/backup behavior and avoid a default
that removes apps on unenrollment.

This is a meaningful setup and permission change. The
[MDM payload](https://developer.apple.com/documentation/devicemanagement/mdm)
can omit erase, lock and settings rights, but its app-management permission is
broad, not an OS-enforced permission for exactly one Swift Sim app. It also needs
separate management certificate/enrollment plumbing. Apple requires a management
capability request for use in a product. No enrollment, supervision, certificate
request or profile generation is authorized by this research.

## Why the apparent shortcuts do not satisfy the requirement

- SideStore's [maintainer explanation](https://github.com/SideStore/SideStore/issues/1505)
  requires cellular on/off Shortcuts for its experimental refresh workflow.
  Interrupting the data path is incompatible with uninterrupted Tailscale and
  notification delivery. It is not proof of a fresh, continuously connected
  cellular installation path.
- LocalDevVPN's [maintainer response](https://github.com/jkcoxson/LocalDevVPN/issues/31)
  confirms a cellular limitation. This does not establish the precise cause of
  our separate Tailscale failure. It does undermine treating a second VPN as an
  already-solved drop-in transport.
- A general process-control, shell or arbitrary IPC bridge is not an installer
  design. This review does not propose invoking privileged operations outside
  their normal authorization.
- Keeping a Wi-Fi-established tunnel or the testing runner alive indefinitely
  changes the lifecycle and overhead requirement; it is not cold-start proof.

## Decision boundary

For an unlocked, explicitly started development session, the OTA-plus-testing
composition is the smallest new candidate with both component paths already in
Swift Sim. Qualify the actual system prompt before adding product code.

For zero session-start interaction and installation while idle/locked, the
documented management channel is the strongest architectural candidate found.
Its onboarding, permission and exact-signing gates require a separate decision.
No reviewed path currently proves the entire original requirement using only
ordinary developer pairing, a stopped runner and continuously active cellular.
That is an evidence boundary, not a proof that every possible implementation is
impossible.

The owner accepted the active-session approach as a useful first step and asked
whether a locked phone could install after unlocking. The proposed queue retains
the build and attempts it after unlock only while the existing phone session is
still authorized and running. Unlocking alone does not restart an expired,
stopped or post-reboot runner.

## Preparation after accepting the active-session scope

A private, isolated one-artifact controller and fixtures were prepared under
ignored `.build/ota-session-install-20261107/`. It uses a frozen copy of the
existing qualified client, preserving concurrent work in the production control
files. No general testing permission was expanded.

Sixteen Mac fixture cases pass. They cover lock/unlock queue progression,
persisted single-submission fences for URL opening and approval, lost replies,
missing/ambiguous/unrelated prompts, session/delivery expiry, phone lifetime,
changed artifact binding and failed durable writes. Only the exact expected
app/host installation alert can advance. A bounded foreground command may check
the active session for up to two minutes, releasing the shared operation lock
between checks so Stop remains available. No worker has been started on the
phone, and fixture success is not system-alert or installation proof.

Normal Companion build 40 is signed and ready, preserving the installed build
38's bundle, team, version and existing production-push profile. Offline signed
artifact preparation passed. Initial builds exposed mismatched checked-in
signing defaults; the successful build uses the exact existing installed-app
identity and manual profile, without creating certificates or provisioning
profiles. Failed build 39 has no installable artifact and is not reused.

Phone availability/startup confirmation is pending. No phone connection, URL
open, alert selection or cellular install has been attempted at this checkpoint.
The signed OTA delivery is retained for the agreed test and has its ordinary
expiry. Build/signing workers exited. Normal hot reload, notifications and phone
apps are unchanged by this trial.
