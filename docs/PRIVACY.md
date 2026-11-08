# Swift Sim Privacy Policy

Effective November 8, 2026

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

During QR pairing, the Mac prints a short-lived invitation that the iPhone
sends directly to the user's helper over private Tailscale. The helper returns
the durable pairing credential after verification; the temporary invitation is
not a Swift Sim cloud account or a Cloudflare delivery link.

When optional remote hot reload is enabled, project source remains on the Mac. The running development app receives a compiled code patch directly from the Mac over the user's private Tailscale network. The Debug developer menu can provide a scoped report, UI information or a screenshot when explicitly requested; Swift Sim does not automatically upload that context.

Optional App Testing uses a separately installed testing app and a time-limited session approved by the user. During an approved session, the selected agent can receive screen/UI observations and perform supported actions. This path is separate from ordinary builds, hot reload and notifications.

## Network and Third-Party Services

Simulator sessions connect directly to the user's Mac through the user's private Tailscale network. Tailscale processes that traffic according to its own terms and privacy policy.

For real-device installs, the Mac may start an account-free Cloudflare Quick Tunnel. The signed IPA, install manifest, build metadata, and network information pass through Cloudflare while the iPhone downloads the build. Swift Sim does not upload the IPA to storage operated by SEA & SEA LLC, and the temporary tunnel is stopped automatically. Cloudflare processes tunnel traffic according to its own terms and privacy policy.

The user's selected coding agent and bundled Swift Sim integration orchestrate builds and simulator sessions on the user's Mac. Supported hosts are Codex, Cursor, Claude Code, and OpenCode. Project source files remain on the Mac and Swift Sim does not upload them to SEA & SEA LLC. The selected coding agent may process code or requested Debug context under that provider's own policies. Signed device-build artifacts are delivered to the user's iPhone, but are not sent to SEA & SEA LLC.

The optional hot-reload lane uses Swift Sim's locally managed open-source engine on the Mac. Tailscale carries the compiled Debug patch to the user's iPhone. Swift Sim does not send that patch to SEA & SEA LLC or through its Cloudflare install tunnel.

## Optional Apple Notifications

The activity inbox works without Apple push credentials. When a matching push
sender is configured, the iPhone registers its APNs device token and notification
preferences with the paired Mac. The Mac stores that information privately and
sends bounded notification text and opaque event identifiers to Apple's APNs
service. Push payloads exclude source, signing keys, pairing credentials and
install capabilities. Apple processes that notification traffic under its own
service policies; notification permission, Focus and connectivity affect display.

The current public beta does not include a shared Swift Sim push relay. The
advanced local sender uses an owner-private signing key for the matching Apple
team. Configuration and keys remain on that owner's Mac. Users can disable
notifications or disconnect the paired Mac; prior APNs acceptance is not proof
of delivery or installation.

## Retention and Deletion

Pairing information, recent-session metadata, and app build history remain on the iPhone until the user deletes that history or removes the app. Archiving hides an app without deleting its history. Mac build history is separate from generated IPA and compiler-cache files. Device-build links expire automatically; owned delivery artifacts and obsolete compiler caches can be removed by bounded retention, while active work, recent/installed builds and required live baselines are protected. Deleting app history and reclaiming compiler files are distinct operations. Project source is not removed by this retention. The repository's security guide explains how to stop delivery, revoke exposed tokens, and remove stored records.

Because SEA & SEA LLC does not collect or retain Swift Sim user data on its servers, there is no developer-held account data to request or delete.

## Tracking and Advertising

Swift Sim does not track users, show advertising, or share app activity with data brokers or advertising networks.

## Changes

This policy may be updated as Swift Sim evolves. Material changes will be published in this repository with a revised effective date.

## Contact

Privacy questions can be sent to serram1994@gmail.com.

For security and token-revocation details, see [Security](SECURITY.md).
