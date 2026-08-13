# Reliability scenario catalog

Use stable scenario IDs when Phase 10 evidence is collected. Each observation must name one of the six evidence classes from the reliability README and carry class-correct provenance.

## Installation, package, and upgrade

- clean npm archive install: class 1;
- isolated clean Homebrew install/service restart: class 1;
- previous-supported-release upgrade with retained user state: class 2;
- fresh-versus-upgraded host comparison: class 2.

## Persistent service

Collect service identity and health across stop/start, process restart, user login, host reboot, sleep/wake, and a retained-state operating interval. These are class-2 observations even when class-1 fixtures exercise similar lifecycle code.

## Simulator and physical device

Interactive Simulator session/live-preview evidence is class 3. Signed build/install/launch and reconnect/retry on real hardware is class 4. Existing CI Simulator tests remain class 1 unless a dedicated class-3 collection run records the environment and artifacts.

## Network/environment

Collect representative local and remote paths plus interface changes relevant to supported use. Record the environment shape and failure/recovery timeline. These observations are class 5; deterministic protocol fixtures remain class 1.

## Corruption, recovery, and rollback

Repository tests should cover deterministic damaged-state, interrupted-operation, retry, recovery, and rollback fixtures wherever possible. A fixture can prove the recovery mechanism in class 1, but retained-host recovery/rollback evidence remains class 2 until collected on a real persistent Mac.

## Diagnostics and external beta

Diagnostics format/redaction checks are class 1. A diagnostics bundle captured during a real environment run inherits that run's evidence class. External-user workflow observations and human review are class 6 and require explicit human-attestation provenance.

## Long-lived reliability

A short loop is a class-1 harness check. A real soak is class 2 and records tested SHA, host/install history, start/end timestamps, workload cadence, lifecycle transitions, observed failures/recoveries, and diagnostics references. Device or environment-specific soak observations additionally remain in classes 4 or 5 rather than being collapsed into class 2.
