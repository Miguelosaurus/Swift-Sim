# Development

This guide is for contributors. End users should install the tagged Homebrew release; do not present source checkout as a second user setup path.

## Local Checkout

Run:

```sh
npm ci
npm run build
npm run check
npm link
```

`npm link` exposes the same compiled `dist/` CLI shipped by Homebrew. Contributor testing must use Node.js 24.x and that command so setup behavior cannot drift from releases.

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

The [direct-install prototype](../mac-helper/optional/direct-install/README.md)
is an isolated contributor experiment for trusted-device installs over Tailscale.
It is not enabled in normal delivery. Its offline tests and pending physical
cellular/lock/reboot qualification are documented separately.

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

The Swift package pins a stable exact tag of the Swift Sim InjectionNext fork.
The compatibility contract binds that tag to the same immutable source revision
and signed engine archive. Do not substitute an unrelated upstream tag. Keep
the fork thin, qualify intentional updates and run
`npm run check:engine-publication` before a release default becomes public.
Client projects can use a published stable exact Swift Sim version; unpublished
qualification work uses explicit local sources without rewriting public tags.

For physical-device proof, use a regular development-signed Debug app on an iPhone connected through the private Tailnet. Require two consecutive `deliver-change` results with `outcome: hot-reloaded`, `applied: true`, `dynamic_replacements > 0`, `refresh_acknowledged: true`, and increasing nonzero revisions. Record patch duration, verify no rebuild or reinstall occurred between edits, and do not substitute screenshots for the runtime report.

The implementation contract for the repeatable classifier, physical-device, and real-workflow benchmark is in [Remote Hot Reload Benchmark Plan](internal/plans/HOT_RELOAD_BENCHMARK_PLAN.md). Keep its three scoreboards separate: a curated routing corpus cannot establish the percentage of chronological real-app edits accelerated.

Run the deterministic benchmark gates locally:

```sh
npm run benchmark:validate
npm run benchmark:static -- --output /tmp/swift-sim-static-benchmark
npm run benchmark:validate:liquid-glass
npm run benchmark:static:liquid-glass
```

The focused Liquid Glass matrix, availability boundary, and physical proof
status are documented in [Liquid Glass Hot Reload Coverage](evidence/LIQUID_GLASS_HOT_RELOAD.md).

The physical runner requires an explicitly named, unlocked trusted iPhone and
an automatic-signing override when the fixture project has no committed team:

```sh
npm run benchmark:device -- \
  --project benchmarks/fixtures/HotReloadBenchmarks.xcodeproj \
  --scheme CatalogApp \
  --device "<trusted-device-name>" \
  --build-setting DEVELOPMENT_TEAM=<your-team-id> \
  --smoke
```

It launches the signed Debug fixture through `xcrun devicectl`, captures the
machine-readable marker stream, and writes resumable `attempts.jsonl`,
`summary.json`, and `report.md`. A locked or disconnected phone is a failed
hardware gate; Simulator builds and static results never count as physical
device proof.

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

## Release Hygiene

Tagged releases use an explicit repository bundle instead of GitHub's regenerated source archive:

1. Update the package, companion, and plugin versions together; move the changelog entries out of `Unreleased`.
2. Run `npm run check`, `swift test`, the native companion `xcodebuild test`
   gate (including pairing-invitation coverage), the unsigned Simulator build,
   and both plugin validators.
3. Commit and push `main`, create the immutable `v<version>` tag, run `npm run build`, then build `swift-sim-<version>.tar.gz` with `scripts/release/create-archive.sh`. The release archive is assembled from the npm package whitelist so it contains emitted `dist/` runtime JavaScript rather than an unbuilt source checkout.
4. Publish that bundle and its SHA-256 file on the GitHub release.
5. Run `scripts/release/render-homebrew-formula.sh <version>` only after the assets are public. Commit the resulting formula to `Miguelosaurus/homebrew-tap` and verify a clean Homebrew install.
6. Run `swift-sim setup` so the installed Codex, Cursor, Claude Code, and OpenCode integrations match the tagged package.

Never replace an asset on an existing release. A changed artifact requires a new version and tag.

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

## Dependency pins

Node 24, TypeScript 5 and the existing Prettier version are deliberate toolchain
pins. Major upgrades need their own compatibility check. ESLint and its
TypeScript parser use scoped `minimatch` overrides to select the patched 11.0.5
release on Node 24; the shipped runtime dependencies do not use those overrides.
Check `npm audit` and lint/type checks before removing them. The optional
`serve-sim` adapter and package dependency must select the same version; qualify
actual Simulator frames before updating that pin.
