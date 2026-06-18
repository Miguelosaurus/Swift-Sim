# TestFlight Beta

## Beta Description

Swift Sim is an iPhone companion for developers using the Codex desktop app, Xcode, and the bundled Swift Sim companion plugin on a Mac. The Codex plugin builds and verifies the user's app, starts the matching simulator session through the Swift Sim helper, and hands that session to the iPhone over the user's private Tailscale network.

The iPhone app does not execute project code or upload source code. Builds remain on the user's Mac.

## What to Test

- Install the bundled Swift Sim companion plugin in Codex on the Mac.
- Ask Codex to build and launch an iOS app, then use the plugin to open that simulator in Swift Sim.
- Pair the iPhone with the Mac helper using the generated `swift-sim://` pairing link.
- Open the simulator session from the companion link returned by Codex.
- Verify live video, taps, gestures, keyboard input, hardware controls, and logs.
- Leave and reopen a recent session.
- Verify recovery after briefly interrupting the Mac helper or Tailscale connection.

## Beta Review Notes

Swift Sim requires the Codex desktop app on a Mac, the bundled Swift Sim companion plugin installed in Codex, Xcode, Node.js 20 or newer, Tailscale, and the open-source Swift Sim helper. Codex is the coding and orchestration surface; the iPhone companion does not build or run projects by itself. No Swift Sim account or demo credentials are required.

Setup instructions: https://github.com/Miguelosaurus/Swift-Sim/blob/main/docs/SETUP.md

The app communicates only with a helper chosen and paired by the tester. The supported remote path is HTTPS through the tester's private Tailscale network. The custom `swift-sim://` URL scheme is used because public builds cannot declare Associated Domains for arbitrary private `*.ts.net` hostnames.

## Public Link Copy

Test Swift Sim, the iPhone companion for viewing and controlling an Xcode Simulator running on your Mac while Codex works. The Codex desktop app, bundled Swift Sim companion plugin, Xcode, Tailscale, and the Swift Sim helper are required.
