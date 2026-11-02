# On-demand screen inspection qualification

Date: 2026-11-01. Scope: Inspect Screen and agent-readable elements only.
Visual comparison, text-size presets and interaction replay are not included.
Phone installation and acceptance remain pending.

## Behavior and bounds

- Developer Tools → Inspect screen shows a temporary outline snapshot. Tap an
  outline or use the native Elements picker; Done restores host interaction.
- `swift-sim app-context --elements` reads exposed controls without opening any
  UI. Known enabled/selected states, labels, available identifiers and clipped
  app-window frames are allowlisted. Text-entry values are omitted; native
  switch/slider values can be returned. Labels remain application data.
- Public accessibility containers and UIKit fallback only. No private API,
  accessibility activation, source-file mapping, element activation, text entry,
  method swizzling, new dependencies, continuous scan or background observer.
- At most 64 elements, 512 objects, depth 24 and 32 KiB of JSON. An 8 ms work
  slice cooperatively yields while retaining this request's progress, within a
  250 ms total scan budget. Host getters cannot be preempted. Partial results
  explicitly identify truncation; geometry does not prove hittability.
- Process/connection/revision and native operation acknowledgements remain
  mandatory. Cancellation, backgrounding, controller/bounds changes and code
  delivery invalidate observations. Phone selections are matched against fresh
  label, role, identifier and frame before being returned. No durable selectors
  or atomic business-state/image guarantee is claimed.
- The engine returns inspection content once and keeps only a tiny duplicate
  tombstone. No inspection-content cache, socket, server or periodic task was
  added. Existing report storage and ordinary delivery behavior are unchanged.

## Evidence

- 30 SDK tests pass, including existing real shader/root/receipt regressions and
  new geometry, selection and escaped-JSON budget checks.
- 16 helper tests pass. The compiled targeted suite passes 103 checks, covering
  inspection plus normal delivery, restart, callback proofs and notifications.
  Adversarial cases cover stale or oversized data, invalid bounds, duplicate IDs,
  incorrect selection, changed binary/process/revision and operation mismatch.
- Native report/tool tests pass, including ephemeral content/duplicate handling,
  bounds, expiry, concurrency and late capture rejection. Prepared-v3 engine
  behavior and its 32-way retry race pass.
- Actual Simulator builds and UI checks find SwiftUI text, a disabled SwiftUI
  button, an embedded UIKit switch and text inputs. Secure and plain input values
  are absent. Element selection and six open/close cycles preserve host state.
- Real native-wire testing uses the actual compiled app and engine, with a
  task-only binding to that fixture's arm64 binary UUIDs. It never replaces the
  production capture/registration. A cold request returned all 25 candidates,
  untruncated, in 51 ms on this host. A second request returned the phone overlay's selected element against fresh matching metadata in 20 ms. This is a functional Simulator observation,
  not physical-phone or notification-latency qualification.
- Release SDK builds exclude inspection/menu symbols. The task fixture contains
  a separate diagnostic export selector; shipping source has no test hook.

Engine source is pinned to `fcb94b4c6d99c69420b1b670b9f7801369d2545b`.
The local 0.5.4 candidate archive is signed and verifies, with SHA-256
`230913bc2ebcc7b6d97c603332ad6bc704290bb52413c41ada4f5eebebecccd1`.
It is installed through the supported candidate workflow; the existing helper
was preserved. This is not a newly published engine or npm release.

The Simulator uses the task-owned conservative simslim profile, with push,
universal-links and keychain checks passing. Physical-phone gesture, accessibility,
footprint and hot-reload/notification coexistence still require device acceptance.
Private receipts, source hashes, screenshots and task resource notes are retained
in the generated qualification folder. No phone patch or app uninstall was used.

## Prepared rollout

Swift-Sim implementation is merged directly to main at
`5c1190f5d9640940e99f8538994166fe8cfa40ec`; engine main is the pinned revision
above. The installed CLI and native Codex skill/reference match this source.
Zenics main `930a66c` changes only its SDK pin, preserving the pre-existing local
Debug linker workaround. Same-identity Zenics Debug 38 is ready for OTA install
with 869 compiler registrations. Its exported signature, Debug entitlement,
exact SDK/engine revisions and every SDK Swift source hash verify. No diagnostic
test selector is present in the shipped SDK. Installation is not confirmed.
Companion 25 needs no update for this Debug-only feature.

The task fixture is stopped and its Simulator is shut down. Inactive generated
compiler caches were released after open-file checks; source, signed archives,
phone build artifacts, registration authority and unrelated work were preserved.
The normal helper and updated engine remain running for hot reload and
notifications. No temporary server, watcher, browser or persistent service was
created by this task. Physical-phone acceptance remains the next step.
