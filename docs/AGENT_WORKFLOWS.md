# Agent Workflows

Swift Sim works with an agent that already runs on the user's Mac. It does not create another coding agent.

The agent edits the local project. Swift Sim provides the build, delivery, update routing, and optional Simulator workflow.

## Shared Contract

All supported agents use the same source instructions:

```text
plugins/swift-sim-companion/skills/remote-simulator-companion/SKILL.md
```

`swift-sim setup` installs the correct integration for each detected host. `swift-sim doctor --json` reports integration status under `deviceInstalls.agents`.

The normal rules are:

- Do not run Swift Sim for an ordinary coding task.
- Use Swift Sim when the user requests iPhone delivery, remote hot reload, or Simulator preview.
- Keep the agent session on the Mac that contains Xcode and the project.
- Run `swift-sim deliver-change` one time after a completed phone-loop edit.
- Let that command choose between a live Debug update and a signed build.
- Do not claim a live update without applied, refresh, and revision proof.
- Report **Install opened** until helper and device verification proves **Installed**.
- Do not expose paths, device identifiers, signing identities, private hostnames, ports, or tokens.

## Installation And Version Updates

Agent integrations are packaged copies. They do not update inside a running agent session.

Run:

```sh
swift-sim update
```

Then start a new agent session.

If `swift-sim doctor --json` reports version drift, update before using remote hot reload. The CLI, helper, and skill must use one contract.

## Supported Agents

### Codex

Setup registers the bundled marketplace and installs `swift-sim-companion@swift-sim`.

Continue the same Mac-hosted task from the ChatGPT or Codex mobile app. Xcode and Swift Sim remain on the Mac.

For Simulator work, Codex can use its Xcode and local preview tools before it returns the phone link.

### Cursor

Setup copies the packaged skill to:

```text
~/.cursor/skills/remote-simulator-companion/
```

Use Cursor Remote Control to continue the local Mac agent. Do not move the build to a cloud agent.

### Claude Code

Setup registers the bundled marketplace and installs `swift-sim-companion@swift-sim`.

Start a local remote-control session:

```sh
claude remote-control
```

You can also run `claude --remote-control`. Continue the session from the **Code** tab in the Claude mobile app.

### OpenCode

Setup copies the shared skill to:

```text
~/.config/opencode/skills/remote-simulator-companion/SKILL.md
```

OpenCode loads the skill on demand. Swift Sim stores a version marker so `doctor` can report drift.

## Build An App To iPhone

The user can ask:

```text
Build this app to my iPhone with Swift Sim
```

The normal command is:

```sh
swift-sim build-device \
  --project "<absolute project path>" \
  --scheme "<scheme>" \
  --allow-provisioning-updates
```

Use `--workspace` for an `.xcworkspace` project.

Before handoff, check the returned build state, app identity, signing compatibility, delivery mode, and HTTPS link. Then provide the link as **Open in Swift Sim to Install**.

Do not uninstall an existing app. Matching bundle identifier, team, and compatible entitlements preserve its app container.

When a project needs explicit Xcode settings, repeat `--build-setting`:

```sh
swift-sim build-device \
  --project "<absolute project path>" \
  --scheme "<scheme>" \
  --build-setting "PRODUCT_BUNDLE_IDENTIFIER=com.example.preview" \
  --build-setting "CURRENT_PROJECT_VERSION=42"
```

Use uppercase Xcode setting names. Quote the complete `KEY=VALUE` argument.

## Deliver A Completed Phone-Loop Edit

After one logical Swift edit, run:

```sh
swift-sim deliver-change \
  --before "<previous.swift>" \
  --after "<current.swift>" \
  --project "<App.xcodeproj>" \
  --scheme "<App>" \
  --allow-provisioning-updates
```

For a multi-file edit, repeat matching `--before` and `--after` arguments in the same order.

The command owns:

- change classification
- warm live readiness
- one bounded recovery attempt
- runtime proof
- signed-build fallback

Interpret the terminal outcome:

| Outcome | Agent response |
| --- | --- |
| `hot-reloaded` | Tell the user to test the running Debug app. No install is required. |
| `install-link-ready` | Say that the change needs a new signed build. Provide **Open in Swift Sim to Install**. |
| `no-change` | Do not report a delivery result. |
| `needs-user-action` | Explain only the returned action. |
| `failed` | Report the returned failure without claiming delivery. |

Do not run `doctor`, `live-status`, screenshots, UI analysis, or a second classification command before a normal warm delivery.

A compiled patch or loaded dynamic library is not proof. A live success requires the correlated applied replacement, refresh acknowledgement, and new root revision.

Structural, mixed, non-Swift, unavailable, and unproven edits must use a signed build. Partial application is not success.

See [Hot Reload Evidence](evidence/README.md) for tested mechanism boundaries.

## Pair A Mac

Run:

```sh
swift-sim setup-status
```

Continue only when the report contains `ok: true`.

Use `swift-sim pair --qr` for the interactive QR flow. Use `swift-sim pair` for machine-readable links.

QR invitations are short-lived and one-time. The companion must verify the helper before it saves the durable pairing credential.

## Open A Live Simulator Preview

Use this lane only when the user asks for Simulator preview.

1. Check `swift-sim setup-status`.
2. Build and launch one exact Simulator.
3. Verify the local app with available host tools.
4. Start Swift Sim with the same Simulator UDID.
5. Return **Open Simulator in Companion App**.

Do not expose the Simulator UDID, local path, port, process ID, or token.

## Release Synchronization

One tagged Homebrew release contains the CLI, helper, shared skill, native plugin manifests, and OpenCode installer.

Setup installs these components from that package. This keeps agent behavior aligned with the helper protocol.

See [Development](DEVELOPMENT.md) for release validation and [Security](SECURITY.md) for transport boundaries.
