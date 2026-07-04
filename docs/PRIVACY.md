# Swift Sim Privacy Policy

Effective July 3, 2026

Swift Sim is a companion for controlling an iOS Simulator and installing development builds produced on a Mac owned by the user. SEA & SEA LLC does not operate a Swift Sim account, artifact-storage, analytics, or advertising service and does not collect personal data through the Swift Sim iPhone app.

## Data the App Handles

The app handles the following data only to provide its core functionality:

- the private Mac helper address chosen by the user
- opaque pairing and simulator-session tokens
- recent session names and connection metadata
- simulator video frames, controls, and logs exchanged directly with the user's Mac
- opaque device-build tokens, app-grouped build history, archive state, and install-request status
- friendly device name and installed version/build when the user runs connected-device verification

The app stores pairing information and recent sessions locally on the iPhone. Simulator frames and logs are displayed in the app and are not uploaded to SEA & SEA LLC.

## Network and Third-Party Services

Simulator sessions connect directly to the user's Mac through the user's private Tailscale network. Tailscale processes that traffic according to its own terms and privacy policy.

For real-device installs, the Mac may start an account-free Cloudflare Quick Tunnel. The signed IPA, install manifest, build metadata, and network information pass through Cloudflare while the iPhone downloads the build. Swift Sim does not upload the IPA to storage operated by SEA & SEA LLC, and the temporary tunnel is stopped automatically. Cloudflare processes tunnel traffic according to its own terms and privacy policy.

The user's selected coding agent and bundled Swift Sim integration orchestrate builds and simulator sessions on the user's Mac. Supported hosts are Codex, Cursor, Claude Code, and OpenCode. Project source code remains on the Mac. Signed device-build artifacts are delivered to the user's iPhone, but are not sent to SEA & SEA LLC.

## Retention and Deletion

Pairing information, recent-session metadata, and app build history remain on the iPhone until the user deletes that history or removes the app. Archiving hides an app without deleting its history. Session records and signed IPA artifacts remain on the user's Mac until removed by the user. Device-build links expire automatically. The repository's security guide explains how to stop delivery, revoke exposed tokens, and remove stored records.

Because SEA & SEA LLC does not collect or retain Swift Sim user data on its servers, there is no developer-held account data to request or delete.

## Tracking and Advertising

Swift Sim does not track users, show advertising, or share app activity with data brokers or advertising networks.

## Changes

This policy may be updated as Swift Sim evolves. Material changes will be published in this repository with a revised effective date.

## Contact

Privacy questions can be sent to serram1994@gmail.com.

For security and token-revocation details, see [Security](SECURITY.md).
