# Swift Sim Privacy Policy

Effective June 18, 2026

Swift Sim is a self-hosted companion for viewing and controlling an iOS Simulator running on a Mac owned by the user. SEA & SEA LLC does not operate a Swift Sim account service, analytics service, advertising service, or cloud relay, and does not collect personal data through the Swift Sim iPhone app.

## Data the App Handles

The app handles the following data only to provide its core functionality:

- the private Mac helper address chosen by the user
- opaque pairing and simulator-session tokens
- recent session names and connection metadata
- simulator video frames, controls, and logs exchanged directly with the user's Mac

The app stores pairing information and recent sessions locally on the iPhone. Simulator frames and logs are displayed in the app and are not uploaded to SEA & SEA LLC.

## Network and Third-Party Services

Swift Sim connects directly to the user's Mac through the user's private Tailscale network. Tailscale processes network traffic according to its own terms and privacy policy. The Swift Sim helper listens locally on the Mac and the supported remote path uses private Tailscale HTTPS; Swift Sim does not use a developer-operated relay.

The Codex desktop app and the bundled Swift Sim companion plugin orchestrate builds and simulator sessions on the user's Mac. Project source code and build products remain on the Mac and are not sent to the Swift Sim iPhone app or SEA & SEA LLC.

## Retention and Deletion

Pairing information and recent-session metadata remain on the iPhone until the user forgets the Mac helper, removes recent sessions, or deletes the app. Session records remain on the user's Mac until removed by the user. The repository's security guide explains how to revoke exposed tokens and remove stored session records.

Because SEA & SEA LLC does not collect or retain Swift Sim user data on its servers, there is no developer-held account data to request or delete.

## Tracking and Advertising

Swift Sim does not track users, show advertising, or share app activity with data brokers or advertising networks.

## Changes

This policy may be updated as Swift Sim evolves. Material changes will be published in this repository with a revised effective date.

## Contact

Privacy questions can be sent to serram1994@gmail.com.

For security and token-revocation details, see [Security](SECURITY.md).
