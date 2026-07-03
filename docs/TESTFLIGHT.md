# TestFlight Beta

## Beta Description

Swift Sim installs Xcode-signed development builds on your iPhone directly from a remote Codex workflow. Temporary install links work on any network and update existing apps without clearing their data when signing remains compatible. The companion groups every prototype into one app library entry with build history, archive controls, and connected-device verification. An optional live Simulator companion is available through private Tailscale access.

The iPhone app does not execute project source code. Xcode signs device builds on the Mac, and the signed IPA is streamed to the phone through an expiring Cloudflare Quick Tunnel without a Swift Sim account.

## What to Test

- Install Swift Sim with Homebrew and run `swift-sim setup`.
- Ask Codex to build an app to iPhone and open the returned install page on cellular with Tailscale disconnected.
- Install an update with the same bundle ID and confirm the app's saved data remains.
- Confirm repeated builds occupy one app-library slot and appear newest-first in Build History.
- Verify archive, restore, history deletion wording, and connected-device status.
- Ask Codex to build and launch an iOS app, then use the plugin to open that simulator in Swift Sim.
- Pair the iPhone with the Mac helper using the generated `swift-sim://` pairing link.
- Open the simulator session from the companion link returned by Codex.
- Verify live video, taps, gestures, keyboard input, hardware controls, and logs.
- Leave and reopen a recent session.
- Verify recovery after briefly interrupting the Mac helper or Tailscale connection.

## Beta Review Notes

Swift Sim requires the Codex desktop app, Xcode, and the Swift Sim Homebrew package on a Mac. `swift-sim setup` installs the matching Codex plugin and starts the helper. Tailscale is required only for optional live Simulator sessions. Codex is the coding and orchestration surface; the iPhone companion does not build projects itself. No Swift Sim account or demo credentials are required.

Setup instructions: https://github.com/Miguelosaurus/Swift-Sim/blob/main/docs/SETUP.md

Simulator access is HTTPS through the tester's private Tailnet. Device builds use a separate token-scoped gateway through a random, expiring `trycloudflare.com` URL; pairing, app-library deletion, and simulator controls are not exposed there. Xcode uses the tester's configured Apple Developer account for signing.

## Public Link Copy

Install, update, and organize Xcode-signed prototype apps from Codex on any network. Swift Sim keeps build history under one app and also provides optional live control of your Mac-hosted Simulator through private Tailscale access.
