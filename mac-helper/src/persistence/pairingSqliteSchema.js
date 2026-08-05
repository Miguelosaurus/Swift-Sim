// @ts-check

import { SWIFT_SIM_SQLITE_MIGRATIONS } from "./swiftSimSqliteDatabase.js";

/** @typedef {import("../contracts/repository.js").SchemaMigration} SchemaMigration */

/** @type {readonly SchemaMigration[]} */
export const PAIRING_SHADOW_SQLITE_MIGRATIONS = Object.freeze([
  ...SWIFT_SIM_SQLITE_MIGRATIONS,
  Object.freeze({
    version: 2,
    name: "pairing_shadow_state",
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
        invite_hash TEXT NOT NULL UNIQUE CHECK (length(invite_hash) = 64),
        installation_id TEXT NOT NULL,
        client_nonce TEXT,
        claimed INTEGER NOT NULL CHECK (claimed IN (0, 1)),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        expires_at TEXT NOT NULL CHECK (length(expires_at) > 0),
        claimed_at TEXT,
        FOREIGN KEY (installation_id)
          REFERENCES pairing_credentials(installation_id)
          ON DELETE CASCADE
      ) STRICT`,
      `CREATE INDEX pairing_invitations_installation_id_idx
        ON pairing_invitations(installation_id)`,
    ]),
  }),
]);
