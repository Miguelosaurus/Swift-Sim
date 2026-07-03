# TestFlight Beta

## Beta Description

Swift Sim is an iPhone companion for developers using the Codex desktop app, Xcode, and the bundled Swift Sim companion plugin on a Mac. It supports private live Simulator control through Tailscale and signed real-device installs through temporary HTTPS links that work without Tailscale.

The iPhone app does not execute project source code. Xcode signs device builds on the Mac, and the signed IPA is streamed to the phone through an expiring Cloudflare Quick Tunnel without a Swift Sim account.

## What to Test

- Install the bundled Swift Sim companion plugin in Codex on the Mac.
- Ask Codex to build and launch an iOS app, then use the plugin to open that simulator in Swift Sim.
- Pair the iPhone with the Mac helper using the generated `swift-sim://` pairing link.
- Open the simulator session from the companion link returned by Codex.
- Verify live video, taps, gestures, keyboard input, hardware controls, and logs.
- Leave and reopen a recent session.
- Verify recovery after briefly interrupting the Mac helper or Tailscale connection.
- Ask Codex to build an app to iPhone and open the returned install page on cellular with Tailscale disconnected.
- Install an update with the same bundle ID and confirm the app's saved data remains.

## Beta Review Notes

Swift Sim requires the Codex desktop app on a Mac, the bundled Swift Sim companion plugin, Xcode, Node.js 20 or newer, and the open-source Swift Sim helper. Tailscale is required only for live simulator sessions. Codex is the coding and orchestration surface; the iPhone companion does not build projects itself. No Swift Sim account or demo credentials are required.

Setup instructions: https://github.com/Miguelosaurus/Swift-Sim/blob/main/docs/SETUP.md

Simulator access is HTTPS through the tester's private Tailnet. Device builds use a separate read-only gateway through a random, expiring `trycloudflare.com` URL; pairing and simulator controls are not exposed there. Xcode uses the tester's configured Apple Developer account for signing.

## Public Link Copy

Test Swift Sim, the iPhone companion for controlling a Mac-hosted Xcode Simulator or installing signed development builds from Codex. Tailscale is needed for live simulator control, but not for install/update links.
