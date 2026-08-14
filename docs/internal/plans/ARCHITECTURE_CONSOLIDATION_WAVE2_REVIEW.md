# Architecture Consolidation Wave 2 Review

Status: **Orchestrator reconciliation complete**

Control parent: `76f8c67f2a606c1423870884b6a0c1a1f3453b5e` from independent Wave 2 audit PR #144.

This review is the binding disposition for the Wave 2 Phase 4 feeders. Individual worker handoffs remain evidence, not authority.

## Independent audit result

PR #144 at `76f8c67f2a606c1423870884b6a0c1a1f3453b5e` passed Verify #1070 and reported P0 0 / P1 0 / P2 1 / P3 0. It found every Wave 1 P1/P2 hazard closed at feeder/control-plane level and allowed the completed Wave 2 feeders to enter serialized integration.

The one P2 is integration ownership, not product semantics: PR #143 correctly persists the artifact freshness regression but directly edits root `package.json`. The integration lane must retain the regression test while re-homing its `check:compiled` registration into an orchestrator-owned integration commit rather than treating the worker package edit as policy.

## Accepted Phase 4 feeder heads

| Feeder | Exact accepted head | Hosted evidence | Disposition |
| --- | --- | --- | --- |
| P4-DIAGNOSTICS PR #130 | `5313b17d1949ceced7830034c5f46e3ac0581baa` | Verify #1007 passed | ACCEPT |
| P4-DEVICE-CUTOVER-FIX PR #139 | `d0b88d5b4f9bf616ee0edfca26d5f7a75290412c` | Verify #1051 passed | ACCEPT provider |
| P4-ARTIFACT-EXECUTION-R2 PR #140 | `c8edbb57b94dfb291a7cada84ae6a097408352cc` | Verify #1059 passed | ACCEPT source |
| Artifact freshness regression PR #143 | `32884c768ecd1e048170d4672d4bf407e2d95303` | Verify #1065 passed | ACCEPT test semantics; re-home root package registration |
| P4-SESSION-BOUNDARY PR #141 | `41269235243f836a2575de3f306ebb4ca342cad8` | Verify #1061 passed | ACCEPT frozen boundary |
| P4-UPGRADE-EVIDENCE-FIX PR #142 | `ec7b909199eea5adc62f4114b74463ad7f1d4c05` | Verify #1041 passed | ACCEPT consumer after device provider |
| P4-SESSIONS-DOMAINS-R2 PR #145 | `48d0ec2af9608522ff0e8cdb15a631cec29bb7e8` | Verify #1073 passed | ACCEPT durable-session feeder |

All remain draft/unmerged. Acceptance here means eligible input to the serialized integration branch, not direct merge approval.

## Sessions R2 orchestrator review

PR #145 is accepted as an integration feeder. It descends from the verified session boundary and preserves that boundary. Its SQLite fragment contains exactly `id`, `token`, `project`, `scheme`, `simulator_udid`, and `created_at`; there is no whole-record JSON, revision/updatedAt, stream/build/log/runtime/process field, PID, port, URL, worker, or runtime claim persistence.

Mixed legacy records pass through `projectDurableSession()` before normalization, persistence, and comparison. `SessionLegacyImportCoordinator.run()` executes the import applier inside `SessionLockedLegacySnapshotReader.withLockedSnapshot()`, so source read, deterministic backup, durable replacement, verification, and checkpoint publication remain under the compatible legacy lock. Production integration must instantiate that lock manager with `createSessionLegacyProcessIdentity`, preserving exact Darwin `/bin/ps -p <pid> -o lstart=` start-token identity and PID-reuse rejection.

The repository is unwired and JSON/session compatibility remains production-authoritative. No global schema/version/order or central composition was claimed by the worker.

One characterization strengthening is integration-owned: PR #145 proves a durable `scheme` change mismatches and hashes the full six-field record, but the integration suite should explicitly mutate each of the six durable fields in turn and prove each is mismatch-sensitive. This is test-strengthening, not a feeder correctness blocker.

## Serialized integration order

1. P4-SESSION-BOUNDARY PR #141.
2. P4-DEVICE-CUTOVER-FIX provider PR #139.
3. P4-UPGRADE-EVIDENCE-FIX consumer PR #142.
4. P4-DIAGNOSTICS PR #130.
5. P4-ARTIFACT-EXECUTION-R2 source PR #140, then retain PR #143's regression test while owning the root package registration in integration.
6. P4-SESSIONS-DOMAINS-R2 PR #145.
7. Shared P4 integration composition: global SQLite migration order, bounded repository construction, staged import/shadow observers, diagnostic probes, compatibility surfaces, and any root package/test registration.
8. Authority/cutover and rollback evidence only after the combined head is verified and persistent-environment evidence passes.

Provider/consumer order is mandatory. Shared red-zone surfaces are integration-owned.

## Integration invariants

- Do not activate SQLite authority merely by integrating feeders.
- Do not introduce permanent dual write.
- Do not delete legacy state or readers.
- Do not expose automatic historical artifact cleanup; apply remains explicit and must use the proven containment executor boundary.
- Do not persist session runtime/process ownership in SQLite.
- Diagnostics remains read-only/redacted and the sole Phase 4 product support-field owner.
- Preserve previous-release upgrade/rollback readability.
- Keep Phase 5 production work blocked until Phase 4 reaches its explicit gate.

## Next authorized work

`P4-INTEGRATION` is the only newly authorized Phase 4 production workstream. It must run serially on one integration branch. Other later-phase preparatory outputs remain accepted references but do not authorize production cutover.

Phase 4 is **not complete** after feeder integration alone. Final combined verification, shadow parity, upgrade/restart/corruption/rollback evidence, persistent-Mac evidence, and an explicit authority decision remain required.