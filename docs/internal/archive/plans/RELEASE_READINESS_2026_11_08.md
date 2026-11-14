# Release readiness: November 8, 2026

Scope: prepare the next beta without contacting the owner's iPhone. No physical
device queries, delivery requests, push sends, installs or testing sessions were
performed. The installed Mac helper and engine were left running unchanged.

## Candidate

- Mac package, shared agent integrations and Companion: 0.6.5.
- App Store Companion build: 15; bundle identity unchanged.
- Engine/Debug SDK: the existing published 0.5.8 contract, unchanged.
- Signed App Store archive and exported IPA prepared locally, not uploaded.
- Existing distribution identity reused. A matching App Store provisioning
  profile was created for the already-enabled push capability. No new identity,
  signing key, device registration or capability was created.

## Changes reviewed

The empty, unpaired library now leads with Connect your Mac. Install links remain
available. Connection and build text describe actual availability rather than
promising installation/verification from a reachable helper alone.

Notification settings distinguish unknown, unconfigured and configured Mac
senders. iPhone permission is requested from that screen only when the sender is
known configured. The activity inbox remains usable without push credentials.
No poller, dependency, background service or SDK/runtime logic was added.

The public quickstart, delivery paths, stable SDK pin, receipt-fence recovery,
storage and privacy guidance were reconciled. Ordinary testers are not asked
for the owner's APNs key. Public beta background alerts remain an explicit
limitation until a separate distribution-safe sender design is authorized.

## No-phone verification

| Gate | Result and boundary |
| --- | --- |
| Full Node 24 check | Passed syntax, architecture, docs, types, format, lint, 1,664 source tests, 1,028 compiled tests and 3 hermetic tests. |
| Packaged installation | Passed isolated package installation, setup/doctor and agent discovery checks; agent CLIs are fixtures, not a second developer's real installation. Homebrew syntax and Node 24 entrypoints passed; the destructive clean Homebrew install gate was not run. |
| Real public engine | Fresh task-owned root downloaded the published signed 0.5.8 archive, verified the pinned checksum/signature, then repeated unchanged. The engine was not started. |
| Swift package | 38 tests passed with client autoconnection explicitly disabled. |
| Companion | 62 tests passed on a stock iOS Simulator with a separate app identity. An unsigned Release Simulator build also passed. |
| First-run UI | Manually verified the primary Mac setup action and one-tap install-link sheet. Unknown, unconfigured and configured notification states were exercised using a loopback-only fixture. No permission or push request was sent to the phone. |
| Distribution artifact | Release archive/export passed with production push entitlement and no debugger entitlement; code signature and version/build were verified. Upload, Apple processing and external review remain untested. |

Private evidence and signing details stay in task-owned local build output.
The isolated Simulator was shut down and the loopback fixture stopped.
This pass does not replace the earlier physical hot-reload qualifications, or
prove a fresh external developer's end-to-end setup.

## Release gates still open, in order

1. Upload the verified Companion candidate after release authorization. Inspect
   processing/export-compliance results, submit for external beta review when
   eligible, and assign the approved, nonexpired build to Public Beta. As checked
   through App Store Connect on November 8, all returned builds and all group
   assignments were expired; the newest upload was 0.6.1 (14). A public link
   alone is not a usable beta. Apple review can move the launch date.
2. Run one clean external developer smoke test using the actual public Mac
   package, agent integration and TestFlight Companion: initial setup, Debug
   bootstrap, apply/restore an edit on cellular, structural update and exact
   installed-version/data confirmation. Keep this separate from fixture proof.
3. Publish the reviewed Mac package/plugin/tag and matching Homebrew formula
   without altering any earlier release. Update availability/version examples
   only after the public artifacts and external build are actually usable.
4. Check launch copy against the beta boundary: Mac awake/online, private
   Tailscale for remote features, development-signed Debug SDK, and explicit iOS
   approval for remote OTA installation. Background alerts are not a default
   public-beta promise. Optional App Testing stays separate.

No new feature work is required for this candidate. The active external build
and a fresh-user smoke test take priority over adding features before launch.
