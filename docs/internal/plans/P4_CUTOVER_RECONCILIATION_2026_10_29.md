# Phase 4 cutover reconciliation — 2026-10-29

Status: repository corrections complete; final exact-head verification is recorded in the draft PR. Real maintenance remains a separate gate.

## Recovered handoff

The user requested that Codex recover the interrupted Swift Sim project work and complete this chunk locally. The recovered source conversations are [Main Orchestrator Swift Sim](https://chatgpt.com/g/g-p-6a7e273d9dcc8191a5fa320be980c2cb/c/6a80dc9b-1650-83ed-a88f-9cdb039c2bf8) and [Agent 24](https://chatgpt.com/g/g-p-6a7e273d9dcc8191a5fa320be980c2cb/c/6a823d4c-f6f8-83ed-92a9-966fe6ca5801). The orchestrator stopped before receiving Agent 24's final result. Agent 24 completed its assigned P1 preflight correction; the planned Agent 25 corrections and Agent 26 review had not started. Codex workers are unnumbered; this continuation does not invent additional numbered web agents.

GitHub and the fetched local refs confirmed this exact lineage:

| Artifact | Exact product/audit head | Disposition |
| --- | --- | --- |
| Cutover implementation #152 | `3a1fb02c9ace97dfdd0637fc5ecb391e3570a77e` | Historical product input |
| Independent audit #153 | `273105b347d9068e0ae306a4e7690d85fba8488c` | Audit-only sibling; preserve |
| R1 correction #154 | `24c8905c80a02dbacbf507e704142ee816e8aca1` | Historical product input |
| Independent R1 audit #155 | `3c33c838a1f174b336039d8f683728365d6fb26b` | 0/1/3/2 findings; controlling correction specification |
| Agent 24 R2A #156 | `fdd2b72dc1ecc9f93163ca60fcea809cef13c0a5` | Verify #1164 / run 31979347580 was successful; exact continuation base |
| Codex R2 completion | `codex/swift-sim-p4-reconcile` | Ordinary child commits of #156; draft PR targets its R2 branch |

No audit commit was used as product ancestry. No previous branch was rewritten, merged, or force-moved. Read the continuation PR's exact head and checks for the frozen final SHA; a document cannot embed its own commit hash.

## Closed repository findings

- **P1 maintenance preflight:** retain Agent 24's stage-specific v7/v8 prefix, installed provenance, actual-helper journal, SQLite online backup, full-v9 reopen and four-backup proof. Additionally hold all four exact legacy locks across the asynchronous snapshot and migration/reopen gates. Bind ownership to exact PID/start token/lease nonce. Process inspection errors cannot prove absence. Publish the same Darwin identity under both `startToken` and legacy `startedAt`, so old writers cannot reclaim a live lease after 30 seconds. Create the snapshot privately before the online backup writes bytes. Read-only authority inspection uses the full corruption parser. Rollback readability requires all four private, contained, JSON-readable backups with byte digests bound through the persisted authority evidence, while allowing partial current-state rollback exports.
- **P2 authority corruption parser:** independently enforce exact storage version 1, every all-null legacy field, complete mode tuples, lowercase digest syntax, canonical JSON/hash identity, canonical UTC timestamps and semantic ordering under CHECK bypass. Corrupt authority blocks both reads and writes before backend selection.
- **P2 hybrid session recovery:** reconcile under the same existing session lock on open and every locked operation; stage, durable commit, runtime publication, completion and compensation stay serialized. Match exact intent/row/runtime identity, preserve conflicting replacements and fail closed. Existing readers hide unpublished intent rows. Current-state rollback export also reconciles under its lock, preventing a crashed unpublished row from becoming a legacy phantom.
- **P2 test integrity:** remove all five added source-text exceptions. The architecture scanner and immutable baseline measurement remain unchanged. Tests inspect disposable JSON/SQLite/sentinel bytes through a guarded temp-data fixture, not implementation source. The fixture rejects source filenames and escaping/renamed symlinks. Register all corrected behavioral suites in compiled-tree verification.

The independent Codex reviewer found the aged-lease and rollback-export residuals above, then rechecked their fixes. Its bounded final code-review result is **P0/P1/P2/P3 = 0/0/0/2**, conditional on final verification. This is a code review; it does not claim real-root or installed-upgrade proof.

## Preserved architecture

Migrations v1-v8 and v9 SQL are unchanged. v9 remains `phase4_global_authority_epoch`, checksum `1e7bae961d793a3ed8228499bb7b0996a6797964cff5349dcbe9dc43f989f37b`. It defaults to legacy authority. `session_records` remains exactly `id`, `token`, `project`, `scheme`, `simulator_udid`, `created_at`; bounded intent metadata does not acquire runtime ownership.

The global selector, atomic pairing fence, final four-lock equality/freshness activation, current-state rollback, revision/epoch fencing, and half-open rollback interval remain. Selected-backend failure propagates without fallback or merged reads. Ordinary startup, doctor/status and authority work remain destructive-cleanup inert. Diagnostics remain read-only, redacted and nonmutating. There is no finalization, expiry, legacy deletion, SQLite process-termination authority, or Phase 5 production work.

## Verification and proof boundaries

Local verification uses Node 24.19.0, disposable state roots and the compiled package. The full `npm run check` gate covers architecture, docs, types, format, lint, source/benchmark tests, compiled tests, hermetic runtime, package contents and clean package installation. Focused fault tests cover actual process exits and stale-owner recovery, interleaved independent creators/reconcilers, rollback after a crashed create, aged live leases against real legacy writers, v7/v8 migration success, withheld migration openers on false evidence, and each missing/corrupt rollback backup. YAML parsing and shell syntax are checked separately. Final counts/results and hosted Verify run are recorded in the continuation PR.

The default local Homebrew check validates formula syntax/layout and deliberately skips installation. Hosted Verify must additionally pass isolated clean Homebrew installation/service and iOS tests. CI's fresh runner is not the user's persistent installed-release upgrade. No local Simulator was needed for these storage corrections; no other task's simulator was changed.

Inventory at this continuation: 219 production source files (195 JavaScript, 17 TypeScript, 7 Swift), 30 preload/runtime-patch modules, 27 remaining historical source-text tests. The five new exceptions are gone; removing unrelated historical debt belongs to its planned phase. Largest inherited files remain `liveReload.js`, companion `SessionStore.swift`, and `ContentView.swift`.

## Remaining gates and next action

Exactly two environment-only P3 gates remain:

1. Real live-root migration/helper staging against the final audited v9 candidate, with exact snapshots, permissions, provenance, rollback evidence and observations.
2. Actual installed Homebrew v0.6.1 to final candidate upgrade/provenance/service proof, preserving the real installation and state.

After the final draft head is green, the next bounded action is a separately authorized maintenance-window requalification plan tied to that exact audited head. Authority activation remains a distinct decision after those gates. No real `~/.swift-sim` access/migration, installed Swift Sim upgrade, helper stop/restart, authority switch, rollback expiry, legacy deletion or artifact cleanup was performed here. No phase-stack merge is authorized by this report.

Rollback for this repository-only continuation: leave its draft PR unmerged and use the preserved #156 base. Do not rewrite validated ancestry or apply a downgrade to real user state.
