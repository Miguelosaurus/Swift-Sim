# Bounded additive hot reload: physical qualification

Qualified on the existing Zenics Debug build 40 on November 5, 2026 (local
time). No app rebuild, reinstall, product-source mutation, or App Testing
runner was used. Delivery used immutable snapshots through the ordinary
durable hot reload queue and the normal helper.

## Physical result

Three generations received matching native applied and refreshed receipts:

| Generation | Change | Revision | Refresh |
| --- | --- | --- | --- |
| Initial | Root tab title calls a new private helper using a new private struct and an SDK import | 1 | preserve-state-v1 |
| Follow-up | Change only the private helper's implementation | 2 | preserve-state-v1 |
| Restore | Restore the installed original source and title | 3 | preserve-state-v1 |

Each receipt proved complete replacement coverage with one Swift dynamic
replacement and zero Objective-C replacements. All three shared the same
binary and app-process identity. The final desired snapshot equals the installed
original, product-source hashes are unchanged, and the current binary has no
pending request or active claim. The unrelated expired uncertain request for
an older binary remains preserved.

This establishes native application, refresh strategy, and restoration. The
test did not independently capture the rendered title or assert arbitrary
SwiftUI object/task migration. Host execution tests separately exercised
helper results, private-name collisions, nominal generations, and restoration.
Old loaded patch metadata remains until process exit.

## Reconnection correction

The first request was prepared while disconnected. A previous baseline-only
process-recovery marker then incorrectly made recovery return a cached no-op
after that request arrived. Nothing had been applied. The fix lets a verified
revision-zero process reconcile newly accepted pre-apply intent after an earlier
no-op, preserving active-claim/current-process-effect fences and original expiry.

The original request was retained and followed through its atomic replacement;
it was never resubmitted. The qualification runner now supports explicit resume
with retained-request/snapshot checks. The helper was gracefully replaced to
activate the fix; the engine process and phone installation were preserved.

## Reproducible evidence

Private local evidence is retained under
`.build/additive-delivery-20261105/phone-final/`: result, submitted intents,
native receipt records, and final status. Captured-root snapshots and compiler
outputs are adjacent. These files contain device/project context and are not
committed. The plan records earlier compiler, host, regression, and package gates.

Focused queue/runtime regression: 89 tests passed. Independent read-only review
found no concrete blocker in the reconnect correction. Full final gate totals
are recorded in the implementation plan after completion.
