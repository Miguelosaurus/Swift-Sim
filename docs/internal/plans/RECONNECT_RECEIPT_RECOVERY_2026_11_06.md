# Automatic receipt recovery

Scope: fix the applied-but-acknowledgement-lost case without restarting the Mac
engine, reloading an image, refreshing the app twice, or migrating user state.
Outside architecture consolidation. Baseline main127122f; Zenics Debug42 restored.

Design: negotiated read-only receipt lookup on the existing metrics transport.
The phone reads its bounded process-lifetime ledger and returns the exact cached
report or attaches one bounded completion callback to an already admitted
operation. It never begins an operation, loads bytes, changes revision, or claims
that an absent ledger entry proves no effect. Unknown/conflicting results remain
fenced. Exact request/digest/attempt/baseline/strategy/coverage/binary/process
matching remains mandatory. Receipt reads may recover after intent expiry.

Mac queries run through existing helper reconciliation, at most once per verified
connection per pending operation; the original send connection does no lookup.
No additional happy-path round trip, timer, poller, state storage, notification
cadence or animation changes. An engine restart may reconstruct only a receipt
lookup from the durable operation identity; no patch retransmission is used.

Implementation: immutable SDK fork from945c67a, native ledger/transport/engine
contracts, helper negotiation and adapter, source/compiled/package/Swift gates.
Qualification: fault-injection tests cover lost completion, in-flight completion,
unknown entry, stale attempt, wrong process and races. A native SwiftUI test must
retain nondefault state and prove one image application/refresh. Physical check
uses temporary snapshots and restores them; reserve the phone only after prep.

Existing normal helper3766 and engine4127 remain until reviewed deployment.
New native build/test outputs belong to .build/reconnect-recovery-20261106/.
No public endpoint, new background service, simulator erase or cleanup is implied.
No PR; review, merge/push main and update helper/plugin when qualification permits.

## Reviewed checkpoint

SDK307f9bf is published and root-pinned. Native engine/ledger, socket lifecycle,
lossy SwiftUI host and proxy-fragmentation tests pass. Full source1488, compiled906
plus3 hermetic/runtime checks, SDK33, root Swift38, Release exclusion, type, lint,
format, architecture/docs and package/isolated-install/Homebrew entrypoints pass.
Candidate0.5.6 is signed and checksum-bound. Next reviewed deployment and one
Debug43 bootstrap, then actual cellular loss/reconnect proof and restoration.
No phone has been reserved or changed yet. Task runtime IDs are in resources.json.
