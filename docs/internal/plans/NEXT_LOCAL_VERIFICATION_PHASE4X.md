# Phase 4X Focused Local Verification

Verification only. Do not edit, commit, push, merge, or switch SQLite authority.

## Exact product head

`63ceccdc630fc6c6c9d4aba9e3cb397b95c503a6`

This head combines the three remediations from the previous real-Mac report:

- historical device-build compatibility before strict SQLite validation,
- existing Swift Sim state-root hardening to `0700`,
- restricted-PATH Homebrew `lsof` resolution.

JSON must remain the sole authoritative read/write path throughout this verification.

## Focused checks

1. Before touching migration state, record SHA-256 and modes for the real `~/.swift-sim/device-builds.json`, the existing `~/.swift-sim` directory, `state.sqlite` if present, and the existing migration backup/checkpoint artifacts. Do not alter legacy JSON bytes.
2. Using the exact product head and the existing real device-build state, rerun the device-build shadow import without switching authority. The previous run had 212 builds and failed before writing domain rows because four historical records lacked compatibility fields.
3. Confirm all 212 real build records now import successfully. Record the import status, `device_builds` row count, checkpoint evidence, source/projection hashes, schema version, `PRAGMA integrity_check`, `PRAGMA foreign_keys`, and WAL checkpoint result.
4. Confirm the content-addressed legacy backup remains byte-identical to the authoritative JSON and that the authoritative JSON SHA-256 is unchanged before/after import.
5. Confirm permissions after shadow initialization:
   - `~/.swift-sim` is `0700`,
   - durable JSON is `0600`,
   - `state.sqlite` and any live WAL/SHM files are `0600`,
   - migration backup directories are `0700`,
   - backup files are `0600`.
   The state-root mode change is expected metadata hardening; legacy JSON bytes must not change.
6. In disposable state, repeat the revision-fence mutation check: after a normal JSON save increments a build revision, the stale SQLite projection must be skipped and must not record a false mismatch; after re-import it may compare again.
7. Re-run the clean Homebrew package/service gate using the same restricted PATH class that previously omitted `/usr/sbin`, for example:

   ```sh
   SWIFT_SIM_RUN_CLEAN_HOMEBREW=1 \
   PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin \
   /opt/homebrew/opt/node@24/bin/npm run check:package
   ```

   It must no longer fail because `lsof` is absent from PATH. Do not overwrite or remove pre-existing real `swift-sim` launchers; report any launcher/link/headerpad warnings separately from the verification result.
8. Confirm SQLite-unavailable startup still falls back to JSON-only, the helper can shut down/restart cleanly in isolated state, and no SQLite authority selector or dual-write path has been activated.

## Report back

Return:

- exact SHA and worktree used,
- exact commands run,
- before/after JSON hashes and filesystem modes,
- real import status and row/checkpoint/schema/integrity evidence,
- restricted-PATH Homebrew result,
- pass/fail for each focused check,
- full details for any failure.

Do not fix failures during this run. Explicitly confirm whether any legacy JSON bytes or authoritative behavior changed.
