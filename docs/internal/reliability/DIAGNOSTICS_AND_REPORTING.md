# Diagnostics bundle and evidence report format

The reliability harness uses two related artifacts: an evidence report and a diagnostics bundle manifest. Neither is an authority source for production state.

## Evidence report

`evidence-report.template.json` is intentionally empty of pass claims. A concrete report should contain:

- `schemaVersion`;
- run identity, tested commit SHA, timestamps, and compatibility-matrix cell IDs;
- a list of requirements with stable IDs and exactly one evidence class each;
- zero or more observation records.

Each collected observation records `id`, `requirementId`, `evidenceClass`, `status`, provenance kind/reference, and environment identity when the class is irreducible. `scripts/reliability/evidence-contract.js` derives the summary from those records. There is no trusted hand-authored top-level pass flag.

`fixture-passed` is a useful observation state for validating a harness, but it leaves the underlying requirement `not-collected`.

## Diagnostics bundle manifest

A bundle manifest should contain:

- bundle ID, tested SHA, capture timestamp, and evidence class;
- relevant OS, Xcode, install-method, Simulator/device, and environment metadata;
- a redaction-review flag;
- a timestamped scenario timeline;
- read-only health/doctor output when available;
- service identity/state relevant to the observation;
- file names plus hashes for included logs or reports.

Do not include credentials, signing material, private keys, or unnecessary personal/device identifiers. Omit or pseudonymize identifiers unless they are required to diagnose the observation.

## Compatibility matrix linkage

`compatibility-matrix.template.json` defines the Phase 10 axes: macOS, Xcode, project size, dependency shape, code-signing mode, install history, and network shape. Concrete values belong to the later support-policy/evidence work, not this preparatory lane.

Each exercised matrix cell should list the evidence requirement IDs that must be satisfied. A cell is complete only when every referenced requirement is `passed` with provenance accepted for that requirement's evidence class. An empty axis, missing cell, fixture-only observation, or invalid provenance remains incomplete.
