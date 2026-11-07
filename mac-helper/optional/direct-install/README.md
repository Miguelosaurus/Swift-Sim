# Direct-install prototype

Experimental, on-demand Mac client for installing an **existing Xcode-signed IPA**
over the phone's private Tailscale address. It is not enabled in normal delivery.
There is no phone SDK change, phone runner, web service, Apple-ID login, scheduler,
link fallback, app launch, or uninstall. No process remains after a command exits.

This is **not yet qualified on a physical phone**. In particular, earlier cellular
app-control success did not establish access to Apple's installation service.
The current task expressly excludes contacting the owner's phone.

## Build and offline preparation

Requires the existing macOS/Xcode signing tools, Python 3.11+, and Rust 1.93+.
The pinned MIT-licensed provider is the same `mh-mobile/idevice` revision used in
the native transport trial: `89cdb2409643deabab99999286b4c4d091c7c068`.
Cargo.lock fixes its transitive dependency graph. Nothing downloads or builds at
helper startup. Cargo is needed to build this experimental executable, not during
an install.

From the repository root:

```sh
cargo build --release --locked --manifest-path mac-helper/optional/direct-install/Cargo.toml
python3 mac-helper/optional/direct-install/prepare.py \
  --ipa /private/path/to/existing-signed.ipa \
  --output /private/path/to/new-preparation
mac-helper/optional/direct-install/target/release/swift-sim-direct-install \
  validate /private/path/to/new-preparation
```

Preparation has no device/network code. It creates a private, new directory,
copies the IPA, rejects unsafe ZIP paths/symlinks, verifies the device bundle's
signature, reads the signed entitlements and embedded profile, and checks bundle,
team, registered-device eligibility, and profile expiry. It never re-signs or
changes the source artifact. Only the frozen IPA and private manifest remain.
The native client rechecks the IPA digest and expiry before any device connection
for installation and hashes the streamed upload again before requesting
installation. Read-only inspection/reconciliation still checks the artifact
binding but permits an expired profile, so expiry cannot strand an earlier
uncertain attempt. A preparation
is a trusted local output, not an untrusted manifest interchange format.
`validate` rejects extra device arguments before reading files; it cannot be
turned into a device operation by adding `--execute`.

## Device commands — only when the owner makes the phone available

Create a private mode-0600 JSON file locally. Do not put it in Git, logs, agent
context, or chat. Use the existing trusted RemotePairing record with the phone's
pinned public key and identifier; the client neither creates pairing nor modifies
the record. A helper/notification bearer or ordinary lockdown plist is not an
RPPairing record.

```json
{
  "host": "100.64.0.2",
  "port": 49152,
  "udid": "synthetic-device-placeholder",
  "pairing_file": "/private/path/to/existing-pinned-record.plist"
}
```

Use the phone's actual known RemotePairing port; the example is not discovery.
Only literal Tailscale IPv4/IPv6 addresses are accepted. There is no DNS, LAN,
USB, mDNS, CoreDevice daemon, or runner fallback. After mutual authentication,
the RSD device identifier must match both the requested device and the signed
profile. The exact peer, device, bundle and artifact bind the durable journal.

All three commands below contact the phone and require `--execute`:

```sh
installer=/path/to/swift-sim-direct-install
prepared=/private/path/to/new-preparation
peer=/private/path/to/peer.json
state=/private/path/to/direct-install-state

"$installer" inspect "$prepared" "$peer" "$state" --execute
"$installer" install "$prepared" "$peer" "$state" --execute
"$installer" reconcile "$prepared" "$peer" "$state" --execute
```

Always reuse the same private state directory. It contains an advisory per-peer,
per-bundle lock and atomic, fsynced journals. Do not delete or bypass an unresolved
journal to retry. A different artifact is blocked until the previous attempt is
terminal and its owned staging file has been cleaned. Reusing an already tracked
build identity for a different artifact is rejected.

The client opens fresh mutually authenticated RemotePairing/RSD-over-TCP and
checks only the requested app in InstallationProxy inventory. Uploads use a
64-KiB buffer and a random owned `PublicStaging/swift-sim-<UUID>.ipa` path. The
submission fence is durable before the install command. There are no blind
install retries, automatic app termination, or system setting changes. Connection
setup is bounded to 30 seconds and the entire operation to ten minutes.

Results are bounded JSON; upstream diagnostics are not enabled because they can
include private pairing data:

- `installed`: Apple returned Complete and a subsequent scoped inventory lookup
  confirmed bundle, version and build. This is not a device-side binary hash.
- `installed-version-observed`: a previously uncertain submission was reconciled
  by seeing the requested version, different from the pre-submission inventory.
  It does not attribute a concurrent manual install to this request.
- `already-matching-version`: inventory matched before a new submission; no
  installation was performed and no exact-binary claim is made.
- `install_unconfirmed_no_retry`: request may have been accepted. Reconcile with
  inventory; do not retry or remove its staging while Apple may still consume it.
- `not-submitted`: reconciliation confirms this attempt never reached its
  submission fence. Owned upload cleanup is attempted; a clean attempt can run
  again. This says nothing about unrelated installations.

`cleanupPending` retains ownership if removal fails. Reconcile only removes that
one staging file after safe pre-submission recovery or a Complete receipt plus
verified inventory. After a lost receipt it only observes whether Apple has
already removed the file; a version lookup alone cannot authorize deletion of a
possibly active install input. A still-present file remains owned and blocks a
different artifact until safely resolved. It never deletes PublicStaging, app
data, other installs, or local pairing material.
A missing staging file counts as already cleaned. An unreachable/locked service
returns a typed stage; it never opens Safari or an install prompt as a fallback.
This prototype does not automatically publish its result into build history or
send notifications. Integration waits for real-device qualification.

## Local verification

```sh
cargo test --locked --manifest-path mac-helper/optional/direct-install/Cargo.toml
cargo clippy --locked --manifest-path mac-helper/optional/direct-install/Cargo.toml --all-targets -- -D warnings
python3 -m unittest discover -s mac-helper/optional/direct-install/tests -p 'test_*.py' -v
```

JSON results include elapsed time for the later device qualification. Tests use
fake device operations, real framed AFC and InstallationProxy traffic over
in-memory duplex streams, and local files. They cover bounded streaming uploads,
descriptor closure after write/hash failure, receipt/inventory gating,
lost acknowledgements across process-state restoration, no second submission,
durable-fence failures, transfer failures, scoped cleanup, concurrent lock
exclusion, path/signature/profile rejection, offline command isolation, expired
profile reconciliation, and offline preparation. These tests
do not prove physical lock/reboot/cellular behavior.

## Physical qualification gate

Do not run until the owner explicitly makes the phone available. Use a harmless
registered development app with existing data, a new unique build number for
each installation case, and the same signing team/bundle identity throughout.
Use existing signing/build output; never uninstall first. Keep the phone runner
stopped and all task-created Apple bridges closed. Record only redacted timings,
case labels, states and inventory results; keep raw identities/records private.

| Case | Conditions | Required evidence | Current state |
| --- | --- | --- | --- |
| Baseline | Same Wi-Fi, Tailscale; fresh installer process | Complete + requested version/build; existing app data preserved | Pending |
| Fresh cellular | Wi-Fi off before command, Tailscale, unlocked; no retained bridge | Direct upload/install + inventory, no link or install approval tap | Pending |
| Locked cellular | Lock before a fresh command; keep cellular/Tailscale | Successful direct install while locked, or exact typed blocked stage | Pending |
| Reboot before first unlock | Reboot on cellular; no runner/bridge or app launch | Record availability/blocking honestly; do not assume protected services run | Pending |
| Reboot after first unlock | One normal passcode unlock after reboot; cellular/Tailscale, fresh process | Direct install without developer-image repair, app launch or install tap | Pending |
| Lost connection | Interrupt after submission; restore connection | Reconcile version with zero second install request | Local fault test only |
| Owner data | Open installed harmless app after each successful case | Preexisting data retained, correct build visible, no reinstall/uninstall | Pending |

An OS-required passcode unlock is a prerequisite, not evidence of fully unattended
locked-phone installation. If a cellular entry point refuses TCP, stop at that
boundary and diagnose it. Wi-Fi success, a warm session, service advertisement,
or successful app-control input cannot satisfy the cellular-install gate.
Only after these checks should direct install become an optional normal build
delivery path; the ordinary link path continues working without Tailscale.

Transport inspiration: [JAS](https://github.com/jkcoxson/jas) uses trusted
RemotePairing/RSD over TCP to reach AFC and InstallationProxy over a VPN. This
prototype reuses our pinned provider and Xcode signing rather than importing its
portal, Apple-ID authentication, re-signing, database or refresh scheduler.
