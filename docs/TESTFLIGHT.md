# TestFlight Beta

## Availability

Checked November 14, 2026 through the authenticated App Store Connect API:
Swift Sim **0.6.6 (16)** is uploaded, processed successfully, nonexpired and
ready for internal testing. It is assigned to the existing **Public Beta** group
and its external beta submission is **Waiting for Review**. Swift Sim
**0.6.5 (15)** remains approved and in external beta testing until then.

Do not describe 0.6.6 as publicly available until Apple approves it and its
Public Beta assignment is verified again. A successful upload or private OTA
install is not external beta availability. Apple's review is an external
dependency; a planned launch date is not an approval receipt.

## Beta Description

Build with the coding agent on your Mac and test changes on your real iPhone
from anywhere. Swift Sim groups your apps and builds, shows the latest update,
and delivers compatible edits to prepared development-signed Debug apps over
private Tailscale. Changes that need a full build use Xcode signing, a reachable
native developer install, or an iOS-confirmed install handoff.

Source files and signing stay on your Mac. No Swift Sim account is required.
Activity updates are available in the app; background alerts need a separately
configured sender and are not included by default for public-beta testers.
Optional developer context, approved app testing and Simulator previews stay
separate from ordinary delivery.

## What to Test

- Follow the public quickstart on a clean Mac state with a supported local agent.
- Use the one-time Debug integration/signing/pairing flow, preserving app identity.
- Apply and restore a reversible body edit over the private route; require exact native applied/refresh proof.
- Background the Debug app while requesting an edit, then return and confirm it applies once.
- Make a structural edit and follow the returned native install, queued iOS prompt or install-link path.
- Confirm the exact installed version and retained app data; an installer callback alone is incomplete.
- Open a build/update notification when a matching sender is configured; verify it opens the app page and latest build.
- Without push configured, verify the notification screen explains in-app updates and does not claim background delivery.
- Verify app icons, latest/previous builds, installed labels, search, archive/restore and build confirmation.
- Pair by QR or explicit link; expired invitations and replacement Macs must not reuse old credentials.
- Run interruption, storage-retention and helper-restart checks; keep old uncertainty fenced and current compiler inputs protected.
- Test optional App Testing only after explicit approval; Stop and duration expiry must end that session.
- Exercise optional Simulator preview independently; it is not proof of physical cellular delivery.

## Beta Review Notes

Swift Sim requires Xcode, Node.js 24 (installed by Homebrew), the Swift Sim Homebrew package, and at least one supported local coding agent on a Mac. `swift-sim setup` installs the matching Codex, Cursor, Claude Code, or OpenCode integration and starts the helper. Normal install links work without Tailscale. The TestFlight Companion does not load project patches; the optional live SDK is restricted to the developer's own development-signed Debug app and excluded from Release/TestFlight/App Store app configurations. Tailscale is required for optional live Simulator sessions, remote hot reload, and the companion's **New build** action because those operations privately reach the user's Mac. The iPhone and Mac do not need shared Wi-Fi or USB. The selected agent remains the coding surface; the companion can independently ask the paired Mac to build its current working tree. No Swift Sim account or demo credentials are required.

Setup instructions: https://github.com/Miguelosaurus/Swift-Sim/blob/main/docs/SETUP.md

Public beta: https://testflight.apple.com/join/HMUUFYNK

Simulator access is HTTPS through the tester's private Tailnet. Device builds can use private Tailscale delivery or a separate token-scoped gateway through an expiring install link; pairing, app-library deletion, and simulator controls are not exposed through that install gateway. Xcode uses the tester's configured Apple Developer account for signing.

## Public Link Copy

Build with your Mac-hosted coding agent and test changes on your iPhone from anywhere. Swift Sim combines supported Debug hot reload, Xcode-signed updates and an organized app library over a private Mac connection.
