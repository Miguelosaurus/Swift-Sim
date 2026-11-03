# App control: bounded implementation spike

The coding agent tests its changes in the running app before asking the developer
to try them. This is an optional development workflow, outside the architecture
consolidation program.

## Constraints

- One day of work, using a stock framework. No fork or custom input driver.
- Wireless physical iPhone control is a release gate. A Simulator pass or a USB
  pass cannot satisfy it. Wait for explicit phone availability before device work.
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

## Remaining gates, in order

1. **Physical wireless transport.** Once the user says the phone is available,
   select the exact paired device. Confirm Apple network transport with USB
   disconnected. Observe the app, tap, enter text, scroll, verify the result,
   and close. Repeat after reconnect. A successful observation alone is
   insufficient: input and its resulting UI must be observed.
2. **Connection scope.** Record whether success requires local Apple Wi-Fi
   pairing. Test another-network/Tailscale access separately if it is to be
   advertised. Existing Swift Sim hot reload over Tailscale is not evidence for
   the XCTest transport. Do not expose the runner publicly or invent a relay.
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
