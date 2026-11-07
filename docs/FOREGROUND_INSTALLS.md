# Foreground install requests (experimental)

An agent can ask an integrated Debug app to show Apple's installation prompt for
its next signed build. The user confirms Install and, if iOS asks, Download over
cellular. No App Testing session, accessibility action, screen capture, copied
link, or navigation through Swift Sim is required for this handoff.

This path needs the matching updated iOS Debug SDK and local engine. It is opt-in;
normal `deliver-change`, builds, hot reload and notifications are unchanged.
Physical cellular qualification of this new SDK path is still pending. Earlier
cellular installs used the testing runner and do not prove this path.

## Agent workflow

Build normally, then use that ready build's ID from the matching project:

```sh
swift-sim request-install --build-id <build-id>
swift-sim request-install --build-id <build-id> --status
swift-sim request-install --build-id <build-id> --cancel
```

For a caller outside the project, provide its `--project` or `--workspace` and
optionally `--scheme`. The command reads the authority-selected build store,
checks signing/delivery readiness and project scope, hashes the local IPA, and
revalidates the saved record before submission. It never starts a build, renews
an expired link, enrolls a device, or uninstalls an app.

The request targets the same bundle and exact currently installed Debug binary.
When connected, it uses the engine's current identity; otherwise it can use the
existing private compilation capture. A capture for a newly built, not yet
installed binary cannot target the old binary: open the installed Debug app once
so the engine can select it. Ambiguous matching clients are left waiting.

The existing connection's identity/foreground and hot-reload completion events
wake a bounded queue in the existing engine. Background, locked, unavailable or
busy apps remain waiting. Returning to the matching app can continue the request
until its original delivery expiry (at most two hours). Unlocking alone does not
promise foregrounding, a working connection, or an installer prompt.

## Results and retries

- `waiting`: no install handoff has been attempted.
- `opening`: a durable fence was saved before the one permitted handoff.
- `prompt-requested`: `UIApplication.open` accepted the handoff. This does not
  prove that a prompt appeared, that the user confirmed, or that installation
  finished.
- `unconfirmed`: the reply was lost or the engine restarted around handoff.
  Inspect the phone; this request will not replay automatically.
- `rejected`, `cancelled`, `expired`: terminal without an installation claim.

Repeating the command reads the existing build-ID receipt. It cannot renew or
resubmit that request. Cancel affects waiting work; it cannot withdraw an iOS
prompt already handed off. Normal installed-build/launch verification remains
separate. This prototype does not automatically open the replacement app.

The private journal retains at most 32 requests and bounded tombstones beyond
link expiry. It contains the temporary install capability and stays local with
owner-only permissions. There is no new timer, socket, watcher or helper process.
The phone reuses its developer-tool ledger; Release SDK objects exclude this
runtime. This is an OTA handoff through the existing Debug connection, not a new
native cellular InstallationProxy transport or a system-wide install facility.
