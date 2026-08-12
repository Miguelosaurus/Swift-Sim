# Phase 4Z1 artifact-retention boundary

The real-Mac Phase 4X disk audit found `~/.swift-sim/device-builds` at 42.10 GiB: 36.79 GiB of per-build DerivedData, 4.02 GiB of archives, 13.03 MiB of result bundles, and approximately 1.27 GiB of exported IPA/app payloads. Of 212 referenced builds, 164 ready builds were superseded and 37 builds were failed.

Phase 4Z1 is intentionally unwired and non-destructive. It defines the future retention primitive only:

- ready build metadata and the exported install payload remain durable;
- heavyweight ready intermediates (`DerivedData`, archive, result bundle, and export-options scratch) are eligible for containment-checked pruning;
- failed roots are eligible only for an injected durable whole-root cleanup request after a 24-hour diagnostic grace period;
- no startup scan or historical cleanup is performed in this slice.

Historical cleanup of the existing 42.10 GiB requires a separate dry-run/reconciliation step and explicit local evidence before destructive activation.
