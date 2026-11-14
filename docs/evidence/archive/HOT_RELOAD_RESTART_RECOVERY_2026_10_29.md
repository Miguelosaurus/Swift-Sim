# Live restart recovery — 2026-10-29

Status: implementation and local qualification; physical acceptance remains a
separate gate. The Zenics owner reported seeing the temporary orange label on
Debug build 26, then losing it after restart while the later Results/Filtered
improvement remained absent. Those are user observations, not newly measured
phone receipts.

## Findings

The preserved journal contains an uncertain label operation and a prepared
successor waiting for that predecessor. The previous queue explicitly rejected
fresh-process recovery whenever any old uncertain operation existed. A process
that died before its receipt reached the Mac therefore blocked cumulative
recovery in a later verified matching process.

The Debug SDK also counted only Swift replacement implementation variables
ending in `TI`. Three preserved patch artifacts contain zero `TI` definitions
and one active `TX` replacement variable each. A real compiled, dead-stripped,
loaded fixture reproduces a visible function replacement with this same
symbol pattern. The corrected SDK counts the union by common replacement stem
without double counting an unstripped TI/TX pair. A plain loaded dylib still
provides zero replacement evidence. Refresh acknowledgement and increased
revision remain separately required.

The historical phone receipt was unavailable because the client was
disconnected. The artifact and compiled regression establish a concrete
false-negative reporting defect; they do not establish every field of the lost
historical receipt or why every previous connection ended. The old SDK can
advance a root refresh while reporting `applied: false`, so same-process
uncertainty must remain fenced.

## Implemented recovery

- A verified matching new Debug process at revision zero can receive one
  cumulative replacement from the qualified original binary source to the
  latest accepted source. Prior worker claims must expire first. Old ambiguity
  remains in the evidence; no old receipt is invented and no ambiguous operation
  is retried in its original process.
- Confirmed desired source is retained separately from expiring pending
  requests, in the same private atomic runtime journal. It survives request
  expiry, garbage collection, helper restart and later app processes. Source
  removals and returns to the installed baseline retain tombstones so older
  temporary labels cannot reappear.
- Superseded/restoration status follows the current request. Garbage collection
  preserves referenced replacement targets. Unknown/nonzero new-process
  revisions do not establish a fresh baseline; malformed revisions fail closed.
- Expiry and explicit restoration revocation preserve unresolved same-process
  effect fences. A matching already-admitted receipt can reconcile after
  pending expiry without another application. Expired unadmitted intent is not
  resurrected.
- Cumulative source and projected journal capacity are reserved before
  accepting intent and rechecked before the application barrier. A capacity
  failure does not cause a native application or signed rebuild.
- The helper advertises `durable-desired-state-v1`; the corrected SDK advertises
  `replacement-proof-v2`. Same-version old processes require an explicit update
  rather than silently promising the new behavior.

`live-desired-revoke` selects a qualified project/workspace and scheme. It stops
restoration and unclaimed queued intent for that binary. It cannot unload a
library already loaded by a running app. Later explicitly confirmed edits may
establish new desired state.

There is no device-local executable patch cache. A truly offline relaunch runs
the installed binary until the awake Mac/helper and private connection return;
then restoration is automatic. Zero stale startup frames and execution while
iOS suspends the app are not claimed.

## Provenance and qualification

The SDK dependency is pinned to native fork revision
`a3341b6a861dde031334813db49f7c7111108c4a` on
`codex/swift-sim-client-reconnect`. The existing qualified local 0.5.0 engine
protocol supports the corrected SDK; no engine replacement, downgrade or public
binary release is needed. Codex integration revision:
`0.6.1+codex.20261029.3`.

Native qualification passed 13 SwiftPM tests, including actual compiled/loaded
stripped and unstripped replacements plus an ordinary-library negative case.
iOS 16 arm64 Debug SDK compilation and the Release exclusion build passed.
Root SwiftPM qualification passed both SwiftSimLive tests against the pinned
new dependency. On Node 24.19.0, `npm run check` passed 1,038 source tests,
516 compiled tests and two hermetic package tests, plus types, lint, formatting,
documentation links, architecture checks, compiled runtime probes and clean
archive installation. Homebrew formula/entrypoint checks passed; the optional
destructive clean Homebrew installation gate was not run.

Behavior regressions cover uncertain A plus queued successor followed by
verified fresh B, active leases, same-process reconnect, unknown revision,
durable state after expiry/GC and multiple relaunches, helper absence,
foreground gating, label removal, multi-file restoration, late receipt
resolution, revocation, status-chain GC and source/journal capacity limits.

## Local activation

Implementation commit `de5288610036b8610a2a6e6878c2bf803477538a` was pushed to
`main` and the primary checkout was fast-forwarded and rebuilt. Canonical setup
reconciled the owned helper; its live health advertises both
`durable-live-delivery-v1` and `durable-desired-state-v1`. The engine remains
0.5.0 with the same measured archive hash. Read-only runtime inspection found
all tracked Simulator streams stopped before helper reconciliation.

The Codex plugin was refreshed to `0.6.1+codex.20261029.3`, enabled, and all 12
cached files matched the checked-in source. The original three queue records
were retained; exact snapshot digests and prior proof fields matched the
private pre-activation evidence copy. The original uncertain request still
reports unconfirmed application, rather than a fabricated success. Activation
did not build or install an app or issue a replacement phone delivery.

## Physical handoff and remaining acceptance

No Zenics source, data, gestures, signing identity, linker workaround or phone
installation was modified by this recovery lane. No real journal was cleared,
no uncertain receipt was synthesized, and no new delivery was requested as a
substitute for diagnosis.

The Zenics lane needs one new Debug SDK bootstrap using the integrated immutable
Swift-Sim revision. Preserve its Debug-only classic-linker workaround and install
over the same app identity. Build from the latest approved source, including
Results/Filtered and removal of the temporary label. A new executable/debug
UUID cannot inherit the prior binary's patch authority; the new build establishes
its own qualified original baseline.

Then deliver one temporary compatible label with `--live-only`, require its
current request/digest/application/refresh/revision proof, and remove it through
another proven live-only delivery. Verify Results while searching and Filtered
under active filters. Repeat background/foreground, disconnection/reconnect,
helper restart with the app open, and several force-quit/relaunch cycles. A
fresh nonce models process eviction in deterministic tests but does not prove
actual iOS memory-pressure eviction. Test helper-unavailable relaunch honestly:
installed baseline first, automatic latest desired state after reconnect.

Do not call these phone gates passed from the source/native tests or a visible
label alone. Keep failed valid attempts and current-request proof. No silent
build/install fallback is authorized by a live-only acceptance step.
