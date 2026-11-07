# Foreground install requests (experimental)

An agent can ask an integrated Debug app to show Apple's installation prompt for
its next signed build. The user confirms Install and, if iOS asks, Download over
cellular. No App Testing session, accessibility action, screen capture, copied
link, or navigation through Swift Sim is required for this handoff.

This path needs the matching updated iOS Debug SDK and local engine. It is opt-in;
normal `deliver-change`, builds, hot reload and notifications are unchanged.
The SDK path is physically qualified for Zenics Debug44 →46 on owner-confirmed
cellular, with native binary identity and the normal installed-and-launched
receipt. Debug46 →47 additionally qualified queueing while locked/disconnected
on cellular, followed by the prompt on returning to Zenics and an exact Debug47
launch receipt. The owner confirmed data/settings survived the earlier install.
This is a
foreground handoff with manual iOS confirmation, not unattended installation.

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

For the qualified cellular path, create the build using the existing paired
Mac's private HTTPS delivery origin (`build-device --remote-base-url <origin>`).
Reuse its configured Tailscale HTTPS route; do not add a listener or alter
unrelated routing. The public quick-tunnel handoff showed the prompt but its
install failed during qualification; the same workflow succeeded over the
private route. That is not proof that every public-tunnel install fails.

The request targets the same bundle and exact currently installed Debug binary.
When connected, it uses the engine's current identity. Otherwise it lazily reads
the existing helper-owned launch history for this project, scheme, signing team
and bundle. The latest unambiguous confirmed Debug binary becomes a future exact-
match selector, even after building the update replaces the compilation capture.
History does not prove current reachability or authorize a different binary.
Missing or ambiguous history requires opening the installed app once. A compiler
capture alone never proves installation. Ambiguous matching clients remain waiting.

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

## Can the iOS prompt be removed?

Research checked 2026-11-07: no supported prompt-suppression option was found for
this Debug OTA handoff. UIApplication.open hands a URL to the system; its success
callback is not an install receipt. Ordinary developer pairing does not give a
sandboxed Debug app the management authority to install another build silently.

Apple documents silent initial managed-app installs on supervised devices.
Unsupervised devices require initial installation or management approval;
updates to already-managed apps can be silent, with a foreground-app exception.
Declarative managed updates can occur while the device is locked. These are
management workflows, not a small switch on the current developer-paired path.
Eligibility of our development-signed artifacts in such a workflow has not been
qualified. No enrollment, supervision, management profile or private bypass is
part of this feature. Keep the native confirmation for the lean personal-device
workflow; revisit management only as an explicit separate product decision.

Sources: [Apple managed-app distribution](https://support.apple.com/guide/deployment/distribute-managed-apps-dep575bfed86/web),
[UIApplication.open](https://developer.apple.com/documentation/uikit/uiapplication/open(_:options:completionhandler:)).
