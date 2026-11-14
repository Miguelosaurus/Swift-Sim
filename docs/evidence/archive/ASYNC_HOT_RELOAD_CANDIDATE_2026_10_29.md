# Asynchronous Hot Reload Candidate — 2026-10-29

Status: repository/native qualification passed; local activation and physical
acceptance are separate gates. No successful hot reload on the target iPhone
is implied by this record.

## Candidate provenance

- Swift SDK/fork: immutable revision
  `f93719095ffc1b107507736c55aa3984222da751`, source branch
  `codex/swift-sim-client-reconnect`. Fork `main` was preserved.
- Mac engine: local **0.5.0 candidate**, ad-hoc signed for local qualification,
  not a published binary release or a Developer ID distribution claim.
- Measured candidate archive SHA256:
  `92f558c440673f4d9e07f13b65cc93224896eac75ba2979f2464e385b823f403`.
- Codex integration revision: `0.6.1+codex.20261029.2`; delivery envelope schema 2.
  Matching helper/engine/client capabilities are required even when their base
  package versions look compatible.

## Behavior implemented

Compatible requests store the exact immutable bytes that were classified.
The helper prepares a bounded signed artifact without a full application
build, waits for the matching Debug process, and reconciles current-request
application/refresh receipts. The requesting CLI may exit. Neither phone
absence nor an uncertain application selects a signed build.

The native client has one connection/reader owner, capped backoff, foreground
and network recovery, root readiness, exact binary/process identity and a
process-lifetime receipt ledger. Reconnect preserves operation identity;
fresh-process replay derives cumulative intent from the qualified original
binary source. Expiry/supersession and ambiguity remain explicit.

`--live-only` prohibits a build even for a structural edit. Ordinary structural
delivery may select a build, with its original routing reason preserved if
signing/storage later fails. CodeSign is no longer classified as invalid
project input. Build-only headroom estimates and terminal failure persistence
do not run as blanket warm-edit preflights.

This candidate applies at foreground/root readiness. It adds no background
mode, push service or promise of execution while iOS suspends/terminates the
app. It does not claim complete stale-frame suppression at startup. Offline
interposition-only preparation is not implemented; it fails without building.

## Local verification

Qualification used Node 24.19.0. `npm run check` passed:

- 1,014 source tests;
- 492 compiled tests, including the new queue/runtime/adapter/identity/storage
  and lifecycle regressions;
- two hermetic package tests, compiled runtime probes, clean package archive
  installation, types/lint/format/docs/architecture checks;
- Homebrew formula/entrypoint checks. The optional destructive clean Homebrew
  installation/service gate was not run.

Root SwiftPM qualification passed two SwiftSimLive tests, including subscription
readiness and revision acknowledgement through the actual new native hooks.
The native fork passed 12 SwiftPM tests, the actual Objective-C++ reconnect /
bounded framing / backpressure harness, and the real temporary Mach-O signing /
digest / receipt engine harness. Its full macOS engine, iOS 16 arm64 SDK and
Release package builds passed.

Review corrections retained regressions for background admission races,
stale attempt replies, immutable classification, lost acknowledgements,
cross-process claims, original baseline retention across expiry/GC,
conservative cohort expiry, deterministic artifact reuse/quota/owned cleanup,
and compiler cancellation/draining during helper shutdown. Independent review
reported no remaining P0/P1/P2 findings in that reviewed state.

Disposable inactive Swift-Sim compilation products, npm download cache and an
unused updater download cache were reclaimed after checking for active use.
Installed applications, dependency checkouts, signed candidate, crash evidence
and existing Zenics artifacts were preserved.

## Physical acceptance ledger

| Scenario | Result |
| --- | --- |
| New Debug SDK installation preserving app identity/data/linker workaround | Not yet run |
| Foreground on another screen, later navigate to Library | Not yet run |
| Background then return with a queued edit | Not yet run |
| Network interruption then return | Not yet run |
| Helper restart while the app stays open | Not yet run |
| Termination then relaunch with queued intent | Not yet run |
| Visible label and proven removal with matching request/digest/revision | Not yet run |

Do not retry these through a build fallback. Use live-only delivery and retain
failed valid attempts. Update this ledger with actual observations before
claiming phone acceptance. User credentials, bearer links, device metadata,
private paths and raw personal logs must remain outside this record.
