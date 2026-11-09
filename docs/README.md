# Swift Sim Documentation

Use this page to find the correct document for your task.

## Get Started

- [Setup](SETUP.md): install Swift Sim, prepare signing, and build the first app
- [App library](APP_LIBRARY.md): icons, build status and concise version history
- [Developer tools](DEVELOPER_MENU.md): Debug menu and agent context on demand
- [Optional app testing](APP_CONTROL.md): scoped phone UI commands with a separate runner
- [Asynchronous Hot Reload](ASYNC_HOT_RELOAD.md): queue requests, reconnect, capability requirements and iOS limits
- [Agent Workflows](AGENT_WORKFLOWS.md): use Swift Sim with Codex, Cursor, Claude Code, or OpenCode
- [Troubleshooting](TROUBLESHOOTING.md): recover from a reported problem

## Understand The System

- [Architecture](ARCHITECTURE.md): components, transport paths, APIs, and stored data
- [Security](SECURITY.md): trust boundaries, tokens, signing, and network exposure
- [Privacy](PRIVACY.md): data handled by the iPhone app and third-party services

- [Get help from your agent](GETTING_HELP.md): copy a problem and its context without retyping it.

## Contribute And Release

- [Development](DEVELOPMENT.md): build, test, and validate a source checkout
- [TestFlight](TESTFLIGHT.md): beta description, test plan, and review notes
- [Releasing](RELEASING.md): coordinated versions, qualification and publication gates
- [Contributing](../CONTRIBUTING.md): contribution requirements and pull-request expectations
- [Changelog](../CHANGELOG.md): notable changes by release

## Engineering Evidence

[Hot Reload Evidence](evidence/README.md) contains physical-device results and mechanism boundaries. These documents support product claims. They are not setup guides.

## Internal Records

[Internal Documentation](internal/README.md) contains implementation plans and completed review records. End users do not need these documents.

## Writing Rules

Public procedures use a controlled, direct style:

- Give one action in each step.
- Put the condition before the action.
- Use the exact command, UI label, result, and state name.
- State the expected result after a command.
- Use the same term for the same feature in every document.
- Keep implementation details out of task instructions unless they affect safety or recovery.
- Do not report **Installed** until helper and device verification proves the exact version.

Code identifiers, commands, API routes, Apple terms, and product names are technical terms. Do not simplify or rename them.

- [Activity and notifications](NOTIFICATIONS.md): inbox, optional push, app handoff and remote launch history.

- [Ordinary Xcode builds](XCODE_BUILD_IMPORT.md): bounded metadata import, exact install evidence, and explicit exports.
