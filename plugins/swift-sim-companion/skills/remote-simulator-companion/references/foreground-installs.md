# Foreground install requests

Use only when the user wants a signed update delivered directly to the integrated
Debug app. This is optional; do not activate App Testing, poll every save, or add
another agent/process. Ordinary coding and hot reload stay unchanged.

Build once through the normal signed-build workflow, preserving bundle, team,
entitlements and app data. For cellular delivery with Tailscale, reuse the paired
Mac's existing private HTTPS delivery origin with `build-device --remote-base-url`.
Do not publish the live port, add a service, or change unrelated Tailscale routes.
Keep bearer URLs/tokens out of chat. If a safe existing origin is unavailable,
use the normal install-link fallback; never invent one.

From the matching project, submit the ready build once:

```sh
swift-sim request-install --build-id <saved-build-id>
```

Outside the project, supply `--project` or `--workspace` and `--scheme`. The helper
requires a signed, unexpired build and a matching SDK/engine. It uses the connected
Debug binary, or the latest verified launch history for this project, scheme,
team and bundle. A new compiler capture is not proof of the installed version.
If history is missing or ambiguous, follow the returned action to open the Debug
app once; do not reinstall, guess a binary, or fabricate a receipt.

`waiting` means queued, not delivered. Tell the user: “Queued. Unlock your iPhone
and return to the app to see the install prompt.” The existing connection wakes
it when that exact Debug app is foregrounded and ready. No particular screen is
required. Unlock alone, an offline phone, a stopped Mac or an expired request
cannot guarantee the prompt. The request expires with delivery or after two
hours, whichever comes first; do not renew it automatically.

The user confirms Apple's Install prompt and, if asked, Download on cellular.
No link navigation or App Testing session is needed. Do not use automation to
press those prompts. This is not a silent install or an automatic app launch.
After installation, ask the user to reopen the app only when needed to verify
the exact running build through normal installed/launch evidence.

Read progress or cancel waiting work without sending again:

```sh
swift-sim request-install --build-id <saved-build-id> --status
swift-sim request-install --build-id <saved-build-id> --cancel
```

Repeating the original command returns the original receipt. `opening` or
`unconfirmed` may mean the handoff occurred: inspect, do not replay or delete
its fence. `prompt-requested` means iOS accepted the URL, not that a prompt was
seen or the app installed. Keep `Installed` reserved for the normal exact-build
verification. Cancellation cannot retract a prompt already handed to iOS.

The queue reuses the existing bounded engine journal and foreground/reconnect
events. No new phone runtime, watcher or notification polling is needed. Current
qualification is cellular delivery with native confirmation; do not promise
silent Xcode-like cellular installation. Apple's managed-app distribution offers
silent paths, but device management is outside this optional Debug workflow.
