# Architecture Consolidation Wave 2 Registry

Status: **Wave 2 reconciled; serialized Phase 4 integration authorized**

Read this after `ARCHITECTURE_CONSOLIDATION_WORKSTREAM_REGISTRY.md`, `ARCHITECTURE_CONSOLIDATION_WAVE1_REVIEW.md`, `ARCHITECTURE_CONSOLIDATION_WAVE2_REVIEW.md`, and the independent Wave 2 audit in `docs/internal/reviews/ARCHITECTURE_PARALLEL_WAVE2_AUDIT.md`.

## Accepted first-wave feeder references

- P4-DIAGNOSTICS: PR #130, head `5313b17d1949ceced7830034c5f46e3ac0581baa`, Verify #1007 passed.
- P5-PRELOAD-INVENTORY: PR #129, head `90046c62d0aac445b17a25cfec85d4b915a34e3a`, Verify #969 passed.
- P6-LIVE-DECOMP-PREP: PR #126, head `ce015a3454a519aa2a9b9aabb59eeafe01ce0434`, Verify #962 passed.
- P7-ANALYZER-PREP: PR #135, head `ef368e49712862396a5069f1d84fd1da39f145c7`, Verify #1016 passed. Its preparation protocol remains experimental until the Phase 6 seam is finalized.
- P8-COMPANION-PREP: PR #127, head `3254d184c97ae5be8c5ddedcdaea8419fead05f3`, Verify #963 passed.
- P9-CONSOLIDATION-INVENTORY: PR #133, head `5814ddb176916cd6f3a5c0382bdd6e98b60fff85`, Verify #971 passed.
- P10-RELIABILITY-HARNESS: PR #128, head `ea376f9d0ca146749189fda7fc1be28829f09998`, Verify #966 passed. Product support-field definitions come from P4-DIAGNOSTICS rather than this harness.
- WAVE1-AUDIT: PR #132, head `cf7b1a2cf0d1823a4351f66a206522eedc8d3e58`, Verify #975 passed.

These remain reviewed inputs, not one combined tested tree.

## Wave 2 disposition

| ID | Status | Accepted evidence / rule |
| --- | --- | --- |
| P4-ARTIFACT-EXECUTION-R2 | VERIFIED FEEDER | PR #140 `c8edbb57b94dfb291a7cada84ae6a097408352cc`, Verify #1059 passed. |
| P4-ARTIFACT-FRESHNESS-REGRESSION | VERIFIED WITH INTEGRATION OWNERSHIP NOTE | PR #143 `32884c768ecd1e048170d4672d4bf407e2d95303`, Verify #1065 passed. Preserve test semantics; root package registration is re-homed by P4-INTEGRATION. |
| P4-DEVICE-CUTOVER-FIX | VERIFIED FEEDER | PR #139 `d0b88d5b4f9bf616ee0edfca26d5f7a75290412c`, Verify #1051 passed. Provider vocabulary. |
| P4-SESSION-BOUNDARY | VERIFIED FROZEN BOUNDARY | PR #141 `41269235243f836a2575de3f306ebb4ca342cad8`, Verify #1061 passed. |
| P4-UPGRADE-EVIDENCE-FIX | VERIFIED FEEDER | PR #142 `ec7b909199eea5adc62f4114b74463ad7f1d4c05`, Verify #1041 passed. Consumer after device provider. |
| P4-SESSIONS-DOMAINS-R2 | VERIFIED FEEDER | PR #145 `48d0ec2af9608522ff0e8cdb15a631cec29bb7e8`, Verify #1073 passed. Exact six-field durable session projection only. |
| WAVE2-AUDIT | VERIFIED REVIEW | PR #144 `76f8c67f2a606c1423870884b6a0c1a1f3453b5e`, Verify #1070 passed; P0 0 / P1 0 / P2 1 / P3 0. |
| P4-INTEGRATION | READY — ONLY ACTIVE P4 PRODUCTION LANE | Serialize the accepted feeders and own shared schema/composition/package surfaces. |

## Dependency rules

1. P4-SESSION-BOUNDARY stays frozen and precedes session repository integration.
2. Device-cutover fixtures are the provider vocabulary; upgrade evidence is a consumer and must follow the provider.
3. PR #143 regression semantics are accepted, but root `package.json` ownership belongs to P4-INTEGRATION.
4. Phase 4 diagnostics define product support/redaction fields; reliability tooling wraps accepted output rather than inventing a parallel field model.
5. Phase 6 defines the future canonical analyzer seam; Phase 7 preparation remains noncanonical until that point.
6. Shared SQLite migration order, central helper/CLI composition, authority routing, and root package/test registration are integration-owned red-zone surfaces.

## Authority state

Wave 2 does not activate SQLite authority, does not authorize permanent dual write, does not delete legacy state/readers, and does not authorize automatic historical artifact cleanup. Those remain later Phase 4 decisions after the combined integration head and required persistent-environment evidence.

No other new Phase 4 production lane is authorized by this overlay.