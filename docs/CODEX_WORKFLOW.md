# Codex Workflow

Codex is the only coding agent. Swift Sim contributes an installable plugin and a local helper; it does not create another agent or execute project source on the iPhone.

## Installation

Normal users install everything through:

```sh
brew install miguelosaurus/tap/swift-sim
swift-sim setup
```

`swift-sim setup` starts the Homebrew service and installs `swift-sim-companion` from the marketplace bundled in the same Homebrew package. Users should not clone the repository or manually copy the skill.

The executable plugin instructions live in:

```text
plugins/swift-sim-companion/skills/remote-simulator-companion/SKILL.md
```

## First Request In A Thread

Codex begins with:

```sh
command -v swift-sim
swift-sim doctor --json
```

If the command is missing, Codex offers to install Swift Sim through Homebrew and runs `swift-sim setup`. Otherwise, it fixes only the item reported as needing attention.

The doctor report deliberately separates:

- `deviceInstalls`: primary workflow; does not require Tailscale
- `simulatorPreview`: optional workflow; requires private Tailscale access

Codex must not block an iPhone build because optional Simulator setup is incomplete.

## Choose The Lane

### Build To iPhone (Default)

Use this lane for:

- install or update on my phone
- test on my iPhone
- camera, Bluetooth, push, HealthKit, widgets, or other device APIs
- a durable testing session without a streamed Simulator

If the user asks only to test on their phone, prefer this lane.

Run:

```sh
swift-sim build-device \
  --project "<absolute project path>" \
  --scheme "<scheme>" \
  --allow-provisioning-updates
```

Use `--workspace` instead of `--project` for an `.xcworkspace` app.

Codex verifies:

- `state` is `ready`
- `signing.deviceInstallable` is true
- `delivery.mode` is `quick-tunnel`
- `signing.updateSafe` is compatible with an in-place update
- the returned link uses HTTPS

Then end with:

```md
[Install on iPhone](https://random-words.trycloudflare.com/d/opaque-build?token=opaque-token)
```

The link is secret, works without Tailscale, and lasts two hours by default.

Never uninstall first. The same bundle identifier, team, and compatible entitlements preserve the existing app container. Warn before proceeding when any of those values changed.

Every successful build is registered under a stable app identity derived from the bundle identifier and signing team. Codex can inspect the organized history with:

```sh
swift-sim list-apps
```

When the user asks whether a build is actually present on a reachable iPhone, run:

```sh
swift-sim verify-device-build --build-id "<opaque-build-id>"
```

Report `verified`, `not-installed`, or `unknown` exactly. Do not treat opening an install link as proof of completion. The companion records that step as `requested` until Apple developer tooling verifies it.

Library maintenance is app-scoped:

```sh
swift-sim archive-app --app-id "<opaque-app-id>"
swift-sim archive-app --app-id "<opaque-app-id>" --restore
swift-sim delete-app --app-id "<opaque-app-id>"
```

Archiving preserves history and artifacts. Deleting removes local Swift Sim history and artifacts; it does not uninstall the app from an iPhone.

### Live Simulator Preview (Optional)

Use this lane only when the user asks for a live Simulator, quick UI preview, Simulator logs, or the Codex sidebar mirror.

1. Run `swift-sim setup-status` and require the optional Simulator section to be healthy.
2. Select one project/workspace, scheme, and Simulator UDID.
3. Build and launch with XcodeBuildMCP when available.
4. Verify the UI through a screenshot or UI description.
5. Start the same Simulator session:

   ```sh
   swift-sim start-session \
     --project "<absolute project path>" \
     --scheme "<scheme>" \
     --simulator "<simulator UDID>" \
     --remote-base-url "<Tailscale Serve URL>" \
     --transport auto
   ```

6. Open `codex.localPreviewUrl` in the Codex sidebar and confirm it renders.
7. End with **Open Simulator in Companion App** using `links.universalLink`.

Keep `links.customScheme` as the fallback for private Tailnet hosts. Never expose local ports, Simulator UDIDs, project paths, stream URLs, or process IDs in the user-facing response.

## Setup Recovery

Use the structured doctor output instead of guessing:

- missing CLI: install Homebrew package and run `swift-sim setup`
- helper unavailable: rerun `swift-sim setup`, then inspect `~/.swift-sim/helper.log`
- plugin unavailable: rerun `swift-sim setup`; start a new Codex thread after installation
- signing failure: report the exact Xcode error and relevant team, device, App ID, capability, or profile fix
- Simulator preview unavailable: configure Tailscale only when the user requested that lane
- dead install link: build again; do not redirect device installs through Tailscale

Treat all pairing, session, and device-build links as secrets. Never paste live values into commits, issues, pull requests, or documentation.

## Release Synchronization

The Homebrew formula points at one immutable GitHub tag containing the CLI, helper, and local Codex marketplace. `swift-sim setup` registers that bundled marketplace through Homebrew's stable installation path, so the plugin and helper move together.

Contributor setup is documented separately in [Development](DEVELOPMENT.md). It must exercise the same `swift-sim` CLI rather than introduce alternate helper behavior.
