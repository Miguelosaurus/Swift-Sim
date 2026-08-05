// @ts-check

import { SWIFT_SIM_SQLITE_MIGRATIONS } from "./swiftSimSqliteDatabase.js";

/** @typedef {import("../contracts/repository.js").SchemaMigration} SchemaMigration */

/** @type {readonly SchemaMigration[]} */
export const PAIRING_SQLITE_MIGRATIONS = Object.freeze([
  ...SWIFT_SIM_SQLITE_MIGRATIONS,
  Object.freeze({
    version: 2,
    name: "pairing_state",
    statements: Object.freeze([
      `CREATE TABLE pairing_credentials (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        installation_id TEXT NOT NULL UNIQUE CHECK (length(installation_id) > 0),
        token TEXT NOT NULL UNIQUE CHECK (length(token) > 0),
        mac_name TEXT NOT NULL CHECK (length(mac_name) > 0),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT`,
      `CREATE TABLE pairing_invitations (
        id TEXT PRIMARY KEY CHECK (length(id) > 0),
        invite_hash TEXT NOT NULL UNIQUE CHECK (
          length(invite_hash) = 64 AND invite_hash NOT GLOB '*[^0-9a-f]*'
        ),
        installation_id TEXT NOT NULL,
        client_nonce TEXT,
        claimed INTEGER NOT NULL CHECK (claimed IN (0, 1)),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        expires_at TEXT NOT NULL CHECK (length(expires_at) > 0),
        claimed_at TEXT,
        CHECK (
          (claimed = 0 AND client_nonce IS NULL AND claimed_at IS NULL) OR
          (
            claimed = 1 AND
            client_nonce IS NOT NULL AND length(client_nonce) > 0 AND
            claimed_at IS NOT NULL AND length(claimed_at) > 0
          )
        ),
        FOREIGN KEY (installation_id)
          REFERENCES pairing_credentials(installation_id)
          ON DELETE CASCADE
      ) STRICT`,
      `CREATE INDEX pairing_invitations_installation_id_idx
        ON pairing_invitations(installation_id)`,
    ]),
    requiredTables: Object.freeze(["pairing_credentials", "pairing_invitations"]),
  }),
  Object.freeze({
    version: 3,
    name: "pairing_shadow_mismatch_evidence",
    statements: Object.freeze([
      `CREATE TABLE pairing_shadow_mismatches (
        mismatch_id TEXT PRIMARY KEY CHECK (
          length(mismatch_id) = 64 AND mismatch_id NOT GLOB '*[^0-9a-f]*'
        ),
        surface TEXT NOT NULL CHECK (surface IN ('credential', 'invitation')),
        key_hash TEXT NOT NULL CHECK (
          length(key_hash) = 64 AND key_hash NOT GLOB '*[^0-9a-f]*'
        ),
        legacy_projection_hash TEXT CHECK (
          legacy_projection_hash IS NULL OR (
            length(legacy_projection_hash) = 64 AND
            legacy_projection_hash NOT GLOB '*[^0-9a-f]*'
          )
        ),
        sqlite_projection_hash TEXT CHECK (
          sqlite_projection_hash IS NULL OR (
            length(sqlite_projection_hash) = 64 AND
            sqlite_projection_hash NOT GLOB '*[^0-9a-f]*'
          )
        ),
        first_observed_at TEXT NOT NULL CHECK (length(first_observed_at) > 0),
        last_observed_at TEXT NOT NULL CHECK (length(last_observed_at) > 0),
        observation_count INTEGER NOT NULL CHECK (observation_count >= 1),
        CHECK (legacy_projection_hash IS NOT sqlite_projection_hash)
      ) STRICT`,
      `CREATE INDEX pairing_shadow_mismatches_surface_key_idx
        ON pairing_shadow_mismatches(surface, key_hash, last_observed_at)`,
    ]),
    requiredTables: Object.freeze(["pairing_shadow_mismatches"]),
  }),
  Object.freeze({
    version: 4,
    name: "pairing_authority_state",
    statements: Object.freeze([
      `CREATE TABLE pairing_authority_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        mode TEXT NOT NULL CHECK (mode IN ('legacy', 'sqlite-rollback', 'sqlite-final')),
        source_revision TEXT CHECK (
          source_revision IS NULL OR (
            length(source_revision) = 64 AND source_revision NOT GLOB '*[^0-9a-f]*'
          )
        ),
        projection_hash TEXT CHECK (
          projection_hash IS NULL OR (
            length(projection_hash) = 64 AND projection_hash NOT GLOB '*[^0-9a-f]*'
          )
        ),
        cutover_at TEXT CHECK (cutover_at IS NULL OR length(cutover_at) > 0),
        rollback_expires_at TEXT CHECK (
          rollback_expires_at IS NULL OR length(rollback_expires_at) > 0
        ),
        finalized_at TEXT CHECK (finalized_at IS NULL OR length(finalized_at) > 0),
        revision INTEGER NOT NULL CHECK (revision >= 0),
        CHECK (
          (
            mode = 'legacy' AND
            source_revision IS NULL AND projection_hash IS NULL AND
            cutover_at IS NULL AND rollback_expires_at IS NULL AND finalized_at IS NULL
          ) OR
          (
            mode = 'sqlite-rollback' AND
            source_revision IS NOT NULL AND projection_hash IS NOT NULL AND
            cutover_at IS NOT NULL AND rollback_expires_at IS NOT NULL AND finalized_at IS NULL
          ) OR
          (
            mode = 'sqlite-final' AND
            source_revision IS NOT NULL AND projection_hash IS NOT NULL AND
            cutover_at IS NOT NULL AND rollback_expires_at IS NOT NULL AND finalized_at IS NOT NULL
          )
        )
      ) STRICT`,
      `INSERT INTO pairing_authority_state(
        singleton,
        mode,
        source_revision,
        projection_hash,
        cutover_at,
        rollback_expires_at,
        finalized_at,
        revision
      ) VALUES (1, 'legacy', NULL, NULL, NULL, NULL, NULL, 0)`,
    ]),
    requiredTables: Object.freeze(["pairing_authority_state"]),
  }),
]);
