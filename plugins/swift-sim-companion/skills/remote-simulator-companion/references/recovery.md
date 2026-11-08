# Agent-handled recovery

Use this only after a blocked delivery, never as a normal warm-edit preflight.
Run once per incident:

```sh
swift-sim recover-delivery --request <existing-request-id>
```

For a helper health failure before admission, use the exact project/workspace
and scheme. Recovery discovers a unique existing pending request before doing
anything; ambiguous or mismatched targets require the existing ID. A scoped
helper start with no request returns `RECOVERY_READY`, not delivery success.
Only retry the original deliver-change when its first result proves failure
at the helper health check, before admission. A lost enqueue reply does not
prove absence. Inspect the existing queue/status rather than resubmitting.

The command restores an absent owned helper, reconciles an incompatible owned
helper, or restarts a stale idle delivery worker. It preserves source snapshots,
claims and native receipts. Active builds/compilation/application defer repairs.
A matching stopped engine can be started only with the existing validated
session, verified installed component and private network route. It never
force-stops a running/unreachable engine, changes pairing/network routes,
installs components, renews a link, starts App Testing or builds an app.

Follow `nextAction` once: `wait`, `open-app`, `check-status`, `check-mac` or
`continue-edit`. Mac-side actions belong to the agent. Ask the user only for
an actual phone action or a local credential prompt. Wrong build/capture,
missing compiler/signing access and component drift stay explicit. Use the
existing live-status/build diagnostics to investigate; do not guess new context.
Unknown application receipts remain fenced. Only an existing exact native
applied/refresh receipt returns completionVerified=true. Repairs and reconnects
alone never prove application. Recovery has no watcher, SDK layer or timer.
