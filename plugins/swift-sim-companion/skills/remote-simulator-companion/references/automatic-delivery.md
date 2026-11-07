# Automatic phone delivery

When the user says they want to test the app on their phone, treat phone delivery
as part of completing subsequent changes for that same app in the current thread.
Carry that preference and project/scheme through handoffs. Do not create a global
preference, watcher, second agent, screenshot loop or background testing session.
Explicit code-only/no-phone instructions override it. A new project or ambiguous
target needs a fresh binding; never deliver unrelated work to the previous app.

Use `deliver-change` once per completed logical change. Its default signed-build
fallback uses Debug and automatic installation. `--configuration` remains explicit
when a different build is requested. `--install link` requests only the traditional
link handoff. Existing hot reload admission, state retention and receipt checks
remain authoritative; an absent app never turns a compatible edit into a rebuild.

For a required build, the command prefers the existing paired Mac's private HTTPS
origin when available. It first tries native Xcode installation to a unique
reachable, developer-paired physical iPhone covered by the signed profile. Device
identity and actual developer connectivity select this route, not Wi-Fi names.
Multiple eligible phones are not guessed; `--device` can select an established
target. No new pairing, runner, private phone API, Rust build or dependency is
required. A native install can work over a usable Wi-Fi/USB developer connection;
fresh cellular developer transport remains unqualified.

Automatic builds hold delivery if project inputs change during compilation.
Resolve the concurrent work before preparing another delivery; do not force an
install of that mixed build.

If native installation is unavailable before submission, the helper queues the
existing foreground install request. The user unlocks and returns to the app,
then confirms Install/Download. If its SDK/engine is unavailable, a normal saved
install link may be the fallback. Never invoke app-control to confirm a prompt.

`installed` confirms requested version/build inventory (or a saved launch receipt
in status), not an exact device-side binary hash or successful app launch.
`install-queued` means wait and return to the app. `install-prompt-requested` means
confirm on the phone, not installed. `install-unconfirmed` requires inspection;
never repeat delivery or switch routes after possible submission. The helper's
native per-app journal is private, locked and bounded. A lost native reply is
reconciled through scoped inventory, with no second installation command.
An uncertain native handoff retains its private staging material and blocks
another build until that operation can be inspected safely; a version observation
alone does not authorize deleting possibly active install inputs.

Save the returned `delivery.requestId` (the saved build ID). Read progress without
building or resubmitting:

```sh
swift-sim build-delivery-status --build-id <id> --project <App.xcodeproj> --scheme <App>
```

Use `--workspace` when applicable. For live requests, keep using
`live-delivery-status --request <id>`. These reuse the respective existing build
and live operation identities; there is no new queue or daemon. The separate
[foreground-install reference](foreground-installs.md) covers queue cancellation,
expiry and iOS restrictions. Ordinary notifications and hot reload never import
the native installer adapter.
