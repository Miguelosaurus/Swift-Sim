# App control: bounded implementation spike

The coding agent tests its changes in the running app before asking the developer
to try them. This is an optional development workflow, outside the architecture
consolidation program.

## Constraints

- One day of work, using a stock framework. No fork or custom input driver.
- The subsequently authorized stock WebDriverAgent alternative has a one-hour
  qualification limit and must add nothing to the existing apps.
- Wireless physical iPhone control is a release gate. A Simulator pass or a USB
  pass cannot satisfy it. Wait for explicit phone availability before device work.
- The user clarified that **different-network access is mandatory**, consistent
  with Swift Sim's remote purpose. A same-Wi-Fi pass is preliminary evidence,
  not completion. Qualify remote runner startup, input, and restart while the
  phone is already on a different network; also distinguish a previously
  running runner surviving a network change from remote cold-start support.
- Use the existing coding agent through a CLI. Add no model, AI service, agent,
  or harness-specific dependency.
- Keep automation out of the Debug SDK and the companion. Add no polling to hot
  reload, notifications, ordinary chats, or helper startup.
- Request screen state only during an explicit app-testing task. Keep evidence
  on the Mac. No cloud device provider, uploads, or default video recording.
- Reuse the provider's actions, sessions, errors, and cleanup. Do not create a
  flow language, scheduler, recorder, persistent Swift Sim broker, or new daemon.

## Candidate and current checkpoint

Evaluate Callstack's MIT-licensed `agent-device` 0.21.36, installed separately
from Swift Sim. Its stock CLI and Node API support native iOS apps without an
app library. The evaluation uses the public Node API with private, task-scoped
state and the provider's own XCTest runner.

The [Simulator report](../../evidence/APP_CONTROL_SIMULATOR_2026_11_02.md)
records the current qualification. The only code added at this checkpoint is a
development script; no production command or agent-skill promise is published.

The subsequent [physical wireless trial](../../evidence/APP_CONTROL_WIRELESS_2026_11_02.md)
failed the input gate on the stock release. App opening and semantic screen
reads worked; the tap lost its transport response and its effect was not
observed. The temporary runner was stopped and removed. **The agent-device lane
is stopped at the evidence checkpoint.** Its physical-device integration is not
approved for shipping; resume that provider only after a stock fix or documented
configuration addresses the failure.

The user then authorized a separate one-hour stock **WebDriverAgent** experiment.
That [same-Wi-Fi physical trial passed](../../evidence/WDA_WIRELESS_2026_11_02.md),
including native input in the companion, a reversible Zenics UI change, a full
runner restart, repeated input, and verified cleanup. No provider source or
app/SDK code changed. WDA is a viable candidate for a thin Mac-only integration;
the production command, access boundary, cross-network support, and full
hot reload edit/test loop remain unqualified.

The [November 3 cellular cold-start check](../../evidence/WDA_CELLULAR_2026_11_03.md)
failed at Apple developer-device discovery despite successful tailnet pings.
The user corrected the first attempt's phone state, so it was treated as
inconclusive; a fresh requested awake-cellular retry produced the same discovery
failure. No runner installed or started. A proposed warm-runner handoff check
was cancelled because the user was away from home. The required already-remote
cold-start/restart gate remains unqualified on this setup.

Subsequent research identified existing explicitly addressed RemotePairing
implementations over Tailscale. Upstream reports distinguish other-Wi-Fi
operation and a warm Wi-Fi-to-cellular handoff from unsupported pure-cellular
cold startup. The cellular report records a bounded candidate-endpoint check
and the next qualification. An isolated pinned iOS OTA bridge now builds and
passes its upstream local tests/race checks/vet. It has not been installed as
a service, paired, or used to launch WDA on this phone. Its separate initial
trusted pairing requires local phone access; cellular cold recovery remains
unqualified. Automatic Xcode
discovery failure must not be described as proof that Tailscale cannot carry
Apple developer traffic.

The subsequent [explicit Tailscale bridge qualification](../../evidence/WDA_TAILNET_BRIDGE_2026_11_03.md)
passed on the physical phone: bootstrap through existing trusted network
lockdown, Wi-Fi-to-cellular handoff, runner installation/startup, native input,
runner restart and repeated input, restoration, and verified removal. No new
phone pairing screen or app code was required. Both native test runs passed.
Fresh outer-bridge acquisition on cellular still failed. Foreground switching
also exposed a stock WDA scope hazard; the private harness now checks actual
foreground independently of its pinned target. No production integration or
permanent bridge was added. The conditional pass does not satisfy unrestricted
cellular cold recovery.

The user explicitly rejected treating this retained connection as sufficient.
Follow-up fresh-start probes also failed with Wi-Fi enabled but unassociated
and with Zenics Debug foregrounded on cellular. Both probes were stopped and
no app actions were sent. Fresh cellular acquisition remains a release blocker;
do not substitute an always-running bridge or integrate the conditional path
as if it met the requirement. No qualified replacement transport has been found.

## Remaining gates, in order

1. **Physical wireless transport — WDA same-Wi-Fi passed; agent-device failed.** For further qualification, once the user says the phone is available,
   select the exact paired device. Confirm Apple network transport with USB
   disconnected. Observe the app, tap, enter text, scroll, verify the result,
   and close. Repeat after reconnect. A successful observation alone is
   insufficient: input and its resulting UI must be observed.
2. **Required remote connection gate — warm cellular runner startup/restart passed; outer-bridge cold recovery failed.** Qualify another-network access
   through Tailscale or an explicitly approved replacement transport. Existing
   Swift Sim hot reload over Tailscale is not evidence for XCTest transport.
   The runner's HTTP commands and Apple's test-runner startup/control connection
   are separate paths: both must work remotely, including restart. Do not expose
   raw runner/engine ports publicly. A managed application relay is a research
   candidate, not authorization to deploy or replace the current trust boundary.
3. **Lean integration.** If wireless input passes, add a lazy reference to the
   existing agent skill using the stock CLI. Reuse the matching app identity;
   select the device explicitly and refuse ambiguous selection. Pin the qualified
   provider version. Keep installation optional and outside normal delivery.
   Add a wrapper only if a demonstrated app-selection or lifecycle gap needs it.
4. **Lifecycle and acceptance.** Finish every testing task by closing its
   provider session and stopping its owned runner/daemon through supported
   controls. Verify there is no idle worker. Prove one small edit, delivery,
   native UI action, observed result, and cleanup in the real Debug app.

If physical wireless input needs a framework patch, USB fallback, bespoke
driver, or prolonged investigation, stop this feature at the evidence checkpoint.
Do not expand the project to make the provider work.

## Efficiency and connection research

The [measured WDA output/timing analysis](../../evidence/WDA_EFFICIENCY_ANALYSIS_2026_11_02.md)
supports optimizing the Mac-side representation before forking native code.
It is not an end-to-end token comparison with regular computer use.

The user requested evaluating T3 Connect/T3 Code as a general Swift Sim
connection reference. T3's MIT-licensed repository documents a hosted identity
and discovery control plane, proof-bound environment sessions, managed
Cloudflare tunnels, and LAN/Tailscale route selection. This is an application
connection model rather than a replacement mesh VPN. Its host tunnel does not
by itself establish remote access to an iPhone's Apple test services.

Evaluate narrow reuse of pairing, scoped authorization, connection recovery,
and route selection. Preserve agent independence and avoid importing T3's agent
orchestration/UI stack. Cloud transit, optional persistence, and application-level
encryption need an explicit design against the user's no-upload requirement;
the inspected T3 authentication documents do not establish payload E2E encryption.
No T3 service was installed, account linked, tunnel started, or deployment made.

Primary source references:

- [T3 Connect architecture](https://github.com/pingdotgg/t3code/blob/main/docs/internals/t3-connect.md)
- [Environment authentication](https://github.com/pingdotgg/t3code/blob/main/docs/internals/environment-auth.md)
- [Remote access and route selection](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md)
- [Repository license](https://github.com/pingdotgg/t3code/blob/main/LICENSE)

## Research sources

- [Callstack agent-device](https://github.com/callstack/agent-device): native
  automation, CLI, public Node API, and MIT license.
- [Physical iOS prerequisites](https://github.com/callstack/agent-device/blob/main/website/docs/docs/installation.md#ios-physical-device-prerequisites):
  Apple pairing, Developer Mode, signing, and XCTest runner requirements.
- [Expo agent-device workflow](https://docs.expo.dev/agents/agent-device/):
  an existing coding agent uses native UI tools; no app library is required.
- [Wireless input issue #4107](https://github.com/callstack/agent-device/issues/4107):
  open at the November 2 research checkpoint. It reports Wi-Fi input failure
  with a different macOS/Xcode/iOS configuration. It motivates the gate; it does
  not prove failure on this Mac.
- [Maestro UIKit support](https://docs.maestro.dev/get-started/supported-platform/ios/uikit):
  physical iOS devices are outside its documented support, so it does not cover
  this requirement.
