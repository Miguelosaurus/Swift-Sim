# Development

This guide is for contributors. End users should install the tagged Homebrew release; do not present source checkout as a second user setup path.

## Local Checkout

Run:

```sh
npm ci
npm run check
npm link
```

`npm link` exposes the same `swift-sim` CLI shipped by Homebrew. Contributor testing must use that command so setup behavior cannot drift from releases.

## Build The iOS Companion For Simulator

```sh
xcodebuild \
  -project Companion/SwiftSimCompanion.xcodeproj \
  -scheme SwiftSimCompanion \
  -sdk iphonesimulator \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## Build The iOS Companion For A Device

```sh
DEVELOPMENT_TEAM=YOUR_TEAM_ID \
PRODUCT_BUNDLE_IDENTIFIER=com.yourname.SwiftSimCompanion \
./scripts/ios/run-on-device.sh
```

The script detects one connected iPhone by default. Set `DEVICE_UDID` when multiple devices are available.

## Validate The Agent Integrations

The shared plugin source is `plugins/swift-sim-companion`. It contains Codex, Cursor, and Claude Code manifests around one skill folder; OpenCode consumes that same skill through its global skills directory. After changing the skill:

1. Validate the skill frontmatter.
2. Validate all three plugin manifests, all marketplace manifests, and OpenCode discovery.
3. Update every explicit plugin version together.
4. Run `swift-sim setup` to refresh detected local hosts.
5. Start a new agent session so the new skill text is loaded.

Validate the optional live runtime and change router:

```sh
swift test
node --test test/liveReload.test.js
swift-sim classify-change --before /tmp/before.swift --after /tmp/after.swift
```

The Swift package pins InjectionNext by commit for reproducibility. Update that revision intentionally and rerun both Swift and Node test suites. The Node classifier must remain conservative: false rebuilds cost time, but a false live-safe result can destabilize the running process.

## Manual Session Test

1. Build and launch an app on a booted simulator.
2. Run `swift-sim setup-status` and copy `suggestedRemoteBaseUrl`.
3. Run `swift-sim start-session` with that simulator's UDID.
4. Open `codex.localPreviewUrl` locally.
5. Open the companion link on an iPhone over cellular.
6. Test tap, drag, keyboard, Home, rotation, logs, app backgrounding, and reconnect.
7. Leave the stream active beyond one minute, then mutate the simulator UI and confirm the phone updates.

## Manual Device Build Test

1. Configure automatic development signing for a disposable iOS app.
2. Run `swift-sim build-device --project <path> --scheme <scheme> --allow-provisioning-updates` without a remote URL.
3. Confirm `state` is `ready`, `delivery.mode` is `quick-tunnel`, and the link uses `https://*.trycloudflare.com`.
4. Open the link on an iPhone with Tailscale disconnected and install the app.
5. Save recognizable app data, increment the build number without changing bundle ID/team/entitlements, then install the update.
6. Confirm the UI changed and the saved data remained.
7. Confirm a public request to `/api/pairing/status` or `/api/sessions/...` returns `404`.
8. Confirm the returned delivery expiry is two hours after creation, or matches an explicit `--ttl-minutes` override.

For a checkout with placeholder project settings, pass repeated `--build-setting KEY=VALUE` options to the device build. The helper applies them while reading signing metadata and archiving; validate the returned bundle identifier, team, and build number before installing.

## Repository Hygiene

Do not commit:

- personal Apple Team IDs
- signing certificate names
- physical device UDIDs
- private Tailscale hostnames or Tailnet names
- real pairing or session tokens
- absolute user home paths
- `.build` products
- `~/.swift-sim` state or logs

Use placeholders in documentation and examples.

## Documentation And Community Files

Run the documentation check directly with:

```sh
npm run check:docs
```

It verifies relative links across the root guides and `docs/`. `npm run check` includes the same validation in CI.

When behavior changes:

- update the user guide, shared agent skill, and helper output together;
- add a short entry under `Unreleased` in [CHANGELOG.md](../CHANGELOG.md);
- keep screenshots and examples free of real links, tokens, identifiers, and hostnames;
- update issue or pull-request guidance when contributor expectations change.

## Scope Rules

- Keep the selected host as the only coding agent; Swift Sim must not spawn another one.
- Keep project execution on the Mac Simulator.
- Keep the helper bound to localhost by default.
- Expose only the read-only device-build gateway through the managed temporary public tunnel.
- Keep `serve-sim` behind the adapter and transport boundaries.
- Stop only the tracked simulator stream.
- Preserve the custom URL scheme as the reliable private-host fallback.
- Treat WebRTC as a measured future upgrade, not an automatic rewrite.

## Pull Requests

Keep changes focused. Include the commands used to verify helper tests, simulator builds, and any affected remote-session behavior. Redact links and local machine details from screenshots and logs.
