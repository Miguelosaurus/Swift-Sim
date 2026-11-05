# App Testing handoff — November 5, 2026

## Implemented and observed

The companion provides a lazy App Testing screen and **Test with Agent** on
managed app pages. An explicit phone tap opens the existing pinned runner's
start URL with a correlated Swift Sim return URL. The return model checks the
attempt, age, path, allowed fields and status, and consumes a matched receipt.
The receipt is a UI handoff hint, never authentication or input authority.

`app-control check` independently authenticates the qualified runner and checks
its identity, capabilities and unlock state. It sends only `device_info`, with
no app activation, UI capture, input, lease or background worker. Connection
failure does not assert which iOS preparation or permission is missing.

The user installed signed companion build 26 and started testing through its
connection-settings entry. The Mac authenticated the runner, independently
confirmed Swift Sim was foregrounded, observed the correlated return message,
then closed an owned session and verified connection refusal. No taps or edits
were sent. This run did not independently measure the network state.

After the user reported poor discoverability, build 27 added the action beside
the app identity and collapsed setup/recovery details. The user confirmed
Wi-Fi off, Tailscale connected, and a return after Zenics → Test with Agent →
Start App Testing. The earlier runner had been fully stopped. The new runner
authenticated; Swift Sim was already foregrounded before any activation. The
native tree contained both the **Test Zenics** context and the correlated
**Testing opened** message. An owned session was closed and the runner port
again refused connections. No taps or edits were sent.

This second run's cellular condition is user-confirmed. A follow-up interface
query occurred after shutdown and therefore did not independently establish
interface names; it is not recorded as new interface-level proof. Earlier
standalone/integration evidence has the separate interface measurements.

## Validation and remaining work

- Both signed companion builds completed using the existing bundle identity,
  signing settings and ad hoc delivery. No target app or SDK changed.
- Foundation-only native tests cover launch URL encoding, restored launch
  records, correlation, expiry, duplicate fields and foreign callbacks.
- Adapter tests cover readiness without UI/input and preserve identity/lock
  refusal. The normal delivery/APNs import-isolation tests still pass.
- The supported Node 24 regression run passed **1,350 tests**. A preceding run
  accidentally used shell-default Node 26 and failed seven existing state/
  maintenance cases; the supported-runtime run passed without changing them.
- Type, lint, architecture and documentation checks passed.

This is the launch/discovery gate, not completed managed setup or session
approval. There is no new session-request notification, automatic runner
installation, phone-enforced deadline or cellular-only post-reboot developer
image recovery in this change. The runner is stopped and the phone released.

Private receipts and generated artifacts are kept locally under ignored
`.build/app-testing-seamless-20261105/`, outside the package and this report.
