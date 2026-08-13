# Phase 10 reliability evidence framework

This directory is preparatory infrastructure for `P10-RELIABILITY-HARNESS`. It does not claim Phase 10 completion and it does not change production behavior.

## Evidence classes

1. `ci-repository`: repository and CI proof. This is the only class repository automation may satisfy directly.
2. `persistent-mac`: retained-host service, install, upgrade, recovery, restart, reboot, and soak proof.
3. `simulator`: explicitly collected end-to-end Simulator proof.
4. `physical-device`: explicitly collected signed device build/install/launch proof.
5. `network-environment`: explicitly collected environment-path proof.
6. `external-beta-human`: external beta or human-attested proof.

The contract in `scripts/reliability/evidence-contract.js` assigns one passing provenance to each class. A fixture may be recorded as `fixture-passed`, but that state never satisfies a requirement. CI that happens to use a Simulator remains class 1 unless it is deliberately collected under the class-3 evidence protocol.

## Existing class-1 proof

At the dispatch base, `npm run check` already covers source checks, tests, compiled runtime, package content/install, and Homebrew verification. The opt-in clean Homebrew gate builds an isolated archive/formula, uses temporary state and a unique port, verifies setup/doctor, and checks service start/restart identity and health. The main workflow also runs iOS tests on an available Simulator.

Those are strong disposable class-1 checks. They are not persistent-Mac, physical-device, network/environment, or external-beta evidence.

The repository also has `scripts/ios/run-on-device.sh` for real device build/install/launch and `scripts/codex/open-simulator-session.sh` for starting Simulator sessions, but neither currently emits a durable evidence record.
