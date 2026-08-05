// @ts-check

import { SWIFT_SIM_SQLITE_MIGRATIONS } from "./swiftSimSqliteDatabase.js";

/** @typedef {import("../contracts/repository.js").SchemaMigration} SchemaMigration */

/** @type {SchemaMigration} */
export const PAIRING_CREDENTIAL_MIGRATION = Object.freeze({
  version: 2,
  name: "pairing_credentials",
  statements: Object.freeze([
    `CREATE TABLE pairing_credentials (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      token TEXT NOT NULL CHECK (length(token) > 0),
      installation_id TEXT NOT NULL CHECK (length(installation_id) > 0),
      mac_name TEXT NOT NULL CHECK (length(mac_name) > 0),
      created_at TEXT NOT NULL CHECK (length(created_at) > 0),
      updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
    ) STRICT`,
  ]),
});

/**
 * Phase 4B schema set. The foundation default remains unchanged until a later
 * production-composition subphase explicitly enables the domain migration.
 * @type {readonly SchemaMigration[]}
 */
export const SWIFT_SIM_PAIRING_MIGRATIONS = Object.freeze([
  ...SWIFT_SIM_SQLITE_MIGRATIONS,
  PAIRING_CREDENTIAL_MIGRATION,
]);
