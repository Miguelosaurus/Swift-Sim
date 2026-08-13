# Architecture Consolidation Wave 2 Registry

Status: **Current correction-wave assignment overlay**

Read this after `ARCHITECTURE_CONSOLIDATION_WORKSTREAM_REGISTRY.md` and `ARCHITECTURE_CONSOLIDATION_WAVE1_REVIEW.md`. For Wave 2 dispatch, this file supersedes the first-wave status cells without rewriting the historical first-wave registry.

## Accepted first-wave feeder references

- P4-DIAGNOSTICS: PR #130, head `5313b17d1949ceced7830034c5f46e3ac0581baa`, Verify #1007 passed.
- P5-PRELOAD-INVENTORY: PR #129, head `90046c62d0aac445b17a25cfec85d4b915a34e3a`, Verify #969 passed.
- P6-LIVE-DECOMP-PREP: PR #126, head `ce015a3454a519aa2a9b9aabb59eeafe01ce0434`, Verify #962 passed.
- P7-ANALYZER-PREP: PR #135, head `ef368e49712862396a5069f1d84fd1da39f145c7`, Verify #1016 passed. Its preparation protocol is experimental until the Phase 6 seam is finalized.
- P8-COMPANION-PREP: PR #127, head `3254d184c97ae5be8c5ddedcdaea8419fead05f3`, Verify #963 passed.
- P9-CONSOLIDATION-INVENTORY: PR #133, head `5814ddb176916cd6f3a5c0382bdd6e98b60fff85`, Verify #971 passed.
- P10-RELIABILITY-HARNESS: PR #128, head `ea376f9d0ca146749189fda7fc1be28829f09998`, Verify #966 passed. Product support-field definitions come from P4-DIAGNOSTICS rather than this harness.
- WAVE1-AUDIT: PR #132, head `cf7b1a2cf0d1823a4351f66a206522eedc8d3e58`, Verify #975 passed.

These are reviewed inputs, not one combined tested tree.

## Wave 2 assignments

| ID | Status | Purpose |
| --- | --- | --- |
| P4-ARTIFACT-EXECUTION-R2 | READY | Re-run the source implementation that did not land in PR #136, including fresh-state checks immediately before an apply action. |
| P4-DEVICE-CUTOVER-FIX | READY | Correct the strict typing failures in PR #134 without changing its reviewed behavior or scope. |
| P4-SESSION-BOUNDARY | READY | Define and characterize the durable session projection separately from transient stream/runtime details, and reuse the proven legacy lock identity behavior. |
| P4-UPGRADE-EVIDENCE-FIX | READY | Keep the v0.6.1 compatibility evidence while avoiding root package ownership and consuming the reviewed device-cutover fixture semantics. |
| P4-SESSIONS-DOMAINS-R2 | BLOCKED | Starts only after P4-SESSION-BOUNDARY is reviewed and verified. |
| P4-INTEGRATION | BLOCKED | Starts only after the Wave 2 Phase 4 feeders are reviewed. |

## Dependency rules

1. Device-cutover fixtures are the provider vocabulary; upgrade evidence is a consumer.
2. The session boundary is frozen before any replacement repository/import implementation is accepted.
3. Phase 4 diagnostics define product support/redaction fields; reliability tooling wraps accepted output rather than inventing a parallel field model.
4. Phase 6 defines the future canonical analyzer seam; Phase 7 preparation remains noncanonical until that point.

No other new production lane is authorized by this overlay.
