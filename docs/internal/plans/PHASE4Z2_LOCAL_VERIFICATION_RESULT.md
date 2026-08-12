# Phase 4Z2 real-Mac verification result

Verified on 2026-08-12 against exact product head `19547d52881ed70288f270f98c2b48ba9f333238` in detached worktree `/private/tmp/swift-sim-verify-19547d`. The existing real helper was not restarted.

## Shadow import

- authoritative JSON: `12,475,170` bytes, mode `0600`
- JSON SHA-256 before/after: `380329ddfbfb4699e705b708ac2c2273dea629b587c1a4167e2e86ad1f151f42` (identical)
- backup directory/file modes: `0700` / `0600`; backup hash identical
- import result: `applied`
- imported builds: `212/212`
- SQLite rows: builds `212`, apps `0`, artifact cleanup `0`, delivery cleanup `0`
- checkpoint record count: `212`
- checkpoint projection hash: `2684b7e74aa663a5168bfd4ccf12f2585af667c3849d91774f5c54ec4939c6d2`
- checkpoint source revision: `34c64d7dad17030625f65399208051c93ec2a086af1fc0fc71c6d4e878729d7a`
- schema `7/7`, WAL, foreign keys enabled, zero FK violations, integrity `ok`, shadow mismatches `0`
- SQLite shadow changed from the prior empty database as expected; SQLite authority was not activated

This closes the known historical device-build import compatibility gap. JSON bytes and production authority behavior remained unchanged.

## Future-retention disposable proof

Focused exact-head retention tests passed `63/63`.

- non-live ready: metadata, export directory, and IPA survived; `DerivedData`, archive, result bundle, and `ExportOptions.plist` were removed
- `liveReload.compilerReady: true`: metadata, IPA, and `DerivedData` survived; archive/result/scratch were removed
- failed build: exactly one deduplicated cleanup job scheduled 24 hours later; no immediate deletion
- cleanup outside canonical `device-builds/<build-id>` root was rejected
- helper startup with disposable HOME did not scan/delete historical sentinels
- retention failure remained nonfatal to ready build state

## Historical artifact audit — read only

`~/.swift-sim/device-builds` totals `44,144,176 KiB` / `42.099167 GiB` across 213 directories. Current JSON references 212 roots; the sole unreferenced root is empty.

Artifact totals:

| Type | Count | KiB | GiB |
| --- | ---: | ---: | ---: |
| `DerivedData` | 145 | 38,579,140 | 36.791935 |
| `.xcarchive` | 47 | 4,213,268 | 4.018085 |
| `.xcresult` | 137 | 13,340 | 0.012722 |
| IPA/app payloads | 417 | 1,335,612 | 1.273739 |
| Other | — | 2,628 | 0.002506 |

Build classification:

- ready, non-live: 50
- ready, `compilerReady`: 125
- failed: 37
- other: 0
- `compilerReady` appears on 128 total records: 125 ready + 3 failed
- ready compiler-ready `DerivedData`: `33,312,980 KiB` / `31.769733 GiB`
- all compiler-ready `DerivedData`: `34,029,656 KiB` / `32.453209 GiB`

Current safe-policy reclaimable estimate:

| Bucket | KiB | GiB |
| --- | ---: | ---: |
| non-live ready intermediates | 4,212,236 | 4.017101 |
| live-ready archive/result/scratch | 12,288 | 0.011719 |
| failed whole roots after 24h | 5,271,068 | 5.026882 |
| **total** | **9,495,592** | **9.055702** |

IPA/export payloads and live-ready `DerivedData` are excluded from reclaimable bytes.

There are 11 latest nonfailed app builds totaling `3.360130 GiB` and 164 superseded ready builds totaling `33.712154 GiB`. No build is active.

## Live ownership remains ambiguous

`live/compilations.json` contains 89 compilation entries and references only build root `9cc7873c-a21b-4c06-b980-7a2bdf4dfc96`, which is latest for its app and matches the engine project. However, the live metadata has no durable build ID or session lease, `sessions.json` contains no build-root references, and the compilation snapshot is dated 2026-08-03.

Therefore the current metadata identifies a candidate but does not prove current-vs-superseded live ownership. Historical live-ready `DerivedData` remains protected until an explicit ownership/supersession lifecycle exists.

## Gates and final-state confirmation

- full `npm run check`: PASS, including `669/669` npm tests
- clean Homebrew package/service gate: PASS; the previous restricted-PATH `lsof` failure did not recur
- state root `0700`; JSON/SQLite/backup files `0600`; backup directories `0700`
- historical artifact pre/post manifest: identical 213 roots / `44,144,176 KiB`
- no historical artifact was deleted, moved, truncated, or compressed
- legacy JSON bytes unchanged
- JSON remained authoritative

Real Simulator/device/network upgrade testing was outside this focused Phase 4Z2 rerun.