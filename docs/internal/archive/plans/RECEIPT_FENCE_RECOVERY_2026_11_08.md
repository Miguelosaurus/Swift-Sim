# Recover missing receipts without losing phone state

Normal product work outside architecture consolidation. Owner authorized closing
the actual missing-receipt gap from the physical Mac interruption qualification.
Keep all work failure-only, lean, agent agnostic and private. No new watcher,
timer, notification cadence, normal warm preflight or app-control session.
No phone action is needed until the one-time Debug SDK update is prepared.

## Protocol and invariants

- Existing native receipt ledger remains the only admission authority. A missing
  entry alone never authorizes replay. Negotiate prepared-receipt-fence-v1;
  older engine/SDK combinations keep read-only lookup and existing safe fences.
- On an authenticated receipt-recovery query, validate exact request, digest,
  attempt, coverage, strategy, baseline, binary, process and current connection.
  If already admitted, return its receipt or attach a bounded completion callback.
  Never cancel an admitted load or infer success from reconnection.
- If not admitted, atomically store a no-effect tombstone under the existing
  ledger lock, before acknowledging. Require matching active/root-ready process
  and baseline. All late copies of that attempt must be refused before loading.
- Reuse the same queued request, immutable snapshot and prepared bytes. Only an
  exact native PREPARED_ATTEMPT_FENCED receipt with an explicit fence marker can
  release uncertainty for a new attempt token. Preserve retired attempt IDs
  across the retry; delayed old frames and reports cannot own or overwrite it.
- Bound tombstones in the existing 1024-entry ledger and bounded per-request
  retired-attempt collection; never evict admitted or fenced ownership. Full or
  conflicting state fails closed. No extra round trip on normal successful edits.
- Capability and native fence evidence must be verified end to end: SDK,
  engine, helper adapter, and durable queue. Engine restart may reconstruct a
  receipt query from existing durable identity, never a mutation.

## Implementation lane and proof

Task evidence: .build/receipt-fence-20261108 (private, task owned). Engine/SDK
worktree is InjectionNext there on codex/receipt-fence-20261108, based exactly on
published immutable ba3c7166f6712d2cd962005a2a1200de4137590b (0.5.7). Preserve all
other engine/SDK lanes and published tags/assets. Main base is 7a13739.

Tests must cover: fence-before-admission, admission-before-fence, simultaneous
race, late old payload after safe retry, duplicate queries, lost negative reply,
wrong identity/connection/attempt/digest/coverage, expiry, bounds and older SDKs.
Only one native owner/load/refresh may win; counter/draft and working bindings
must survive recovery. Test engine reconstruction and real helper/queue races.
Run native Swift and source/compiled/package/architecture/Release exclusion
gates. Prepare the signed candidate engine and exact SDK pin as reviewable
artifacts before any required public publication approval. Do not rewrite old
0.5.7 or 0.6.3 assets/tags. Merge reviewed root work into main without PRs.

Physical qualification requires a one-time Debug SDK update, followed by a real
cellular missing-handoff test with no phone app restart, exact native no-effect
proof before retry, one successful application, preserved nondefault state,
and original-screen restoration. Do not claim phone proof from local tests.
Record all resource PIDs/ports/IDs; stop disposable resources after use and keep
the normal product helper/engine separate from test resources.

## Qualification checkpoint

- SDK/engine source: `2bcb07c7032bdd8ecaeed122b1668b18982a0bee`.
  Signed local engine 0.5.8 candidate is prepared; public tags/assets are unchanged.
- Native SDK: 38 tests pass; the final strict-Boolean receipt subset passes all
  nine tests. Engine tests cover cache reconstruction, native negative proof,
  old-client fallback, stale reports and a single safe new handoff. Release
  exclusion checks pass.
- Real native SwiftUI host: one load owner and one refresh, 32 late originals
  refused; two views retain distinct counters, drafts, added State and working
  bindings through recovery and restoration. This is Mac native evidence.
- Root checks: 1,662 source tests, 1,028 compiled tests and three hermetic tests
  pass, plus types, formatting, lint, architecture, docs, installed package and
  Homebrew formula checks. The destructive clean Homebrew installation gate was
  not enabled.
- Zenics Debug 51 is installed on the physical phone; the owner confirmed data
  intact. Its matching new native capability was verified at revision zero.
  The cellular missing-handoff/fence/retry qualification passed.
- Other Zenics work changed module sources after capture. The added-State
  fixture therefore failed exact-original-source validation before preparation
  or phone mutation. Preserve that guard and the other lane's files. The phone
  fixture instead changes only an existing view body and checks selected-tab
  state. All three immutable variants compile with `preserve-state-v1`.
- Physical cellular qualification: the test adapter withheld the original image
  before forwarding it to the engine, leaving the real durable request uncertain
  and the engine without a cached admission. The production receipt query got
  the phone's exact `PREPARED_ATTEMPT_FENCED` proof at unchanged revision one.
  The same request, snapshot and signed image then used a new token and refreshed
  exactly once to revision two, in the same Zenics process. The owner confirmed
  `Fence 2 · library`, with Library still selected. This was a controlled lost
  handoff over cellular, not a claim of a physical network outage in this test.
- Resubmitting the withheld old control envelope was refused by the engine,
  with native revision unchanged. Direct late native frames were separately
  tested in the real native Mac host; no such frame was forwarded to the phone.
- Original-screen restoration is receipt-confirmed at revision three, using
  `preserve-state-v1` in the same process. Product source files were unchanged.
  The normal helper is running again. No temporary worker, simulator, watcher,
  App Testing session or additional background service remains.
