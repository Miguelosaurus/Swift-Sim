# P4-INTEGRATION

Status: **READY after Wave 2 reconciliation**  
Class: **implementation / serialized integration**  
Phase: **4**

Read `ARCHITECTURE_CONSOLIDATION_WAVE2_REVIEW.md` and `docs/internal/reviews/ARCHITECTURE_PARALLEL_WAVE2_AUDIT.md` before editing.

## Goal

Build one tested Phase 4 integration head from the independently accepted feeder implementations, resolving shared schema/composition/package ownership serially without activating a new authority prematurely.

This workstream owns shared Phase 4 integration surfaces. It does not claim Phase 4 completion or authorize Phase 5 production work.

## Exact feeder inputs

Use only these reviewed heads unless the orchestrator explicitly supplies a later correction:

- P4-SESSION-BOUNDARY PR #141: `41269235243f836a2575de3f306ebb4ca342cad8`
- P4-DEVICE-CUTOVER-FIX PR #139: `d0b88d5b4f9bf616ee0edfca26d5f7a75290412c`
- P4-UPGRADE-EVIDENCE-FIX PR #142: `ec7b909199eea5adc62f4114b74463ad7f1d4c05`
- P4-DIAGNOSTICS PR #130: `5313b17d1949ceced7830034c5f46e3ac0581baa`
- P4-ARTIFACT-EXECUTION-R2 PR #140: `c8edbb57b94dfb291a7cada84ae6a097408352cc`
- PR #143 accepted regression semantics: `32884c768ecd1e048170d4672d4bf407e2d95303`
- P4-SESSIONS-DOMAINS-R2 PR #145: `48d0ec2af9608522ff0e8cdb15a631cec29bb7e8`

Do not silently substitute sibling or stale heads.

## Required integration order

1. Preserve/fold in the P4-SESSION-BOUNDARY before session repository work.
2. Integrate P4-DEVICE-CUTOVER-FIX provider semantics.
3. Integrate P4-UPGRADE-EVIDENCE-FIX as a consumer of that provider.
4. Integrate P4-DIAGNOSTICS without inventing a second support schema.
5. Integrate P4-ARTIFACT-EXECUTION-R2 source.
6. Bring in the PR #143 artifact regression test semantics, but do not preserve worker ownership of root `package.json`; register the compiled test in an integration-owned commit.
7. Integrate P4-SESSIONS-DOMAINS-R2 after the frozen boundary.
8. Compose shared schema and staged runtime wiring.

Use ordinary merge/cherry-pick commits; do not rewrite validated feeder history. Resolve conflicts narrowly and record every semantic conflict resolution in the PR handoff.

## Shared schema ownership

This workstream owns the global SQLite migration ordering needed to consume accepted fragments.

The current Phase 4 schema is a prefix chain: `SWIFT_SIM_SQLITE_MIGRATIONS` owns v1, `PAIRING_SQLITE_MIGRATIONS` extends it through v5, and `DEVICE_BUILD_SQLITE_MIGRATIONS` extends it through v7. `SwiftSimSqliteDatabase` intentionally rejects applied versions absent from the migration list supplied by an opener. Therefore the session migration must become the next globally ordered migration (normally v8 unless inspection proves a newer accepted migration already exists), and **every production opener of the shared `state.sqlite` must be moved to the same complete Phase 4 migration history**. It is invalid to create a v8 database and leave a pairing/runtime opener using only the v1–5 prefix, because that opener would reject the newer schema. Preserve prefix exports only where useful for isolated historical tests; shared production composition must use one complete ordered list.

For sessions, use exactly `SESSION_DURABLE_SQLITE_SCHEMA_STATEMENTS` and `SESSION_DURABLE_SQLITE_REQUIRED_TABLES`. The resulting `session_records` durable table must contain only:

- `id`
- `token`
- `project`
- `scheme`
- `simulator_udid`
- `created_at`

Do not add `record_json`, revision/updated timestamps, stream/build/log/runtime/process fields, PID, port, URL, worker/engine state, or any runtime claim.

Reuse existing global checkpoint infrastructure where compatible rather than creating a parallel checkpoint truth.

Add migration compatibility tests that open an existing schema-v7 database with the complete integration migration list, upgrade it to the new session schema, close/reopen it, and prove all production shared-state openers accept the resulting latest schema rather than reporting it as "newer than this Swift Sim build."

## Session composition

Construct the legacy session lock path using the existing compatible legacy lock request and instantiate its `NodeLockManager` with `createSessionLegacyProcessIdentity` / exact Darwin start-token semantics.

Compose durable session import/shadow behavior only as a staged migration observer. JSON/session compatibility remains production-authoritative in this workstream unless a later explicit authority/cutover sub-step is separately authorized after evidence.

Add integration characterization that mutates each of the six durable session fields individually and proves each durable mutation creates a shadow mismatch, while runtime-only mutation continues to compare equal.

## Device cutover / upgrade composition

P4-DEVICE-CUTOVER-FIX is the provider vocabulary. Preserve its legacy-authoritative compatibility behavior and export/rollback epoch semantics. P4-UPGRADE-EVIDENCE-FIX must consume those semantics; do not let the fixture define a second model.

No SQLite authority activation is implied by integrating the provider modules.

## Artifact maintenance composition

Preserve PR #140's freshness fences. Any executable historical reclamation must still re-read authoritative build state immediately before destructive action and fail closed on revision, root, lifecycle, policy, or measurement drift.

Bind the executor seam only to the proven contained artifact-store deletion boundary or an equivalently characterized adapter. Do not replace containment with raw recursive filesystem deletion.

Historical maintenance remains explicit operator action. Do not wire automatic startup/background orphan/manual-review cleanup.

Retain `test/deviceBuildArtifactMaintenanceService.test.ts` from PR #143 and register it in the compiled test gate from an integration-owned root-package commit.

## Diagnostics composition

P4-DIAGNOSTICS remains read-only, redacted, mutation-disabled, and the sole Phase 4 product support-field owner. Central doctor/support composition may consume these projections but must not create a competing product schema.

## Authority / rollback constraints

During this integration workstream:

- keep current legacy JSON authority recorded and active;
- no permanent dual write;
- no legacy-state deletion;
- no rollback-reader removal;
- no rollback-window expiry;
- no process/filesystem termination authority from SQLite rows;
- no Phase 5 production work.

If a feeder cannot be integrated without violating one of these constraints, stop and report the blocker rather than broadening scope.

## Verification

Run after each meaningful red-zone composition cluster where practical, and always at the final exact head:

- focused feeder tests affected by conflict resolution;
- session durable/import/shadow/lock tests;
- device cutover/export/rollback tests;
- previous-release upgrade evidence;
- diagnostics/redaction tests;
- artifact maintenance freshness/containment tests;
- shared SQLite v7 -> latest migration and reopen/older-opener compatibility tests;
- architecture check;
- strict types;
- lint/format;
- full `npm run check`;
- exact-head hosted Verify including clean Homebrew/service and iOS.

Persistent real-Mac migration/corruption/rollback evidence may remain a separate post-integration gate; do not fabricate it.

## Deliverables

Return:

- one draft integration PR;
- exact integration head SHA;
- exact feeder SHAs actually integrated;
- conflict-resolution ledger;
- final global schema migration/version change;
- list of every shared `state.sqlite` production opener and the complete migration list it now uses;
- exact runtime composition added, with authority state stated explicitly;
- proof that PR #143 package ownership was re-homed;
- six-field session mismatch-sensitivity characterization;
- hosted Verify result;
- explicit list of remaining Phase 4 cutover/evidence blockers.

Do not merge the PR.