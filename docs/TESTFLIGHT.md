# TestFlight Beta

## Beta Description

Swift Sim installs Xcode-signed development builds on your iPhone from a mobile-controlled Codex, Cursor, Claude Code, or OpenCode workflow. Temporary handoff links work on any network and update existing apps without clearing their data when signing remains compatible. The companion records the build before launching installation, groups every prototype into one app library entry, and provides history, archive controls, and connected-device verification. An optional live Simulator companion is available through private Tailscale access.

The iPhone app does not execute project source code. Xcode signs device builds on the Mac, and the signed IPA is streamed to the phone through an expiring Cloudflare Quick Tunnel without a Swift Sim account.

## What to Test

- Install Swift Sim with Homebrew and run `swift-sim setup`.
- Ask a supported local coding agent to build an app to iPhone and open the returned install page on cellular with Tailscale disconnected.
- Install an update with the same bundle ID and confirm the app's saved data remains.
- Confirm repeated builds occupy one app-library slot and appear newest-first in Build History.
- Verify archive, restore, history deletion wording, and connected-device status.
- Ask the coding agent to build and launch an iOS app, then use its Swift Sim integration to open that simulator in Swift Sim.
- Pair the iPhone with the Mac helper using the generated `swift-sim://` pairing link.
- Open the simulator session from the companion link returned by the coding agent.
- Verify live video, taps, gestures, keyboard input, hardware controls, and logs.
- Leave and reopen a recent session.
- Verify recovery after briefly interrupting the Mac helper or Tailscale connection.

## Beta Review Notes

Swift Sim requires Xcode, the Swift Sim Homebrew package, and at least one supported local coding agent on a Mac. `swift-sim setup` installs the matching Codex, Cursor, Claude Code, or OpenCode integration and starts the helper. Tailscale is required only for optional live Simulator sessions. The selected agent is the coding and orchestration surface; the iPhone companion does not build projects itself. No Swift Sim account or demo credentials are required.

Setup instructions: https://github.com/Miguelosaurus/Swift-Sim/blob/main/docs/SETUP.md

Public beta: https://testflight.apple.com/join/HMUUFYNK

Simulator access is HTTPS through the tester's private Tailnet. Device builds use a separate token-scoped gateway through a random, expiring `trycloudflare.com` URL; pairing, app-library deletion, and simulator controls are not exposed there. Xcode uses the tester's configured Apple Developer account for signing.

## Public Link Copy

Install, update, and organize Xcode-signed prototype apps from Codex, Cursor, Claude Code, or OpenCode on any network. Swift Sim keeps build history under one app and also provides optional live control of your Mac-hosted Simulator through private Tailscale access.
