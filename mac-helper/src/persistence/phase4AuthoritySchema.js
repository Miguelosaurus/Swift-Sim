// @ts-check

/**
 * Migration v9 is intentionally product-global. Pairing's v7 authority row is
 * domain-local and cannot safely coordinate device-build and durable-session
 * authority. This selector is the single Phase-4 commit point; v1-v8 remain
 * byte-for-byte immutable.
 */
export const PHASE4_AUTHORITY_SQLITE_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE phase4_authority_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    storage_version INTEGER NOT NULL CHECK (storage_version = 1),
    mode TEXT NOT NULL CHECK (mode IN ('legacy', 'preparing', 'sqlite-rollback', 'sqlite-final')),
    revision INTEGER NOT NULL CHECK (revision >= 0 AND revision <= 9007199254740991),
    cutover_epoch INTEGER NOT NULL CHECK (cutover_epoch >= 0 AND cutover_epoch <= 9007199254740991),
    preparation_id TEXT CHECK (
      preparation_id IS NULL OR (
        length(preparation_id) = 64 AND preparation_id NOT GLOB '*[^0-9a-f]*'
      )
    ),
    evidence_hash TEXT CHECK (
      evidence_hash IS NULL OR (
        length(evidence_hash) = 64 AND evidence_hash NOT GLOB '*[^0-9a-f]*'
      )
    ),
    evidence_json TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json)),
    prepared_at TEXT CHECK (prepared_at IS NULL OR length(prepared_at) > 0),
    cutover_at TEXT CHECK (cutover_at IS NULL OR length(cutover_at) > 0),
    rollback_expires_at TEXT CHECK (rollback_expires_at IS NULL OR length(rollback_expires_at) > 0),
    finalized_at TEXT CHECK (finalized_at IS NULL OR length(finalized_at) > 0),
    updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
    CHECK (
      (mode = 'legacy' AND preparation_id IS NULL AND evidence_hash IS NULL AND evidence_json IS NULL
        AND prepared_at IS NULL AND cutover_at IS NULL AND rollback_expires_at IS NULL AND finalized_at IS NULL)
      OR
      (mode = 'preparing' AND preparation_id IS NOT NULL AND evidence_hash IS NOT NULL AND evidence_json IS NOT NULL
        AND prepared_at IS NOT NULL AND cutover_at IS NULL AND rollback_expires_at IS NULL AND finalized_at IS NULL)
      OR
      (mode = 'sqlite-rollback' AND preparation_id IS NOT NULL AND evidence_hash IS NOT NULL AND evidence_json IS NOT NULL
        AND prepared_at IS NOT NULL AND cutover_at IS NOT NULL AND rollback_expires_at IS NOT NULL
        AND rollback_expires_at > cutover_at AND finalized_at IS NULL)
      OR
      (mode = 'sqlite-final' AND preparation_id IS NOT NULL AND evidence_hash IS NOT NULL AND evidence_json IS NOT NULL
        AND prepared_at IS NOT NULL AND cutover_at IS NOT NULL AND rollback_expires_at IS NOT NULL
        AND rollback_expires_at > cutover_at AND finalized_at IS NOT NULL AND finalized_at >= rollback_expires_at)
    )
  ) STRICT`,
  `INSERT INTO phase4_authority_state(
    singleton, storage_version, mode, revision, cutover_epoch,
    preparation_id, evidence_hash, evidence_json, prepared_at,
    cutover_at, rollback_expires_at, finalized_at, updated_at
  ) VALUES (
    1, 1, 'legacy', 0, 0,
    NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, '1970-01-01T00:00:00.000Z'
  )`,
]);

export const PHASE4_AUTHORITY_SQLITE_REQUIRED_TABLES = Object.freeze([
  "phase4_authority_state",
]);
