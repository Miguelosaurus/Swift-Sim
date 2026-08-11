# Current architecture-consolidation handoff

Date: 2026-08-11

This is the current handoff for the live draft/unmerged architecture-consolidation stack. Reconcile GitHub/local state before acting if any newer commit exists.

## Operating rules

- Phase 2+ remains draft and unmerged. Do not merge or force-push.
- Preserve ordinary child history; corrections are new commits.
- JSON remains the sole production read/write authority until a later explicit, fenced cutover.
- Do not consume or manufacture persistent-machine, physical-device, network, or previous-release upgrade evidence in repository-only automation when the real machine is required.
- Final local verification is delegated to Codex/Luna; Miguel retains final merge authorization.
- Phase 5 must not start until Phase 4 is actually complete.

## Current active boundary

The device-build domain has advanced from repository/import infrastructure to **live optional SQLite shadow mode**, while JSON remains fully authoritative.

Hosted-green chain immediately before this handoff:

| Unit | PR | Exact implementation head | Hosted evidence |
| --- | ---: | --- | --- |
| 4H — resumable device-build legacy import | #98 | `6ba637f968e424538b719081d7564f1690251df0` | Verify #875 / `31484093720` |
| 4I — per-entity shadow comparison/evidence | #99 | `49adc9cfa917634bdb206e5ef2d22c9c628c3e09` | Verify #879 / `31502611382` |
| 4J — best-effort shadow observer | #101 | `3848fd04545a2ed16b2e65e94a2d2a0e3eb0dc4d` | Verify #881 / `31504098733` |
| 4K — exact legacy build-lock process identity | #102 | `a7a513245f1cffd3efc579d6b7233ace6063d177` | Verify #883 / `31505392635` |
| 4L — authorized deferred build-read hook | #103 | `c0d566be5380638f948d89c355a04c4a9508b9cb` | `31507362584` |
| 4M — unwired shadow runtime composition | #104 | `d634199df44d4b43e9fb60ed9459ce60fa81bafb` | Verify #889 / `31508718050` |
| 4N — revision-fenced live build evidence | #105 | `d7f4a6b452017651771d89c0dcef96f60c0a2648` | Verify #891 / `31512035071` |
| 4O — helper resource-close ownership | #106 | `5bc3cb05a36100abcb019a6ccd7f704d7e357a99` | Verify #892 / `31512813692` |
| 4P — fail-open shadow startup | #107 | `498418d1044931219ef914c8729b0f2221fb2645` | Verify #896 / `31513868022` |
| 4Q — canonical shared DB/backup/legacy-lock paths | #108 | `d812213e87cce9f17d718ba29371262e55c11406` | Verify #897 / `31513970006` |
| 4R — raw-source-loadable persistence graph | #109 | `445660eed1673d5a7d563803227650f4d2f437eb` | Verify #899 / `31515102535` |
| 4S — optional compatibility loader | #110 | `8f790b65c609a40dc59723496586c453b680fab8` | Verify #902 / `31516036240` |
| 4T — live optional device-build shadow wiring | #111 | `cf7e914c2f6e791edd06380578a83310417e0400` | Verify #903 / `31516642628` |
| 4U — private SQLite creation permissions | #112 | `588aacc46cd9482fc963c3ada3da709b6bfa0d81` | Verify #905 / `31517749763`; hardened live oracles `31517815886`, `31517976818` |

PR #100 is a useful historical sibling handoff but is not current product ancestry. This file supersedes it.

## What live shadow mode now does

Helper `serve` still constructs and uses `DeviceBuildStore` for every authoritative read and write. After interrupted-build recovery, it best-effort prepares the SQLite shadow:

1. derives sibling `state.sqlite` and domain-scoped backup paths from the authoritative JSON path;
2. acquires the exact legacy `device-builds.json.lock` protocol using the legacy-compatible Darwin `ps -o lstart=` identity;
3. makes an exact 0600 content-addressed backup under a 0700 backup parent;
4. imports/checkpoints the normalized device-build transactional snapshot resumably;
5. supplies the observer only to successful authorized read-only build-capability paths;
6. defers observation until after response publication;
7. compares live build projections only when SQLite and JSON build revisions are equal;
8. treats loader/path/SQLite/schema/lock/backup/import/reporting failure as optional diagnostics and continues JSON-only;
9. closes the optional DB only after server/session/build drain on graceful shutdown.

There is no production SQLite writer authority, no authority selector, no permanent dual write, and no legacy deletion.

## Hosted live-shadow evidence

Temporary macOS oracle `31516751742` against exact 4T head proved in an ephemeral HOME:

- raw-source helper startup;
- schema v7 migration;
- `device-build-state-v1` checkpoint;
- byte-equal content-addressed backup;
- `PRAGMA integrity_check = ok`;
- unchanged JSON hash;
- restart idempotency with one backup/checkpoint and seven migrations;
- deliberate unusable SQLite path still started JSON-only with only the generic fallback diagnostic.

That oracle discovered new SQLite mode 0644. Phase 4U fixes fresh SQLite/WAL/SHM creation by temporarily applying process umask 077 across the synchronous DB construction/migration window and restoring the previous umask in `finally`.

Hardened permission oracles `31517815886` and `31517976818` against exact 4U product head passed with assertions for:

- state root 0700;
- `state.sqlite` 0600;
- migration backup directory 0700;
- backup 0600;
- WAL/SHM 0600 when present;
- schema/checkpoint/integrity/restart/fail-open behavior unchanged.

## Why local verification is required now

The hosted proof deliberately uses disposable HOME/state. Before any device-build authority-state/cutover work is activated, verify shadow mode on the real local development machine against the actual existing Swift Sim state and service packaging without modifying or deleting legacy JSON.

Important local-only checks include:

- real existing `~/.swift-sim/device-builds.json` import and backup readability;
- persistent service restart behavior and permissions under the user's actual filesystem/umask/Homebrew environment;
- real shadow behavior across existing builds and ordinary subsequent JSON mutations, including revision-fenced stale-skip behavior;
- previous-tagged-release Homebrew upgrade path where safe;
- real Simulator/device/network checks available on the machine.

Do not switch authority during this verification.

## Phase 4 still incomplete

ADR-0003 classifies transactional apps, builds, sessions, pairing metadata, recipes, observations, and cleanup jobs as SQLite domain state. Device-build build/app/cleanup state is now shadowed; pairing has validated repository/import/authority/rollback primitives but is not merged; remaining Phase 4 work still includes:

- local device-build shadow evidence and review before any cutover activation;
- fenced device-build single-writer authority state/cutover and explicit read-only rollback window;
- device-build rollback export/readability evidence;
- session-domain normalized repository/import/shadow/authority work;
- other transactional recipe/observation state confirmed by the live writable-state inventory;
- `swift-sim doctor` schema/migration/permission/integrity/orphan checks;
- redacted export/diagnostic and actionable corruption recovery;
- previous-tagged-release clean Homebrew upgrade proof;
- final Phase 4 repository gate/audit.

Production authority cutover and Phase 5 preload removal remain unauthorized.

## Recommended continuation after local report

1. Reconcile the exact local/GitHub head and record the local evidence without changing authority.
2. Fix any local shadow defect as a bounded child PR and rerun hosted + local evidence.
3. Only with clean shadow evidence, implement device-build authority-state/cutover/rollback primitives as separate reversible slices; do not activate them in the same step that introduces the primitives.
4. Continue with session/remaining transactional domains and diagnostics/upgrade proof.
5. Keep the progress ledger and this handoff current.
