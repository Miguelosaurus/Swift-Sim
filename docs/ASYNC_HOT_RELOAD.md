# Asynchronous iPhone Hot Reload

Compatible edits can be requested while the phone is offline, locked, using
another app, or while the Debug app is not running. The Mac stores immutable
intent and prepares a signed replacement without starting a full app build.
The matching Debug app reconnects and applies pending work when it returns to
foreground execution. The current screen does not select what can reload;
navigate to the changed screen later to see the result.

## Availability

This workflow requires the matching reconnect SDK, prepared-delivery engine,
and helper capability. The reviewed SDK is pinned in `Package.swift`. The
engine implementation is a qualified **local 0.5.0 candidate**, not a published
binary release. The public installer still defaults to engine 0.4.0. An older
engine/client/helper must report an explicit update requirement; reconnecting
alone cannot add a missing protocol capability.

Local candidate activation is an operator qualification step. It measures an
explicit archive checksum, preserves owner-only configuration, and verifies
the app signature before installation. No background updater or public
candidate download is implied. First bootstrap requires one new signed Debug
SDK installation; subsequent compatible edits do not reinstall the app.

## Request and status

For a specifically requested hot reload or acceptance test, use live-only mode:

```sh
swift-sim deliver-change \
  --live-only \
  --before "<previous.swift>" --after "<current.swift>" \
  --project "<App.xcodeproj>" --scheme "<App>" \
  --configuration Debug
```

`--live-only` never builds or installs an app. A structural edit reports that a
signed build is required. Without that option, structural edits may use one
ordinary signed build; compatible edits still queue and never rebuild merely
because the device is unavailable, compilation fails, or an acknowledgement is
uncertain.

Delivery envelope schema **2** adds `queued` as an incomplete outcome. Save its
opaque `delivery.requestId`. Status can be read without repeating delivery:

```sh
swift-sim live-delivery-status --request "<opaque-request-id>"
```

| State | Meaning |
| --- | --- |
| `queued` | Intent is durable; preparation has not completed. |
| `compiling` | An owned, bounded compiler worker is preparing the snapshot. |
| `waiting-for-device` | The prepared request awaits its matching client. |
| `waiting-for-foreground` | The client cannot currently execute/refresh safely. |
| `applying` | The application barrier was persisted and the native transaction was sent. |
| `applied` | Application was acknowledged; refresh proof remains outstanding. |
| `refreshed` / `hot-reloaded` | This request has a matching applied replacement, refresh acknowledgement and increased revision. |
| `uncertain` / `failed` | The effect cannot be confirmed; a matching receipt may reconcile it. No new operation is manufactured. |

Queued work is not "done". A ready build, connected engine, loaded library,
screenshot, or unrelated last-patch report is insufficient. Agents report the
queued state and let the helper continue; they do not repeatedly inject the
same edit or ask the user to keep a specific screen open.

## Recovery and compatibility

The helper owns queue processing after the requesting CLI exits. Mac sleep,
an unavailable engine, or a stopped helper pauses processing. The Mac must be
awake and the helper running to prepare/deliver. Its shutdown cancels and
drains its compiler worker. Intent survives restart in the private runtime
journal.

App identity, both executable/debug-dylib UUIDs, process nonce, snapshot digest,
request/attempt identity and revision fence every application. A socket
reconnect retains the process's receipts; a new process gets a cumulative
replacement derived from the qualified original binary source baseline.
Replaced requests point to that cumulative request and expose its expiry.
Unresolved partial/uncertain history blocks unsafe fresh-process replay.

Requests expire within 24 hours. A cumulative cohort uses its earliest
accepted expiry, so it may shorten a later request's remaining lifetime; it
never silently extends accepted intent. Expired cohorts are not automatically
resurrected. The bounded original source-baseline index can outlive request
expiry while retained binary history needs it. All content remains on the Mac.

The journal is bounded to 256 requests, 32 files per request, 1 MiB per source
file and 32 MiB total. Prepared artifacts use deterministic ownership and a
128 MiB quota; expiry cleanup only removes verified Swift Sim-owned outputs.
Unavailable storage fails cleanly without starting a full app build.

Offline preparation currently supports generated dynamic-replacement bundles.
An interposition-only edit that cannot be prepared returns a precise failure;
it does not silently become a signed build. Release, TestFlight and App Store
execution remain excluded, and the transport remains private to the Tailnet.

## iOS execution limits

This implementation waits for foreground/root readiness. It does not add
background modes, silent pushes, or persistent background execution. Apple's
[background sequence](https://developer.apple.com/documentation/uikit/about-the-background-execution-sequence)
allows the system to suspend apps. A
[finite background task](https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time)
can finish legitimate work already underway; it is not a promise that a later
remote edit wakes a suspended or terminated app. Network-path observation helps
reconnect when code runs; it does not grant execution time.

Best-effort background finishing is a separate future qualification. The root
readiness barrier prevents applying before the refresh observer is installed;
this candidate does not claim that it suppresses every stale startup frame.

Physical acceptance still requires foreground on another screen, background /
return, network interruption / return, helper restart with the app open, and
termination / relaunch with queued work. Each scenario needs current-request
compile/apply/refresh/revision proof and the visible change plus its proven
removal. Local harnesses do not substitute for those phone observations.
