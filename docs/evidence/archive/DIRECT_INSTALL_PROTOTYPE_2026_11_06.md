# Direct-install prototype — offline checkpoint, 2026-11-06

**Later checkpoint:** the owner subsequently authorized physical testing. See
[phone qualification](DIRECT_INSTALL_PHONE_QUALIFICATION_2026_11_06.md) for three
successful Wi-Fi/Tailscale installs, the reboot endpoint change, and the remaining
fresh cellular acquisition failure. The offline-only scope below records the
earlier phase, not the current authorization.

The owner authorized building the prototype and explicitly prohibited phone use
for this phase. **No physical-device command, discovery, connection, runner,
installation, lock, reboot, or pairing change was performed.** Cellular install
and silent lock/reboot behavior remain unproven.

## Implementation

The `mac-helper/optional/direct-install/README.md` (archived; see git tag archive/pre-lean-2026-11-13)
reuses existing Xcode-signed IPAs and the already-trialled pinned MIT `idevice`
provider. It connects to an explicit private Tailscale address, performs mutual
RemotePairing authentication against the pinned peer, opens the existing
in-process TCP/RSD stack, checks the expected device, and uses Apple's AFC and
InstallationProxy services. It never enables a public service or starts an app
runner. It does not add code or dependencies to either phone app.

The installed version is scoped to the requested bundle. Complete + matching
post-install inventory is needed for `installed`; an already matching build or
a version observed after an uncertain send is labelled separately. No installed
binary-hash proof is claimed. A private, fsynced journal fences the operation
before submission; a lost acknowledgement permits inventory reconciliation,
never blind resubmission. Cleanup only removes this attempt's UUID staging file
before submission or after Complete plus verified inventory. Lost-receipt
recovery only observes whether Apple has already removed it; a still-present
input remains owned, without destructive cleanup based on inventory alone.
The prepared IPA remains immutable and is hashed again
during its 64-KiB streaming upload.

No normal helper, engine, CLI dispatcher, notification, hot-reload, plugin or
phone-app path imports or invokes the prototype. It is explicitly built and run
on demand, with no idle process. Normal signed installs continue supporting the
existing link path without Tailscale; this experiment has no link fallback.

## Local evidence

- Rust tests: 13 passing, including the real provider's framed InstallationProxy
  protocol over in-memory duplex streams, durable journal reopen and lock
  exclusion, lost acknowledgement, no repeat submission, wrong/missing inventory,
  pre-submission write failure, transfer failure and cleanup recovery.
- Python tests: 4 passing, covering snapshot preservation, private outputs,
  signature/profile rejection, expiry/team mismatch, archive traversal/symlinks,
  existing output preservation and task-owned cleanup.
- `cargo clippy --locked --all-targets -- -D warnings`: passed.
- Locked optimized native build: passed; executable 1,116,304 bytes on this Mac.
- An existing Xcode-signed Swift Sim IPA was prepared and validated offline;
  its signature, entitlements, registered-device profile and digest passed. The
  source artifact was unchanged. Raw device/team/profile data stays private.
- One `/usr/bin/time -l` offline validation measured 0.18 seconds elapsed,
  2,572,288 bytes peak RSS and 1,573,152 bytes peak physical footprint. These are
  **offline validation** measurements, not transfer/install memory or timing.
- An install invocation without `--execute` was rejected with
  `explicit_execute_required` before any peer record or device access.
- Source syntax, architecture inventory and TypeScript checks passed.
- Targeted notification/APNs/live-delivery regressions: 150 passing, zero failures.

Private task artifacts and resource ownership live under the ignored
`.build/direct-install-20261106/` directory. No persistent listener, watcher,
simulator or daemon was created. Hermetic test-owned loopback servers close with
their completed test processes. Cargo build/test processes terminate normally.
The normal user helper and hot-reload engine remain untouched.

## Qualification still required

The executable and exact commands are ready; the README contains the physical
test matrix. With owner availability, qualify each case using a new build number
and preserved app data: Wi-Fi baseline, **fresh cellular before connection**,
locked cellular, reboot before first unlock, and reboot after first unlock.
Keep all runner/retained-bridge paths closed. Record Complete + scoped inventory,
zero link/installation-approval taps, and the actual prerequisite if iOS blocks
a case. Also fault a post-submission connection and reconcile without a second
install command.

Earlier [native transport evidence](NATIVE_CONTROL_TAILNET_2026_11_04.md) was a
Wi-Fi authentication pass and cellular TCP refusal. Successful standalone runner
input on cellular does not remove that installer-transport uncertainty. No
production delivery integration or universal cellular-install claim is warranted
until this new path passes those physical checks.

## Follow-up review — offline only

The continuation retained the owner's restriction on phone contact. Review
found and fixed a malformed-argument path: `validate` with device arguments and
`--execute` could fall through to the device installer. Typed command dispatch
now rejects that combination before even reading local files. Only the explicit
`install` action can enter the upload/submission path; `inspect` and `reconcile`
remain non-submitting. Tests exercise the rejected combination and missing
execution flags without opening a network connection.

Profile expiry no longer blocks read-only inspection/reconciliation of an older
attempt. Actual installation and offline readiness validation still reject an
expired profile; artifact digests and peer/device binding remain mandatory.

Three additional real AFC wire fixtures use in-memory duplex streams to verify
that a multi-chunk upload transfers the expected bytes in at most 64-KiB chunks,
closes its descriptor after success or digest mismatch, and stops immediately
after a rejected write while still closing the descriptor. No phone endpoint,
discovery, pairing change, daemon, or new production import was involved.

Follow-up checks: 18 Rust tests and 4 Python tests pass; strict Clippy and the
optimized locked build pass. The earlier 150 notification/live-delivery tests
are baseline evidence from this prototype's first commit; normal runtime paths
remain unchanged. The original binary size/timing above describes that earlier
build, not a cellular transfer measurement.

Transport reference: [JAS source and README](https://github.com/jkcoxson/jas).
Only its use of trusted RSD-over-TCP with AFC/InstallationProxy informed this
prototype; its authentication/signing portal and background scheduler were not
imported. Dependency source remains pinned to the earlier Swift Sim trial.
