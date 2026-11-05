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

## Physical approval qualification

On the user's Wi-Fi-ready phone, a new request was accepted by APNs. The user
completed the phone flow; local state changed from pending to approved. Opening
the exact request admitted one bounded session and consumed it. The native tree
reported Swift Sim in front, its Stop Testing button, and the matching approval
confirmation. This proves the integrated approval and admission path on Wi-Fi;
it does not independently distinguish the notification action from tap followed
by the in-app Allow button, or qualify this new UI on fresh cellular.

One agent-driven tap of Stop Testing returned ACTION_UNCONFIRMED. It was not
repeated. The request remained consumed and the runner still accepted a TCP
connection. A subsequent explicit Mac cancellation returned request-cancelled;
connection refusal and removal of the local session independently confirmed
shutdown. The exact cause of the native RPC failure is not established.

Review found a reproducible contention problem: Stop could immediately return
SESSION_BUSY while an agent action held the command lock. Shutdown now allows
up to thirty seconds to acquire that same lock; ordinary commands still fail
immediately on contention. A real threaded regression verifies cancellation
waits without repeating input. The companion permits the bounded stop response
to finish and displays Stopping Testing. Build 30 includes those changes; its
physical user-driven Stop confirmation is pending. No helper restart or change
to normal notification timeouts is needed for this refinement.

Cellular-only developer-image recovery after reboot remains unsupported.
