# Optional testing approval checkpoint

## Installed baseline

The reproducible optional installer's physical runner passed a fresh startup
check after the user confirmed launch. Authentication matched the bounded
provider version and exact expected build-recipe fingerprint. Authenticated
network configuration showed cellular and Tailscale interfaces, without a Wi-Fi
interface. No testing session, UI capture, app activation, taps or edits were
sent. Explicit shutdown was followed by connection refusal.

## Request implementation

An explicit `app-control request` creates one private, five-minute request for
a managed app and selected notification registration. A one-shot APNs alert
offers Allow Testing. An ordinary tap opens confirmation; only the explicit
iOS Allow action can start the handoff directly. The companion submits approval
after the correlated runner return. The Mac rechecks pairing, phone identity,
app, request state and bounded runtime before consuming the request for one
session. Stop targets that request's owned session.

Request handling is lazy and does not add a worker, polling loop, target-app
library, or hook in normal hot reload and notification processing. The existing
provider's phone-enforced ten-minute lifetime remains unchanged.

## Verification and deployment

- Node 24 regression suite: 1,358 passed, zero failed.
- Final focused suite, including the additional CLI refusal exit-code case:
  14 passed, zero failed.
- Native Foundation handoff/expiry and real-process shutdown cases passed.
- Type, lint, architecture, documentation and package-content checks passed.
- Signed companion build 29 is ready; installation was requested.
- Reviewed source merged and pushed to main as `6a5c1c4`; installed helper
  artifacts match this candidate. Codex plugin updated to
  `0.6.1+codex.20261105.4`.
- Before the graceful helper restart, all saved simulator sessions had stopped
  runtime dispositions and all builds were terminal. The replacement helper
  returned health 200; the existing hot reload engine retained its process
  identity. No additional persistent service was created.
- Installed testing endpoint: unauthenticated access returned 401; paired
  access returned 200 with no pending request and the expected Mac identity.
  No public delivery gateway was listening during this check; public exclusion
  is covered locally, not claimed as a live gateway test.

## Remaining physical proof

The new build's actual notification action, return, approval, one-use session
admission and Stop flow still need phone qualification. APNs acceptance alone
must not be reported as notification delivery or user approval. The earlier
fresh cellular check qualifies the installed runner, not this new approval UI.
Cellular-only developer-image recovery after reboot remains unsupported.
