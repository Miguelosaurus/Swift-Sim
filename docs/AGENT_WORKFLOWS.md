# Agent Workflows

Swift Sim does not add another AI agent. It gives an existing local coding agent a version-matched skill plus a local CLI for Xcode builds, signed iPhone installs, app history, and optional Simulator sessions.

## Shared Contract

Every supported agent uses the same instructions:

```text
plugins/swift-sim-companion/skills/remote-simulator-companion/SKILL.md
```

The repository distributes that skill through four host integrations:

- Codex plugin: `.codex-plugin/plugin.json`
- Cursor plugin: `.cursor-plugin/plugin.json`
- Claude Code plugin: `.claude-plugin/plugin.json`
- OpenCode global skill: `~/.config/opencode/skills/remote-simulator-companion/SKILL.md`

`swift-sim setup` installs the appropriate integration for every supported agent detected on the Mac. `swift-sim doctor --json` reports each integration under `deviceInstalls.agents` and considers the build lane ready when at least one is configured.

## Codex

Codex uses the marketplace bundled in the Homebrew package. Setup registers that immutable package path and installs `swift-sim-companion@swift-sim`.

For Simulator work, Codex should build and verify with XcodeBuildMCP, start Swift Sim with the same Simulator UDID, and inspect `codex.localPreviewUrl` in the Codex sidebar before returning the phone link.

The ChatGPT/Codex mobile app continues the same Mac-hosted session, so Xcode and Swift Sim stay local.

## Cursor

Setup copies the packaged skill into the supported user skill directory:

```text
~/.cursor/skills/remote-simulator-companion/
```

A copy is used instead of a symlink for reliable Cursor desktop, CLI, automation, and remote-session discovery. Each `swift-sim setup` or `swift-sim update` replaces only this Swift Sim-owned directory with the version from Homebrew.

The repository also includes the native Cursor manifest. Public installation still uses `swift-sim setup`, keeping Cursor on the exact skill version shipped with the helper rather than creating a second version source.

Use Cursor Remote Control to continue an agent that is running on the Mac. Do not send the build to a cloud agent: a cloud VM cannot use the Mac's Xcode credentials or local helper.

## Claude Code

Setup uses Claude Code's native non-interactive plugin commands to register the bundled `swift-sim` marketplace at user scope and install `swift-sim-companion@swift-sim`.

Start the local mobile-capable session with:

```sh
claude remote-control
```

or:

```sh
claude --remote-control
```

Then continue it from the **Code** tab in the Claude mobile app. The agent, filesystem, Xcode tools, and Swift Sim helper remain on the Mac.

## OpenCode

Setup follows OpenCode's native agent-skill discovery contract and copies the shared skill to:

```text
~/.config/opencode/skills/remote-simulator-companion/SKILL.md
```

OpenCode loads global skills on demand through its `skill` tool. Swift Sim writes a version marker beside the skill so `swift-sim doctor` can detect drift and `swift-sim update` can refresh it. OpenCode has no required Swift Sim account or backend; users may connect to the local Mac session through whatever remote or mobile surface they already operate.

## First Request

The agent begins with:

```sh
command -v swift-sim
swift-sim doctor --json
```

If the CLI is missing, install it through Homebrew and run `swift-sim setup`. Otherwise fix only the item marked `needs-attention`.

The doctor report separates:

- `deviceInstalls`: primary real-iPhone workflow; no Tailscale requirement
- `simulatorPreview`: optional live Simulator workflow; private Tailscale requirement

## Build To iPhone

The default command is:

```sh
swift-sim build-device \
  --project "<absolute project path>" \
  --scheme "<scheme>" \
  --allow-provisioning-updates
```

Use `--workspace` for `.xcworkspace` projects. The agent verifies `state`, signing compatibility, delivery mode, and the returned HTTPS URL, then ends with **Open in Swift Sim to Install**. The HTTPS page opens the companion first; direct OTA installation is visibly presented only as the no-companion fallback.

Never uninstall first. Matching bundle identifier, team, and compatible entitlements preserve the existing app container.

## Live Simulator Preview

Use this lane only when requested:

1. Check `swift-sim setup-status`.
2. Build and launch one exact Simulator.
3. Verify the local UI using host-available tools.
4. Start Swift Sim with that Simulator UDID.
5. End with **Open Simulator in Companion App**.

Do not expose local paths, ports, Simulator UDIDs, process IDs, or unredacted tokens in the response.

## Release Synchronization

One tagged Homebrew release contains the helper, shared skill, three native plugin manifests, and OpenCode installer. Setup always installs from that package, so agent behavior moves with the CLI instead of drifting across copied documentation.
