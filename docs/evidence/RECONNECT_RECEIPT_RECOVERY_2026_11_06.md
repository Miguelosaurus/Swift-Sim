# Automatic reconnect receipt recovery

The matching Debug SDK and local engine0.5.6 recover a lost confirmation by
reading the phone's existing process-lifetime receipt. This lookup cannot begin
an operation, load an image or refresh a view. The helper no longer retransmits
patch bytes on an engine-cache miss. Unknown/conflicting native state stays
uncertain; this is not a promise to reapply an unacknowledged mutation.

## Bounds and compatibility

The existing helper turn requests recovery only for an authenticated replacement
connection, or after an engine-cache miss with the durable exact original
contract. Normal completed edits and the original send connection add no lookup
message. One lookup per connection, at most16 connections per operation, uses the
existing metrics frame with a 16KiB JSON bound, an empty data frame and a scoped
300ms write budget. A pending native operation retains at most16 completion
callbacks including its original one. No new poller, timer, service, state
serializer, app-content upload, animation or notification-cadence change exists.

Request/digest/attempt/baseline/strategy/coverage and binary/process identities
remain exact. Queries also bind the current connection nonce. A cached completed
report keeps its original identity and revision; it cannot manufacture a newer
refresh. Lookup expiry does not act as permission to load code. Old SDKs receive
no new control frame and retain ordinary delivery; one matching Debug SDK update
is required for recovery. New process restoration retains its existing separate
verified revision-zero rules.

## Native and host checks

- All33 SDK Swift tests pass, including four new ledger tests for lost results,
  pending completion, wrong identities, stale attempts, changed proof/strategy,
  missing entries, expiry and bounded concurrent lookup callbacks.
- Production native engine contracts pass, including32 concurrent lookups sending
  one query, connection-observation oscillation, cache reconstruction without
  image bytes, original-connection silence, old-client gating and wrong-process
  refusal. Existing v3/Objective-C/32-way retry fences remain intact. A pre-existing
  test fixture assigned two completed operations the same revision; its developer
  context assertion was made deterministic with distinct revisions.
- Real SimpleSocket tests pass for the empty-data receipt frame, fragmented and
  invalid frames, bounded writes/backpressure, and native reconnect lifecycle.
- A real offscreen SwiftUI host compiles production replacement modules, the
  actual receipt ledger and engine. Only transport and the unused symbol-image
  convenience type are shimmed; production coverage inspection validates two
  replacements. The transport drops the completion and authenticates a new
  connection. Recovery preserves installed counters7/12, added counters/drafts,
  a later Boolean, working bindings and one child appearance per instance.
  After32 duplicate operation reads/submissions, owner=1, refresh=1 and query=1.
  Native receipt: `RECONNECT_STATE_PASS owners=1 refreshes=1 queries=1 duplicates=32
  existing=7/12 added=10/23 drafts=kept/separate flag=true appearances=1/1 restored=true`.
- The loopback-only fault proxy is tested with fragmented frames: unrelated and
  failed receipts pass unchanged, exactly one selected successful receipt is
  dropped, and its retransmitted cached receipt passes on the next connection.
  Its temporary processes and sockets exit in the test's finalizer.

## Package and delivery checkpoint

SDK main307f9bf is root-pinned immutably. The signed Mac engine archive0.5.6
has SHA256700dc792368c3fa169b6f5fa692f3b4b3d3f30f4e48c87aca9129d17992e99e7.
Its actual app builds and its deep strict signature verifies. Source tests1488,
compiled906 plus3 hermetic checks/runtime gates, root Swift38 and Release builds,
SDK33, types, format and lint pass. Package contents, isolated installed-package
setup/doctor and Homebrew entrypoints pass; destructive clean Homebrew installation
remains disabled. Actual Release SDK objects exclude the recovery symbol and
capability. Physical acceptance remains pending; no phone changes have been made.

Private receipts and source/binary hashes live under
.build/reconnect-recovery-20261106/. The original SDK/checkouts, normal helper
and engine remain preserved until explicit reviewed deployment. No simulator
or additional persistent service has been started.
