# Contributing to Swift Sim

Thanks for helping improve Swift Sim. The project spans a Node.js Mac helper, a native SwiftUI companion, agent integrations, and release packaging. Changes should keep those pieces version-matched and preserve the local-first security model.

## Before You Start

- Search existing issues before opening a new one.
- Open a feature request before implementing behavior that would change the trust model, supported agents, or delivery architecture.
- Report security problems privately using [SECURITY.md](SECURITY.md), not a public issue.

## Local Setup

You need an Apple silicon Mac, Xcode, Node.js 20 or newer, and Homebrew.

```sh
npm ci
npm run check
npm link
```

Build and test the iPhone companion:

```sh
xcodebuild test \
  -project Companion/SwiftSimCompanion.xcodeproj \
  -scheme SwiftSimCompanion \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=latest' \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO
```

See [Development](docs/DEVELOPMENT.md) for device builds, integration validation, and manual end-to-end checks.

## Pull Requests

Keep each pull request focused and explain the user-visible result. Include:

- the problem being solved;
- screenshots or a short recording for UI changes;
- tests added or updated;
- the exact validation commands you ran;
- any security, privacy, signing, or compatibility impact.

Do not include real device identifiers, Apple Team IDs, signing identities, private hostnames, install links, tokens, or absolute home-directory paths in code, screenshots, logs, or fixtures.

## Project Rules

- The selected coding agent remains the only agent. Swift Sim must not spawn another one.
- Project builds and signing remain on the user's Mac.
- iPhone installs must not require Tailscale.
- Simulator controls stay private to the user's Tailnet.
- Matching app updates should preserve app data; never uninstall first.
- Helper, CLI, skill, plugin manifests, documentation, and release metadata must describe the same behavior.
- User-facing copy should be direct, calm, and understandable without internal implementation terms.

By contributing, you agree that your contribution is licensed under the repository's [Apache License 2.0](LICENSE).
